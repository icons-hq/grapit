import { render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FieldBenefitEntitlement } from '@grabit/shared';

import FieldCheckInPage from '../page';

const REQUESTED_SHOWTIME_ID = '00000000-0000-4000-8000-000000000301';
const TICKET_SHOWTIME_ID = '00000000-0000-4000-8000-000000000302';
const BENEFIT_ENTITLEMENT_ID = '00000000-0000-4000-8000-000000000801';
const RAW_TICKET_TOKEN = 'raw-ticket-token-for-benefit-redemption';

const mocks = vi.hoisted(() => ({
  routerReplace: vi.fn(),
  searchParams: new URLSearchParams(),
  verifyData: null as unknown,
  consumeMutateAsync: vi.fn(),
  benefitRedeemMutateAsync: vi.fn(),
  offlineSyncMutateAsync: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: mocks.routerReplace,
  }),
  usePathname: () => '/field/check-in',
  useSearchParams: () => mocks.searchParams,
}));

vi.mock('@/stores/use-auth-store', () => ({
  useAuthStore: () => ({
    isInitialized: true,
    accessToken: 'scanner-access-token',
    user: {
      id: 'scanner-user-1',
      name: '현장 스태프',
      role: 'admin',
      adminCapabilityBundle: 'scanner',
      adminCapabilities: ['field.scan.verify', 'field.scan.consume', 'field.scan.sync'],
    },
  }),
}));

vi.mock('@/hooks/use-field-operations', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/use-field-operations')>(
    '@/hooks/use-field-operations',
  );

  return {
    ...actual,
    useFieldCheckInVerify: () => ({
      data: mocks.verifyData,
      isLoading: false,
      isFetching: false,
      isError: false,
    }),
    useFieldCheckInConsume: () => ({
      data: null,
      isPending: false,
      mutateAsync: mocks.consumeMutateAsync,
    }),
    useFieldBenefitRedeem: () => ({
      isPending: false,
      mutateAsync: mocks.benefitRedeemMutateAsync,
    }),
    useFieldOfflineSync: () => ({
      isPending: false,
      mutateAsync: mocks.offlineSyncMutateAsync,
    }),
  };
});

function includedBenefit(): FieldBenefitEntitlement {
  return {
    id: BENEFIT_ENTITLEMENT_ID,
    runId: null,
    source: 'configuration',
    benefitIdentity: 'benefit_official_poster',
    kind: 'included',
    displayCopy: {
      ko: { name: '공식 포스터', description: '공식 포스터 설명' },
      en: { name: 'Official poster', description: 'Official poster benefit' },
      'zh-CN': { name: 'Official poster', description: 'Official poster benefit' },
      th: { name: 'Official poster', description: 'Official poster benefit' },
    },
    state: 'active',
    redeemedAt: null,
    attachedToTicket: true,
  };
}

function verification(overrides: Record<string, unknown> = {}) {
  return {
    result: 'processable',
    resultLabel: '입장 가능 티켓입니다',
    processable: true,
    reservationNumber: 'GRP-FIELD-BENEFIT-001',
    performanceTitle: 'Benefit Scanner Performance',
    showtimeAt: '2026-07-04T10:00:00.000Z',
    showtimeId: TICKET_SHOWTIME_ID,
    seats: ['VIP A열 1번'],
    ticketStatus: 'ACTIVE',
    offlineQueue: [],
    benefitEntitlements: [includedBenefit()],
    ...overrides,
  };
}

describe('FieldCheckInPage benefit redemption showtime contract', () => {
  beforeEach(() => {
    mocks.routerReplace.mockReset();
    mocks.consumeMutateAsync.mockReset();
    mocks.benefitRedeemMutateAsync.mockReset().mockResolvedValue({
      outcome: 'redeemed',
      outcomeLabel: '혜택 사용 처리 완료',
      redeemedAt: '2026-07-04T08:45:00.000Z',
    });
    mocks.offlineSyncMutateAsync.mockReset();
    mocks.searchParams = new URLSearchParams({
      ticket: RAW_TICKET_TOKEN,
      showtimeId: REQUESTED_SHOWTIME_ID,
    });
    mocks.verifyData = verification();
  });

  it('submits the scanner-requested showtime when redeeming a benefit', async () => {
    const user = userEvent.setup();
    render(<FieldCheckInPage />);

    await user.click(screen.getByRole('button', { name: '사용 처리' }));

    await waitFor(() => {
      expect(mocks.benefitRedeemMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          token: RAW_TICKET_TOKEN,
          showtimeId: REQUESTED_SHOWTIME_ID,
          benefitEntitlementId: BENEFIT_ENTITLEMENT_ID,
          confirmed: true,
        }),
      );
    });
    expect(mocks.benefitRedeemMutateAsync.mock.calls[0]?.[0].showtimeId)
      .not.toBe(TICKET_SHOWTIME_ID);
  });

  it('keeps benefits visible but disables redemption for wrong-showtime scans', async () => {
    mocks.verifyData = verification({
      result: 'wrong-showtime',
      resultLabel: '현재 회차의 티켓이 아닙니다',
      processable: false,
    });

    render(<FieldCheckInPage />);

    await waitFor(() => {
      expect(screen.getByText('현재 회차의 티켓이 아닙니다')).toBeInTheDocument();
      const panel = screen.getByTestId('scanner-benefit-panel');
      expect(within(panel).getByText('공식 포스터')).toBeInTheDocument();
      expect(within(panel).queryByRole('button', { name: '사용 처리' }))
        .not.toBeInTheDocument();
    });
    expect(mocks.benefitRedeemMutateAsync).not.toHaveBeenCalled();
  });

  it('redeems active benefits for already-used tickets after entry processing', async () => {
    const user = userEvent.setup();
    mocks.verifyData = verification({
      result: 'duplicate',
      resultLabel: '이미 입장 처리된 티켓입니다',
      processable: false,
      ticketStatus: 'USED',
    });

    render(<FieldCheckInPage />);

    await user.click(await screen.findByRole('button', { name: '사용 처리' }));

    await waitFor(() => {
      expect(mocks.benefitRedeemMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          token: RAW_TICKET_TOKEN,
          showtimeId: REQUESTED_SHOWTIME_ID,
          benefitEntitlementId: BENEFIT_ENTITLEMENT_ID,
          confirmed: true,
        }),
      );
    });
    expect(mocks.consumeMutateAsync).not.toHaveBeenCalled();
  });
});
