import { describe, expect, it } from 'vitest';

import {
  banners,
  bannerDeviceTargetEnum,
  bannerPlacementEnum,
  bannerStatusEnum,
  performancePublishStateEnum,
  performanceStatusEnum,
  performances,
  venues,
} from './index.js';
import * as schemaBarrel from './index.js';
import {
  createBannerSchema,
  createPerformanceSchema,
  performancePublishLifecycleSchema,
} from '@grabit/shared';

function expectColumnName(column: { name: string } | undefined, name: string) {
  expect(column?.name).toBe(name);
}

describe('Phase 25 admin content schema contracts', () => {
  it('keeps the internal event publish lifecycle separate from public performance_status', () => {
    expect(performancePublishLifecycleSchema.options).toEqual([
      'draft',
      'review',
      'publish_ready',
      'published',
    ]);
    expect(performancePublishStateEnum.enumValues).toEqual([
      'draft',
      'review',
      'publish_ready',
      'published',
    ]);
    expect(performanceStatusEnum.enumValues).toEqual([
      'upcoming',
      'selling',
      'closing_soon',
      'ended',
    ]);
    expect(performanceStatusEnum.enumValues).not.toEqual(
      performancePublishStateEnum.enumValues,
    );

    expectColumnName(performances.publishState, 'publish_state');
    expectColumnName(
      performances.publishReviewRequestedAt,
      'publish_review_requested_at',
    );
    expectColumnName(performances.publishReadyAt, 'publish_ready_at');
    expectColumnName(performances.publishedAt, 'published_at');
    expectColumnName(performances.publishedByUserId, 'published_by_user_id');

    const parsed = createPerformanceSchema.parse({
      title: 'Girl Rules Fanmeet',
      genre: 'artist_celebrity',
      venueName: 'Donghae Arts Center',
      venueAddress: 'Seoul',
      venueAccessNotes: 'Wheelchair access through gate B',
      transportSummary: 'Use line 2 and shuttle bus',
      startDate: '2026-07-18',
      endDate: '2026-07-18',
      ageRating: '12+',
      priceTiers: [{ tierName: 'VIP', price: 150000, sortOrder: 0 }],
      publishState: 'publish_ready',
    });

    expect(parsed.publishState).toBe('publish_ready');
    expect(parsed.venueAccessNotes).toBe('Wheelchair access through gate B');
    expect(parsed.transportSummary).toBe('Use line 2 and shuttle bus');
  });

  it('exports venue/transport and banner placement/device/schedule/status fields through the schema barrel', () => {
    expect(schemaBarrel).toHaveProperty('performancePublishStateEnum');
    expect(schemaBarrel).toHaveProperty('bannerPlacementEnum');
    expect(schemaBarrel).toHaveProperty('bannerDeviceTargetEnum');
    expect(schemaBarrel).toHaveProperty('bannerStatusEnum');

    expectColumnName(venues.accessNotes, 'access_notes');
    expectColumnName(venues.transportSummary, 'transport_summary');

    expect(bannerPlacementEnum.enumValues).toEqual([
      'home_hero',
      'home_secondary',
      'performance_detail',
      'operations_notice',
    ]);
    expect(bannerDeviceTargetEnum.enumValues).toEqual([
      'all',
      'desktop',
      'mobile',
    ]);
    expect(bannerStatusEnum.enumValues).toEqual([
      'draft',
      'scheduled',
      'active',
      'paused',
      'expired',
    ]);

    expectColumnName(banners.placement, 'placement');
    expectColumnName(banners.deviceTarget, 'device_target');
    expectColumnName(banners.status, 'status');
    expectColumnName(banners.startsAt, 'starts_at');
    expectColumnName(banners.endsAt, 'ends_at');

    const parsed = createBannerSchema.parse({
      imageUrl: 'https://r2.example.com/banners/m1.jpg',
      linkUrl: 'https://heygrabit.com/performances/girl-rules',
      placement: 'home_hero',
      deviceTarget: 'mobile',
      startsAt: '2026-05-15T00:00:00.000Z',
      endsAt: '2026-05-31T23:59:59.000Z',
      status: 'scheduled',
    });

    expect(parsed).toMatchObject({
      placement: 'home_hero',
      deviceTarget: 'mobile',
      status: 'scheduled',
    });
  });
});
