import { describe, expect, it } from 'vitest';

import {
  FIELD_CHECK_IN_OUTCOMES,
  FIELD_OFFLINE_SYNC_STATES,
  fieldCheckInConsumeRequestSchema,
  fieldCheckInVerifyResponseSchema,
  fieldCheckInVerifyRequestSchema,
  fieldMonitorLogFilterSchema,
  fieldMonitorSummarySchema,
  fieldOfflineSyncAttemptSchema,
  fieldOfflineSyncResponseSchema,
  adminSettlementReconciliationSchema,
  settlementExportRequestSchema,
  settlementExportResponseSchema,
  settlementSummarySchema,
} from './field-operations.schema';
import { fieldCheckInVerifyRequestSchema as exportedVerifyRequestSchema } from '../index';

const VALID_SHOWTIME_ID = '00000000-0000-4000-8000-000000000001';
const VALID_EVENT_ID = 'event-girl-rules-20260704';
const VALID_ISO = '2026-07-04T09:00:00.000Z';
const VALID_BENEFIT_RUN_ID = '33333333-3333-4333-8333-333333333333';
const VALID_BENEFIT_ENTITLEMENT_ID = '55555555-5555-4555-8555-555555555555';
const BENEFIT_DISPLAY_COPY = {
  ko: { name: '6:1', description: '6:1 이벤트 참여 혜택' },
  en: { name: '6:1', description: '6:1 event benefit' },
  'zh-CN': { name: '6:1', description: '6:1 活动福利' },
  th: { name: '6:1', description: 'สิทธิประโยชน์กิจกรรม 6:1' },
};

const FORBIDDEN_VISIBLE_FIELDS = [
  'email',
  'phone',
  'rawToken',
  'rawJti',
  'paymentKey',
  'cookie',
];

describe('field operations contract', () => {
  it('accepts opaque token or QR URL verify requests without state-changing confirmation or raw PII fields', () => {
    expect(
      fieldCheckInVerifyRequestSchema.parse({
        token: 'opaque-ticket-token',
        showtimeId: VALID_SHOWTIME_ID,
      }),
    ).toEqual({
      token: 'opaque-ticket-token',
      showtimeId: VALID_SHOWTIME_ID,
    });

    expect(
      fieldCheckInVerifyRequestSchema.parse({
        qrUrl: 'https://heygrabit.com/field/check-in?token=opaque-ticket-token',
      }).qrUrl,
    ).toBe('https://heygrabit.com/field/check-in?token=opaque-ticket-token');

    expect(() =>
      fieldCheckInVerifyRequestSchema.parse({
        token: 'opaque-ticket-token',
        confirmed: true,
      }),
    ).toThrow();

    for (const field of FORBIDDEN_VISIBLE_FIELDS) {
      expect(() =>
        fieldCheckInVerifyRequestSchema.parse({
          token: 'opaque-ticket-token',
          [field]: 'leak',
        }),
      ).toThrow();
    }
  });

  it('requires explicit manual consume fields and confirmed true after scanner review', () => {
    const parsed = fieldCheckInConsumeRequestSchema.parse({
      token: 'opaque-ticket-token',
      showtimeId: VALID_SHOWTIME_ID,
      deviceAttemptId: 'device-attempt-1',
      confirmed: true,
    });

    expect(parsed.confirmed).toBe(true);
    expect(parsed.deviceAttemptId).toBe('device-attempt-1');

    expect(() =>
      fieldCheckInConsumeRequestSchema.parse({
        token: 'opaque-ticket-token',
        showtimeId: VALID_SHOWTIME_ID,
        deviceAttemptId: 'device-attempt-1',
      }),
    ).toThrow(/확인/);

    expect(() =>
      fieldCheckInConsumeRequestSchema.parse({
        token: 'opaque-ticket-token',
        showtimeId: VALID_SHOWTIME_ID,
        confirmed: true,
      }),
    ).toThrow(/attempt/);
  });

  it('includes benefit entitlements in field verify ticket context', () => {
    const parsed = fieldCheckInVerifyResponseSchema.parse({
      outcome: 'processable',
      processable: true,
      ticket: {
        reservationNumber: 'GRP-24001',
        performanceTitle: 'Girl Rules Fanmeet',
        showtimeId: VALID_SHOWTIME_ID,
        showtimeLabel: '2026-07-04 18:00',
        seatLabels: ['VIP A-1'],
        ticketStatus: 'ACTIVE',
        redactedTokenRef: 'tok_abc...xyz',
        maskedJti: 'jti_***_a1',
        benefitEntitlements: [
          {
            id: VALID_BENEFIT_ENTITLEMENT_ID,
            runId: VALID_BENEFIT_RUN_ID,
            source: 'live_run',
            benefitIdentity: 'benefit_6_to_1',
            kind: 'included',
            displayCopy: BENEFIT_DISPLAY_COPY,
            state: 'active',
            runMode: 'live',
            attachedToTicket: true,
            redeemedAt: null,
          },
        ],
      },
      verifiedAt: VALID_ISO,
    });

    expect(parsed.ticket?.benefitEntitlements).toHaveLength(1);
    expect(parsed.ticket?.benefitEntitlements[0]?.benefitIdentity).toBe(
      'benefit_6_to_1',
    );
  });

  it('includes configuration-source included benefits with nullable run ids in field context', () => {
    const parsed = fieldCheckInVerifyResponseSchema.parse({
      outcome: 'processable',
      processable: true,
      ticket: {
        reservationNumber: 'GRP-24001',
        performanceTitle: 'Girl Rules Fanmeet',
        showtimeId: VALID_SHOWTIME_ID,
        showtimeLabel: '2026-07-04 18:00',
        seatLabels: ['VIP A-1'],
        ticketStatus: 'ACTIVE',
        redactedTokenRef: 'tok_abc...xyz',
        benefitEntitlements: [
          {
            id: VALID_BENEFIT_ENTITLEMENT_ID,
            runId: null,
            source: 'configuration',
            benefitIdentity: 'benefit_6_to_1',
            kind: 'included',
            displayCopy: BENEFIT_DISPLAY_COPY,
            state: 'active',
            attachedToTicket: true,
            redeemedAt: null,
          },
        ],
      },
      verifiedAt: VALID_ISO,
    });

    expect(parsed.ticket?.benefitEntitlements[0]).toMatchObject({
      source: 'configuration',
      runId: null,
      attachedToTicket: true,
    });
  });

  it('rejects nullable run ids for run-backed field entitlements', () => {
    const responseWithBenefit = (benefitEntitlement: Record<string, unknown>) => ({
      outcome: 'processable',
      processable: true,
      ticket: {
        reservationNumber: 'GRP-24001',
        performanceTitle: 'Girl Rules Fanmeet',
        showtimeId: VALID_SHOWTIME_ID,
        showtimeLabel: '2026-07-04 18:00',
        seatLabels: ['VIP A-1'],
        ticketStatus: 'ACTIVE',
        redactedTokenRef: 'tok_abc...xyz',
        benefitEntitlements: [benefitEntitlement],
      },
      verifiedAt: VALID_ISO,
    });

    const commonBenefit = {
      id: VALID_BENEFIT_ENTITLEMENT_ID,
      benefitIdentity: 'benefit_6_to_1',
      kind: 'included',
      displayCopy: BENEFIT_DISPLAY_COPY,
      state: 'active',
      redeemedAt: null,
    };

    expect(() =>
      fieldCheckInVerifyResponseSchema.parse(responseWithBenefit({
        ...commonBenefit,
        runId: null,
        source: 'live_run',
        runMode: 'live',
        attachedToTicket: true,
      })),
    ).toThrow();

    expect(() =>
      fieldCheckInVerifyResponseSchema.parse(responseWithBenefit({
        ...commonBenefit,
        runId: null,
        source: 'test_run',
        runMode: 'test',
        attachedToTicket: false,
      })),
    ).toThrow();

    expect(() =>
      fieldCheckInVerifyResponseSchema.parse(responseWithBenefit({
        ...commonBenefit,
        runId: null,
        source: 'rollback',
        attachedToTicket: true,
      })),
    ).toThrow();

    expect(
      fieldCheckInVerifyResponseSchema.parse(responseWithBenefit({
        ...commonBenefit,
        runId: null,
        source: 'configuration',
        attachedToTicket: true,
      })).ticket?.benefitEntitlements[0]?.runId,
    ).toBeNull();
  });

  it('models server-authoritative field outcomes and offline sync states', () => {
    expect(FIELD_CHECK_IN_OUTCOMES).toEqual([
      'processable',
      'entered',
      'duplicate',
      'tampered',
      'refunded_cancelled',
      'expired',
      'wrong_showtime',
      'already_used',
      'offline_pending',
      'synced',
      'rejected',
    ]);
    expect(FIELD_OFFLINE_SYNC_STATES).toEqual(['pending', 'synced', 'rejected']);

    const pending = fieldOfflineSyncAttemptSchema.parse({
      deviceAttemptId: 'device-attempt-1',
      scannerUserId: 'scanner-user-1',
      showtimeId: VALID_SHOWTIME_ID,
      attemptedAt: VALID_ISO,
      token: 'opaque-ticket-token',
      redactedTokenRef: 'tok_abc...xyz',
      syncState: 'pending',
    });

    expect(pending.syncState).toBe('pending');
    expect(pending.token).toBe('opaque-ticket-token');
    expect(pending.redactedTokenRef).toBe('tok_abc...xyz');

    const response = fieldOfflineSyncResponseSchema.parse({
      results: [
        {
          deviceAttemptId: 'device-attempt-1',
          syncState: 'synced',
          outcome: 'entered',
          resolvedAt: VALID_ISO,
        },
        {
          deviceAttemptId: 'device-attempt-2',
          syncState: 'rejected',
          outcome: 'tampered',
          resolvedAt: VALID_ISO,
          reason: 'signature mismatch',
        },
      ],
    });

    expect(response.results.map((result) => result.syncState)).toEqual([
      'synced',
      'rejected',
    ]);
  });

  it('defines KPI-first monitor DTOs and secondary log filters without raw token or PII rows', () => {
    const summary = fieldMonitorSummarySchema.parse({
      eventId: VALID_EVENT_ID,
      showtimeId: VALID_SHOWTIME_ID,
      enteredCount: 120,
      notEnteredCount: 30,
      entryRate: 0.8,
      duplicateScanCount: 3,
      rejectedScanCount: 2,
      offlinePendingCount: 4,
      offlineSyncedCount: 8,
      latestAbnormalAlerts: [
        {
          type: 'duplicate_spike',
          severity: 'warning',
          message: 'Duplicate scans increased',
          count: 3,
          detectedAt: VALID_ISO,
        },
      ],
      updatedAt: VALID_ISO,
    });

    expect(summary.latestAbnormalAlerts[0]?.type).toBe('duplicate_spike');
    expect(summary.offlinePendingCount).toBe(4);

    const filters = fieldMonitorLogFilterSchema.parse({
      eventId: VALID_EVENT_ID,
      showtimeId: VALID_SHOWTIME_ID,
      outcome: 'duplicate',
      syncState: 'rejected',
      scannerUserId: 'scanner-user-1',
      dateFrom: '2026-07-04',
      dateTo: '2026-07-05',
    });

    expect(filters.outcome).toBe('duplicate');

    for (const field of FORBIDDEN_VISIBLE_FIELDS) {
      expect(() =>
        fieldMonitorLogFilterSchema.parse({
          eventId: VALID_EVENT_ID,
          [field]: 'leak',
        }),
      ).toThrow();
    }
  });

  it('defines settlement summary and export datasets for post-event operations', () => {
    const summary = settlementSummarySchema.parse({
      eventId: VALID_EVENT_ID,
      showtimeId: VALID_SHOWTIME_ID,
      currency: 'KRW',
      grossSalesAmount: 3_000_000,
      paidReservationCount: 150,
      refundedAmount: 200_000,
      refundCount: 4,
      enteredCount: 120,
      noShowCount: 30,
      entryRate: 0.8,
      generatedAt: VALID_ISO,
    });

    expect(summary.noShowCount).toBe(30);

    const request = settlementExportRequestSchema.parse({
      eventId: VALID_EVENT_ID,
      showtimeId: VALID_SHOWTIME_ID,
      dataset: 'settlement_accounting_input',
      reason: 'post-event settlement reconciliation',
    });

    expect(request.dataset).toBe('settlement_accounting_input');

    const response = settlementExportResponseSchema.parse({
      exportId: 'export-1',
      dataset: 'entry_status',
      filename: 'entry-status.csv',
      rowCount: 150,
      generatedAt: VALID_ISO,
    });

    expect(response.rowCount).toBe(150);

    for (const dataset of [
      'entry_status',
      'no_show_reservations',
      'reservation_payment_refund_summary',
      'settlement_accounting_input',
    ]) {
      expect(settlementExportRequestSchema.parse({
        eventId: VALID_EVENT_ID,
        dataset,
        reason: 'operator requested export',
      }).dataset).toBe(dataset);
    }
  });

  it('defines admin settlement reconciliation without raw payment identifiers', () => {
    const reconciliation = adminSettlementReconciliationSchema.parse({
      eventId: VALID_EVENT_ID,
      siteSalesGrossAmount: 193_906_000,
      domestic: {
        tossGrossAmount: 159_004_000,
        payoutAmount: 153_032_725,
        feeAmount: 5_971_275,
        matchedGrossAmount: 158_280_000,
        unmatchedGrossAmount: 4_156_000,
        unsettledTransferAmount: 3_432_000,
        unsettledTransferCount: 11,
      },
      foreign: {
        grossAmount: 31_470_000,
        byProvider: [
          { provider: 'PAYPAL', grossAmount: 21_818_000, reservationCount: 56 },
          { provider: 'ALIPAY_PLUS', grossAmount: 8_374_000, reservationCount: 23 },
        ],
      },
      generatedAt: VALID_ISO,
      warnings: ['외화정산 지급액은 Toss 상점관리자 값을 직접 입력하세요.'],
    });

    expect(reconciliation.domestic.payoutAmount).toBe(153_032_725);
    expect(JSON.stringify(reconciliation)).not.toContain('paymentKey');
    expect(JSON.stringify(reconciliation)).not.toContain('orderId');

    expect(() =>
      adminSettlementReconciliationSchema.parse({
        ...reconciliation,
        siteSalesGrossAmount: -1,
      }),
    ).toThrow();
  });

  it('exports field operations contracts from the shared barrel', () => {
    expect(exportedVerifyRequestSchema).toBe(fieldCheckInVerifyRequestSchema);
  });
});
