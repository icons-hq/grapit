import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ConsentService } from './consent.service.js';
import type { ConsentCaptureItem } from '@grabit/shared';

function makeConsentItems() {
  return [
    { id: 'item-terms', key: 'terms', version: '2026-05-01', locale: 'ko', isRequired: true },
    { id: 'item-privacy', key: 'privacy', version: '2026-05-01', locale: 'ko', isRequired: true },
    { id: 'item-pipa', key: 'pipa_required', version: '2026-05-01', locale: 'ko', isRequired: true },
    {
      id: 'item-cross-border',
      key: 'cross_border_transfer',
      version: '2026-05-01',
      locale: 'ko',
      isRequired: true,
    },
    { id: 'item-pdpa', key: 'pdpa_notice', version: '2026-05-01', locale: 'ko', isRequired: true },
    { id: 'item-pipl', key: 'pipl_notice', version: '2026-05-01', locale: 'ko', isRequired: true },
    { id: 'item-marketing', key: 'marketing', version: '2026-05-01', locale: 'ko', isRequired: false },
  ];
}

function makeCaptureItems(
  overrides: Partial<Record<ConsentCaptureItem['key'], boolean>> = {},
): ConsentCaptureItem[] {
  return makeConsentItems().map((item) => ({
    key: item.key as ConsentCaptureItem['key'],
    version: item.version,
    language: 'ko',
    accepted: overrides[item.key as ConsentCaptureItem['key']] ?? true,
  }));
}

function chainRows<T>(rows: T[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(rows),
    }),
  };
}

describe('ConsentService', () => {
  let service: ConsentService;
  let db: {
    select: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
  };
  let insertedRows: unknown[];

  beforeEach(() => {
    insertedRows = [];
    db = {
      select: vi.fn().mockReturnValue(chainRows(makeConsentItems())),
      insert: vi.fn().mockReturnValue({
        values: vi.fn((rows: unknown[]) => {
          insertedRows = rows;
          return Promise.resolve([]);
        }),
      }),
    };
    service = new ConsentService(db as never);
  });

  it('writes one immutable audit row per submitted item/version/language', async () => {
    const userId = randomUUID();
    const capturedAt = new Date('2026-05-06T00:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(capturedAt);

    try {
      await service.captureConsent(
        userId,
        {
          birthDate: '1995-05-15',
          items: makeCaptureItems({ marketing: false }),
          sourceFlow: 'signup',
        },
        { ipAddress: '203.0.113.10', userAgent: 'vitest-agent' },
      );
    } finally {
      vi.useRealTimers();
    }

    expect(insertedRows).toHaveLength(7);
    expect(insertedRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId,
          consentItemId: 'item-cross-border',
          itemKey: 'cross_border_transfer',
          itemVersion: '2026-05-01',
          language: 'ko',
          agreed: true,
          agreedAt: capturedAt,
          ipAddress: '203.0.113.10',
          userAgent: 'vitest-agent',
          sourceFlow: 'signup',
        }),
        expect.objectContaining({
          itemKey: 'marketing',
          agreed: false,
          sourceFlow: 'signup',
        }),
      ]),
    );
  });

  it('blocks when a required consent item is missing', async () => {
    await expect(
      service.assertRequiredConsents({
        birthDate: '1995-05-15',
        sourceFlow: 'signup',
        items: makeCaptureItems().filter((item) => item.key !== 'privacy'),
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('blocks when cross-border transfer consent is refused', async () => {
    await expect(
      service.assertRequiredConsents({
        birthDate: '1995-05-15',
        sourceFlow: 'booking',
        items: makeCaptureItems({ cross_border_transfer: false }),
      }),
    ).rejects.toThrow(
      '국외이전 동의가 필요합니다. 동의하지 않으면 가입 또는 팬미팅 예매를 진행할 수 없습니다.',
    );
  });

  it('keeps marketing consent optional and separate from required blocking', async () => {
    await expect(
      service.assertRequiredConsents({
        birthDate: '1995-05-15',
        sourceFlow: 'signup',
        items: makeCaptureItems({ marketing: false }),
      }),
    ).resolves.toBeUndefined();
  });

  it('blocks under-14 users without guardian flow', () => {
    expect(() =>
      service.assertAgeAllowed('2013-05-07', new Date('2026-05-06T00:00:00.000Z')),
    ).toThrow(ForbiddenException);
    expect(() =>
      service.assertAgeAllowed('2013-05-07', new Date('2026-05-06T00:00:00.000Z')),
    ).toThrow('만 14세 미만은 가입할 수 없습니다');
  });
});
