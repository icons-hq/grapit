import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, asc, eq, gte, isNull, or, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import type IORedis from 'ioredis';
import { ANALYTICS_NOTICE_VERSION, ANALYTICS_RETENTION_DAYS, ANALYTICS_SESSION_MS, type AnalyticsBatch, type AnalyticsConfig, type AnalyticsCounts } from '@grabit/shared';
import type { DrizzleDB } from '../../database/drizzle.provider.js';
import { analyticsAttribution, analyticsEvents, analyticsSessions, analyticsSettings, analyticsOptOuts, users } from '../../database/schema/index.js';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service.js';
import { REDIS_CLIENT } from '../booking/providers/redis.provider.js';
import { ANALYTICS_DB, ANALYTICS_POOL } from './analytics-database.module.js';
import type { RequestUser } from '../../common/decorators/current-user.decorator.js';

export const ANALYTICS_ACTIVE_KEY = 'analytics:active-visitors:v1';
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);
  private collecting = false;
  private configCache?: { until: number; value: Promise<AnalyticsConfig> };
  constructor(@Inject(ANALYTICS_DB) private readonly db: DrizzleDB, @Inject(ANALYTICS_POOL) private readonly pool: Pool,
    @Inject(FeatureFlagsService) private readonly flags: FeatureFlagsService, @Inject(REDIS_CLIENT) private readonly redis: IORedis) {}

  async config(refresh = false): Promise<AnalyticsConfig> {
    const environmentEnabled = this.flags.isAnalyticsEnvironmentEnabled();
    const aggregateEnvironmentEnabled = this.flags.isAggregateAnalyticsEnvironmentEnabled();
    const base = { environmentEnabled, aggregateEnvironmentEnabled, noticeVersion: ANALYTICS_NOTICE_VERSION, rawRetentionDays: ANALYTICS_RETENTION_DAYS };
    if (!environmentEnabled && !aggregateEnvironmentEnabled) return { ...base, enabled: false, aggregateEnabled: false };
    if (!refresh && this.configCache && this.configCache.until > Date.now()) return this.configCache.value;
    const value = this.db.select().from(analyticsSettings).where(eq(analyticsSettings.id, 1)).then(([row]) => ({ ...base, aggregateEnabled: aggregateEnvironmentEnabled && row?.aggregateEnabled === true, enabled: environmentEnabled && row?.enabled === true && row.noticeVersion === ANALYTICS_NOTICE_VERSION })).catch(() => ({ ...base, enabled: false }));
    this.configCache = { until: Date.now() + 5000, value }; return value;
  }
  async configure(enabled: boolean, actor: RequestUser) {
    if (enabled && !this.flags.isAnalyticsEnvironmentEnabled()) throw new ForbiddenException('정책 개정·시행 확인 후 ANALYTICS_ENABLED 환경 게이트를 먼저 활성화해야 합니다');
    await this.db.insert(analyticsSettings).values({ id: 1, enabled, noticeVersion: ANALYTICS_NOTICE_VERSION, updatedBy: actor.id })
      .onConflictDoUpdate({ target: analyticsSettings.id, set: { enabled, noticeVersion: ANALYTICS_NOTICE_VERSION, updatedAt: new Date(), updatedBy: actor.id } });
    this.configCache = undefined; return this.config(true);
  }

  async configureAggregate(enabled: boolean, actor: RequestUser) {
    if (enabled && !this.flags.isAggregateAnalyticsEnvironmentEnabled()) throw new ForbiddenException('운영 분석 환경이 비활성 상태입니다');
    await this.db.insert(analyticsSettings).values({ id: 1, enabled: false, aggregateEnabled: enabled, updatedBy: actor.id })
      .onConflictDoUpdate({ target: analyticsSettings.id, set: { aggregateEnabled: enabled, updatedAt: new Date(), updatedBy: actor.id } });
    this.configCache = undefined;
    return this.config(true);
  }

  async collectCounts(batch: AnalyticsCounts): Promise<boolean> {
    if (!this.flags.isAggregateAnalyticsEnvironmentEnabled() || this.collecting || this.pool.waitingCount > 0 || (this.pool.totalCount > 0 && this.pool.idleCount === 0)) return false;
    this.collecting = true;
    try {
      // One bounded statement reads the shared switch and adds grouped counts.
      // Duplicate keys are merged; no raw event, timestamp, account or browser ID is persisted.
      await this.db.execute(sql`insert into analytics_counters(bucket,page,name,count)
        select date_trunc('hour',now()), x.page, x.name, sum(x.count)::int
        from jsonb_to_recordset(${JSON.stringify(batch.counts)}::jsonb) as x(page text,name text,count int)
        where exists(select 1 from analytics_settings where id=1 and aggregate_enabled=true)
        group by x.page,x.name order by x.page,x.name
        on conflict(bucket,page,name) do update set count=analytics_counters.count+excluded.count,updated_at=now()`);
      return true;
    } catch { this.logger.warn('Aggregate analytics dropped: storage unavailable or capacity limit'); return false; }
    finally { this.collecting = false; }
  }

  async collect(batch: AnalyticsBatch): Promise<boolean> {
    // Do not create a queue of requests or borrow a ticketing-pool connection.
    if (!this.flags.isAnalyticsEnvironmentEnabled() || this.collecting || this.pool.waitingCount > 0 || (this.pool.totalCount > 0 && this.pool.idleCount === 0)) return false;
    this.collecting = true;
    try {
      const now = new Date();
      const accepted = await this.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${batch.visitorId}::text,7261112))`);
        // No cache here: every new batch observes the shared kill switch.
        const [setting] = await tx.select().from(analyticsSettings).where(eq(analyticsSettings.id, 1));
        if (!setting?.enabled || setting.noticeVersion !== ANALYTICS_NOTICE_VERSION) return false;
        const [withdrawn] = await tx.select().from(analyticsOptOuts).where(and(eq(analyticsOptOuts.visitorHash, hashVisitor(batch.visitorId)), gte(analyticsOptOuts.expiresAt, now)));
        if (withdrawn) return false;
        const events = batch.events.map(({ at, ...event }) => ({ ...event, sessionId: batch.sessionId,
          occurredAt: new Date(Math.abs(Date.parse(at) - now.getTime()) <= 300_000 ? at : now.getTime()) }));
        const [session] = await tx.insert(analyticsSessions).values({ id: batch.sessionId, visitorId: batch.visitorId,
          startedAt: new Date(Math.min(...events.map((e) => e.occurredAt.getTime()), now.getTime())), lastSeenAt: now,
          touch: batch.touch, consentVersion: batch.consentVersion, consentedAt: new Date(batch.consentedAt), device: batch.device, browser: batch.browser, os: batch.os, screen: batch.screen, language: batch.language })
          .onConflictDoUpdate({ target: analyticsSessions.id, set: { lastSeenAt: now }, setWhere: and(eq(analyticsSessions.visitorId, batch.visitorId), gte(analyticsSessions.lastSeenAt, new Date(now.getTime() - ANALYTICS_SESSION_MS))) })
          .returning({ id: analyticsSessions.id });
        if (!session) return false;
        await tx.insert(analyticsEvents).values(events).onConflictDoNothing({ target: analyticsEvents.id });
        return true;
      });
      if (accepted && typeof this.redis.zadd === 'function') {
        // TTL-only liveness signal. No IP or browser fingerprint is stored.
        void this.redis.multi().zadd(ANALYTICS_ACTIVE_KEY, now.getTime(), batch.visitorId)
          .zremrangebyscore(ANALYTICS_ACTIVE_KEY, '-inf', now.getTime() - 300_000).expire(ANALYTICS_ACTIVE_KEY, 300).exec().catch(() => undefined);
      }
      return accepted;
    } catch { this.logger.warn('Analytics batch dropped: storage unavailable or capacity limit'); return false; }
    finally { this.collecting = false; }
  }

  async identify(input: { visitorId: string; sessionId: string }, actor: RequestUser) {
    if (actor.role !== 'user' || !(await this.config(true)).enabled) return false;
    const now = new Date(); const cutoff = new Date(now.getTime() - ANALYTICS_SESSION_MS);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.visitorId}::text,7261112))`);
      const [member] = await tx.select({ id: users.id, createdAt: users.createdAt }).from(users).where(and(eq(users.id, actor.id), eq(users.accountStatus, 'active')));
      if (!member) return false;
      // The verified JWT owns the account ID. A session already attached to a
      // different user can never be reassigned on a shared device.
      const [session] = await tx.update(analyticsSessions).set({ userId: actor.id }).where(and(
        eq(analyticsSessions.id, input.sessionId), eq(analyticsSessions.visitorId, input.visitorId), gte(analyticsSessions.lastSeenAt, cutoff),
        or(isNull(analyticsSessions.userId), eq(analyticsSessions.userId, actor.id)),
      )).returning();
      if (!session) return false;
      // Existing customers still link this session, but a later login must not
      // be presented as the campaign that originally caused their signup.
      if (member.createdAt < session.startedAt || member.createdAt.getTime() > session.lastSeenAt.getTime() + ANALYTICS_SESSION_MS) return true;
      const retention = new Date(now.getTime() - ANALYTICS_RETENTION_DAYS * 86400000);
      const [first] = await tx.select().from(analyticsSessions).where(and(eq(analyticsSessions.visitorId, input.visitorId),
        gte(analyticsSessions.startedAt, retention), or(isNull(analyticsSessions.userId), eq(analyticsSessions.userId, actor.id))))
        .orderBy(asc(analyticsSessions.startedAt)).limit(1);
      const touch = first ?? session;
      await tx.insert(analyticsAttribution).values({ userId: actor.id, visitorId: input.visitorId, firstTouch: touch.touch, lastTouch: session.touch, firstAt: touch.startedAt, lastAt: session.startedAt })
        .onConflictDoUpdate({ target: analyticsAttribution.userId,
          set: { visitorId: input.visitorId, firstTouch: touch.touch, lastTouch: session.touch, firstAt: touch.startedAt, lastAt: session.startedAt, updatedAt: now },
          // Freeze acquisition at first identification; later logins must not
          // rewrite the original signup campaign. Retire it after 90 days.
          setWhere: sql`${analyticsAttribution.updatedAt} < ${retention.toISOString()}::timestamptz`,
        });
      return true;
    });
  }

  async withdraw(input: { visitorId: string; sessionId: string }) {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.visitorId}::text,7261112))`);
      await tx.insert(analyticsOptOuts).values({ visitorHash: hashVisitor(input.visitorId), expiresAt: new Date(Date.now() + 90 * 86400000) })
        .onConflictDoNothing();
      // The opaque 128-bit browser ID is the erasure handle, never returned by
      // admin reports. A fresh tab may not have sent its session's first batch;
      // that must not prevent deletion of this browser's earlier sessions.
      const bounds = await tx.execute(sql`select min(started_at) as first from analytics_sessions where visitor_id=${input.visitorId}::uuid`);
      await tx.delete(analyticsAttribution).where(eq(analyticsAttribution.visitorId, input.visitorId));
      await tx.delete(analyticsSessions).where(eq(analyticsSessions.visitorId, input.visitorId));
      const first = bounds.rows[0]?.first;
      if (first) {
        const day = new Date(Math.floor((new Date(first as string).getTime() + 32400000) / 86400000) * 86400000 - 32400000).toISOString();
        await tx.execute(sql`delete from analytics_rollups where bucket>=${day}::timestamptz`);
        await tx.execute(sql`insert into analytics_settings(id,enabled,rebuild_since) values(1,false,${day}::timestamptz)
          on conflict(id) do update set rebuild_since=least(coalesce(analytics_settings.rebuild_since,excluded.rebuild_since),excluded.rebuild_since)`);
      }
    });
    if (typeof this.redis.zrem === 'function') await this.redis.zrem(ANALYTICS_ACTIVE_KEY, input.visitorId).catch(() => undefined);
    return { deleted: true };
  }
}

function hashVisitor(id: string) { return createHash('sha256').update('analytics-withdrawal:' + id).digest('hex'); }
