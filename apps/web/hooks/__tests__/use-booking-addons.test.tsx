import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookingAddonSnapshot, UserProfile } from '@grabit/shared';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/use-auth-store';
import { useBookingStore } from '@/stores/use-booking-store';
import { useBookingAddons } from '../use-booking-addons';

vi.mock('@/lib/api-client', () => ({ apiClient: { get: vi.fn(), put: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const put = vi.mocked(apiClient.put);
const seat = { seatId: 'A-1', seatKey: '1F:A-1', floorKey: '1F', floorLabel: '1층', tierName: 'SVIP', row: 'A', number: '1', price: 380000 };
const copy = { ko: { name: '포토', description: '추가 구매' }, en: { name: 'Photo', description: 'Paid option' },
  th: { name: 'Photo', description: 'Paid option' }, 'zh-CN': { name: 'Photo', description: 'Paid option' } };
const choice = { addonId: 'photo', seatKey: seat.seatKey, price: 150000, displayCopy: copy, expiresAt: new Date(Date.now() + 600000).toISOString() };
const empty: BookingAddonSnapshot = { showtimeId: 'show', generatedAt: new Date().toISOString(), nextExpiryAt: null,
  addons: [{ id: 'photo', identity: 'photo', displayCopy: copy, price: 150000, capacity: 58, eligibleTierNames: ['SVIP'], active: true, sortOrder: 0, available: 58, held: 0, sold: 0 }], selections: [] };
let client: QueryClient;
function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  get.mockReset(); put.mockReset(); get.mockResolvedValue(empty);
  useAuthStore.getState().setAuth('test', { id: 'buyer' } as UserProfile);
  useBookingStore.getState().resetBooking();
  useBookingStore.setState({ selectedShowtimeId: 'show', selectedSeats: [seat] });
});
afterEach(() => { client.clear(); useAuthStore.getState().clearAuth(); useBookingStore.getState().resetBooking(); });

describe('paid addon selection synchronization', () => {
  it('restores server-owned holds and drops them when a fresh snapshot reports expiry', async () => {
    get.mockResolvedValue({ ...empty, selections: [choice] });
    const { result } = renderHook(() => useBookingAddons('show'), { wrapper: Wrapper });
    await waitFor(() => expect(useBookingStore.getState().selectedAddons).toEqual([choice]));
    get.mockResolvedValue(empty);
    await act(async () => { await result.current.refetch(); });
    await waitFor(() => expect(useBookingStore.getState().selectedAddons).toEqual([]));
  });

  it('waits for the authoritative mutation response and sends only the choice, never its price or remaining count', async () => {
    let resolve!: (value: BookingAddonSnapshot) => void;
    put.mockImplementation(() => new Promise((r) => { resolve = r; }));
    const { result } = renderHook(() => useBookingAddons('show'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    act(() => result.current.setSelection({ addonId: 'photo', seatKey: seat.seatKey, selected: true }));
    await waitFor(() => expect(result.current.selectionPending).toBe(true));
    expect(useBookingStore.getState().selectedAddons).toEqual([]);
    expect(put).toHaveBeenCalledWith('/api/v1/booking/addons/holds', { showtimeId: 'show', addonId: 'photo', seatKey: seat.seatKey, selected: true });
    const selected = { ...empty, selections: [choice] };
    get.mockResolvedValue(selected);
    await act(async () => { resolve(selected); });
    await waitFor(() => expect(useBookingStore.getState().selectedAddons).toEqual([choice]));
    expect(result.current.selectionPending).toBe(false);
  });

  it('does not carry another account’s selections through the query cache', async () => {
    get.mockResolvedValue({ ...empty, selections: [choice] });
    const { result } = renderHook(() => useBookingAddons('show'), { wrapper: Wrapper });
    await waitFor(() => expect(useBookingStore.getState().selectedAddons).toEqual([choice]));
    get.mockResolvedValue(empty);
    act(() => useAuthStore.getState().setAuth('other-test', { id: 'other' } as UserProfile));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await waitFor(() => expect(useBookingStore.getState().selectedAddons).toEqual([]));
  });
});
