import { pgTable, uuid, varchar, boolean, timestamp, pgEnum } from 'drizzle-orm/pg-core';

export const genderEnum = pgEnum('gender', ['male', 'female', 'unspecified']);
export const localeEnum = pgEnum('locale', ['ko', 'en', 'th', 'zh-CN', 'ja']);

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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
