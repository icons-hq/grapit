import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { AudienceQuery, CreativePerformance, CreativeReport } from '@grabit/shared';
import type { DrizzleDB } from '../../database/drizzle.provider.js';
import { ANALYTICS_DB } from './analytics-database.module.js';

@Injectable()
export class CreativeReportService {
  constructor(@Inject(ANALYTICS_DB) private readonly db: DrizzleDB) {}

  async report(query: AudienceQuery): Promise<CreativeReport> {
    const since = new Date(query.since).toISOString();
    const until = new Date(Math.min(Date.parse(query.until), Date.now())).toISOString();
    if (since >= until || Date.parse(since) < Date.now() - 90 * 86400000) throw new BadRequestException('최근 90일 이내의 과거 구간을 선택해주세요');
    // Cohort is sessions started in this window. Each paid order belongs to its
    // most recent matching checkout, not every earlier campaign the member saw.
    const result = await this.db.execute(sql`with
      sessions as materialized (select * from analytics_sessions where started_at>=${since}::timestamptz and started_at<${until}::timestamptz),
      events as materialized (select e.* from analytics_events e join sessions s on s.id=e.session_id where e.occurred_at>=${since}::timestamptz and e.occurred_at<${until}::timestamptz),
      paid as materialized (select distinct on (pay.reservation_id) pay.reservation_id,e.session_id
        from payments pay join reservations r on r.id=pay.reservation_id join users u on u.id=r.user_id and u.role='user' and u.account_status<>'merged'
        join showtimes st on st.id=r.showtime_id join analytics_sessions s on s.user_id=r.user_id
        join analytics_events e on e.session_id=s.id and e.name='checkout_start' and e.props->>'performanceId'=st.performance_id::text
        where pay.paid_at>=${since}::timestamptz and pay.paid_at<${until}::timestamptz
          and pay.status in ('DONE','PARTIAL_CANCELED','CANCELED') and r.status in ('CONFIRMED','CANCELLED')
          and e.occurred_at<=pay.paid_at and e.occurred_at>=${since}::timestamptz-interval '30 minutes' and pay.paid_at<=s.last_seen_at+interval '30 minutes'
        order by pay.reservation_id,e.occurred_at desc,e.id desc),
      signup as (select distinct on (u.id) s.id as session_id from users u join sessions s on s.user_id=u.id
        where u.role='user' and u.account_status<>'merged' and u.created_at>=s.started_at and u.created_at<=s.last_seen_at+interval '30 minutes'
          and u.created_at>=${since}::timestamptz and u.created_at<${until}::timestamptz order by u.id,s.started_at desc,s.id),
      counts as (select s.id,s.visitor_id,s.touch,
        exists(select 1 from signup x where x.session_id=s.id)::int as signup,
        exists(select 1 from events e where e.session_id=s.id and e.name='favorite_add')::int as favorite,
        exists(select 1 from events e where e.session_id=s.id and e.name='checkout_start')::int as checkout,
        exists(select 1 from paid p where p.session_id=s.id)::int as paid,
        (select count(*)::int from paid p where p.session_id=s.id) as orders
        from sessions s),
      groups as (select coalesce(touch->>'source',touch->>'referrerHost','direct') as source,
        coalesce(touch->>'medium','') as medium,coalesce(touch->>'campaign','') as campaign,coalesce(touch->>'content','') as content,
        count(*)::int as sessions,count(distinct visitor_id)::int as visitors,sum(signup)::int as "signupSessions",
        sum(favorite)::int as "favoriteSessions",sum(checkout)::int as "checkoutSessions",sum(paid)::int as "paidSessions",sum(orders)::int as "paidOrders"
        from counts group by 1,2,3,4)
      select (select count(*)::int from groups) as total,
        coalesce((select jsonb_agg(g) from (select * from groups order by sessions desc,source,medium,campaign,content limit 100) g),'[]'::jsonb) as rows`);
    const row = result.rows[0]!;
    const rate = (numerator: number, denominator: number) => denominator ? Math.round(1000 * numerator / denominator) / 10 : 0;
    return { since, until, generatedAt: new Date().toISOString(), totalGroups: row.total as number,
      rows: (row.rows as CreativePerformance[]).map((r) => ({ ...r, signupRate: rate(r.signupSessions, r.sessions), favoriteRate: rate(r.favoriteSessions, r.sessions), paymentRate: rate(r.paidSessions, r.sessions) })) };
  }
}
