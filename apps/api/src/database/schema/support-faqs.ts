import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  supportContentReviewStateEnum,
  supportThreadCategoryEnum,
  supportTranslationUseEnum,
} from './support-threads.js';
import { localeEnum, users } from './users.js';

export const supportFaqs = pgTable(
  'support_faqs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    category: supportThreadCategoryEnum('category').notNull(),
    locale: localeEnum('locale').notNull().default('ko'),
    question: text('question').notNull(),
    answer: text('answer').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isPinned: boolean('is_pinned').notNull().default(false),
    reviewState: supportContentReviewStateEnum('review_state')
      .notNull()
      .default('draft'),
    translationUse: supportTranslationUseEnum('translation_use')
      .notNull()
      .default('none'),
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
    index('idx_support_faqs_category_locale').on(
      table.category,
      table.locale,
    ),
    index('idx_support_faqs_review_state').on(table.reviewState),
    index('idx_support_faqs_published_at').on(table.publishedAt),
  ],
);
