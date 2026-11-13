import { sql } from 'drizzle-orm';
import { pgTable, uuid, varchar, boolean, timestamp, jsonb, index, primaryKey, check } from 'drizzle-orm/pg-core';
import type { AudienceTagInput } from '@grabit/shared';
import { users } from './users.js';
import { performances } from './performances.js';

export const audienceTags = pgTable('audience_tags', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: varchar('slug', { length: 60 }).notNull().unique(),
  kind: varchar('kind', { length: 16 }).$type<AudienceTagInput['kind']>().notNull(),
  labels: jsonb('labels').$type<AudienceTagInput['labels']>().notNull(),
  active: boolean('active').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check('audience_tag_kind', sql`${t.kind} in ('artist','activity','benefit')`)]);

export const audiencePerformanceTags = pgTable('audience_performance_tags', {
  performanceId: uuid('performance_id').notNull().references(() => performances.id, { onDelete: 'cascade' }),
  tagId: uuid('tag_id').notNull().references(() => audienceTags.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.performanceId, t.tagId] }), index('idx_audience_performance_tags_tag').on(t.tagId)]);

export const audiencePreferences = pgTable('audience_preferences', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  consentVersion: varchar('consent_version', { length: 40 }).notNull(),
  consentedAt: timestamp('consented_at', { withTimezone: true }).notNull().defaultNow(),
  behaviorSince: timestamp('behavior_since', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (t) => [index('idx_audience_preferences_expiry').on(t.expiresAt)]);

export const audienceUserTags = pgTable('audience_user_tags', {
  userId: uuid('user_id').notNull().references(() => audiencePreferences.userId, { onDelete: 'cascade' }),
  tagId: uuid('tag_id').notNull().references(() => audienceTags.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.userId, t.tagId] }), index('idx_audience_user_tags_tag').on(t.tagId)]);

// Consent evidence contains no answers. The worker removes it after 90 days;
// account deletion cascades. Profile withdrawal deletes answers immediately.
export const audienceConsentEvents = pgTable('audience_consent_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  version: varchar('version', { length: 40 }).notNull(),
  action: varchar('action', { length: 16 }).notNull(),
  useBehavior: boolean('use_behavior').notNull(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('idx_audience_consent_events_expiry').on(t.at), check('audience_consent_action', sql`${t.action} in ('save','withdraw')`)]);
