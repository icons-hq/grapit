import { pgTable, uuid, varchar, timestamp, integer, boolean, jsonb, index, primaryKey } from 'drizzle-orm/pg-core';
import type { AnalyticsTouch, AnalyticsEvent } from '@grabit/shared';
import { users } from './users.js';

export const analyticsSettings = pgTable('analytics_settings', {
  id: integer('id').primaryKey().default(1), enabled: boolean('enabled').notNull().default(false),
  aggregateEnabled: boolean('aggregate_enabled').notNull().default(false),
  noticeVersion: varchar('notice_version', { length: 40 }), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  rebuildSince: timestamp('rebuild_since', { withTimezone: true }),
});
export const analyticsSessions = pgTable('analytics_sessions', {
  id: uuid('id').primaryKey(), visitorId: uuid('visitor_id').notNull(), userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(), lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
  touch: jsonb('touch').$type<AnalyticsTouch>().notNull(), consentVersion: varchar('consent_version', { length: 40 }).notNull(),
  consentedAt: timestamp('consented_at', { withTimezone: true }).notNull(),
  device: varchar('device', { length: 16 }).notNull(), browser: varchar('browser', { length: 16 }).notNull(), os: varchar('os', { length: 16 }).notNull(),
  screen: varchar('screen', { length: 16 }).notNull(), language: varchar('language', { length: 8 }).notNull(),
}, (t) => [index('idx_analytics_sessions_visitor_time').on(t.visitorId, t.startedAt), index('idx_analytics_sessions_started').on(t.startedAt), index('idx_analytics_sessions_user').on(t.userId), index('idx_analytics_sessions_last_seen').on(t.lastSeenAt)]);
export const analyticsEvents = pgTable('analytics_events', {
  id: uuid('id').primaryKey(), sessionId: uuid('session_id').notNull().references(() => analyticsSessions.id, { onDelete: 'cascade' }), pageId: uuid('page_id').notNull(),
  name: varchar('name', { length: 32 }).notNull(), path: varchar('path', { length: 160 }).notNull(), previousPath: varchar('previous_path', { length: 160 }),
  props: jsonb('props').$type<AnalyticsEvent['props']>().notNull(), occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index('idx_analytics_events_occurred').on(t.occurredAt), index('idx_analytics_events_session_time').on(t.sessionId, t.occurredAt)]);
export const analyticsAttribution = pgTable('analytics_attribution', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  visitorId: uuid('visitor_id').notNull(),
  firstTouch: jsonb('first_touch').$type<AnalyticsTouch>().notNull(), lastTouch: jsonb('last_touch').$type<AnalyticsTouch>().notNull(),
  firstAt: timestamp('first_at', { withTimezone: true }).notNull(), lastAt: timestamp('last_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('idx_analytics_attribution_expiry').on(t.updatedAt), index('idx_analytics_attribution_visitor').on(t.visitorId)]);
export const analyticsOptOuts = pgTable('analytics_opt_outs', {
  visitorHash: varchar('visitor_hash', { length: 64 }).primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (t) => [index('idx_analytics_opt_outs_expiry').on(t.expiresAt)]);
export const analyticsRollups = pgTable('analytics_rollups', {
  grain: varchar('grain', { length: 8 }).notNull(), bucket: timestamp('bucket', { withTimezone: true }).notNull(), visitors: integer('visitors').notNull(), sessions: integer('sessions').notNull(),
  pageViews: integer('page_views').notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.grain, t.bucket] })]);

// Only counters survive a request. No visitor/session/user identifier or event rows.
export const analyticsCounters = pgTable('analytics_counters', {
  bucket: timestamp('bucket', { withTimezone: true }).notNull(),
  page: varchar('page', { length: 24 }).notNull(), name: varchar('name', { length: 32 }).notNull(),
  count: integer('count').notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.bucket, t.page, t.name] })]);
export const analyticsTrafficHistory = pgTable('analytics_traffic_history', {
  bucket: timestamp('bucket', { withTimezone: true }).notNull(),
  source: varchar('source', { length: 40 }).notNull(), metric: varchar('metric', { length: 40 }).notNull(),
  count: integer('count').notNull(), sampled: boolean('sampled').notNull(),
  observedThrough: timestamp('observed_through', { withTimezone: true }).notNull(),
}, (t) => [primaryKey({ columns: [t.bucket, t.source, t.metric] })]);
