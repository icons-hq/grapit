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

function bookingsResponse(overrides: { total?: number } = {}) {
  return {
    bookings: [],
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
    mocks.apiGet.mockResolvedValue(bookingsResponse());
  });

  it('shows operation funnel KPIs with exact KRW sales revenue', async () => {
    renderWithClient(<AdminBookingDashboard />);

    expect(await screen.findByText('판매 완료')).toBeInTheDocument();
    expect(screen.getByText('결제/취소 진행')).toBeInTheDocument();
    expect(screen.getByText('실패')).toBeInTheDocument();
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
      '예매번호, 주문ID, 공연명, 좌석, 회원 이름/이메일/전화/ID 검색',
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
