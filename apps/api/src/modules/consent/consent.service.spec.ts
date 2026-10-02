import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
  ADMIN_CONSENT_AUDIT_DEFAULT_WINDOW_DAYS,
  type ConsentCaptureItem,
} from '@grabit/shared';
import { CONSENT_DOCUMENT_OUTDATED_MESSAGE, ConsentService } from './consent.service.js';

function makeConsentItems() {
  return [
    { id: 'item-terms', key: 'terms', version: '2026-05-01', locale: 'ko', isRequired: true },
    { id: 'item-privacy', key: 'privacy', version: '2026-05-01', locale: 'ko', isRequired: true },
    { id: 'item-pipa', key: 'pipa_required', version: '2026-05-01', locale: 'ko', isRequired: true },
    {
      id: 'item-marketing',
      key: 'marketing',
      version: '2026-05-01',
      locale: 'ko',
      isRequired: false,
    },
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

function bookingItems(keys: ConsentCaptureItem['key'][] = ['terms', 'privacy']) {
  return keys.map((key) => ({
    key,
    version: '2026-05-01',
    language: 'ko' as const,
    accepted: true,
    sourceFlow: 'booking' as const,
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
  let insertedRows: Array<Record<string, unknown>>;

  beforeEach(() => {
    insertedRows = [];
    db = {
      select: vi.fn().mockReturnValue(chainRows(makeConsentItems())),
      insert: vi.fn().mockReturnValue({
        values: vi.fn((rows: Array<Record<string, unknown>>) => {
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
          items: [
            ...makeCaptureItems({ marketing: false }),
            {
              key: 'cross_border_transfer',
              version: '2026-05-01',
              language: 'ko',
              accepted: true,
            },
          ],
          sourceFlow: 'signup',
        },
        { ipAddress: '203.0.113.10', userAgent: 'vitest-agent' },
      );
    } finally {
      vi.useRealTimers();
    }

    expect(insertedRows).toHaveLength(4);
    expect(insertedRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId,
          consentItemId: 'item-pipa',
          itemKey: 'pipa_required',
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
        sourceFlow: 'signup',
        items: makeCaptureItems().filter((item) => item.key !== 'privacy'),
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('does not require legacy cross-border or country notice rows', async () => {
    await expect(
      service.assertRequiredConsents({
        sourceFlow: 'booking',
        items: [
          ...makeCaptureItems(),
          {
            key: 'cross_border_transfer',
            version: '2026-05-01',
            language: 'ko',
            accepted: false,
          },
          {
            key: 'pdpa_notice',
            version: '2026-05-01',
            language: 'ko',
            accepted: false,
          },
          {
            key: 'pipl_notice',
            version: '2026-05-01',
            language: 'ko',
            accepted: false,
          },
        ],
      }),
    ).resolves.toBeUndefined();
  });

  it('keeps marketing consent optional and separate from required blocking', async () => {
    await expect(
      service.assertRequiredConsents({
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

  describe('booking consent', () => {
    it('accepts the two rows checkout shows when the flow is inferred from the booking items', async () => {
      // Reservation prepare passes only `{ items }`; every booking row is tagged.
      await expect(service.assertRequiredConsents({ items: bookingItems() })).resolves.toBeUndefined();
    });

    it('still requires PIPA consent for signup rows', async () => {
      const signupItems = bookingItems().map((item) => ({ ...item, sourceFlow: 'signup' as const }));
      await expect(service.assertRequiredConsents({ items: signupItems }))
        .rejects.toThrow('pipa_required consent is required');
    });

    it('requires every checkout row to be accepted', async () => {
      await expect(service.assertRequiredConsents({
        items: bookingItems().map((item) => (item.key === 'privacy' ? { ...item, accepted: false } : item)),
      })).rejects.toThrow('privacy consent is required');
    });

    it('never records a PIPA row for booking, because checkout does not present it', async () => {
      await service.captureConsent(
        'user-1',
        {
          birthDate: '1995-05-15',
          // A page built before this fix still submits pipa_required.
          items: bookingItems(['terms', 'privacy', 'pipa_required']),
          sourceFlow: 'booking',
        },
        { ipAddress: '203.0.113.10' },
      );

      expect(insertedRows.map((row) => row.itemKey)).toEqual(['terms', 'privacy']);
      expect(insertedRows.every((row) => row.sourceFlow === 'booking')).toBe(true);
    });

    it('records the document language the client submitted', async () => {
      db.select.mockReturnValue(chainRows(makeConsentItems().map((item) => ({ ...item, locale: 'en' }))));

      await service.captureConsent(
        'user-1',
        {
          birthDate: '1995-05-15',
          items: bookingItems().map((item) => ({ ...item, language: 'en' as const })),
          sourceFlow: 'booking',
        },
        { ipAddress: '203.0.113.10' },
      );

      expect(insertedRows.map((row) => row.language)).toEqual(['en', 'en']);
    });
  });

  describe('document versions', () => {
    it('rejects a required row on a retired version before any side effect, with a reload hint', async () => {
      const staleItems = bookingItems().map((item) => (
        item.key === 'privacy' ? { ...item, version: '2026-01-01' } : item
      ));

      await expect(service.assertRequiredConsents({ items: staleItems }))
        .rejects.toThrow(CONSENT_DOCUMENT_OUTDATED_MESSAGE);
      expect(db.insert).not.toHaveBeenCalled();
      await expect(service.captureConsent(
        'user-1',
        { birthDate: '1995-05-15', items: staleItems, sourceFlow: 'booking' },
        { ipAddress: '203.0.113.10' },
      )).rejects.toThrow(CONSENT_DOCUMENT_OUTDATED_MESSAGE);
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('skips an optional row on a retired version instead of failing the request', async () => {
      await service.captureConsent(
        'user-1',
        {
          birthDate: '1995-05-15',
          items: makeCaptureItems().map((item) => (
            item.key === 'marketing' ? { ...item, version: '2026-01-01' } : item
          )),
          sourceFlow: 'signup',
        },
        { ipAddress: '203.0.113.10' },
      );

      expect(insertedRows.map((row) => row.itemKey)).toEqual(['terms', 'privacy', 'pipa_required']);
    });

    it('accepts both the previous and the new version while both are active', async () => {
      db.select.mockReturnValue(chainRows([
        ...makeConsentItems(),
        { id: 'item-privacy-v2', key: 'privacy', version: '2026-05-11', locale: 'ko', isRequired: true },
      ]));

      for (const version of ['2026-05-01', '2026-05-11']) {
        await service.captureConsent(
          'user-1',
          {
            birthDate: '1995-05-15',
            items: bookingItems().map((item) => (item.key === 'privacy' ? { ...item, version } : item)),
            sourceFlow: 'booking',
          },
          { ipAddress: '203.0.113.10' },
        );
        expect(insertedRows.find((row) => row.itemKey === 'privacy')).toMatchObject({ itemVersion: version });
      }
    });
  });

  describe('queryConsentAudit', () => {
    const dialect = new PgDialect();
    const now = new Date('2026-10-01T00:00:00.000Z');

    function auditRow(index: number) {
      const second = String(59 - index).padStart(2, '0');
      return {
        id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        itemKey: 'privacy',
        version: '2026-05-11',
        language: 'ko',
        userId: `user-${index}`,
        email: `fan${index}@example.com`,
        phone: '+821012345678',
        ipAddress: '203.0.113.10',
        timestamp: new Date(`2026-09-30T00:00:${second}.123Z`),
        cursorAt: `2026-09-30T00:00:${second}.123456Z`,
        sourceFlow: 'signup',
        accepted: true,
      };
    }

    function auditQueryDb(rows: ReturnType<typeof auditRow>[]) {
      const calls: { where?: SQL; orderBy?: unknown[]; limit?: number } = {};
      const chain = {
        from: vi.fn(() => chain),
        innerJoin: vi.fn(() => chain),
        where: vi.fn((where?: SQL) => {
          calls.where = where;
          return chain;
        }),
        orderBy: vi.fn((...order: unknown[]) => {
          calls.orderBy = order;
          return chain;
        }),
        limit: vi.fn((limit: number) => {
          calls.limit = limit;
          return Promise.resolve(rows.slice(0, limit));
        }),
      };
      const auditService = new ConsentService({ select: vi.fn(() => chain) } as never);
      const rendered = () => dialect.sqlToQuery(calls.where!);
      return { auditService, calls, rendered };
    }

    it('returns one bounded page, newest first, with a cursor for the next page', async () => {
      const { auditService, calls } = auditQueryDb([0, 1, 2, 3].map(auditRow));

      const result = await auditService.queryConsentAudit({ limit: 3 }, now);

      expect(calls.limit).toBe(4);
      expect(calls.orderBy).toHaveLength(2);
      expect(result.items.map((row) => row.id)).toEqual([0, 1, 2].map((index) => auditRow(index).id));
      expect(result.items[0]).toMatchObject({
        maskedUser: { id: 'user-0', email: 'fa***@example.com', phone: '+82********78' },
        maskedIp: '203.0.113.0',
      });
      expect(JSON.stringify(result.items)).not.toContain('fan0@example.com');
      expect(ConsentService.decodeAuditCursor(result.nextCursor!)).toEqual({
        at: auditRow(2).cursorAt,
        id: auditRow(2).id,
      });
    });

    it('returns no cursor on the last page', async () => {
      const { auditService } = auditQueryDb([0, 1].map(auditRow));

      const result = await auditService.queryConsentAudit({ limit: 3 }, now);

      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBeNull();
    });

    it('limits an unfiltered query to the default lookback window', async () => {
      const { auditService, rendered } = auditQueryDb([]);

      const result = await auditService.queryConsentAudit({}, now);

      const windowFrom = new Date(now.getTime() - ADMIN_CONSENT_AUDIT_DEFAULT_WINDOW_DAYS * 86_400_000);
      expect(result.defaultWindowFrom).toBe(windowFrom.toISOString());
      expect(rendered().sql).toContain('"consent_audit_logs"."agreed_at" >= $1');
      expect(rendered().params).toEqual([windowFrom.toISOString()]);
    });

    it('does not cap a user lookup to the default window', async () => {
      const { auditService, rendered } = auditQueryDb([]);
      const userId = randomUUID();

      const result = await auditService.queryConsentAudit({ userId }, now);

      expect(result.defaultWindowFrom).toBeNull();
      expect(rendered().sql).not.toContain('agreed_at');
      expect(rendered().params).toEqual([userId]);
    });

    it('continues strictly after the cursor row using its full precision timestamp', async () => {
      const { auditService, rendered } = auditQueryDb([]);
      const cursor = ConsentService.encodeAuditCursor({
        at: '2026-09-30T00:00:57.123456Z',
        id: auditRow(2).id,
      });

      await auditService.queryConsentAudit({ cursor, from: '2026-09-01T00:00:00.000Z' }, now);

      const query = rendered();
      expect(query.sql).toContain('"consent_audit_logs"."agreed_at" <= $2::timestamptz');
      expect(query.sql).toContain(
        '("consent_audit_logs"."agreed_at" < $3::timestamptz or ("consent_audit_logs"."agreed_at" = $4::timestamptz and "consent_audit_logs"."id" < $5::uuid))',
      );
      expect(query.params.slice(1)).toEqual([
        '2026-09-30T00:00:57.123456Z',
        '2026-09-30T00:00:57.123456Z',
        '2026-09-30T00:00:57.123456Z',
        auditRow(2).id,
      ]);
    });

    it('rejects a tampered cursor as a bad request', async () => {
      const { auditService } = auditQueryDb([]);

      await expect(auditService.queryConsentAudit({ cursor: 'not-a-cursor' }, now))
        .rejects.toThrow(BadRequestException);
      await expect(auditService.queryConsentAudit({
        cursor: ConsentService.encodeAuditCursor({ at: "2026-09-30' or 1=1 --", id: 'x' } as never),
      }, now)).rejects.toThrow(BadRequestException);
    });
  });
});
