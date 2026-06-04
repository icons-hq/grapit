import type { ReactNode } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { BookingPage } from '@/components/booking/booking-page';
import { ApiClientError } from '@/lib/api-client';
import { useBookingStore } from '@/stores/use-booking-store';

type MyLocksMockData = {
  seatIds: string[];
  expiresAt: number | null;
};

const {
  lockSeatMutateMock,
  unlockSeatMutateMock,
  unlockAllMutateMock,
  routerPushMock,
  useLocaleMock,
  seatStatusSeatsMock,
  myLocksDataMock,
  toastInfoMock,
} = vi.hoisted(() => ({
  lockSeatMutateMock: vi.fn(),
  unlockSeatMutateMock: vi.fn(),
  unlockAllMutateMock: vi.fn(),
  routerPushMock: vi.fn(),
  useLocaleMock: vi.fn(() => 'ko'),
  seatStatusSeatsMock: vi.fn(() => ({
    '1F:A-1': 'available',
    '2F:A-1': 'available',
  })),
  myLocksDataMock: vi.fn<() => MyLocksMockData>(() => ({ seatIds: [], expiresAt: null })),
  toastInfoMock: vi.fn(),
}));

vi.mock('next-intl', () => ({
  useLocale: useLocaleMock,
}));

vi.mock('sonner', () => ({
  toast: {
    info: toastInfoMock,
    error: vi.fn(),
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: routerPushMock,
  }),
}));

vi.mock('@/hooks/use-runtime-flags', () => ({
  useRuntimeFlags: () => ({
    bookingEnabled: true,
    isLoading: false,
    bookingDisabledMessage: '',
  }),
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
    data: {
      seats: seatStatusSeatsMock(),
    },
  }),
  useMyLocks: () => ({ data: myLocksDataMock() }),
  useLockSeat: () => ({
    mutate: lockSeatMutateMock,
    isPending: false,
  }),
  useUnlockSeat: () => ({
    mutate: unlockSeatMutateMock,
    isPending: false,
  }),
  useUnlockAllSeats: () => ({
    mutate: unlockAllMutateMock,
    isPending: false,
  }),
}));

vi.mock('@/components/booking/seat-map-viewer', () => ({
  SeatMapViewer: ({
    svgUrl,
    selectedSeatIds,
    myLockedSeatIds,
    onSeatClick,
  }: {
    svgUrl: string;
    selectedSeatIds: Set<string>;
    myLockedSeatIds?: Set<string>;
    onSeatClick: (seatId: string) => void;
  }) => (
    <div>
      <p>{`current map: ${svgUrl}`}</p>
      <p>{`selected ids: ${Array.from(selectedSeatIds).join(',') || 'none'}`}</p>
      <p>{`my locked ids: ${Array.from(myLockedSeatIds ?? []).join(',') || 'none'}`}</p>
      <button
        type="button"
        onClick={() => onSeatClick(svgUrl.includes('/2F-') ? '2F:A-1' : 'A-1')}
      >
        현재 층 좌석 선택
      </button>
    </div>
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

function createPerformanceDetail() {
  const firstFloorSeatMap = {
    id: 'seat-map-1f',
    performanceId: 'performance-floor-aware',
    floorKey: '1F',
    floorLabel: '1층',
    sortOrder: 0,
    svgUrl: '/1F-map.svg',
    seatConfig: {
      tiers: [
        {
          tierName: 'VIP',
          color: '#6C3CE0',
          seatIds: ['A-1'],
        },
      ],
    },
    totalSeats: 1,
  };

  return {
    id: 'performance-floor-aware',
    title: 'Girl Rules Fanmeet',
    genre: 'artist_celebrity' as const,
    subcategory: null,
    venueId: 'venue-1',
    posterUrl: null,
    description: 'fanmeet',
    startDate: '2026-07-04T09:00:00.000Z',
    endDate: '2026-07-04T11:00:00.000Z',
    runtime: '120분',
    ageRating: '전체관람가',
    status: 'selling' as const,
    salesInfo: null,
    viewCount: 0,
    createdAt: '2026-05-08T00:00:00.000Z',
    updatedAt: '2026-05-08T00:00:00.000Z',
    venue: { id: 'venue-1', name: '서울 공연장', address: null },
    castings: [],
    showtimes: [
      {
        id: 'showtime-floor-aware',
        performanceId: 'performance-floor-aware',
        dateTime: '2026-07-04T09:00:00.000Z',
      },
    ],
    priceTiers: [
      {
        id: 'tier-vip',
        performanceId: 'performance-floor-aware',
        tierName: 'VIP',
        price: 110000,
        sortOrder: 0,
      },
    ],
    seatMaps: [
      firstFloorSeatMap,
      {
        ...firstFloorSeatMap,
        id: 'seat-map-2f',
        floorKey: '2F',
        floorLabel: '2층',
        sortOrder: 1,
        svgUrl: '/2F-map.svg',
      },
    ],
    bookingPolicy: {
      maxTicketsPerUser: 2,
      allowedPaymentMethods: ['CARD'],
      changePolicyEnabled: false,
      paymentWindowMinutes: 7,
      seatHoldMinutes: 10,
      cancelledSeatHoldMinMinutes: 1,
      cancelledSeatHoldMaxMinutes: 10,
      manualOpenEnabled: true,
    },
    seatMap: firstFloorSeatMap,
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

function seedBookingState() {
  useBookingStore.getState().resetBooking();
  useBookingStore.getState().setDate(new Date('2026-07-04T00:00:00.000Z'));
  useBookingStore.getState().setShowtime('showtime-floor-aware');
}

describe('BookingPage floor selector', () => {
  beforeEach(() => {
    seedBookingState();
    lockSeatMutateMock.mockReset();
    unlockSeatMutateMock.mockReset();
    unlockAllMutateMock.mockReset();
    routerPushMock.mockReset();
    toastInfoMock.mockReset();
    useLocaleMock.mockReturnValue('ko');
    seatStatusSeatsMock.mockReset();
    myLocksDataMock.mockReset();
    seatStatusSeatsMock.mockReturnValue({
      '1F:A-1': 'available',
      '2F:A-1': 'available',
    });
    myLocksDataMock.mockReturnValue({ seatIds: [], expiresAt: null });
    lockSeatMutateMock.mockImplementation((variables, options) => {
      options?.onSuccess?.(
        {
          success: true,
          lockId: `lock-${variables.seatId}`,
          seatId: variables.seatId,
          seatKey: variables.seatKey ?? variables.seatId,
          floorKey: variables.floorKey,
          floorLabel: variables.floorLabel,
          expiresAt: Date.now() + 600000,
        },
        variables,
        undefined as never,
      );
    });
  });

  it('preserves selections across floor switching and renders removable tags plus bottom summary', async () => {
    const user = userEvent.setup();

    renderWithQuery(<BookingPage performanceId="performance-floor-aware" />);

    expect(screen.getByText('current map: /1F-map.svg')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '현재 층 좌석 선택' }));
    await user.click(screen.getByRole('radio', { name: /2층/ }));

    expect(screen.getByText('current map: /2F-map.svg')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '현재 층 좌석 선택' }));
    await user.click(screen.getByRole('radio', { name: /1층/ }));

    expect(
      screen.getByRole('button', { name: '1층 A열 1번 선택 해제' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '2층 A열 1번 선택 해제' }),
    ).toBeInTheDocument();
    expect(screen.getByText('current map: /1F-map.svg')).toBeInTheDocument();
    expect(screen.getByText('selected ids: A-1')).toBeInTheDocument();
    expect(screen.getByText('총 2석')).toBeInTheDocument();
    expect(screen.getByText('총 결제 금액')).toBeInTheDocument();
    expect(screen.getByText('224,000원')).toBeInTheDocument();
  });

  it('clears all selected seats through the fixed bottom bar', async () => {
    const user = userEvent.setup();

    renderWithQuery(<BookingPage performanceId="performance-floor-aware" />);

    await user.click(screen.getByRole('button', { name: '현재 층 좌석 선택' }));
    expect(
      screen.getByRole('button', { name: '1층 A열 1번 선택 해제' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '전체 해제' }));

    expect(unlockAllMutateMock).toHaveBeenCalledWith({
      showtimeId: 'showtime-floor-aware',
    });
    expect(
      screen.queryByRole('button', { name: '1층 A열 1번 선택 해제' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('총 0석')).toBeInTheDocument();
  });

  it('restores owned locks as removable selections after returning from checkout', async () => {
    const user = userEvent.setup();
    seatStatusSeatsMock.mockReturnValue({
      '1F:A-1': 'locked',
      '2F:A-1': 'available',
    });
    myLocksDataMock.mockReturnValue({
      seatIds: ['1F:A-1'],
      expiresAt: Date.now() + 7 * 60 * 1000,
    });

    renderWithQuery(<BookingPage performanceId="performance-floor-aware" />);

    expect(
      await screen.findByRole('button', { name: '1층 A열 1번 선택 해제' }),
    ).toBeInTheDocument();
    expect(screen.getByText('my locked ids: A-1')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '1층 A열 1번 선택 해제' }));

    expect(unlockSeatMutateMock).toHaveBeenCalledWith({
      showtimeId: 'showtime-floor-aware',
      seatId: '1F:A-1',
    });
  });

  it('shows policy-driven limit copy and removes the hardcoded 최대 4석 helper', () => {
    renderWithQuery(<BookingPage performanceId="performance-floor-aware" />);

    expect(
      screen.getByText('이 공연은 1인 2매까지 예매할 수 있습니다'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/최대 4석/)).not.toBeInTheDocument();
    expect(
      screen.getByText(/결제 완료 후 좌석 변경은 지원되지 않으며, 취소\/환불 후 다시 예매해야 합니다\./),
    ).toBeInTheDocument();
  });

  it('surfaces backend 409 messages instead of replacing every conflict with other-owner copy', async () => {
    const user = userEvent.setup();
    lockSeatMutateMock.mockImplementation((variables, options) => {
      options?.onError?.(
        new ApiClientError('이 공연은 1인 최대 4매까지 예매할 수 있습니다', 409),
        variables,
        undefined as never,
      );
    });

    renderWithQuery(<BookingPage performanceId="performance-floor-aware" />);

    await user.click(screen.getByRole('button', { name: '현재 층 좌석 선택' }));

    expect(toastInfoMock).toHaveBeenCalledWith(
      '이 공연은 1인 최대 4매까지 예매할 수 있습니다',
    );
    expect(toastInfoMock).not.toHaveBeenCalledWith('이미 다른 사용자가 선택한 좌석입니다');
  });

  it('marks floors unavailable when all seats are held or disabled', () => {
    seatStatusSeatsMock.mockReturnValue({
      '1F:A-1': 'held',
      '2F:A-1': 'disabled',
    });

    renderWithQuery(<BookingPage performanceId="performance-floor-aware" />);

    expect(screen.getAllByText('혼잡')).toHaveLength(2);
    expect(
      screen.getByText('현재 층은 선택 가능한 좌석이 없습니다. 다른 층을 확인해주세요.'),
    ).toBeInTheDocument();
  });
});
