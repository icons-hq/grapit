import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  supportContentReviewStateEnum,
  supportThreadPriorityEnum,
  supportTranslationUseEnum,
} from './support-threads.js';
import { localeEnum, users } from './users.js';

export const supportNoticeCategoryEnum = pgEnum('support_notice_category', [
  'general',
  'urgent',
  'maintenance',
  'payment',
  'refund',
  'signup',
  'event',
]);

export const supportNoticeStatusEnum = pgEnum('support_notice_status', [
  'draft',
  'review',
  'scheduled',
  'published',
  'archived',
]);

export const supportNotices = pgTable(
  'support_notices',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    category: supportNoticeCategoryEnum('category')
      .notNull()
      .default('general'),
    locale: localeEnum('locale').notNull().default('ko'),
    title: text('title').notNull(),
    body: text('body').notNull(),
    status: supportNoticeStatusEnum('status').notNull().default('draft'),
    priority: supportThreadPriorityEnum('priority')
      .notNull()
      .default('normal'),
    reviewState: supportContentReviewStateEnum('review_state')
      .notNull()
      .default('draft'),
    translationUse: supportTranslationUseEnum('translation_use')
      .notNull()
      .default('none'),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    updatedByUserId: uuid('updated_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_support_notices_status_schedule').on(
      table.status,
      table.scheduledAt,
    ),
    index('idx_support_notices_category_locale').on(
      table.category,
      table.locale,
    ),
    index('idx_support_notices_review_state').on(table.reviewState),
    index('idx_support_notices_published_at').on(table.publishedAt),
  ],
);
