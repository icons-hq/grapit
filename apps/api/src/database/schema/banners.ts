import { pgTable, uuid, varchar, integer, boolean, timestamp, pgEnum, index } from 'drizzle-orm/pg-core';

export const bannerPlacementEnum = pgEnum('banner_placement', [
  'home_hero',
  'home_secondary',
  'performance_detail',
  'operations_notice',
]);

export const bannerDeviceTargetEnum = pgEnum('banner_device_target', [
  'all',
  'desktop',
  'mobile',
]);

export const bannerStatusEnum = pgEnum('banner_status', [
  'draft',
  'scheduled',
  'active',
  'paused',
  'expired',
]);

export const banners = pgTable(
  'banners',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    imageUrl: varchar('image_url', { length: 1000 }).notNull(),
    linkUrl: varchar('link_url', { length: 1000 }),
    placement: bannerPlacementEnum('placement').notNull().default('home_hero'),
    deviceTarget: bannerDeviceTargetEnum('device_target').notNull().default('all'),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    status: bannerStatusEnum('status').notNull().default('active'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_banners_placement_status').on(table.placement, table.status),
    index('idx_banners_schedule').on(table.startsAt, table.endsAt),
  ],
);
