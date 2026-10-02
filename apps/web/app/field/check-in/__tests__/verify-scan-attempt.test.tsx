import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import FieldCheckInPage from '../page';
import { clearPendingScanAttempts } from '@/lib/field/offline-scan-store';

const SHOWTIME_ID = '00000000-0000-4000-8000-000000000301';
const RAW_TICKET_TOKEN = 'raw-ticket-token-for-scan-attempt';

const mocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  verifyInputs: [] as Array<Record<string, unknown>>,
  consumeMutateAsync: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
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
    useFieldShowtimes: () => ({
      data: [{ id: SHOWTIME_ID, eventId: 'field-event', title: '현장 검증', dateTime: '2099-01-01T10:00:00Z', venueName: 'Hall' }],
      isError: false,
    }),
    useFieldCheckInVerify: (input: Record<string, unknown>) => {
      mocks.verifyInputs.push(input);
      return {
        data: {
          result: 'processable',
          resultLabel: '입장 가능 티켓입니다',
          processable: true,
          reservationNumber: 'GRP-FIELD-ATTEMPT-001',
          performanceTitle: 'Attempt Scanner Performance',
          showtimeAt: '2099-01-01T10:00:00.000Z',
          showtimeId: SHOWTIME_ID,
          seats: ['VIP A열 1번'],
          ticketStatus: 'ACTIVE',
          offlineQueue: [],
          benefitEntitlements: [],
        },
        isLoading: false,
        isFetching: false,
        isError: false,
      };
    },
    useFieldCheckInConsume: () => ({ data: null, isPending: false, mutateAsync: mocks.consumeMutateAsync }),
    useFieldBenefitRedeem: () => ({ isPending: false, mutateAsync: vi.fn() }),
    useFieldOfflineSync: () => ({ isPending: false, mutateAsync: vi.fn() }),
  };
});

// The server records a rejected verify once per scan attempt and ignores the
// re-check of an attempt that consume already recorded (audit #113), so verify
// must carry the same attempt id that the entry action later uses.
describe('FieldCheckInPage scan attempt identity', () => {
  beforeEach(async () => {
    await clearPendingScanAttempts(); sessionStorage.clear();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    mocks.verifyInputs.length = 0;
    mocks.consumeMutateAsync.mockReset().mockResolvedValue({ result: 'processed', resultLabel: '입장 처리 완료' });
    mocks.searchParams = new URLSearchParams({ ticket: RAW_TICKET_TOKEN, showtimeId: SHOWTIME_ID });
  });

  it('verifies with the same device attempt id that the entry action consumes', async () => {
    const user = userEvent.setup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    render(<FieldCheckInPage />, { wrapper });

    // The page first checks this device's offline queue for the same QR.
    await user.click(await screen.findByRole('button', { name: '이 좌석 입장 처리' }));
    await waitFor(() => expect(mocks.consumeMutateAsync).toHaveBeenCalledTimes(1));

    const consumedAttempt = mocks.consumeMutateAsync.mock.calls[0]?.[0].deviceAttemptId;
    expect(consumedAttempt).toEqual(expect.any(String));
    expect(mocks.verifyInputs.length).toBeGreaterThan(0);
    for (const input of mocks.verifyInputs) {
      expect(input).toMatchObject({ token: RAW_TICKET_TOKEN, showtimeId: SHOWTIME_ID, deviceAttemptId: consumedAttempt });
    }
  });
});
