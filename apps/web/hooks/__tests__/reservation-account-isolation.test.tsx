import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMyReservations, useReservationDetail } from '../use-reservations';
import { useAuthStore } from '@/stores/use-auth-store';

const get = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ apiClient: { get } }));

describe('Buyer reservation cache isolation', () => {
  beforeEach(() => {
    get.mockReset();
    useAuthStore.setState({ user: { id: 'buyer-a' } as never, accessToken: 'test-a' });
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
