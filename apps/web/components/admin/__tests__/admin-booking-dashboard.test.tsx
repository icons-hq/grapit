import type { ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';

import { AdminBookingDashboard } from '../admin-booking-dashboard';
import { apiClient } from '@/lib/api-client';

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: mocks.apiGet,
  },
}));

vi.mock('@/components/admin/reservation-export-panel', () => ({
  ReservationExportPanel: () => <div data-testid="reservation-export-panel" />,
}));

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderWithClient(ui: ReactNode) {
  render(
    <QueryClientProvider client={createQueryClient()}>{ui}</QueryClientProvider>,
  );
}

function bookingItem() {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    reservationNumber: 'GRP-24006',
    tossOrderId: 'GRP-TOSS-ORDER-24006',
    userName: '김예매',
    userEmail: 'buyer@example.com',
    userCountry: 'KR',
    performanceTitle: 'Girl Rules Fanmeet',
    showDateTime: '2026-07-18T10:00:00.000Z',
    seats: [
      {
        seatId: 'A-1',
        floorKey: '1F',
        floorLabel: '1층',
        seatKey: '1F:A-1',
        tierName: 'VIP',
        price: 50000,
        row: 'A',
        number: '1',
      },
    ],
    totalAmount: 50000,
    status: 'CONFIRMED',
    funnelStatus: 'SOLD',
    paymentStatus: 'DONE',
    paymentMethod: 'CARD',
    ticketStatusCounts: {
      ACTIVE: 1,
      CANCELLATION_PENDING: 0,
      CANCELLED: 0,
      EXPIRED: 0,
    },
    createdAt: '2026-05-08T11:45:00.000Z',
  };
}

function bookingDetail() {
  return {
    ...bookingItem(),
    userPhone: '+821012345678',
    paymentInfo: {
      paymentKey: 'payment-key-1',
      method: 'CARD',
      amount: 50000,
      status: 'DONE',
      paidAt: '2026-05-08T11:46:00.000Z',
    },
    ticketItems: [],
  };
}

function performanceListResponse() {
  return {
    data: [
      {
        id: '11111111-1111-4111-8111-000000000301',
        title: 'Girl Rules Fanmeet',
        genre: 'musical',
        posterUrl: null,
        status: 'upcoming',
        startDate: '2026-07-18T00:00:00.000Z',
        endDate: '2026-07-18T00:00:00.000Z',
        venueName: 'Donghae Arts Center',
      },
    ],
    total: 1,
    page: 1,
    limit: 20,
    totalPages: 1,
  };
}

function performanceDetailResponse() {
  return {
    ...performanceListResponse().data[0],
    venue: null,
    priceTiers: [
      { id: 'tier-vip', tierName: 'VIP', price: 79000, sortOrder: 0 },
      { id: 'tier-r', tierName: 'R석', price: 66000, sortOrder: 1 },
    ],
    showtimes: [
      {
        id: '11111111-1111-4111-8111-000000000302',
        performanceId: '11111111-1111-4111-8111-000000000301',
        dateTime: '2026-07-18T10:00:00.000Z',
      },
    ],
    castings: [],
    seatMaps: [
      {
        floorKey: '1F',
        floorLabel: '1층',
        sortOrder: 0,
        svgUrl: 'https://example.com/seat-map.svg',
        seatConfig: null,
        totalSeats: 100,
      },
    ],
    bookingPolicy: {
      maxTicketsPerUser: 2,
      allowedPaymentMethods: ['CARD'],
      changePolicyEnabled: false,
      paymentWindowMinutes: 10,
      seatHoldMinutes: 10,
      cancelledSeatHoldMinMinutes: 1,
      cancelledSeatHoldMaxMinutes: 10,
      manualOpenEnabled: true,
      bookingStartsAt: null,
    },
    seatMap: null,
  };
}

function bookingsResponse(overrides: {
  total?: number;
  bookings?: ReturnType<typeof bookingItem>[];
  tierStats?: Array<{
    tierName: string;
    price: number;
    soldSeats: number;
    activeRevenue: number;
    averageTicketAmount: number;
    cancelProcessingSeats: number;
    cancelledSeats: number;
    enteredSeats: number;
    totalSeats: number | null;
    remainingSeats: number | null;
    sellThroughRate: number | null;
  }>;
} = {}) {
  return {
    bookings: overrides.bookings ?? [],
    stats: {
      totalBookings: 9,
      totalRevenue: 1_500_000,
      cancelRate: 20,
      soldCount: 4,
      pendingPaymentCount: 1,
      paymentProcessingCount: 1,
      failedCount: 2,
      cancelProcessingCount: 1,
      cancelledCount: 1,
      partialCancelledCount: 1,
      completedRevenue: 1_500_000,
    },
    tierStats: overrides.tierStats ?? [
      {
        tierName: 'VIP',
        price: 79000,
        soldSeats: 10,
        activeRevenue: 790000,
        averageTicketAmount: 79000,
        cancelProcessingSeats: 1,
        cancelledSeats: 2,
        enteredSeats: 4,
        totalSeats: 100,
        remainingSeats: 90,
        sellThroughRate: 10,
      },
    ],
    total: overrides.total ?? 0,
  };
}

describe('AdminBookingDashboard', () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      value: () => false,
      configurable: true,
    });
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      value: () => {},
      configurable: true,
    });
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      value: () => {},
      configurable: true,
    });
    Element.prototype.scrollIntoView = function scrollIntoView() {};
  });

  beforeEach(() => {
    mocks.apiGet.mockReset();
    mocks.apiGet.mockImplementation(async (url: string) => {
      const path = String(url);
      if (path.includes('/api/v1/admin/performances/11111111-1111-4111-8111-000000000301')) {
        return performanceDetailResponse();
      }
      if (path.includes('/api/v1/admin/performances?')) {
        return performanceListResponse();
      }
      return bookingsResponse();
    });
  });

  it('shows operation funnel KPIs with sold seat count and exact KRW sales revenue', async () => {
    renderWithClient(<AdminBookingDashboard />);

    expect(await screen.findByText('판매 좌석')).toBeInTheDocument();
    expect(await screen.findByText('10건')).toBeInTheDocument();
    expect(screen.getByText('결제/취소 진행')).toBeInTheDocument();
    expect(screen.queryByText('실패')).not.toBeInTheDocument();
    expect(screen.getByText('취소 완료')).toBeInTheDocument();
    expect(screen.getByText('판매 매출')).toBeInTheDocument();
    expect(await screen.findByText('1,500,000원')).toBeInTheDocument();
    expect(screen.queryByText('총 예매수')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('₩1.5M');
  });

  it('sends expanded search and booking funnel filters as query params', async () => {
    const user = userEvent.setup();
    renderWithClient(<AdminBookingDashboard />);

    const searchInput = await screen.findByPlaceholderText(
      '예매번호, Toss 주문번호, 공연명, 좌석, 회원 이름/이메일/전화/ID 검색',
    );

    await user.type(searchInput, 'GRP-ORDER-123');
    await selectOption(user, '퍼널 상태', '결제 확인 중');
    await selectOption(user, '결제 상태', '결제 완료');
    await selectOption(user, '결제 수단', '해외 간편결제');
    await selectOption(user, '국내/해외', '해외');

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('search=GRP-ORDER-123'),
      );
    });

    const lastCall = String(mocks.apiGet.mock.calls.at(-1)?.[0]);
    expect(lastCall).toContain('/api/v1/admin/bookings?');
    expect(lastCall).toContain('funnelStatus=PAYMENT_PROCESSING');
    expect(lastCall).toContain('paymentStatus=DONE');
    expect(lastCall).toContain('paymentMethod=FOREIGN_EASY_PAY');
    expect(lastCall).toContain('audienceRegion=overseas');
    expect(lastCall).toContain('search=GRP-ORDER-123');
    expect(lastCall).toContain('page=1');
    expect(lastCall).not.toContain('status=');
  });

  it('sends performance, showtime, and seat filters as query params', async () => {
    const user = userEvent.setup();
    renderWithClient(<AdminBookingDashboard />);

    await selectOption(user, '공연', 'Girl Rules Fanmeet');
    await selectOption(user, '회차', '2026.07.18 19:00');
    await selectOption(user, '좌석 등급', 'VIP');
    await selectOption(user, '층', '1층');

    const seatInput = await screen.findByPlaceholderText('좌석만 검색');
    await user.type(seatInput, 'A-10');

    await waitFor(() => {
      const lastCall = String(mocks.apiGet.mock.calls.at(-1)?.[0]);
      expect(lastCall).toContain('performanceId=11111111-1111-4111-8111-000000000301');
      expect(lastCall).toContain('showtimeId=11111111-1111-4111-8111-000000000302');
      expect(lastCall).toContain('seatTier=VIP');
      expect(lastCall).toContain('floorKey=1F');
      expect(lastCall).toContain('seatQuery=A-10');
    });
    expect(
      mocks.apiGet.mock.calls.some(([url]) =>
        String(url).includes('/api/v1/admin/performances?page=1&limit=200'),
      ),
    ).toBe(true);
  });

  it('removes dependent seat filters when performance is reset', async () => {
    const user = userEvent.setup();
    renderWithClient(<AdminBookingDashboard />);

    await selectOption(user, '공연', 'Girl Rules Fanmeet');
    await selectOption(user, '회차', '2026.07.18 19:00');
    await selectOption(user, '좌석 등급', 'VIP');
    await selectOption(user, '층', '1층');
    await selectOption(user, '공연', '전체 공연');

    await waitFor(() => {
      const lastCall = String(mocks.apiGet.mock.calls.at(-1)?.[0]);
      expect(lastCall).not.toContain('performanceId=');
      expect(lastCall).not.toContain('showtimeId=');
      expect(lastCall).not.toContain('seatTier=');
      expect(lastCall).not.toContain('floorKey=');
    });
  });

  it('omits seatQuery when the seat search field is cleared', async () => {
    const user = userEvent.setup();
    renderWithClient(<AdminBookingDashboard />);

    const seatInput = await screen.findByPlaceholderText('좌석만 검색');
    await user.type(seatInput, 'A-10');

    await waitFor(() => {
      expect(String(mocks.apiGet.mock.calls.at(-1)?.[0])).toContain('seatQuery=A-10');
    });

    await user.clear(seatInput);

    await waitFor(() => {
      expect(String(mocks.apiGet.mock.calls.at(-1)?.[0])).not.toContain('seatQuery=');
    });
  });

  it('shows tier statistics with capacity and ticket diagnostics', async () => {
    renderWithClient(<AdminBookingDashboard />);

    expect(await screen.findByRole('table', { name: '좌석 등급별 통계' })).toBeInTheDocument();
    expect(screen.getByText('등급별 좌석 통계')).toBeInTheDocument();
    expect(await screen.findByRole('cell', { name: 'VIP' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '10석' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '790,000원' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '90석' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '10%' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '처리중 1 / 취소 2' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '4석' })).toBeInTheDocument();
  });

  it('shows dashes for tier capacity fields before a showtime is selected', async () => {
    mocks.apiGet.mockImplementation(async (url: string) => {
      const path = String(url);
      if (path.includes('/api/v1/admin/performances?')) {
        return performanceListResponse();
      }
      return bookingsResponse({
        tierStats: [
          {
            tierName: 'VIP',
            price: 79000,
            soldSeats: 10,
            activeRevenue: 790000,
            averageTicketAmount: 79000,
            cancelProcessingSeats: 1,
            cancelledSeats: 2,
            enteredSeats: 4,
            totalSeats: null,
            remainingSeats: null,
            sellThroughRate: null,
          },
        ],
      });
    });

    renderWithClient(<AdminBookingDashboard />);

    const row = (await screen.findByRole('cell', { name: 'VIP' })).closest('tr');
    expect(row).not.toBeNull();
    expect(within(row as HTMLTableRowElement).getAllByRole('cell', { name: '-' })).toHaveLength(2);
  });

  it('shows Toss order id in the booking list and detail modal', async () => {
    const user = userEvent.setup();
    mocks.apiGet.mockImplementation(async (url: string) => {
      const path = String(url);
      if (path.includes('/api/v1/admin/bookings/11111111-1111-4111-8111-111111111111')) {
        return bookingDetail();
      }
      return bookingsResponse({ bookings: [bookingItem()], total: 1 });
    });

    renderWithClient(<AdminBookingDashboard />);

    expect(await screen.findByText(/GRP-TOSS-ORDER-24006/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /김예매 Girl Rules Fanmeet 예매 상세 보기/ }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Toss 주문번호')).toBeInTheDocument();
    expect(within(dialog).getByText('GRP-TOSS-ORDER-24006')).toBeInTheDocument();
  });

  it('requests the next server page when pagination is available', async () => {
    const user = userEvent.setup();
    mocks.apiGet.mockResolvedValue(bookingsResponse({ total: 41 }));

    renderWithClient(<AdminBookingDashboard />);

    expect(await screen.findByText('1 / 3')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '다음' }));

    await waitFor(() => {
      expect(String(mocks.apiGet.mock.calls.at(-1)?.[0])).toContain('page=2');
    });
  });
});

async function selectOption(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  option: string,
) {
  await user.click(screen.getByLabelText(label));
  await user.click(within(document.body).getByRole('option', { name: option }));
}
