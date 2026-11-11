import { BadRequestException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { signupMonitoringResponseSchema, type SignupMonitoringQuery, type SignupMonitoringResponse } from '@grabit/shared';
import type { DrizzleDB } from '../../database/drizzle.provider.js';
import { parseAdminKstDateTime } from './admin-date.util.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export function signupMonitoringWindow(query: SignupMonitoringQuery, now = new Date()) {
  const today = new Date(now.getTime() + 9 * HOUR).toISOString().slice(0, 10);
  const since = query.period === 'announcement' ? new Date(query.since ?? '')
    : query.period === 'today' ? parseAdminKstDateTime(today)
      : new Date(now.getTime() - (query.period === '24h' ? DAY : 7 * DAY));
  if (!Number.isFinite(since.getTime()) || since > now || now.getTime() - since.getTime() > 90 * DAY) {
    throw new BadRequestException('공지 시각은 현재 이전, 최근 90일 이내여야 합니다');
  }
  return { since, until: now, previousSince: new Date(since.getTime() - (now.getTime() - since.getTime())) };
}

/** Single SQL snapshot; no customer rows or identities leave this aggregate. */
export async function loadSignupMonitoring(db: DrizzleDB, query: SignupMonitoringQuery, now = new Date()): Promise<SignupMonitoringResponse> {
  const window = signupMonitoringWindow(query, now);
  const since = window.since.toISOString();
  const until = window.until.toISOString();
  const previousSince = window.previousSince.toISOString();
  const result = await db.execute(sql`with eligible as materialized (
    select u.id, u.created_at, u.is_email_verified, u.is_phone_verified, u.marketing_consent, u.country,
      coalesce(u.preferred_locale::text, 'ko') as locale,
      coalesce((select s.provider from social_accounts s where s.user_id = u.id
        and s.created_at between u.created_at and u.created_at + interval '1 minute'
        order by s.created_at, s.id limit 1), case when u.password_hash is not null then 'email' else 'unknown' end) as provider
    from users u where u.role = 'user' and u.account_status <> 'merged'
      and u.created_at >= ${previousSince}::timestamptz and u.created_at < ${until}::timestamptz
  ), cohort as materialized (select * from eligible where created_at >= ${since}::timestamptz),
  paid as (select c.id from cohort c where exists (
    select 1 from reservations r join payments p on p.reservation_id = r.id
    where r.user_id = c.id and r.status in ('CONFIRMED', 'CANCELLED') and p.status in ('DONE', 'CANCELED')
      and p.paid_at >= c.created_at and p.paid_at < ${until}::timestamptz
  ))
  select json_build_object(
    'signups', (select count(*)::int from cohort),
    'previousSignups', (select count(*)::int from eligible where created_at < ${since}::timestamptz),
    'emailVerified', (select count(*)::int from cohort where is_email_verified),
    'phoneVerified', (select count(*)::int from cohort where is_phone_verified),
    'marketingConsented', (select count(*)::int from cohort where marketing_consent),
    'firstPaidMembers', (select count(*)::int from paid)
  ) as summary,
  (select coalesce(json_agg(t order by t.hour), '[]'::json) from (
    select to_char(created_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:00') as hour, count(*)::int as signups from cohort group by 1
  ) t) as hourly,
  (select coalesce(json_agg(t order by t.count desc, t.value), '[]'::json) from (select provider as value, count(*)::int from cohort group by 1) t) as providers,
  (select coalesce(json_agg(t order by t.count desc, t.value), '[]'::json) from (select country as value, count(*)::int from cohort group by 1) t) as countries,
  (select coalesce(json_agg(t order by t.count desc, t.value), '[]'::json) from (select locale as value, count(*)::int from cohort group by 1) t) as locales`);
  const row = result.rows[0]!;
  const summary = row.summary as Omit<SignupMonitoringResponse['summary'], 'change' | 'changeRate' | 'firstPaidRate'>;
  const hours = new Map((row.hourly as SignupMonitoringResponse['hourly']).map((r) => [r.hour, r.signups]));
  const hourly: SignupMonitoringResponse['hourly'] = [];
  for (let time = Math.floor(window.since.getTime() / HOUR) * HOUR; time < window.until.getTime(); time += HOUR) {
    const hour = new Date(time + 9 * HOUR).toISOString().slice(0, 13).replace('T', ' ') + ':00';
    hourly.push({ hour, signups: hours.get(hour) ?? 0 });
  }
  const ratio = (value: unknown) => (value as Array<{ value: string; count: number }>).map((item) => ({ ...item, rate: percent(item.count, summary.signups) }));
  return signupMonitoringResponseSchema.parse({
    since, until, previousSince, generatedAt: until,
    summary: { ...summary, change: summary.signups - summary.previousSignups,
      changeRate: summary.previousSignups === 0 ? null : percent(summary.signups - summary.previousSignups, summary.previousSignups),
      firstPaidRate: percent(summary.firstPaidMembers, summary.signups) },
    hourly, providers: ratio(row.providers), countries: ratio(row.countries), locales: ratio(row.locales),
  });
}

function percent(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : Math.round(numerator / denominator * 1000) / 10;
}
