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
  routerPushMock,
  useLocaleMock,
} = vi.hoisted(() => ({
  lockSeatMutateMock: vi.fn(),
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
    data: { seats: { '1F:A-1': 'available' } },
  }),
  useMyLocks: () => ({ data: { seatIds: [], expiresAt: null } }),
  useLockSeat: () => ({ mutate: lockSeatMutateMock, isPending: false }),
  useUnlockSeat: () => ({ mutate: vi.fn(), isPending: false }),
  useUnlockAllSeats: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/components/booking/booking-header', () => ({
  BookingHeader: () => <header>booking header</header>,
}));

vi.mock('@/components/booking/date-picker', () => ({
  DatePicker: ({
    availableDates,
    onSelect,
  }: {
    availableDates: Date[];
    onSelect: (date: Date) => void;
  }) => (
    <div>
      {availableDates.map((date) => {
        const label = date.toLocaleDateString('ko-KR', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          weekday: 'long',
        });

        return (
          <button key={label} type="button" onClick={() => onSelect(date)}>
            {label}
          </button>
        );
      })}
    </div>
  ),
}));

vi.mock('@/components/booking/seat-map-viewer', () => ({
  SeatMapViewer: () => <div>seat map ready</div>,
}));

vi.mock('@/components/booking/seat-legend', () => ({
  SeatLegend: () => <div>seat legend</div>,
}));

function createPerformanceDetail() {
  const seatMap = {
    id: 'seat-map-1f',
    performanceId: 'performance-kst',
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
    id: 'performance-kst',
    title: 'KST Fanmeet',
    genre: 'artist_celebrity' as const,
    subcategory: null,
    venueId: 'venue-1',
    posterUrl: null,
    description: 'timezone fixture',
    startDate: '2026-07-18T00:00:00.000+09:00',
    endDate: '2026-07-18T23:59:59.000+09:00',
    runtime: '120분',
    ageRating: '전체관람가',
    status: 'selling' as const,
    salesInfo: null,
    viewCount: 0,
    createdAt: '2026-05-11T00:00:00.000Z',
    updatedAt: '2026-05-11T00:00:00.000Z',
    venue: { id: 'venue-1', name: '서울 공연장', address: null },
    castings: [],
    showtimes: [
      {
        id: 'showtime-kst',
        performanceId: 'performance-kst',
        dateTime: '2026-07-18T19:00:00.000+09:00',
      },
    ],
    priceTiers: [
      {
        id: 'tier-vip',
        performanceId: 'performance-kst',
        tierName: 'VIP',
        price: 110000,
        sortOrder: 0,
      },
    ],
    seatMaps: [seatMap],
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
    seatMap,
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

describe('BookingPage timezone handling', () => {
  beforeEach(() => {
    useBookingStore.getState().resetBooking();
    lockSeatMutateMock.mockReset();
    routerPushMock.mockReset();
    useLocaleMock.mockReturnValue('ko');
  });

  it('groups and renders +09:00 showtimes by KST calendar and clock time', async () => {
    const user = userEvent.setup();

    renderWithQuery(<BookingPage performanceId="performance-kst" />);

    await user.click(
      screen.getByRole('button', { name: '2026년 7월 18일 토요일' }),
    );

    expect(screen.getByRole('button', { name: '19:00' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '10:00' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '19:00' }));

    expect(screen.getByText('seat map ready')).toBeInTheDocument();
    expect(screen.getByText('KST Fanmeet').nextElementSibling).toHaveTextContent(
      '2026년 7월 18일 토 19:00',
    );
  });
});
