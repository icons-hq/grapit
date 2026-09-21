import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMyReservations, useReservationDetail, useRefundPreview, useCancelTicketItem } from '../use-reservations';
import { useAuthStore } from '@/stores/use-auth-store';

const get = vi.hoisted(() => vi.fn());
const put = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ apiClient: { get, put } }));

describe('Buyer reservation cache isolation', () => {
  beforeEach(() => {
    get.mockReset();
    put.mockReset();
    window.history.replaceState({}, '', '/');
    useAuthStore.setState({ user: { id: 'buyer-a' } as never, accessToken: 'test-a' });
  });

  it('does not refetch an obsolete refund quote after the seat cancellation succeeds', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    get.mockResolvedValue({ refundableAmount: 52000 });
    put.mockResolvedValue({ id: 'order-a' });
    const { result } = renderHook(() => ({ preview: useRefundPreview('order-a', true, 'seat-a'), cancel: useCancelTicketItem() }), { wrapper });
    await waitFor(() => expect(result.current.preview.isSuccess).toBe(true));
    await act(() => result.current.cancel.mutateAsync({ id: 'order-a', ticketItemId: 'seat-a', reason: 'Changed plans' }));
    expect(get).toHaveBeenCalledTimes(1);
    expect(client.getQueryState(['reservations', 'order-a', 'refund-preview', 'buyer-a', 'seat-a'])?.isInvalidated).toBe(true);
  });

  it.each(['list', 'detail'])('refetches a %s in the selected language instead of retaining the previous title', async (kind) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60000 } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const original = kind === 'list' ? [{ performanceTitle: '공연' }] : { performanceTitle: '공연' };
    get.mockResolvedValueOnce(original).mockImplementation(() => new Promise(() => {}));
    const useTargetQuery: () => { data: unknown } = kind === 'list' ? useMyReservations : () => useReservationDetail('order-a');
    const { result, rerender } = renderHook(useTargetQuery, { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(original));
    window.history.replaceState({}, '', '/th/mypage');
    rerender();
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(get).toHaveBeenLastCalledWith(expect.stringContaining('locale=th')));
  });

  it.each(['list', 'detail'])('does not show the previous account during a %s lookup', async (kind) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60000 } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const firstResult = kind === 'list' ? [{ id: 'private-a' }] : { id: 'private-a' };
    get.mockResolvedValueOnce(firstResult).mockImplementation(() => new Promise(() => {}));
    const useTargetQuery: () => { data: unknown } = kind === 'list' ? useMyReservations : () => useReservationDetail('private-a');
    const { result } = renderHook(useTargetQuery, { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(firstResult));
    act(() => useAuthStore.setState({ user: { id: 'buyer-b' } as never, accessToken: 'test-b' }));
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });
});
