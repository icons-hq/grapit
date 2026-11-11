import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type IORedis from 'ioredis';
import type { AnalyticsQuery, AnalyticsReport } from '@grabit/shared';
import type { DrizzleDB } from '../../database/drizzle.provider.js';
import { REDIS_CLIENT } from '../booking/providers/redis.provider.js';
import { ANALYTICS_DB } from './analytics-database.module.js';
import { ANALYTICS_ACTIVE_KEY, AnalyticsService } from './analytics.service.js';

const array = (query: SQL) => sql`(select coalesce(jsonb_agg(x), '[]'::jsonb) from (${query}) x)`;
const iso = (at: unknown) => at ? new Date(at as string).toISOString() : null;
function funnel(rows: Array<{ name: string; count: number }>) {
  return rows.map((r, i) => ({ ...r, rate: rows[0]?.count ? Math.round(1000 * r.count / rows[0].count) / 10 : 0,
    dropoff: i === 0 ? 0 : Math.max(0, rows[i - 1]!.count - r.count) }));
}
@Injectable()
export class AnalyticsReportService {
  constructor(@Inject(ANALYTICS_DB) private readonly db: DrizzleDB, @Inject(AnalyticsService) private readonly analytics: AnalyticsService,
    @Inject(REDIS_CLIENT) private readonly redis: IORedis) {}

  async report(query: AnalyticsQuery): Promise<AnalyticsReport> {
    const since = new Date(query.since).toISOString();
    const until = new Date(Math.min(Date.parse(query.until), Date.now())).toISOString();
    if (since >= until || Date.parse(since) < Date.now() - 90 * 86400000) throw new BadRequestException('최근 90일 내의 과거 조회 구간을 선택해주세요');
    const previous = new Date(Date.parse(since) - (Date.parse(until) - Date.parse(since))).toISOString();
    const config = await this.analytics.config();
    const active = typeof this.redis.zcount === 'function' ? await this.redis.zcount(ANALYTICS_ACTIVE_KEY, Date.now() - 300_000, '+inf').catch(() => null) : null;
    const result = await this.db.execute(sql`with
      e as materialized (select * from analytics_events where occurred_at >= ${since}::timestamptz and occurred_at < ${until}::timestamptz),
      s as materialized (select * from analytics_sessions where id in (select session_id from e)),
      new_users as materialized (select id, created_at from users where role = 'user' and account_status <> 'merged' and created_at >= ${since}::timestamptz and created_at < ${until}::timestamptz),
      paid as materialized (select distinct p.reservation_id, r.user_id, st.performance_id, p.paid_at from payments p join reservations r on r.id = p.reservation_id
        join users u on u.id = r.user_id join showtimes st on st.id = r.showtime_id
        where p.paid_at >= ${since}::timestamptz and p.paid_at < ${until}::timestamptz and p.status in ('DONE','PARTIAL_CANCELED','CANCELED') and r.status in ('CONFIRMED','CANCELLED') and u.role = 'user'),
      visits as (select session_id, min(occurred_at) as at from e where name = 'page_view' group by 1),
      detail as (select e.session_id, e.props->>'performanceId' as performance, min(e.occurred_at) as at from e join visits v using(session_id)
        where e.name = 'performance_view' and e.occurred_at >= v.at group by 1,2),
      seats as (select e.session_id, d.performance, min(e.occurred_at) as at from e join detail d using(session_id)
        where e.name = 'seat_select' and e.props->>'performanceId' = d.performance and e.occurred_at >= d.at group by 1,2),
      checkout as (select e.session_id, s.performance, min(e.occurred_at) as at from e join seats s using(session_id)
        where e.name = 'checkout_start' and e.props->>'performanceId' = s.performance and e.occurred_at >= s.at group by 1,2),
      converted as (select distinct on (p.reservation_id) p.reservation_id, c.session_id from checkout c join s on s.id = c.session_id
        join paid p on p.user_id = s.user_id and p.performance_id::text = c.performance and p.paid_at >= c.at and p.paid_at <= s.last_seen_at + interval '30 minutes'
        order by p.reservation_id, c.at desc, c.session_id),
      signup_sessions as (select distinct on (u.id) u.id as user_id, s.id as session_id from new_users u join s on s.user_id = u.id join visits v on v.session_id = s.id
        where u.created_at >= v.at and u.created_at <= s.last_seen_at + interval '30 minutes' order by u.id, v.at desc, s.id),
      page_counts as (select session_id, count(*) filter(where name='page_view')::int as views from e group by 1),
      exits as (select distinct on(session_id) session_id, path from e where name='page_view' order by session_id, occurred_at desc, id desc),
      acquired as (select a.*, u.created_at from analytics_attribution a join new_users u on u.id=a.user_id
        where u.created_at >= a.first_at and u.created_at <= a.updated_at and a.updated_at >= now()-interval '90 days'),
      raw_trend as (select date_trunc(${query.granularity}, e.occurred_at at time zone 'Asia/Seoul') at time zone 'Asia/Seoul' as bucket,
        count(distinct s.visitor_id)::int as visitors, count(distinct e.session_id)::int as sessions, count(*) filter(where e.name='page_view')::int as page_views
        from e join s on s.id=e.session_id group by 1)
      select jsonb_build_object(
        'visitors',(select count(distinct visitor_id)::int from s), 'sessions',(select count(*)::int from s), 'pageViews',(select count(*)::int from e where name='page_view'),
        'returningVisitors',(select count(distinct s.visitor_id)::int from s where exists(select 1 from analytics_sessions old where old.visitor_id=s.visitor_id and old.started_at<s.started_at)),
        'previousVisitors',(select count(distinct ps.visitor_id)::int from analytics_events pe join analytics_sessions ps on ps.id=pe.session_id where pe.occurred_at>=${previous}::timestamptz and pe.occurred_at<${since}::timestamptz),
        'signups',(select count(*)::int from new_users), 'paidOrders',(select count(distinct reservation_id)::int from paid),
        'cancelledOrders',(select count(distinct c.reservation_id)::int from (
          select reservation_id from ticket_items where status='cancelled' and cancelled_at>=${since}::timestamptz and cancelled_at<${until}::timestamptz
          union select reservation_id from payments where status in ('CANCELED','PARTIAL_CANCELED') and cancelled_at>=${since}::timestamptz and cancelled_at<${until}::timestamptz
        ) c join reservations r on r.id=c.reservation_id join users u on u.id=r.user_id where u.role='user' and r.status in ('CONFIRMED','CANCELLED'))
      ) as summary,
      (select max(received_at) from analytics_events) as "lastCollectedAt",
      (select max(updated_at) from analytics_rollups) as "rollupThrough",
      ${array(sql`select to_char(t.bucket at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') as hour,
        coalesce(r.visitors,t.visitors) as visitors, coalesce(r.sessions,t.sessions) as sessions, coalesce(r.page_views,t.page_views) as "pageViews"
        from raw_trend t left join analytics_rollups r on r.grain=${query.granularity} and r.bucket=t.bucket
          and r.bucket>=${since}::timestamptz and r.bucket + (case when ${query.granularity}='day' then interval '1 day' else interval '1 hour' end)<=${until}::timestamptz
          and r.bucket + (case when ${query.granularity}='day' then interval '1 day' else interval '1 hour' end)<now()-interval '5 minutes'
        order by t.bucket`)} as trend,
      ${array(sql`select '방문' as name,count(*)::int as count from visits union all select '공연 상세',count(distinct session_id)::int from detail
        union all select '좌석 선택',count(distinct session_id)::int from seats union all select '결제 시작',count(distinct session_id)::int from checkout
        union all select '결제 완료',count(distinct session_id)::int from converted`)} as funnel,
      ${array(sql`select '방문' as name,count(*)::int as count from visits union all select '가입 완료',count(distinct session_id)::int from signup_sessions`)} as "signupFunnel",
      ${array(sql`select coalesce(s.touch->>'source',s.touch->>'referrerHost','direct') as source, coalesce(s.touch->>'medium','') as medium, coalesce(s.touch->>'campaign','') as campaign, coalesce(s.touch->>'term','') as term, coalesce(s.touch->>'content','') as content,
        count(distinct s.id)::int as sessions, count(distinct su.user_id)::int as signups, count(distinct s.user_id) filter(where c.session_id is not null)::int as "paidMembers"
        from s left join signup_sessions su on su.session_id=s.id left join converted c on c.session_id=s.id group by 1,2,3,4,5 order by sessions desc limit 20`)} as sources,
      ${array(sql`select model,coalesce(touch->>'source',touch->>'referrerHost','direct') as source,coalesce(touch->>'campaign','') as campaign,
        count(*)::int as signups, count(*) filter(where exists(select 1 from paid p where p.user_id=a.user_id))::int as "paidMembers"
        from acquired a cross join lateral (values ('first',a.first_touch),('last',a.last_touch)) t(model,touch) group by 1,2,3 order by model,signups desc limit 40`)} as attribution,
      ${array(sql`select s.touch->>'landingPath' as path, count(*)::int as sessions, count(*) filter(where pc.views=1)::int as "singlePageSessions"
        from s join page_counts pc on pc.session_id=s.id group by 1 order by sessions desc limit 15`)} as "landingPages",
      ${array(sql`select p.id,p.title,count(*) filter(where e.name='performance_view')::int as views,
        count(distinct e.session_id) filter(where e.name='booking_start')::int as "bookingSessions",count(distinct e.session_id) filter(where e.name='checkout_start')::int as "checkoutSessions"
        from e join performances p on p.id::text=e.props->>'performanceId' group by p.id,p.title order by views desc limit 15`)} as performances,
      ${array(sql`select e.path, count(*) filter(where e.name='page_view')::int as views,
        coalesce(round(sum((e.props->>'seconds')::int) filter(where e.name='engagement')::numeric / nullif(count(distinct e.page_id) filter(where e.name='engagement'),0)),0)::int as "averageSeconds",
        count(distinct e.page_id) filter(where e.name='scroll_depth' and (e.props->>'depth')::int>=75)::int as "deepScrolls",
        (select count(*)::int from exits x where x.path=e.path) as exits
        from e group by e.path having count(*) filter(where e.name='page_view')>0 order by views desc limit 15`)} as engagement,
      ${array(sql`select d.dimension,d.value,count(*)::int as sessions from s cross join lateral (values ('device',s.device),('browser',s.browser),('os',s.os),('language',s.language),('screen',s.screen)) d(dimension,value) group by 1,2 order by 1,sessions desc`)} as dimensions`);
    const row = result.rows[0]!;
    const rawTrend = row.trend as AnalyticsReport['trend'];
    const trendMap = new Map(rawTrend.map((r) => [r.hour, r]));
    const step = query.granularity === 'day' ? 86400000 : 3600000;
    const start = Math.floor((Date.parse(since) + 9 * 3600000) / step) * step - 9 * 3600000;
    const trend: AnalyticsReport['trend'] = [];
    for (let at = start; at < Date.parse(until); at += step) {
      const hour = new Date(at + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
      trend.push(trendMap.get(hour) ?? { hour, visitors: 0, sessions: 0, pageViews: 0 });
    }
    return { since, until, generatedAt: new Date().toISOString(), config, lastCollectedAt: iso(row.lastCollectedAt), rollupThrough: iso(row.rollupThrough),
      summary: { ...(row.summary as AnalyticsReport['summary']), activeVisitors: active }, trend,
      funnel: funnel(row.funnel as Array<{ name: string; count: number }>), signupFunnel: funnel(row.signupFunnel as Array<{ name: string; count: number }>),
      sources: row.sources as AnalyticsReport['sources'], attribution: row.attribution as AnalyticsReport['attribution'], landingPages: row.landingPages as AnalyticsReport['landingPages'],
      performances: row.performances as AnalyticsReport['performances'], engagement: row.engagement as AnalyticsReport['engagement'], dimensions: row.dimensions as AnalyticsReport['dimensions'] };
  }
}
