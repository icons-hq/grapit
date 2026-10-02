import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  pgEnum,
  jsonb,
  index,
  foreignKey,
} from 'drizzle-orm/pg-core';

export const genderEnum = pgEnum('gender', ['male', 'female', 'unspecified']);
export const localeEnum = pgEnum('locale', ['ko', 'en', 'th', 'zh-CN', 'zh-TW']);

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).unique().notNull(),
  passwordHash: varchar('password_hash', { length: 255 }), // null for social-only accounts
  name: varchar('name', { length: 100 }).notNull(),
  phone: varchar('phone', { length: 20 }).notNull(),
  gender: genderEnum('gender').notNull(),
  country: varchar('country', { length: 100 }).notNull().default('KR'),
  preferredLocale: localeEnum('preferred_locale').default('ko'),
  birthDate: varchar('birth_date', { length: 10 }).notNull(), // YYYY-MM-DD format
  isPhoneVerified: boolean('is_phone_verified').notNull().default(false),
  isEmailVerified: boolean('is_email_verified').notNull().default(false),
  marketingConsent: boolean('marketing_consent').notNull().default(false),
  role: varchar('role', { length: 20 }).notNull().default('user'), // user | admin
  adminCapabilityBundle: varchar('admin_capability_bundle', { length: 20 }),
  adminCapabilities: jsonb('admin_capabilities')
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  accountStatus: varchar('account_status', { length: 20 }).notNull().default('active'),
  withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
  withdrawalReason: varchar('withdrawal_reason', { length: 500 }),
  withdrawnByUserId: uuid('withdrawn_by_user_id'),
  withdrawalSource: varchar('withdrawal_source', { length: 20 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Self-reference and indexes created by migrations 0020 and 0021.
  foreignKey({
    name: 'users_withdrawn_by_user_id_users_id_fk',
    columns: [table.withdrawnByUserId],
    foreignColumns: [table.id],
  }).onDelete('set null'),
  index('idx_users_role_admin_capability_bundle').on(table.role, table.adminCapabilityBundle),
  index('idx_users_account_status').on(table.accountStatus),
  // Case-insensitive login/signup lookups. Not unique: legacy rows may differ only by case.
  index('idx_users_email_lower').using('btree', sql`lower(${table.email})`),
  // Verified phone identity lookup for the per-person ticket limit (ticket-limit.ts, migration 0039).
  index('idx_users_verified_phone_suffix')
    .on(sql`(right(regexp_replace(translate(${table.phone}, '０１２３４５６７８９', '0123456789'), '[^0-9]', '', 'g'), 8))`)
    .where(sql`${table.isPhoneVerified} = true`),
]);
