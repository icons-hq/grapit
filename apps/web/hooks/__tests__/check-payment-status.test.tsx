import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCheckPaymentStatus } from '../use-check-payment-status';
const post = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ apiClient: { post } }));

describe('manual payment status recovery', () => {
  beforeEach(() => { post.mockReset(); });
  it.each(['unavailable', 'checked'])('refreshes the order after a provider result of %s', async (outcome) => {
    post.mockResolvedValue({ outcome });
    const refetch = vi.fn().mockResolvedValue({});
    const { result } = renderHook(() => useCheckPaymentStatus('order', refetch));
    await act(() => result.current.check());
    expect(post).toHaveBeenCalledWith('/api/v1/payments/status-check', { orderId: 'order' }, { showErrorToast: false });
    expect(refetch).toHaveBeenCalledOnce();
    expect(result.current.providerUnavailable).toBe(outcome === 'unavailable');
  });
  it('still reloads local evidence when the provider check request fails', async () => {
    post.mockRejectedValue(new Error('network'));
    const refetch = vi.fn().mockResolvedValue({});
    const { result } = renderHook(() => useCheckPaymentStatus('order', refetch));
    await act(() => result.current.check());
    expect(refetch).toHaveBeenCalledOnce(); expect(result.current.providerUnavailable).toBe(true);
  });
  it('deduplicates repeated clicks until reconciliation and local refresh finish', async () => {
    let finish!: (value: unknown) => void;
    post.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const refetch = vi.fn().mockResolvedValue({});
    const { result } = renderHook(() => useCheckPaymentStatus('order', refetch));
    let first!: Promise<void>;
    act(() => { first = result.current.check(); });
    await act(() => result.current.check());
    expect(post).toHaveBeenCalledOnce();
    await act(async () => { finish({ outcome: 'checked' }); await first; });
    expect(result.current.checking).toBe(false);
  });
});
