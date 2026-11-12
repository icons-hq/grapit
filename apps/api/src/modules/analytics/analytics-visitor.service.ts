import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { AnalyticsVisitorsQuery, AnalyticsVisitorSession, AnalyticsSessionDetail, ReplayEvent } from '@grabit/shared';
import type { DrizzleDB } from '../../database/drizzle.provider.js';
import { ANALYTICS_DB } from './analytics-database.module.js';

const sessionFields = sql` s.id, md5(s.visitor_id::text) as "visitorKey", s.user_id as "userId",
  case when u.account_status='active' then u.name end as "memberName", case when u.account_status='active' then u.email end as "memberEmail",
  s.started_at as "startedAt", s.last_seen_at as "lastSeenAt", s.device, s.browser, s.os, s.touch,
  (select count(*)::int from analytics_events e where e.session_id=s.id) as events,
  (select count(*)::int from analytics_events e where e.session_id=s.id and e.name='pointer_click') as clicks,
  (select count(distinct r.recording_id)::int from analytics_replay_chunks r where r.session_id=s.id and r.received_at>=now()-interval '14 days') as recordings`;
const iso = (value: unknown) => value instanceof Date ? value.toISOString() : new Date(String(value).replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')).toISOString();
const normalizeSession = (row: Record<string, unknown>): AnalyticsVisitorSession => ({ ...row, startedAt: iso(row.startedAt), lastSeenAt: iso(row.lastSeenAt) }) as unknown as AnalyticsVisitorSession;
@Injectable()
export class AnalyticsVisitorService {
  constructor(@Inject(ANALYTICS_DB) private readonly db: DrizzleDB) {}
  async sessions(query: AnalyticsVisitorsQuery) {
    if (Date.parse(query.since) < Date.now() - 90 * 86400000) throw new BadRequestException('최근 90일 내의 기록만 조회할 수 있습니다');
    const result = await this.db.execute(sql`select ${sessionFields} from analytics_sessions s left join users u on u.id=s.user_id
      where s.last_seen_at>=${query.since}::timestamptz and s.started_at<${query.until}::timestamptz and s.started_at>=now()-interval '90 days'
      ${query.visitor ? sql`and md5(s.visitor_id::text)=${query.visitor}` : sql``}
      ${query.before ? sql`and s.started_at<${query.before}::timestamptz` : sql``}
      order by s.started_at desc,s.id desc limit 51`);
    const sessions = result.rows.slice(0, 50).map(normalizeSession);
    return { sessions, nextBefore: result.rows.length > 50 ? new Date(sessions[49]!.startedAt).toISOString() : null };
  }
  async detail(id: string, before?: string): Promise<AnalyticsSessionDetail> {
    const rows = await this.db.execute(sql`select ${sessionFields} from analytics_sessions s left join users u on u.id=s.user_id where s.id=${id}::uuid and s.started_at>=now()-interval '90 days'`);
    if (!rows.rows[0]) throw new NotFoundException('방문 기록이 없거나 보관 기간이 지났습니다');
    const events = await this.db.execute(sql`select id,page_id as "pageId",name,path,occurred_at as "occurredAt",props from analytics_events where session_id=${id}::uuid
      ${before ? sql`and occurred_at<${before}::timestamptz` : sql``} order by occurred_at desc,id desc limit 501`);
    const recordings = await this.db.execute(sql`select recording_id as id,page_id as "pageId",path,min(started_at) as "startedAt",sum(jsonb_array_length(events))::int as events,sum(bytes)::int as bytes
      from analytics_replay_chunks where session_id=${id}::uuid and received_at>=now()-interval '14 days' group by recording_id,page_id,path order by min(started_at) desc limit 100`);
    return { session: normalizeSession(rows.rows[0]), events: events.rows.slice(0, 500).map((row) => ({ ...row, occurredAt: iso(row.occurredAt) })) as unknown as AnalyticsSessionDetail['events'],
      nextBefore: events.rows.length > 500 ? iso(events.rows[499]!.occurredAt) : null,
      recordings: recordings.rows.map((row) => ({ ...row, startedAt: iso(row.startedAt) })) as unknown as AnalyticsSessionDetail['recordings'] };
  }
  async replay(id: string) {
    const chunks = await this.db.execute(sql`select events from analytics_replay_chunks where recording_id=${id}::uuid and received_at>=now()-interval '14 days' order by started_at,id limit 1000`);
    const events = chunks.rows.flatMap((r) => r.events as ReplayEvent[]).sort((a, b) => a.timestamp - b.timestamp);
    if (!events.some((e) => e.type === 2)) throw new NotFoundException('재생 가능한 화면 기록이 없거나 보관 기간이 지났습니다');
    return { events };
  }
}
