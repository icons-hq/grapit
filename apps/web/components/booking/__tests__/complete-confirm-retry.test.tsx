import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CompletePage from '@/app/booking/[performanceId]/complete/page';
import { useAuthStore } from '@/stores/use-auth-store';

const boundary = vi.hoisted(() => ({
  get: vi.fn(), post: vi.fn(), search: new URLSearchParams(), replace: vi.fn(), toastError: vi.fn(),
  locale: 'en',
}));
vi.mock('@/lib/api-client', () => ({ apiClient: { get: boundary.get, post: boundary.post } }));
vi.mock('next/navigation', () => ({
  useParams: () => ({ performanceId: 'performance-return' }),
  useRouter: () => ({ replace: boundary.replace }),
  useSearchParams: () => boundary.search,
}));
vi.mock('next-intl', () => ({ useLocale: () => boundary.locale, useTranslations: () => (key: string) => key }));
vi.mock('sonner', () => ({ toast: { error: boundary.toastError } }));
vi.mock('@/components/auth/auth-guard', () => ({ AuthGuard: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/components/booking/booking-complete', () => ({ BookingComplete: () => <p>Confirmed ticket</p> }));
// Retry spacing is covered by the policy unit test; the page test keeps real retries without waiting.
vi.mock('@/lib/booking/payment-return', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/booking/payment-return')>()),
  getConfirmPaymentRetryDelayMs: () => 0,
}));

const RETURN = 'paymentType=NORMAL&orderId=GRP-return&paymentKey=test-return&amount=52000';
const confirmed = { id: 'reservation-return', tossOrderId: 'GRP-return', status: 'CONFIRMED' };
const handedOff = {
  tossOrderId: 'GRP-return', status: 'PENDING_PAYMENT', paymentInfo: null,
  checkoutStartedAt: '2026-10-02T03:00:00.000Z', paymentDeadlineAt: '2099-01-01T00:07:00.000Z',
};

function networkLoss() {
  return new TypeError('Failed to fetch');
}

function mountPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><CompletePage /></QueryClientProvider>);
}

describe('Payment return confirm delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    boundary.locale = 'en';
    window.history.replaceState(null, '', '/en/booking/performance-return/complete');
    useAuthStore.setState({ user: { id: 'buyer' } as never });
    boundary.search = new URLSearchParams(RETURN);
  });

  it('resends a confirm lost to a network drop instead of leaving the authenticated payment to expire', async () => {
    boundary.post.mockRejectedValueOnce(networkLoss()).mockResolvedValueOnce(confirmed);

    mountPage();

    expect(await screen.findByText('Confirmed ticket')).toBeInTheDocument();
    expect(boundary.post).toHaveBeenCalledTimes(2);
    // The confirm carries the display locale for the returned detail (audit #88).
    expect(boundary.post).toHaveBeenLastCalledWith(expect.stringMatching(/^\/api\/v1\/payments\/confirm\?locale=/), {
      paymentKey: 'test-return', orderId: 'GRP-return', amount: 52000,
    }, { showErrorToast: false });
    expect(boundary.toastError).not.toHaveBeenCalled();
  });

  it('lets the buyer send the confirm again after repeated gateway failures, without a new payment', async () => {
    const gatewayError = Object.assign(new Error('Service Unavailable'), { statusCode: 503 });
    boundary.post
      .mockRejectedValueOnce(gatewayError)
      .mockRejectedValueOnce(gatewayError)
      .mockRejectedValueOnce(gatewayError)
      .mockRejectedValueOnce(gatewayError)
      .mockResolvedValueOnce(confirmed);
    boundary.get.mockResolvedValue(handedOff);

    mountPage();

    const resend = await screen.findByRole('button', { name: 'Send payment confirmation again' });
    expect(boundary.post).toHaveBeenCalledTimes(4);
    expect(screen.queryByRole('button', { name: 'reselectCta' })).not.toBeInTheDocument();
    await userEvent.setup().click(resend);

    expect(await screen.findByText('Confirmed ticket')).toBeInTheDocument();
    expect(boundary.post).toHaveBeenCalledTimes(5);
    expect(boundary.toastError).not.toHaveBeenCalled();
  });

  it('keeps the resend card, with a busy button, while the resent confirm is in flight', async () => {
    const gatewayError = Object.assign(new Error('Bad Gateway'), { statusCode: 502 });
    let finishResend!: (value: unknown) => void;
    boundary.post
      .mockRejectedValueOnce(gatewayError)
      .mockRejectedValueOnce(gatewayError)
      .mockRejectedValueOnce(gatewayError)
      .mockRejectedValueOnce(gatewayError)
      .mockReturnValueOnce(new Promise((resolve) => { finishResend = resolve; }));
    boundary.get.mockResolvedValue(handedOff);

    mountPage();

    const resend = await screen.findByRole('button', { name: 'Send payment confirmation again' });
    const body = 'Your payment was authenticated, but we could not finish confirming it yet. Please request confirmation again in a moment. You will only be charged once.';
    expect(screen.getByText(body)).toBeInTheDocument();
    await userEvent.setup().click(resend);

    await waitFor(() => expect(boundary.post).toHaveBeenCalledTimes(5));
    expect(screen.getByRole('button', { name: 'Send payment confirmation again' })).toBeDisabled();
    expect(screen.getByText(body)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check status again' })).not.toBeInTheDocument();

    finishResend(confirmed);
    expect(await screen.findByText('Confirmed ticket')).toBeInTheDocument();
  });

  it('retries a busy confirm lease but never repeats a definite rejection', async () => {
    boundary.post
      .mockRejectedValueOnce(Object.assign(new Error('결제 확인이 이미 진행 중입니다.'), { statusCode: 409 }))
      .mockRejectedValueOnce(Object.assign(new Error('좌석 점유 시간이 만료되었습니다. 좌석을 다시 선택해주세요.'), { statusCode: 409 }));
    boundary.get.mockResolvedValue(handedOff);

    mountPage();

    expect(await screen.findByRole('heading', { name: 'Checking your existing booking' })).toBeInTheDocument();
    expect(boundary.post).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Check status again' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send payment confirmation again' })).not.toBeInTheDocument();
  });

  it('drops the one-time provider return after confirmation so a reload reads the order instead', async () => {
    boundary.post.mockResolvedValueOnce(confirmed);

    mountPage();

    expect(await screen.findByText('Confirmed ticket')).toBeInTheDocument();
    expect(boundary.replace).toHaveBeenCalledWith(
      '/en/booking/performance-return/complete?orderId=GRP-return&pending=true',
      { scroll: false },
    );
  });

  it('does not report a failure when the order behind a rejected confirm is already confirmed', async () => {
    boundary.post.mockRejectedValueOnce(Object.assign(new Error('대기열 입장 시간이 만료되었습니다'), { statusCode: 403 }));
    boundary.get.mockResolvedValue(confirmed);

    mountPage();

    expect(await screen.findByText('Confirmed ticket')).toBeInTheDocument();
    expect(boundary.post).toHaveBeenCalledTimes(1);
    expect(boundary.toastError).not.toHaveBeenCalled();
    // Confirmed through lookup: a reload must not send the stale return again either.
    await waitFor(() => expect(boundary.replace).toHaveBeenCalledWith(
      '/en/booking/performance-return/complete?orderId=GRP-return&pending=true',
      { scroll: false },
    ));
  });

  it('reports the confirm error in the page locale once lookup shows the order did not complete', async () => {
    boundary.post.mockRejectedValueOnce(Object.assign(new Error('금액이 일치하지 않습니다'), { statusCode: 400 }));
    boundary.get.mockResolvedValue({ ...handedOff, status: 'FAILED', checkoutStartedAt: null });

    mountPage();

    expect(await screen.findByRole('heading', { name: 'Payment confirmation failed' })).toBeInTheDocument();
    // Never the Korean server text on the English page (audit #96).
    await waitFor(() => expect(boundary.toastError).toHaveBeenCalledWith('Payment confirmation failed'));
    expect(boundary.toastError).toHaveBeenCalledTimes(1);
    expect(boundary.toastError).not.toHaveBeenCalledWith('금액이 일치하지 않습니다');
    expect(screen.queryByText('금액이 일치하지 않습니다')).not.toBeInTheDocument();
  });

  it('keeps the Korean server reason on the Korean page', async () => {
    boundary.locale = 'ko';
    boundary.post.mockRejectedValueOnce(Object.assign(new Error('금액이 일치하지 않습니다'), { statusCode: 400 }));
    boundary.get.mockResolvedValue({ ...handedOff, status: 'FAILED', checkoutStartedAt: null });

    mountPage();

    await waitFor(() => expect(boundary.toastError).toHaveBeenCalledWith('금액이 일치하지 않습니다'));
  });

  it('says why on the checking card when a definite refusal leaves the order pending (403 sales closed)', async () => {
    boundary.post.mockRejectedValueOnce(
      Object.assign(new Error('이미 시작된 회차는 예매할 수 없습니다.'), { statusCode: 403 }),
    );
    // Still handed off and unpaid until the provider EXPIRED webhook arrives.
    boundary.get.mockResolvedValue(handedOff);

    mountPage();

    expect(await screen.findByRole('heading', { name: 'Checking your existing booking' })).toBeInTheDocument();
    expect(await screen.findByText('seatSelection.showtimeClosed')).toBeInTheDocument();
    expect(screen.queryByText('이미 시작된 회차는 예매할 수 없습니다.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send payment confirmation again' })).not.toBeInTheDocument();
    expect(boundary.post).toHaveBeenCalledTimes(1);
    expect(boundary.toastError).not.toHaveBeenCalled();
  });

  it('shows the seat-hold refusal in the page locale on the checking card (409)', async () => {
    boundary.post.mockRejectedValueOnce(
      Object.assign(new Error('좌석 점유 시간이 만료되었습니다. 좌석을 다시 선택해주세요.'), { statusCode: 409 }),
    );
    boundary.get.mockResolvedValue(handedOff);

    mountPage();

    expect(await screen.findByText('Your seat hold expired. Please choose seats again.')).toBeInTheDocument();
    expect(screen.queryByText(/좌석 점유/)).not.toBeInTheDocument();
  });
});
