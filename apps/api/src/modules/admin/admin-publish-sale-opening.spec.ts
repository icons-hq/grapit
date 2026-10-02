import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import type { PerformancePreparation, PerformanceSaleOpening } from '@grabit/shared';

import { AdminService, IMMEDIATE_SALE_CONFIRMATION_MESSAGE, type PublishPerformanceInput } from './admin.service.js';
import type { AdminAuditService } from './admin-audit.service.js';
import type { CatalogFreshnessService } from '../performance/catalog-freshness.service.js';
import { readPerformancePreparation } from './performance-preparation.js';

vi.mock('./performance-preparation.js', () => ({ readPerformancePreparation: vi.fn() }));

const UPDATED_AT = '2026-09-30T00:00:00.000Z';
const context = { actorUserId: '11111111-1111-4111-8111-111111111111', ipAddress: '198.51.100.10', userAgent: 'vitest', requestId: 'req-1' };
const publishInput: PublishPerformanceInput = {
  expectedUpdatedAt: UPDATED_AT,
  reason: '공개 검수 완료',
  confirmed: true,
  confirmedChangedFields: ['publishState'],
  contentChecklist: { ko: { title: true, description: true }, en: { title: true, description: true } },
};

function preparation(saleOpening: PerformanceSaleOpening): PerformancePreparation {
  return { performanceId: 'perf-1', title: '팬미팅', updatedAt: UPDATED_AT, publishState: 'draft', status: 'selling',
    bookingStartsAt: saleOpening.at, saleOpening, canPublish: true, structureProtected: false, reservationCount: 0,
    checks: [{ key: 'sales', label: '판매 설정', ready: true, step: 'seats', detail: '' }], locales: [], history: [] };
}

function createDb(publishState: 'draft' | 'published') {
  const performanceRow = {
    id: 'perf-1', title: '팬미팅', genre: 'artist_celebrity', subcategory: null, venueId: 'venue-1', posterUrl: null,
    description: '상세', descriptionVisible: true, detailImages: [], startDate: new Date('2026-12-01T00:00:00.000Z'),
    endDate: new Date('2026-12-02T00:00:00.000Z'), runtime: null, ageRating: '전체 관람가', status: 'selling', publishState,
    publishReviewRequestedAt: null, publishReadyAt: null, publishedAt: null, publishedByUserId: null, salesInfo: null,
    salesInfoVisible: true, viewCount: 0, createdAt: new Date(UPDATED_AT), updatedAt: new Date(UPDATED_AT),
  };
  const lockedRead = { from: vi.fn(), where: vi.fn(), for: vi.fn().mockResolvedValue([performanceRow]) };
  lockedRead.from.mockReturnValue(lockedRead);
  lockedRead.where.mockReturnValue(lockedRead);
  // The real update stamps updatedAt with a SQL expression; the database returns a timestamp.
  const set = vi.fn((values: Record<string, unknown>) => ({
    where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ ...performanceRow, ...values,
      updatedAt: new Date('2026-09-30T00:00:01.000Z') }]) }),
  }));
  const tx = { select: vi.fn().mockReturnValue(lockedRead), update: vi.fn().mockReturnValue({ set }) };
  return { transaction: vi.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx)), tx };
}

describe('AdminService.publishPerformance sale opening confirmation', () => {
  let audit: { write: ReturnType<typeof vi.fn> };
  let freshness: { invalidatePerformance: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.mocked(readPerformancePreparation).mockReset();
    audit = { write: vi.fn().mockResolvedValue({ id: 'audit-1' }) };
    freshness = { invalidatePerformance: vi.fn().mockResolvedValue(undefined) };
  });

  function serviceFor(db: ReturnType<typeof createDb>) {
    return new AdminService(db as never, freshness as unknown as CatalogFreshnessService, audit as unknown as AdminAuditService);
  }

  it('refuses to publish an open sale without explicit immediate-sale confirmation and records the failed attempt', async () => {
    const db = createDb('draft');
    vi.mocked(readPerformancePreparation).mockResolvedValue(preparation({ mode: 'immediate', at: null, startElapsed: false }));

    const error = await serviceFor(db).publishPerformance('perf-1', publishInput, context).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).message).toBe(IMMEDIATE_SALE_CONFIRMATION_MESSAGE);
    expect(db.tx.update).not.toHaveBeenCalled();
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ action: 'event.publish', status: 'failed',
      changedFields: ['publishState', 'saleOpening'],
      after: { saleOpening: { mode: 'immediate', at: null, startElapsed: false, confirmed: false } } }), db.tx);
    expect(freshness.invalidatePerformance).not.toHaveBeenCalled();
  });

  it('publishes an open sale once the approver confirms the immediate opening', async () => {
    const db = createDb('draft');
    vi.mocked(readPerformancePreparation).mockResolvedValue(preparation({ mode: 'immediate', at: null, startElapsed: false }));

    const result = await serviceFor(db).publishPerformance('perf-1', { ...publishInput, immediateSaleConfirmed: true }, context);

    expect(result.publishState).toBe('published');
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ status: 'success',
      changedFields: ['publishState', 'saleOpening'],
      after: expect.objectContaining({ saleOpening: { mode: 'immediate', at: null, startElapsed: false, confirmed: true } }) }), db.tx);
  });

  it.each<PerformanceSaleOpening>([
    { mode: 'manual', at: null, startElapsed: false },
    { mode: 'scheduled', at: '2026-10-08T11:00:00.000Z', startElapsed: false },
  ])('does not ask for immediate-sale confirmation when sales open %s', async (saleOpening) => {
    const db = createDb('draft');
    vi.mocked(readPerformancePreparation).mockResolvedValue(preparation(saleOpening));

    await expect(serviceFor(db).publishPerformance('perf-1', publishInput, context)).resolves.toMatchObject({ publishState: 'published' });
  });

  it('does not ask again when an already public performance is re-approved', async () => {
    const db = createDb('published');
    vi.mocked(readPerformancePreparation).mockResolvedValue(preparation({ mode: 'immediate', at: null, startElapsed: false }));

    await expect(serviceFor(db).publishPerformance('perf-1', publishInput, context)).resolves.toMatchObject({ publishState: 'published' });
  });
});
