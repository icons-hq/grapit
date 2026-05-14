import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { refunds } from './refunds.js';
import { reservations } from './reservations.js';
import { localeEnum, users } from './users.js';

export const supportThreadSourceEnum = pgEnum('support_thread_source', [
  'qna',
  'cs',
  'refund_dispute',
  'signup_failure',
  'notice_followup',
]);

export const supportThreadCategoryEnum = pgEnum('support_thread_category', [
  'general',
  'event_info',
  'booking',
  'payment_error',
  'refund_unprocessed',
  'refund_dispute',
  'signup_failure',
  'account',
  'ticket_delivery',
  'seat_accessibility',
  'abuse_fraud',
  'other',
]);

export const supportThreadStatusEnum = pgEnum('support_thread_status', [
  'open',
  'waiting_customer',
  'waiting_operator',
  'resolved',
  'closed',
]);

export const supportThreadPriorityEnum = pgEnum('support_thread_priority', [
  'low',
  'normal',
  'high',
  'urgent',
]);

export const supportThreadEscalationStateEnum = pgEnum(
  'support_thread_escalation_state',
  ['none', 'auto_escalated', 'manual_escalated', 'deescalated', 'resolved'],
);

export const supportContentReviewStateEnum = pgEnum(
  'support_content_review_state',
  ['draft', 'review', 'approved', 'published', 'archived'],
);

export const supportTranslationUseEnum = pgEnum('support_translation_use', [
  'none',
  'manual',
  'assisted',
]);

export const supportThreads = pgTable(
  'support_threads',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    source: supportThreadSourceEnum('source').notNull().default('cs'),
    category: supportThreadCategoryEnum('category').notNull(),
    status: supportThreadStatusEnum('status').notNull().default('open'),
    priority: supportThreadPriorityEnum('priority')
      .notNull()
      .default('normal'),
    escalationState: supportThreadEscalationStateEnum('escalation_state')
      .notNull()
      .default('none'),
    title: varchar('title', { length: 255 }).notNull(),
    summary: text('summary'),
    locale: localeEnum('locale').notNull().default('ko'),
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    assigneeUserId: uuid('assignee_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    reservationId: uuid('reservation_id').references(() => reservations.id, {
      onDelete: 'set null',
    }),
    refundId: uuid('refund_id').references(() => refunds.id, {
      onDelete: 'set null',
    }),
    signupFailureEmailHash: varchar('signup_failure_email_hash', {
      length: 64,
    }),
    signupFailurePhoneHash: varchar('signup_failure_phone_hash', {
      length: 64,
    }),
    slaDueAt: timestamp('sla_due_at', { withTimezone: true }).notNull(),
    firstResponseAt: timestamp('first_response_at', { withTimezone: true }),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    escalatedAt: timestamp('escalated_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    messageCount: integer('message_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_support_threads_status_sla').on(table.status, table.slaDueAt),
    index('idx_support_threads_priority_escalation').on(
      table.priority,
      table.escalationState,
    ),
    index('idx_support_threads_category').on(table.category),
    index('idx_support_threads_assignee_user_id').on(table.assigneeUserId),
    index('idx_support_threads_refund_id').on(table.refundId),
    index('idx_support_threads_reservation_id').on(table.reservationId),
    index('idx_support_threads_signup_email_hash').on(
      table.signupFailureEmailHash,
    ),
    index('idx_support_threads_signup_phone_hash').on(
      table.signupFailurePhoneHash,
    ),
  ],
);
