import { createHash } from 'node:crypto';
import { Inject, Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { DrizzleDB } from '../../database/drizzle.provider.js';
import { PG_BOSS, type PgBossContract } from '../jobs/pgboss.provider.js';
import { PgbossModule } from '../jobs/pgboss.module.js';
import { ANALYTICS_DB, AnalyticsDatabaseModule } from './analytics-database.module.js';

export const ANALYTICS_MAINTENANCE_QUEUE = 'analytics-maintenance';
@Injectable()
export class AnalyticsMaintenance implements OnModuleInit {
  constructor(@Inject(ANALYTICS_DB) private readonly db: DrizzleDB, @Inject(PG_BOSS) private readonly boss: PgBossContract) {}
  async onModuleInit() {
    if (!this.boss.isAvailable || this.boss.processesJobs === false) return;
    await this.boss.createQueue(ANALYTICS_MAINTENANCE_QUEUE);
    await this.boss.work(ANALYTICS_MAINTENANCE_QUEUE, async () => { await this.run(); });
    // The existing five-minute bounded worker provides scheduling. Stable IDs
    // prevent overlapping instances from scheduling the same interval twice.
    const h = createHash('sha256').update(`analytics:${Math.floor(Date.now() / 300000)}`).digest('hex');
    const id = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
    await this.boss.send(ANALYTICS_MAINTENANCE_QUEUE, {}, { id, retryLimit: 3, retryDelay: 30 });
  }
  async run() {
    const result = await this.db.transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout = '5s'`);
      const lock = await tx.execute(sql`select pg_try_advisory_xact_lock(7261111) as acquired`);
      if (!lock.rows[0]?.acquired) return { deleted: 0, more: false };
      let more = false;
      const rebuilding = await tx.execute(sql`select rebuild_since from analytics_settings where id=1`);
      const rebuildSince = rebuilding.rows[0]?.rebuild_since;
      let rebuiltUntil = Date.now() + 86400000;
      for (const grain of ['hour', 'day'] as const) {
        const step = grain === 'hour' ? 3600000 : 86400000;
        const cursor = await tx.execute(sql`select coalesce(
          (select max(bucket) from analytics_rollups where grain=${grain}),
          (select min(occurred_at) from analytics_events where occurred_at>=now()-interval '90 days'), ${rebuildSince ? new Date(rebuildSince as string).toISOString() : null}::timestamptz) as at`);
        if (!cursor.rows[0]?.at) continue;
        const start = Math.floor((Math.min(new Date(cursor.rows[0].at as string).getTime(), rebuildSince ? new Date(rebuildSince as string).getTime() : Infinity) + 9 * 3600000) / step) * step - 9 * 3600000 - step;
        const end = Math.min(Date.now() + step, start + (grain === 'hour' ? 24 : 7) * step);
        more ||= end < Date.now();
        rebuiltUntil = Math.min(rebuiltUntil, end);
        const interval = grain === 'hour' ? sql`interval '1 hour'` : sql`interval '1 day'`;
        await tx.execute(sql`insert into analytics_rollups (grain,bucket,visitors,sessions,page_views,updated_at)
          select ${grain},b.bucket,count(distinct s.visitor_id)::int,count(distinct e.session_id)::int,count(*) filter(where e.name='page_view')::int,now()
          from generate_series(${new Date(start).toISOString()}::timestamptz,${new Date(end - step).toISOString()}::timestamptz,${interval}) b(bucket)
          left join analytics_events e on e.occurred_at>=b.bucket and e.occurred_at<b.bucket+${interval}
          left join analytics_sessions s on s.id=e.session_id group by b.bucket
          on conflict(grain,bucket) do update set visitors=excluded.visitors,sessions=excluded.sessions,page_views=excluded.page_views,updated_at=excluded.updated_at`);
      }
      if (rebuildSince) await tx.execute(sql`update analytics_settings set rebuild_since=${rebuiltUntil < Date.now() ? new Date(rebuiltUntil).toISOString() : null}::timestamptz
        where id=1 and rebuild_since=${new Date(rebuildSince as string).toISOString()}::timestamptz`);
      await tx.execute(sql`delete from analytics_opt_outs where expires_at<now()`);
      const deleted = await tx.execute(sql`delete from analytics_events where id in (select id from analytics_events where occurred_at<now()-interval '90 days' order by occurred_at limit 10000) returning id`);
      const sessions = await tx.execute(sql`delete from analytics_sessions where id in (select id from analytics_sessions where started_at<now()-interval '90 days' order by started_at limit 5000) returning id`);
      await tx.execute(sql`delete from analytics_attribution where updated_at<now()-interval '90 days' or first_at<now()-interval '90 days' or user_id in(select id from users where account_status<>'active')`);
      await tx.execute(sql`update analytics_sessions set user_id=null where user_id in(select id from users where account_status<>'active')`);
      await tx.execute(sql`delete from analytics_rollups where bucket<now()-interval '365 days'`);
      return { deleted: deleted.rows.length, more: more || deleted.rows.length === 10000 || sessions.rows.length === 5000 };
    });
    if (result.more) await this.boss.send(ANALYTICS_MAINTENANCE_QUEUE, {}, { startAfter: new Date(Date.now() + 1000), retryLimit: 3, retryDelay: 30 });
    return result;
  }
}
@Module({ imports: [AnalyticsDatabaseModule, PgbossModule], providers: [AnalyticsMaintenance] })
export class AnalyticsMaintenanceModule {}
