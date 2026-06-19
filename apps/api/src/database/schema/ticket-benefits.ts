import { desc, sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { showtimes } from './showtimes.js';
import { ticketItems } from './ticket-items.js';
import { users } from './users.js';

type JsonRecord = Record<string, unknown>;
type BenefitDisplayCopy = Record<string, { name: string; description: string }>;

export const ticketBenefitKindEnum = pgEnum('ticket_benefit_kind', [
  'included',
  'limited',
]);

export const ticketBenefitConfigurationChangeActionEnum = pgEnum(
  'ticket_benefit_configuration_change_action',
  ['created', 'updated', 'activated', 'deactivated', 'rolled_back'],
);

export const ticketBenefitRunModeEnum = pgEnum('ticket_benefit_run_mode', [
  'live',
  'test',
]);

export const ticketBenefitRunStatusEnum = pgEnum(
  'ticket_benefit_run_status',
  ['running', 'completed', 'failed'],
);

export const ticketBenefitEntitlementSourceEnum = pgEnum(
  'ticket_benefit_entitlement_source',
  ['configuration', 'live_run', 'test_run', 'rollback'],
);

export const ticketBenefitEntitlementStateEnum = pgEnum(
  'ticket_benefit_entitlement_state',
  ['active', 'inactive', 'redeemed'],
);

export const ticketBenefitRedemptionResultEnum = pgEnum(
  'ticket_benefit_redemption_result',
  [
    'redeemed',
    'duplicate',
    'not_eligible',
    'inactive',
    'tampered',
    'wrong_showtime',
  ],
);

export const ticketBenefitConfigurations = pgTable(
  'ticket_benefit_configurations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    showtimeId: uuid('showtime_id')
      .notNull()
      .references(() => showtimes.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
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
    index('idx_ticket_benefit_configurations_showtime_id').on(table.showtimeId),
    uniqueIndex('idx_ticket_benefit_configurations_showtime_version_unique').on(
      table.showtimeId,
      table.version,
    ),
  ],
);

export const ticketBenefitConfigurationChanges = pgTable(
  'ticket_benefit_configuration_changes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    showtimeId: uuid('showtime_id')
      .notNull()
      .references(() => showtimes.id, { onDelete: 'cascade' }),
    configurationId: uuid('configuration_id').references(
      () => ticketBenefitConfigurations.id,
      { onDelete: 'set null' },
    ),
    action: ticketBenefitConfigurationChangeActionEnum('action').notNull(),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    reason: text('reason'),
    beforeSnapshot: jsonb('before_snapshot').$type<JsonRecord>(),
    afterSnapshot: jsonb('after_snapshot').$type<JsonRecord>(),
    changedAt: timestamp('changed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const ticketBenefits = pgTable(
  'ticket_benefits',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    configurationId: uuid('configuration_id')
      .notNull()
      .references(() => ticketBenefitConfigurations.id, {
        onDelete: 'cascade',
      }),
    identity: varchar('identity', { length: 120 }).notNull(),
    kind: ticketBenefitKindEnum('kind').notNull(),
    displayCopy: jsonb('display_copy').$type<BenefitDisplayCopy>().notNull(),
    eligibleTierNames: jsonb('eligible_tier_names')
      .$type<string[]>()
      .notNull(),
    quantity: integer('quantity'),
    selectionPriority: integer('selection_priority'),
    mutualExclusionGroup: varchar('mutual_exclusion_group', { length: 120 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_ticket_benefits_configuration_id').on(table.configurationId),
    uniqueIndex('idx_ticket_benefits_configuration_identity_unique').on(
      table.configurationId,
      table.identity,
    ),
  ],
);

export const ticketBenefitRuns = pgTable(
  'ticket_benefit_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    showtimeId: uuid('showtime_id')
      .notNull()
      .references(() => showtimes.id, { onDelete: 'cascade' }),
    mode: ticketBenefitRunModeEnum('mode').notNull(),
    status: ticketBenefitRunStatusEnum('status')
      .notNull()
      .default('running'),
    configurationSnapshot: jsonb('configuration_snapshot')
      .$type<JsonRecord>()
      .notNull(),
    seedRef: varchar('seed_ref', { length: 160 }).notNull(),
    randomSeedInternal: varchar('random_seed_internal', {
      length: 256,
    }).notNull(),
    resultSummary: jsonb('result_summary')
      .$type<JsonRecord>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_ticket_benefit_runs_showtime_created').on(
      table.showtimeId,
      desc(table.createdAt),
    ),
  ],
);

export const ticketBenefitEntitlements = pgTable(
  'ticket_benefit_entitlements',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    showtimeId: uuid('showtime_id')
      .notNull()
      .references(() => showtimes.id, { onDelete: 'restrict' }),
    ticketItemId: uuid('ticket_item_id')
      .notNull()
      .references(() => ticketItems.id, { onDelete: 'restrict' }),
    benefitIdentity: varchar('benefit_identity', { length: 120 }).notNull(),
    benefitKind: ticketBenefitKindEnum('benefit_kind').notNull(),
    displayCopySnapshot: jsonb('display_copy_snapshot')
      .$type<BenefitDisplayCopy>()
      .notNull(),
    source: ticketBenefitEntitlementSourceEnum('source').notNull(),
    runId: uuid('run_id').references(() => ticketBenefitRuns.id, {
      onDelete: 'set null',
    }),
    state: ticketBenefitEntitlementStateEnum('state')
      .notNull()
      .default('active'),
    inactiveReason: text('inactive_reason'),
    redeemedAt: timestamp('redeemed_at', { withTimezone: true }),
    redeemedByUserId: uuid('redeemed_by_user_id').references(() => users.id, {
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
    index('idx_ticket_benefit_entitlements_showtime_ticket_item').on(
      table.showtimeId,
      table.ticketItemId,
    ),
    uniqueIndex('idx_ticket_benefit_entitlements_active_limited_ticket_item')
      .on(table.ticketItemId)
      .where(sql`${table.benefitKind} = 'limited' AND ${table.state} = 'active'`),
    uniqueIndex('idx_tbe_active_config_included_item_identity')
      .on(table.ticketItemId, table.benefitIdentity)
      .where(sql`${table.source} = 'configuration' AND ${table.benefitKind} = 'included' AND ${table.state} = 'active'`),
  ],
);

export const ticketBenefitRedemptionRecords = pgTable(
  'ticket_benefit_redemption_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    showtimeId: uuid('showtime_id')
      .notNull()
      .references(() => showtimes.id, { onDelete: 'restrict' }),
    ticketItemId: uuid('ticket_item_id')
      .notNull()
      .references(() => ticketItems.id, { onDelete: 'restrict' }),
    benefitEntitlementId: uuid('benefit_entitlement_id')
      .notNull()
      .references(() => ticketBenefitEntitlements.id, {
        onDelete: 'restrict',
      }),
    scannerUserId: uuid('scanner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    deviceAttemptId: varchar('device_attempt_id', { length: 120 }).notNull(),
    redactedTokenRef: varchar('redacted_token_ref', { length: 160 }).notNull(),
    result: ticketBenefitRedemptionResultEnum('result').notNull(),
    rejectionReason: text('rejection_reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_tbrr_showtime_entitlement_created').on(
      table.showtimeId,
      table.benefitEntitlementId,
      desc(table.createdAt),
    ),
    uniqueIndex('idx_ticket_benefit_redemption_records_device_attempt_unique').on(
      table.deviceAttemptId,
    ),
  ],
);
