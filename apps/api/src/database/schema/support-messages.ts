import {
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  supportContentReviewStateEnum,
  supportThreads,
  supportTranslationUseEnum,
} from './support-threads.js';
import { localeEnum, users } from './users.js';

export const supportMessageAuthorTypeEnum = pgEnum(
  'support_message_author_type',
  ['customer', 'admin', 'system'],
);

export const supportMessageVisibilityEnum = pgEnum(
  'support_message_visibility',
  ['public', 'internal'],
);

export const supportMessages = pgTable(
  'support_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => supportThreads.id, { onDelete: 'cascade' }),
    authorType: supportMessageAuthorTypeEnum('author_type').notNull(),
    authorUserId: uuid('author_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    locale: localeEnum('locale').notNull().default('ko'),
    body: text('body').notNull(),
    visibility: supportMessageVisibilityEnum('visibility')
      .notNull()
      .default('public'),
    isInternalNote: boolean('is_internal_note').notNull().default(false),
    reviewState: supportContentReviewStateEnum('review_state')
      .notNull()
      .default('approved'),
    translationUse: supportTranslationUseEnum('translation_use')
      .notNull()
      .default('none'),
    reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_support_messages_thread_id').on(table.threadId),
    index('idx_support_messages_author_user_id').on(table.authorUserId),
    index('idx_support_messages_review_state').on(table.reviewState),
  ],
);
