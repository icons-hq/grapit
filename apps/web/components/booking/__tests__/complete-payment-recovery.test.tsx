import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CompletePage from '@/app/booking/[performanceId]/complete/page';
import { useAuthStore } from '@/stores/use-auth-store';

const boundary = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), search: new URLSearchParams(), replace: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ apiClient: { get: boundary.get, post: boundary.post } }));
vi.mock('next/navigation', () => ({
  useParams: () => ({ performanceId: 'performance-return' }),
  useRouter: () => ({ replace: boundary.replace }),
  useSearchParams: () => boundary.search,
}));
vi.mock('next-intl', () => ({ useLocale: () => 'en', useTranslations: () => (key: string) => key }));
vi.mock('@/components/auth/auth-guard', () => ({ AuthGuard: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/components/booking/booking-complete', () => ({ BookingComplete: () => <p>Confirmed ticket</p> }));

function mountPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><CompletePage /></QueryClientProvider>);
}

describe('Provider return recovery actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: { id: 'buyer' } as never });
    boundary.search = new URLSearchParams('pending=true&orderId=GRP-pending');
  });

  it('offers status and support, without a new payment, while a past-deadline handoff is unknown', async () => {
    boundary.get.mockResolvedValue({
      tossOrderId: 'GRP-pending', status: 'PENDING_PAYMENT', paymentInfo: null,
      checkoutStartedAt: '2020-01-01T00:00:00.000Z', paymentDeadlineAt: '2020-01-01T00:07:00.000Z',
    });
    mountPage();
    expect(await screen.findByRole('heading', { name: 'Checking your existing booking' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Help centre' })).toHaveAttribute('href', '/en/support');
    expect(screen.queryByRole('button', { name: 'reselectCta' })).not.toBeInTheDocument();
    expect(boundary.post).not.toHaveBeenCalled();
  });

  it('does not turn a status query outage into an expired or failed payment', async () => {
    boundary.get.mockRejectedValue(new Error('Network unavailable'));
    mountPage();
    expect(await screen.findByRole('heading', { name: 'We could not check your booking' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'reselectCta' })).not.toBeInTheDocument();
  });

  it('identifies an already cancelled booking instead of calling the original payment a failure', async () => {
    boundary.get.mockResolvedValue({ tossOrderId: 'GRP-pending', status: 'CANCELLED',
      paymentInfo: { status: 'CANCELED' }, paidAt: '2026-09-01T00:00:00Z',
      paymentDeadlineAt: '2020-01-01T00:07:00.000Z' });
    mountPage();
    expect(await screen.findByRole('heading', { name: 'Cancellation and refund status' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Payment confirmation failed' })).not.toBeInTheDocument();
    expect(boundary.post).not.toHaveBeenCalled();
  });

  it('reads authoritative payment state after confirm fails, including a seat-lock conflict', async () => {
    boundary.search = new URLSearchParams('orderId=GRP-pending&paymentKey=test-return&amount=52000');
    boundary.post.mockRejectedValue(Object.assign(new Error('좌석 점유 시간이 만료되었습니다. 좌석을 다시 선택해주세요.'), { statusCode: 409 }));
    boundary.get.mockResolvedValue({
      tossOrderId: 'GRP-pending', status: 'PENDING_PAYMENT', paymentInfo: { status: 'DONE' },
      paymentDeadlineAt: '2020-01-01T00:07:00.000Z',
    });
    mountPage();
    await waitFor(() => expect(boundary.post).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('heading', { name: 'Checking your existing booking' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'reselectCta' })).not.toBeInTheDocument();
  });
});
