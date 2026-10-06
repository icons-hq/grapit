import { createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { FieldCheckInVerifyResponse } from '@grabit/shared';
import {
  canRedeemBenefitsForVerification,
  normalizeBenefitRedemptionResponse,
  normalizeVerifyResponse,
  useFieldCheckInVerify,
} from '@/hooks/use-field-operations';

const { postMock } = vi.hoisted(() => ({ postMock: vi.fn() }));

vi.mock('@/lib/api-client', () => ({ apiClient: { post: postMock, get: vi.fn() } }));

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

  it('allows benefit redemption after entry when an already-used ticket has active benefits', () => {
    const normalized = normalizeVerifyResponse({
      outcome: 'already_used',
      processable: false,
      ticket: {
        reservationNumber: 'GRP-BENEFIT-SCAN',
        performanceTitle: 'Benefit Scanner Performance',
        showtimeId: '00000000-0000-4000-8000-000000000301',
        showtimeLabel: '2026-07-04T10:00:00.000Z',
        seatLabels: ['VIP A열 1번'],
        ticketStatus: 'USED',
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
      rejectionReason: '이미 사용된 티켓입니다',
      verifiedAt: '2026-07-04T08:00:00.000Z',
    } satisfies FieldCheckInVerifyResponse);

    expect(normalized.result).toBe('duplicate');
    expect(canRedeemBenefitsForVerification(normalized)).toBe(true);
  });

  it('does not allow benefit redemption for wrong-showtime scans with active benefits', () => {
    const normalized = normalizeVerifyResponse({
      outcome: 'wrong_showtime',
      processable: false,
      ticket: {
        reservationNumber: 'GRP-BENEFIT-SCAN',
        performanceTitle: 'Benefit Scanner Performance',
        showtimeId: '00000000-0000-4000-8000-000000000302',
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
      rejectionReason: '현재 회차의 티켓이 아닙니다',
      verifiedAt: '2026-07-04T08:00:00.000Z',
    } satisfies FieldCheckInVerifyResponse);

    expect(canRedeemBenefitsForVerification(normalized)).toBe(false);
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

describe('useFieldCheckInVerify scan attempt cache (D4)', () => {
  it('reuses the result within one scan attempt and checks a new scan of the same QR again', async () => {
    postMock.mockReset().mockResolvedValue({ outcome: 'already_used', processable: false, ticket: null, verifiedAt: '2026-07-04T08:00:00.000Z' });
    // Same stale time as the app's QueryClient.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
    const scan = { token: 'qr-token', showtimeId: '00000000-0000-4000-8000-000000000301', deviceAttemptId: 'attempt-1' };

    const first = renderHook(() => useFieldCheckInVerify(scan), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();
    const sameScan = renderHook(() => useFieldCheckInVerify(scan), { wrapper });
    await waitFor(() => expect(sameScan.result.current.isSuccess).toBe(true));
    expect(postMock).toHaveBeenCalledTimes(1);

    // A re-scan carries a new attempt id; the server must see it (a rescan of a
    // used seat is a duplicate attempt) instead of the cached answer.
    renderHook(() => useFieldCheckInVerify({ ...scan, deviceAttemptId: 'attempt-2' }), { wrapper });
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(2));
    expect(postMock.mock.calls[1]?.[1]).toMatchObject({ token: 'qr-token', deviceAttemptId: 'attempt-2' });
  });
});
