import { describe, expect, it } from 'vitest';
import type { FieldCheckInVerifyResponse } from '@grabit/shared';
import {
  normalizeBenefitRedemptionResponse,
  normalizeVerifyResponse,
} from '@/hooks/use-field-operations';

const benefitRunId = '00000000-0000-4000-8000-000000000701';
const benefitEntitlementId = '00000000-0000-4000-8000-000000000801';

const displayCopy = {
  ko: { name: '6:1 이벤트 참여권', description: '6:1 이벤트 참여권 설명' },
  en: { name: '6:1 Event', description: '6:1 event benefit' },
  'zh-CN': { name: '6:1 活动', description: '6:1 活动福利' },
  th: { name: '6:1 Event', description: '6:1 event benefit' },
};

describe('field operations normalizers', () => {
  it('preserves field benefit entitlements from verify ticket context', () => {
    const response = {
      outcome: 'processable',
      processable: true,
      ticket: {
        reservationNumber: 'GRP-BENEFIT-SCAN',
        performanceTitle: 'Benefit Scanner Performance',
        showtimeId: '00000000-0000-4000-8000-000000000301',
        showtimeLabel: '2026-07-04T10:00:00.000Z',
        seatLabels: ['VIP A열 1번'],
        ticketStatus: 'ACTIVE',
        redactedTokenRef: 'tok_redacted',
        benefitEntitlements: [
          {
            id: benefitEntitlementId,
            runId: benefitRunId,
            source: 'live_run',
            runMode: 'live',
            benefitIdentity: 'benefit_6_to_1',
            kind: 'limited',
            displayCopy,
            state: 'active',
            redeemedAt: null,
            attachedToTicket: true,
          },
        ],
      },
      verifiedAt: '2026-07-04T08:00:00.000Z',
    } satisfies FieldCheckInVerifyResponse;

    const normalized = normalizeVerifyResponse(response);

    expect(normalized.benefitEntitlements).toHaveLength(1);
    expect(normalized.benefitEntitlements[0]).toMatchObject({
      id: benefitEntitlementId,
      benefitIdentity: 'benefit_6_to_1',
      kind: 'limited',
      state: 'active',
    });
  });

  it('labels duplicate benefit redemption with prior redemption timestamp', () => {
    const normalized = normalizeBenefitRedemptionResponse({
      outcome: 'duplicate',
      benefitEntitlement: null,
      redemptionEventId: null,
      redeemedAt: null,
      priorRedemption: {
        redeemedAt: '2026-07-04T08:30:00.000Z',
        scannerUserId: 'scanner-user',
        deviceAttemptId: 'device-attempt',
        redemptionEventId: 'redemption-event',
      },
    });

    expect(normalized).toMatchObject({
      outcome: 'duplicate',
      outcomeLabel: '이미 사용된 혜택입니다',
      redeemedAt: '2026-07-04T08:30:00.000Z',
    });
  });
});
