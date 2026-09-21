import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBookingPaymentRecovery } from '../use-booking';
import { useAuthStore } from '@/stores/use-auth-store';
import { useBookingStore } from '@/stores/use-booking-store';

const get = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ apiClient: { get } }));

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const expiredOrder = {
  id: 'pending-order', tossOrderId: 'GRP-pending', status: 'PENDING_PAYMENT',
  paymentDeadlineAt: '2020-01-01T00:00:00.000Z', checkoutStartedAt: '2020-01-01T00:00:00.000Z',
};

describe('Completion recovery uses provider state before local expiry', () => {
  beforeEach(() => {
    get.mockReset();
    useBookingStore.getState().resetBooking();
    useAuthStore.setState({ user: { id: 'buyer' } as never, accessToken: 'test-token', isInitialized: true });
  });

  it.each(['IN_PROGRESS', 'DONE', 'PARTIAL_CANCELED', null])('keeps %s or an unknown handoff pending after the local deadline', async (status) => {
    get.mockResolvedValue({ ...expiredOrder, paymentInfo: status ? { status } : null });
    const { result } = renderHook(() => useBookingPaymentRecovery('GRP-pending', { pendingReturn: true }), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.paymentStatus).toBe('pending');
  });

  it('does not call an unreachable order expired because an old browser timer expired', async () => {
    useBookingStore.getState().applyPaymentDeadline('2020-01-01T00:00:00.000Z');
    get.mockRejectedValue(new Error('Network unavailable'));
    const { result } = renderHook(() => useBookingPaymentRecovery('GRP-pending', { pendingReturn: true }), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.paymentStatus).toBe('unavailable');
  });

  it('allows expiry only for a known unpaid order without handoff', async () => {
    get.mockResolvedValue({ ...expiredOrder, checkoutStartedAt: null, paymentInfo: null });
    const { result } = renderHook(() => useBookingPaymentRecovery('GRP-pending', { pendingReturn: true }), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.paymentStatus).toBe('expired');
  });
});
