import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookingAddonSnapshot, UserProfile } from '@grabit/shared';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/use-auth-store';
import { useBookingStore } from '@/stores/use-booking-store';
import { useBookingAddons } from '../use-booking-addons';
import { BookingAddonOptions } from '@/components/booking/booking-addon-options';

vi.mock('next-intl', () => ({ useLocale: () => 'ko' }));
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
afterEach(() => { cleanup(); client.clear(); useAuthStore.getState().clearAuth(); useBookingStore.getState().resetBooking(); });

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


describe('addon selection feedback during network delay', () => {
  it('shows progress immediately while the server hold response is outstanding', async () => {
    let finish!: (value: BookingAddonSnapshot) => void;
    put.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    function Selection() {
      const addons = useBookingAddons('show');
      return <BookingAddonOptions snapshot={addons.data} seats={[seat]} pending={false}
        pendingSelections={addons.pendingSelections} onChange={addons.setSelection} />;
    }
    render(<Selection />, { wrapper: Wrapper });
    const checkbox = await screen.findByRole('checkbox');
    fireEvent.click(checkbox);
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(screen.getByText('선점 중…')).toBeInTheDocument();
    expect(checkbox).toBeChecked();
    expect(useBookingStore.getState().selectedAddons).toEqual([]);
    await act(async () => { finish({ ...empty, selections: [choice] }); });
    expect(await screen.findByText('선점 완료')).toBeInTheDocument();
  });
});


function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('consecutive addon selections and recovery', () => {
  it('accepts another option immediately, serializes writes, and avoids a GET after successful holds', async () => {
    const first = deferred<BookingAddonSnapshot>();
    const second = deferred<BookingAddonSnapshot>();
    put.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const highFive = { ...empty.addons[0]!, id: 'high-five', maxPerTicket: 2 };
    const initial = { ...empty, addons: [...empty.addons, highFive] };
    get.mockResolvedValue(initial);
    function Selection() {
      const addons = useBookingAddons('show');
      return <><BookingAddonOptions snapshot={addons.data} seats={[seat]} pending={false}
        pendingSelections={addons.pendingSelections} onChange={addons.setSelection} />
        <button disabled={addons.selectionPending}>다음 단계</button></>;
    }
    render(<Selection />, { wrapper: Wrapper });
    const boxes = await screen.findAllByRole('checkbox');
    fireEvent.click(boxes[0]!);
    expect(boxes[1]!).toBeEnabled();
    fireEvent.click(boxes[1]!);
    expect(screen.getAllByText('선점 중…')).toHaveLength(2);
    expect(screen.getByRole('button', { name: '다음 단계' })).toBeDisabled();
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(useBookingStore.getState().selectedAddons).toEqual([]);
    await act(async () => { first.resolve({ ...initial, selections: [choice] }); });
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    expect(useBookingStore.getState().selectedAddons).toEqual([choice]);
    expect(screen.getByRole('button', { name: '다음 단계' })).toBeDisabled();
    const highChoice = { ...choice, addonId: highFive.id, unitIndex: 1 };
    await act(async () => { second.resolve({ ...initial, selections: [choice, highChoice] }); });
    await waitFor(() => expect(screen.getByRole('button', { name: '다음 단계' })).toBeEnabled());
    expect(useBookingStore.getState().selectedAddons).toEqual([choice, highChoice]);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('removes unconfirmed feedback after rejection and blocks checkout until server reconciliation finishes', async () => {
    const response = deferred<BookingAddonSnapshot>();
    const reconciliation = deferred<BookingAddonSnapshot>();
    put.mockReturnValue(response.promise);
    const { result } = renderHook(() => useBookingAddons('show'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    get.mockReturnValueOnce(reconciliation.promise);
    act(() => result.current.setSelection({ addonId: 'photo', seatKey: seat.seatKey, selected: true }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    await act(async () => { response.reject(new Error('Sold out')); });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(result.current.selectionPending).toBe(true);
    expect(result.current.pendingSelections).toEqual([]);
    expect(useBookingStore.getState().selectedAddons).toEqual([]);
    await act(async () => { reconciliation.resolve({ ...empty, addons: empty.addons.map((addon) => ({ ...addon, available: 0 })) }); });
    await waitFor(() => expect(result.current.selectionPending).toBe(false));
    expect(result.current.data?.addons[0]?.available).toBe(0);
  });

  it('recovers a committed hold after its response is lost', async () => {
    put.mockRejectedValue(new Error('Connection lost'));
    const { result } = renderHook(() => useBookingAddons('show'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    get.mockResolvedValue({ ...empty, selections: [choice] });
    act(() => result.current.setSelection({ addonId: 'photo', seatKey: seat.seatKey, selected: true }));
    await waitFor(() => expect(useBookingStore.getState().selectedAddons).toEqual([choice]));
    expect(result.current.selectionPending).toBe(false);
  });

  it('never lets a delayed GET erase a subsequently confirmed choice', async () => {
    const oldRead = deferred<BookingAddonSnapshot>();
    const response = deferred<BookingAddonSnapshot>();
    put.mockReturnValue(response.promise);
    const { result } = renderHook(() => useBookingAddons('show'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    get.mockReturnValueOnce(oldRead.promise);
    let reading!: ReturnType<typeof result.current.refetch>;
    act(() => { reading = result.current.refetch(); });
    act(() => result.current.setSelection({ addonId: 'photo', seatKey: seat.seatKey, selected: true }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    await act(async () => { response.resolve({ ...empty, selections: [choice] }); });
    await waitFor(() => expect(useBookingStore.getState().selectedAddons).toEqual([choice]));
    await act(async () => { oldRead.resolve(empty); await reading; });
    expect(result.current.data?.selections).toEqual([choice]);
    expect(useBookingStore.getState().selectedAddons).toEqual([choice]);
  });

  it('discards queued writes and late responses when the account changes', async () => {
    const response = deferred<BookingAddonSnapshot>();
    put.mockReturnValue(response.promise);
    const { result } = renderHook(() => useBookingAddons('show'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    act(() => {
      result.current.setSelection({ addonId: 'photo', seatKey: seat.seatKey, selected: true });
      result.current.setSelection({ addonId: 'high-five', seatKey: seat.seatKey, selected: true });
    });
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    act(() => useAuthStore.getState().setAuth('other-test', { id: 'other' } as UserProfile));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.selectionPending).toBe(false);
    expect(result.current.pendingSelections).toEqual([]);
    await act(async () => { response.resolve({ ...empty, selections: [choice] }); });
    expect(useBookingStore.getState().selectedAddons).toEqual([]);
    expect(put).toHaveBeenCalledTimes(1);
  });

  it('discards queued writes and late responses when the showtime changes', async () => {
    const response = deferred<BookingAddonSnapshot>();
    put.mockReturnValue(response.promise);
    const { result, rerender } = renderHook(({ showtime }) => useBookingAddons(showtime), { wrapper: Wrapper, initialProps: { showtime: 'show' } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    act(() => {
      result.current.setSelection({ addonId: 'photo', seatKey: seat.seatKey, selected: true });
      result.current.setSelection({ addonId: 'high-five', seatKey: seat.seatKey, selected: true });
    });
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    get.mockResolvedValue({ ...empty, showtimeId: 'other-show' });
    rerender({ showtime: 'other-show' });
    await waitFor(() => expect(result.current.data?.showtimeId).toBe('other-show'));
    await act(async () => { response.resolve({ ...empty, selections: [choice] }); });
    expect(result.current.selectionPending).toBe(false);
    expect(result.current.pendingSelections).toEqual([]);
    expect(useBookingStore.getState().selectedAddons).toEqual([]);
    expect(put).toHaveBeenCalledTimes(1);
  });

  it('does not enqueue the same unit twice before its response', async () => {
    const response = deferred<BookingAddonSnapshot>();
    put.mockReturnValue(response.promise);
    const { result } = renderHook(() => useBookingAddons('show'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const input = { addonId: 'photo', seatKey: seat.seatKey, unitIndex: 1, selected: true };
    act(() => { result.current.setSelection(input); result.current.setSelection(input); });
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(result.current.pendingSelections).toEqual([input]);
    await act(async () => { response.resolve({ ...empty, selections: [choice] }); });
    expect(put).toHaveBeenCalledTimes(1);
  });
});


describe('selection during recovery', () => {
  it('sends an option queued while the previous failed request is being reconciled', async () => {
    const response = deferred<BookingAddonSnapshot>();
    const recovery = deferred<BookingAddonSnapshot>();
    const queued = deferred<BookingAddonSnapshot>();
    put.mockReturnValueOnce(response.promise).mockReturnValueOnce(queued.promise);
    const { result } = renderHook(() => useBookingAddons('show'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    get.mockReturnValueOnce(recovery.promise);
    act(() => result.current.setSelection({ addonId: 'photo', seatKey: seat.seatKey, unitIndex: 1, selected: true }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    await act(async () => { response.reject(new Error('Connection lost')); });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    act(() => result.current.setSelection({ addonId: 'high-touch', seatKey: seat.seatKey, unitIndex: 2, selected: true }));
    expect(result.current.selectionPending).toBe(true);
    await act(async () => { recovery.resolve(empty); });
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    const highChoice = { ...choice, addonId: 'high-touch', unitIndex: 2 };
    await act(async () => { queued.resolve({ ...empty, selections: [highChoice] }); });
    await waitFor(() => expect(result.current.selectionPending).toBe(false));
    expect(result.current.pendingSelections).toEqual([]);
    expect(useBookingStore.getState().selectedAddons).toEqual([highChoice]);
  });
});
