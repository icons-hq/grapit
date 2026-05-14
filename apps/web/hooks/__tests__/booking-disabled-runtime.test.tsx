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
  usePerformanceDetailMock,
  useLocaleMock,
  useTranslationsMock,
  useRuntimeFlagsMock,
} = vi.hoisted(() => ({
  lockSeatMutateMock: vi.fn(),
  prepareReservationMock: vi.fn(),
  requestPaymentMock: vi.fn(),
  routerPushMock: vi.fn(),
  routerReplaceMock: vi.fn(),
  usePerformanceDetailMock: vi.fn(),
  useLocaleMock: vi.fn(() => 'ko'),
  useTranslationsMock: vi.fn(() => (key: string, values?: Record<string, string>) => {
    const messages: Record<string, string> = {
      'paymentDeadline.badge': '결제 가능 시간',
      'paymentDeadline.title': '지금부터 7분 안에 결제를 완료해주세요',
      'paymentDeadline.helper': '{threshold} 이하가 되면 마감 상태로 전환됩니다.',
      'paymentDeadline.criticalHelper': '{threshold} 이하로 남았습니다. 결제를 서둘러주세요.',
      'paymentDeadline.seatHoldHelper': '좌석 점유 만료 {time}',
      'paymentDisclaimer.title': '해외 결제 안내',
      'paymentDisclaimer.description': '해외 결제 전에 아래 내용을 확인해주세요.',
      'paymentDisclaimer.krwPrimary': '결제 금액은 KRW 기준으로 청구됩니다.',
      'paymentDisclaimer.fxHelper': '예상 환율과 수수료는 실제 청구 시점에 달라질 수 있습니다.',
      'paymentDisclaimer.refundDelay': '환불 반영까지 추가 시간이 걸릴 수 있습니다.',
      'paymentDisclaimer.checkboxLabel': '해외 결제 및 환불 유의사항에 동의합니다',
      'paymentDisclaimer.ctaPending': '해외 결제 동의가 필요합니다',
      'paymentDisclaimer.payNow': '결제하기',
      'paymentRecovery.reselectCta': '좌석 다시 선택하기',
      'paymentRecovery.reselectPrompt': '좌석을 다시 선택해주세요',
      'paymentRecovery.expiredTitle': '결제 가능 시간이 만료되었습니다',
      'paymentRecovery.expiredBody': '좌석을 다시 선택한 뒤 새 결제를 시작해주세요.',
      'paymentRecovery.expiredCta': '결제 시간이 만료되었습니다',
    };

    let message = messages[key] ?? key;

    if (values) {
      for (const [token, value] of Object.entries(values)) {
        message = message.replace(`{${token}}`, value);
      }
    }

    return message;
  }),
  useRuntimeFlagsMock: vi.fn(() => ({
    bookingEnabled: false,
    isLoading: false,
    bookingDisabledMessage: '예매는 추후 오픈 예정입니다',
  })),
}));

vi.mock('next-intl', () => ({
  useLocale: useLocaleMock,
  useTranslations: useTranslationsMock,
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
  usePerformanceDetail: usePerformanceDetailMock,
}));

vi.mock('@/hooks/use-socket', () => ({
  useBookingSocket: vi.fn(),
}));

vi.mock('@/hooks/use-booking', () => ({
  useSeatStatus: () => ({
    data: { seats: { 'A-1': 'available' } },
  }),
  useMyLocks: () => ({ data: { seatIds: [], expiresAt: null } }),
  useBookingPaymentSnapshot: () => ({
    paymentDeadlineAt: new Date(Date.now() + 7 * 60 * 1000).toISOString(),
    lockExpiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    bookingPolicy: {
      maxTicketsPerOrder: 1,
      cancellationChangePolicy: 'CANCEL_ONLY',
      sameGradeChangeEnabled: false,
      paymentWindowMinutes: 7,
      seatHoldMinutes: 10,
    },
    allowedPaymentMethods: ['CARD'],
    isPaymentDeadlineExpired: false,
  }),
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

function setCurrentUserRole(role: 'user' | 'admin') {
  useAuthStore.getState().setAuth(`${role}-access-token`, {
    id: `${role}-1`,
    email: role === 'admin' ? 'admin@grapit.test' : 'fan@example.com',
    name: role === 'admin' ? 'Admin' : 'Fan',
    phone: '+821012345678',
    gender: 'unspecified',
    country: 'KR',
    birthDate: '1990-01-01',
    preferredLocale: 'ko',
    isPhoneVerified: true,
    role,
    createdAt: '2026-05-06T00:00:00.000Z',
  });
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

  setCurrentUserRole('user');
}

describe('runtime booking disabled UI', () => {
  beforeEach(() => {
    lockSeatMutateMock.mockReset();
    prepareReservationMock.mockReset();
    requestPaymentMock.mockReset();
    routerPushMock.mockReset();
    routerReplaceMock.mockReset();
    usePerformanceDetailMock.mockReset();
    usePerformanceDetailMock.mockReturnValue({
      data: createPerformanceDetail(),
      isLoading: false,
      isError: false,
    });
    useLocaleMock.mockReturnValue('ko');
    useRuntimeFlagsMock.mockReturnValue({
      bookingEnabled: false,
      isLoading: false,
      bookingDisabledMessage: '예매는 추후 오픈 예정입니다',
    });
    seedBookingFlow();
  });

  it('keeps exact booking-disabled copy for all five launch locales', () => {
    expect(BOOKING_DISABLED_COPY).toEqual({
      ko: '예매는 추후 오픈 예정입니다',
      en: 'Ticket booking will open later',
      th: 'การจองบัตรจะเปิดให้บริการในภายหลัง',
      'zh-CN': '门票预订将于稍后开放',
      'zh-TW': '門票預訂將於稍後開放',
    });
  });

  it.each([
    ['ko', '예매는 추후 오픈 예정입니다'],
    ['en', 'Ticket booking will open later'],
    ['th', 'การจองบัตรจะเปิดให้บริการในภายหลัง'],
    ['zh-CN', '门票预订将于稍后开放'],
    ['zh-TW', '門票預訂將於稍後開放'],
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

    expect(await screen.findAllByText('예매는 추후 오픈 예정입니다')).not.toHaveLength(0);
    expect(screen.queryByRole('button', { name: '좌석 A-1' })).not.toBeInTheDocument();
    expect(screen.queryByText('seat legend')).not.toBeInTheDocument();

    expect(lockSeatMutateMock).not.toHaveBeenCalled();
  });

  it('shows booking CTA on performance detail for admin while runtime booking is disabled', async () => {
    setCurrentUserRole('admin');

    renderWithQuery(
      <Suspense fallback={null}>
        <PerformanceDetailPage params={fulfilledParams('performance-disabled')} />
      </Suspense>,
    );

    expect(await screen.findAllByRole('link', { name: '예매하기' })).toHaveLength(2);
    expect(screen.queryByText('예매는 추후 오픈 예정입니다')).not.toBeInTheDocument();
  });

  it('allows admin to lock a seat while runtime booking is disabled', async () => {
    const user = userEvent.setup();
    setCurrentUserRole('admin');
    useBookingStore.getState().clearSeats();

    renderWithQuery(<BookingPage performanceId="performance-disabled" />);

    await user.click(await screen.findByRole('button', { name: '좌석 A-1' }));

    expect(lockSeatMutateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        showtimeId: 'showtime-disabled',
        seatId: 'A-1',
      }),
      expect.any(Object),
    );
    expect(screen.queryByText('예매는 추후 오픈 예정입니다')).not.toBeInTheDocument();
  });

  it.each([
    ['ko', '예매는 추후 오픈 예정입니다'],
    ['en', 'Ticket booking will open later'],
  ] satisfies Array<[SupportedLocale, string]>)(
    'shows disabled copy before performance detail finishes loading for %s',
    (locale, copy) => {
      useLocaleMock.mockReturnValue(locale);
      useRuntimeFlagsMock.mockReturnValue({
        bookingEnabled: false,
        isLoading: false,
        bookingDisabledMessage: copy,
      });
      usePerformanceDetailMock.mockReturnValue({
        data: undefined,
        isLoading: true,
        isError: false,
      });

      renderWithQuery(<BookingPage performanceId="performance-disabled" />);

      expect(screen.getByText(copy)).toBeInTheDocument();
      expect(screen.queryByText('date picker')).not.toBeInTheDocument();
      expect(screen.queryByText('seat legend')).not.toBeInTheDocument();
    },
  );

  it('does not prepare reservation or call Toss requestPayment when disabled', async () => {
    const user = userEvent.setup();
    renderWithQuery(<ConfirmPage />);

    await user.click(await screen.findByLabelText('전체 동의'));
    await waitFor(() => {
      expect(
        screen.getAllByRole('button', { name: '예매는 추후 오픈 예정입니다' })[0],
      ).toBeDisabled();
    });
    await user.click(screen.getAllByRole('button', { name: '예매는 추후 오픈 예정입니다' })[0]);

    expect(prepareReservationMock).not.toHaveBeenCalled();
    expect(requestPaymentMock).not.toHaveBeenCalled();
  });

  it('allows admin to prepare reservation and request Toss payment while runtime booking is disabled', async () => {
    const user = userEvent.setup();
    setCurrentUserRole('admin');
    prepareReservationMock.mockResolvedValueOnce({
      reservationId: 'admin-reservation-1',
      orderId: 'admin-order-1',
    });

    renderWithQuery(<ConfirmPage />);

    await user.click(await screen.findByLabelText('전체 동의'));
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: '결제하기' })).toHaveLength(2);
    });
    await user.click(screen.getAllByRole('button', { name: '결제하기' })[0]);

    await waitFor(() => {
      expect(prepareReservationMock).toHaveBeenCalledTimes(1);
    });
    expect(requestPaymentMock).toHaveBeenCalledTimes(1);
  });

  it('switches the confirm CTA to 결제하기 after required agreements when booking is enabled', async () => {
    const user = userEvent.setup();
    useRuntimeFlagsMock.mockReturnValue({
      bookingEnabled: true,
      isLoading: false,
      bookingDisabledMessage: '예매는 추후 오픈 예정입니다',
    });

    renderWithQuery(<ConfirmPage />);

    expect(screen.getAllByRole('button', { name: '약관에 동의해주세요' })).toHaveLength(2);

    await user.click(await screen.findByLabelText('전체 동의'));

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: '결제하기' })).toHaveLength(2);
    });
  });

  it('surfaces prepare 409 recovery UI and does not call Toss requestPayment when booking is enabled', async () => {
    const user = userEvent.setup();
    const lockFailureMessage = '좌석 점유 시간이 만료되었습니다. 좌석을 다시 선택해주세요.';
    useRuntimeFlagsMock.mockReturnValue({
      bookingEnabled: true,
      isLoading: false,
      bookingDisabledMessage: '예매는 추후 오픈 예정입니다',
    });
    prepareReservationMock.mockRejectedValueOnce(new Error(lockFailureMessage));

    renderWithQuery(<ConfirmPage />);

    await user.click(await screen.findByLabelText('전체 동의'));
    await user.click((await screen.findAllByRole('button', { name: '결제하기' }))[0]);

    expect(await screen.findByText(lockFailureMessage)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '좌석 다시 선택하기' })).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: '좌석을 다시 선택해주세요' })[0],
    ).toBeDisabled();
    expect(prepareReservationMock).toHaveBeenCalledTimes(1);
    expect(requestPaymentMock).not.toHaveBeenCalled();
  });
});
