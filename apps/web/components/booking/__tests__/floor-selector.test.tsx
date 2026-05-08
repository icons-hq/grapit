import type { ReactNode } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { BookingPage } from '@/components/booking/booking-page';
import { useBookingStore } from '@/stores/use-booking-store';

const {
  lockSeatMutateMock,
  unlockSeatMutateMock,
  unlockAllMutateMock,
  routerPushMock,
  useLocaleMock,
} = vi.hoisted(() => ({
  lockSeatMutateMock: vi.fn(),
  unlockSeatMutateMock: vi.fn(),
  unlockAllMutateMock: vi.fn(),
  routerPushMock: vi.fn(),
  useLocaleMock: vi.fn(() => 'ko'),
}));

vi.mock('next-intl', () => ({
  useLocale: useLocaleMock,
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
      seats: {
        '1F:A-1': 'available',
        '2F:A-1': 'available',
      },
    },
  }),
  useMyLocks: () => ({ data: { seatIds: [], expiresAt: null } }),
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
    onSeatClick,
  }: {
    svgUrl: string;
    selectedSeatIds: Set<string>;
    onSeatClick: (seatId: string) => void;
  }) => (
    <div>
      <p>{`current map: ${svgUrl}`}</p>
      <p>{`selected ids: ${Array.from(selectedSeatIds).join(',') || 'none'}`}</p>
      <button type="button" onClick={() => onSeatClick('A-1')}>
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
      maxTicketsPerUser: 1,
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
    useLocaleMock.mockReturnValue('ko');
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

  it('preserves selections across floor switching and groups the summary by floor label', async () => {
    const user = userEvent.setup();

    renderWithQuery(<BookingPage performanceId="performance-floor-aware" />);

    expect(screen.getByText('current map: /1F-map.svg')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '현재 층 좌석 선택' }));
    await user.click(screen.getByRole('button', { name: /2층/ }));

    expect(screen.getByText('current map: /2F-map.svg')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '현재 층 좌석 선택' }));
    await user.click(screen.getByRole('button', { name: /1층/ }));

    expect(screen.getByRole('heading', { name: '1층' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '2층' })).toBeInTheDocument();
    expect(screen.getByText('current map: /1F-map.svg')).toBeInTheDocument();
    expect(screen.getByText('selected ids: A-1')).toBeInTheDocument();
    expect(screen.getAllByText('2석').length).toBeGreaterThan(0);
  });

  it('shows policy-driven limit copy and removes the hardcoded 최대 4석 helper', () => {
    renderWithQuery(<BookingPage performanceId="performance-floor-aware" />);

    expect(
      screen.getByText('이 공연은 1인 1매까지 예매할 수 있습니다'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/최대 4석/)).not.toBeInTheDocument();
    expect(
      screen.getByText(/결제 완료 후 좌석 변경은 지원되지 않으며, 취소\/환불 후 다시 예매해야 합니다\./),
    ).toBeInTheDocument();
  });
});
