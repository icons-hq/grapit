import type { ReactNode } from 'react';
import { Suspense, forwardRef, useEffect, useImperativeHandle } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import type { SupportedLocale } from '@grabit/shared';
import { BOOKING_DISABLED_COPY } from '@/lib/runtime-flags';
import { BookingPage } from '@/components/booking/booking-page';
import ConfirmPage from '@/app/booking/[performanceId]/confirm/page';
import PerformanceDetailPage from '@/app/performance/[id]/page';
import { useAuthStore } from '@/stores/use-auth-store';
import { useBookingStore } from '@/stores/use-booking-store';

const {
  lockSeatMutateMock,
  prepareReservationMock,
  requestPaymentMock,
  routerPushMock,
  routerReplaceMock,
  useLocaleMock,
  useRuntimeFlagsMock,
} = vi.hoisted(() => ({
  lockSeatMutateMock: vi.fn(),
  prepareReservationMock: vi.fn(),
  requestPaymentMock: vi.fn(),
  routerPushMock: vi.fn(),
  routerReplaceMock: vi.fn(),
  useLocaleMock: vi.fn(() => 'ko'),
  useRuntimeFlagsMock: vi.fn(() => ({
    bookingEnabled: false,
    isLoading: false,
    bookingDisabledMessage: '예매는 5월말 오픈 예정입니다',
  })),
}));

vi.mock('next-intl', () => ({
  useLocale: useLocaleMock,
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ performanceId: 'performance-disabled' }),
  useRouter: () => ({
    push: routerPushMock,
    replace: routerReplaceMock,
  }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/hooks/use-runtime-flags', () => ({
  useRuntimeFlags: useRuntimeFlagsMock,
}));

vi.mock('@/hooks/use-performances', () => ({
  usePerformanceDetail: () => ({
    data: createPerformanceDetail(),
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('@/hooks/use-socket', () => ({
  useBookingSocket: vi.fn(),
}));

vi.mock('@/hooks/use-booking', () => ({
  useSeatStatus: () => ({
    data: { seats: { 'A-1': 'available' } },
  }),
  useMyLocks: () => ({ data: { seatIds: [], expiresAt: null } }),
  useLockSeat: () => ({ mutate: lockSeatMutateMock, isPending: false }),
  useUnlockSeat: () => ({ mutate: vi.fn(), isPending: false }),
  useUnlockAllSeats: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelPendingReservation: () => ({ mutate: vi.fn() }),
  usePrepareReservation: () => ({ mutateAsync: prepareReservationMock }),
}));

vi.mock('@/components/auth/auth-guard', () => ({
  AuthGuard: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/booking/seat-map-viewer', () => ({
  SeatMapViewer: ({ onSeatClick }: { onSeatClick: (seatId: string) => void }) => (
    <button type="button" onClick={() => onSeatClick('A-1')}>
      좌석 A-1
    </button>
  ),
}));

vi.mock('@/components/booking/booking-header', () => ({
  BookingHeader: () => <header>booking header</header>,
}));

vi.mock('@/components/booking/date-picker', () => ({
  DatePicker: () => <div>date picker</div>,
}));

vi.mock('@/components/booking/showtime-chips', () => ({
  ShowtimeChips: () => <div>showtime chips</div>,
}));

vi.mock('@/components/booking/seat-legend', () => ({
  SeatLegend: () => <div>seat legend</div>,
}));

vi.mock('@/components/booking/toss-payment-widget', async () => {
  const React = await import('react');
  return {
    TossPaymentWidget: forwardRef(function TossPaymentWidget(
      { onReady }: { onReady: () => void },
      ref,
    ) {
      useImperativeHandle(ref, () => ({
        requestPayment: requestPaymentMock,
      }));
      useEffect(() => {
        onReady();
      }, [onReady]);
      return <div>payment widget</div>;
    }),
  };
});

function createPerformanceDetail() {
  return {
    id: 'performance-disabled',
    title: 'Girl Rules Fanmeet',
    status: 'ON_SALE',
    posterUrl: null,
    startDate: '2026-07-04T09:00:00.000Z',
    endDate: '2026-07-04T11:00:00.000Z',
    runtime: '120분',
    ageRating: '전체관람가',
    description: 'fanmeet',
    salesInfo: null,
    venue: { id: 'venue-1', name: '서울 공연장' },
    castings: [],
    showtimes: [
      {
        id: 'showtime-disabled',
        dateTime: '2026-07-04T09:00:00.000Z',
        status: 'SCHEDULED',
      },
    ],
    priceTiers: [
      {
        id: 'tier-vip',
        tierName: 'VIP',
        price: 110000,
      },
    ],
    seatMap: {
      svgUrl: '/seat-map.svg',
      seatConfig: {
        tiers: [
          {
            tierName: 'VIP',
            color: '#6C3CE0',
            seatIds: ['A-1'],
          },
        ],
      },
    },
  };
}

function renderWithQuery(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>,
  );
}

function fulfilledParams(id: string) {
  const params = Promise.resolve({ id }) as Promise<{ id: string }> & {
    status: 'fulfilled';
    value: { id: string };
  };
  params.status = 'fulfilled';
  params.value = { id };
  return params;
}

function seedBookingFlow() {
  useBookingStore.getState().resetBooking();
  useBookingStore.getState().setDate(new Date('2026-07-04T00:00:00.000Z'));
  useBookingStore.getState().setShowtime('showtime-disabled');
  useBookingStore.getState().setBookingData({
    selectedSeats: [
      {
        seatId: 'A-1',
        tierName: 'VIP',
        tierColor: '#6C3CE0',
        row: 'A',
        number: '1',
        price: 110000,
      },
    ],
    showtimeId: 'showtime-disabled',
    performanceId: 'performance-disabled',
    performanceTitle: 'Girl Rules Fanmeet',
    showDateTime: '2026-07-04T09:00:00.000Z',
    venue: '서울 공연장',
    posterUrl: null,
    expiresAt: Date.now() + 600000,
  });

  useAuthStore.getState().setAuth('access-token', {
    id: 'user-1',
    email: 'fan@example.com',
    name: 'Fan',
    phone: '+821012345678',
    gender: 'unspecified',
    country: 'KR',
    birthDate: '1990-01-01',
    preferredLocale: 'ko',
    isPhoneVerified: true,
    role: 'user',
    createdAt: '2026-05-06T00:00:00.000Z',
  });
}

describe('runtime booking disabled UI', () => {
  beforeEach(() => {
    lockSeatMutateMock.mockReset();
    prepareReservationMock.mockReset();
    requestPaymentMock.mockReset();
    routerPushMock.mockReset();
    routerReplaceMock.mockReset();
    useLocaleMock.mockReturnValue('ko');
    useRuntimeFlagsMock.mockReturnValue({
      bookingEnabled: false,
      isLoading: false,
      bookingDisabledMessage: '예매는 5월말 오픈 예정입니다',
    });
    seedBookingFlow();
  });

  it('keeps exact booking-disabled copy for all five launch locales', () => {
    expect(BOOKING_DISABLED_COPY).toEqual({
      ko: '예매는 5월말 오픈 예정입니다',
      en: 'Ticket booking opens in late May',
      th: 'การจองบัตรจะเปิดปลายเดือนพฤษภาคม',
      'zh-CN': '门票预订预计于5月下旬开放',
      'zh-TW': '門票預訂預計於5月下旬開放',
    });
  });

  it.each([
    ['ko', '예매는 5월말 오픈 예정입니다'],
    ['en', 'Ticket booking opens in late May'],
    ['th', 'การจองบัตรจะเปิดปลายเดือนพฤษภาคม'],
    ['zh-CN', '门票预订预计于5月下旬开放'],
    ['zh-TW', '門票預訂預計於5月下旬開放'],
  ] satisfies Array<[SupportedLocale, string]>)(
    'replaces the performance detail booking CTA with disabled copy for %s',
    async (locale, copy) => {
      useLocaleMock.mockReturnValue(locale);
      useRuntimeFlagsMock.mockReturnValue({
        bookingEnabled: false,
        isLoading: false,
        bookingDisabledMessage: copy,
      });

      renderWithQuery(
        <Suspense fallback={null}>
          <PerformanceDetailPage params={fulfilledParams('performance-disabled')} />
        </Suspense>,
      );

      expect(await screen.findAllByText(copy)).toHaveLength(2);
      expect(screen.queryByRole('link', { name: '예매하기' })).not.toBeInTheDocument();
    },
  );

  it('does not call the seat lock handler when disabled booking users click a seat', async () => {
    renderWithQuery(<BookingPage performanceId="performance-disabled" />);

    expect(await screen.findAllByText('예매는 5월말 오픈 예정입니다')).not.toHaveLength(0);
    expect(screen.queryByRole('button', { name: '좌석 A-1' })).not.toBeInTheDocument();
    expect(screen.queryByText('seat legend')).not.toBeInTheDocument();

    expect(lockSeatMutateMock).not.toHaveBeenCalled();
  });

  it('does not prepare reservation or call Toss requestPayment when disabled', async () => {
    const user = userEvent.setup();
    renderWithQuery(<ConfirmPage />);

    await user.click(await screen.findByLabelText('전체 동의'));
    await waitFor(() => {
      expect(
        screen.getAllByRole('button', { name: '예매는 5월말 오픈 예정입니다' })[0],
      ).toBeDisabled();
    });
    await user.click(screen.getAllByRole('button', { name: '예매는 5월말 오픈 예정입니다' })[0]);

    expect(prepareReservationMock).not.toHaveBeenCalled();
    expect(requestPaymentMock).not.toHaveBeenCalled();
  });
});
