import { act, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FieldBenefitEntitlement } from '@grabit/shared';

import FieldCheckInPage from '../page';
import {
  addPendingScanAttempt,
  clearPendingScanAttempts,
  listPendingScanAttempts,
  updatePendingScanAttempt,
} from '@/lib/field/offline-scan-store';

const SHOWTIME_ID = '00000000-0000-4000-8000-000000000301';
const OTHER_SHOWTIME_ID = '00000000-0000-4000-8000-000000000302';
const BENEFIT_ENTITLEMENT_ID = '00000000-0000-4000-8000-000000000801';
const RAW_TICKET_TOKEN = 'raw-ticket-token-for-scan-attempt';
const SCANNER_USER_ID = 'scanner-user-1';
const ENTERED_LABEL = '입장 처리가 완료되었습니다';

type SyncResult = { deviceAttemptId: string; state: 'synced'; result: 'processed'; resultLabel: string };

const mocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  verifyInputs: [] as Array<Record<string, unknown>>,
  /** When set, verify runs as a real query with this server stand-in (fixed per test). */
  verifyServer: null as null | ((input: Record<string, unknown>) => Promise<unknown>),
  verifyRefetch: vi.fn(async () => undefined),
  consumeMutateAsync: vi.fn(),
  benefitRedeemMutateAsync: vi.fn(),
  offlineSyncMutateAsync: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/field/check-in',
  useSearchParams: () => mocks.searchParams,
}));

vi.mock('@/stores/use-auth-store', () => ({
  useAuthStore: () => ({
    isInitialized: true,
    accessToken: 'scanner-access-token',
    user: {
      id: SCANNER_USER_ID,
      name: '현장 스태프',
      role: 'admin',
      adminCapabilityBundle: 'scanner',
      adminCapabilities: ['field.scan.verify', 'field.scan.consume', 'field.scan.sync', 'field.benefits.redeem'],
    },
  }),
}));

vi.mock('@/hooks/use-field-operations', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/use-field-operations')>(
    '@/hooks/use-field-operations',
  );
  const { useMutation, useQuery } = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');

  return {
    ...actual,
    useFieldShowtimes: () => ({
      data: [
        { id: SHOWTIME_ID, eventId: 'field-event', title: '현장 검증', dateTime: '2099-01-01T10:00:00Z', venueName: 'Hall' },
        { id: OTHER_SHOWTIME_ID, eventId: 'field-event', title: '현장 검증 2회차', dateTime: '2099-01-01T14:00:00Z', venueName: 'Hall' },
      ],
      isError: false,
    }),
    useFieldCheckInVerify: (input: Record<string, unknown>) => {
      mocks.verifyInputs.push(input);
      const server = mocks.verifyServer;
      if (server) {
        // Same query key as the real hook: one cached result per scan attempt.
        // eslint-disable-next-line react-hooks/rules-of-hooks -- verifyServer is fixed per test
        return useQuery({
          queryKey: ['field', 'check-in', 'verify', input.token, input.showtimeId, input.deviceAttemptId],
          queryFn: () => server(input),
          enabled: Boolean(input.enabled),
          retry: false,
        });
      }
      return {
        data: {
          result: 'processable',
          resultLabel: '입장 가능 티켓입니다',
          processable: true,
          reservationNumber: 'GRP-FIELD-ATTEMPT-001',
          performanceTitle: 'Attempt Scanner Performance',
          showtimeAt: '2099-01-01T10:00:00.000Z',
          showtimeId: SHOWTIME_ID,
          seats: ['VIP A열 1번'],
          ticketStatus: 'ACTIVE',
          offlineQueue: [],
          benefitEntitlements: [includedBenefit()],
        },
        isLoading: false,
        isFetching: false,
        isError: false,
        fetchStatus: 'idle',
        refetch: mocks.verifyRefetch,
      };
    },
    // Real mutation state per mounted scan screen: a remount loses its result.
    useFieldCheckInConsume: () => useMutation({ mutationFn: mocks.consumeMutateAsync }),
    useFieldBenefitRedeem: () => useMutation({ mutationFn: mocks.benefitRedeemMutateAsync }),
    useFieldOfflineSync: () => ({ isPending: false, mutateAsync: mocks.offlineSyncMutateAsync }),
  };
});

function includedBenefit(): FieldBenefitEntitlement {
  const copy = { name: '공식 포스터', description: '공식 포스터 설명' };
  return {
    id: BENEFIT_ENTITLEMENT_ID,
    runId: null,
    source: 'configuration',
    benefitIdentity: 'benefit_official_poster',
    kind: 'included',
    displayCopy: { ko: copy, en: copy, 'zh-CN': copy, th: copy },
    state: 'active',
    redeemedAt: null,
    attachedToTicket: true,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(<FieldCheckInPage />, { wrapper });
}

/** An unsynced entry of another QR in this scanner's queue for the same showtime. */
async function queueOtherEntry() {
  await addPendingScanAttempt({
    deviceAttemptId: 'queued-other-entry',
    scannerUserId: SCANNER_USER_ID,
    eventId: 'field-event',
    showtimeId: SHOWTIME_ID,
    token: 'another-queued-token',
    redactedTokenRef: 'tok_anothe...oken',
    attemptedAt: '2099-01-01T09:00:00.000Z',
    syncState: 'pending',
  });
}

/** Holds the automatic sync until the test releases it. */
function holdAutoSync() {
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  mocks.offlineSyncMutateAsync.mockImplementation(async ({ attempts }: { attempts: Array<{ deviceAttemptId: string }> }) => {
    await released;
    return attempts.map((attempt): SyncResult => ({ deviceAttemptId: attempt.deviceAttemptId, state: 'synced',
      result: 'processed', resultLabel: '보류 스캔 동기화 완료' }));
  });
  return () => act(async () => { release(); });
}

function verifyAttemptIds() {
  return [...new Set(mocks.verifyInputs.map((input) => input.deviceAttemptId))];
}

// The server records a rejected verify once per scan attempt and ignores the
// re-check of an attempt that consume already recorded (audit #113), so verify
// must carry the same attempt id that the entry action later uses.
describe('FieldCheckInPage scan attempt identity', () => {
  beforeEach(async () => {
    // jsdom has no layout; the page brings each new scan result into view.
    Element.prototype.scrollIntoView = vi.fn();
    await clearPendingScanAttempts(); sessionStorage.clear(); localStorage.clear();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    mocks.verifyInputs.length = 0;
    mocks.verifyServer = null;
    mocks.verifyRefetch.mockClear();
    mocks.consumeMutateAsync.mockReset().mockResolvedValue({ result: 'processed', resultLabel: ENTERED_LABEL });
    mocks.benefitRedeemMutateAsync.mockReset().mockResolvedValue({ outcome: 'redeemed', outcomeLabel: '혜택 사용 처리 완료' });
    mocks.offlineSyncMutateAsync.mockReset().mockResolvedValue([]);
    mocks.searchParams = new URLSearchParams({ ticket: RAW_TICKET_TOKEN, showtimeId: SHOWTIME_ID });
  });

  it('verifies with the same device attempt id that the entry action consumes', async () => {
    const user = userEvent.setup();
    renderPage();

    // The page first checks this device's offline queue for the same QR.
    await user.click(await screen.findByRole('button', { name: '이 좌석 입장 처리' }));
    await waitFor(() => expect(mocks.consumeMutateAsync).toHaveBeenCalledTimes(1));

    const consumedAttempt = mocks.consumeMutateAsync.mock.calls[0]?.[0].deviceAttemptId;
    expect(consumedAttempt).toEqual(expect.any(String));
    expect(mocks.verifyInputs.length).toBeGreaterThan(0);
    for (const input of mocks.verifyInputs) {
      expect(input).toMatchObject({ token: RAW_TICKET_TOKEN, showtimeId: SHOWTIME_ID, deviceAttemptId: consumedAttempt });
    }
  });

  it('keeps the attempt and the entry result when an automatic sync settles another queued entry (D4)', async () => {
    await queueOtherEntry();
    const releaseSync = holdAutoSync();
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: '이 좌석 입장 처리' }));
    expect(await screen.findByRole('status', { name: ENTERED_LABEL })).toBeInTheDocument();
    const consumedAttempt = mocks.consumeMutateAsync.mock.calls[0]?.[0].deviceAttemptId as string;

    await releaseSync();
    await waitFor(async () => expect(await listPendingScanAttempts({ syncState: 'pending' })).toHaveLength(0));
    expect(await screen.findByText('서버 확정')).toBeInTheDocument();

    // A remount used to issue a new attempt id; the next verify then recorded
    // the scanner's own entry as an already_used duplicate on the server.
    expect(screen.getByRole('status', { name: ENTERED_LABEL })).toBeInTheDocument();
    expect(verifyAttemptIds()).toEqual([consumedAttempt]);
    await user.click(screen.getByRole('button', { name: '사용 처리' }));
    await waitFor(() => expect(mocks.benefitRedeemMutateAsync).toHaveBeenCalledTimes(1));
    expect(verifyAttemptIds()).toEqual([consumedAttempt]);
  });

  it('keeps the attempt when another tab syncs a queued entry and this tab reloads the queue (D4)', async () => {
    await queueOtherEntry();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: '이 좌석 입장 처리' });
    const firstAttempt = verifyAttemptIds();
    expect(firstAttempt).toHaveLength(1);

    // Another tab synced the record; this tab reads it when it becomes visible again.
    await updatePendingScanAttempt('queued-other-entry', { syncState: 'synced', result: 'processed', resultLabel: '보류 스캔 동기화 완료' });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(await screen.findByText('서버 확정')).toBeInTheDocument();

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    await user.click(screen.getByRole('button', { name: '이 좌석 입장 처리' }));
    await waitFor(() => expect(mocks.consumeMutateAsync).toHaveBeenCalledTimes(1));
    expect(mocks.consumeMutateAsync.mock.calls[0]?.[0].deviceAttemptId).toBe(firstAttempt[0]);
    expect(verifyAttemptIds()).toEqual(firstAttempt);
  });

  it('shows the server result of this scan\'s own queued entry after sync instead of a fresh entry button', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const releaseSync = holdAutoSync();
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: '이 좌석 입장 처리' }));
    expect(await screen.findByRole('status', { name: '입장 동기화 대기' })).toBeInTheDocument();
    const [queued] = await listPendingScanAttempts({ syncState: 'pending' });
    expect(verifyAttemptIds()).toEqual([queued!.deviceAttemptId]);

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    act(() => { window.dispatchEvent(new Event('online')); });
    await releaseSync();

    expect(await screen.findByRole('status', { name: '보류 스캔 동기화 완료' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '이 좌석 입장 처리' })).not.toBeInTheDocument();
    expect(screen.queryByText('이 기기에서 이미 입장 동기화 대기 중인 QR입니다')).not.toBeInTheDocument();
    expect(verifyAttemptIds()).toEqual([queued!.deviceAttemptId]);
  });

  it('starts a new attempt for a re-scan of the same QR and for another showtime, and admits after the showtime change', async () => {
    // Like the server: an attempt's receipt is bound to the showtime it was recorded for.
    const receipts = new Map<string, string>();
    mocks.consumeMutateAsync.mockImplementation(async ({ deviceAttemptId, showtimeId }: { deviceAttemptId: string; showtimeId: string }) => {
      const recorded = receipts.get(deviceAttemptId);
      if (recorded && recorded !== showtimeId) {
        throw Object.assign(new Error('다른 검표에 사용된 요청입니다. 티켓을 다시 확인해주세요.'), { statusCode: 409 });
      }
      receipts.set(deviceAttemptId, showtimeId);
      return showtimeId === OTHER_SHOWTIME_ID
        ? { result: 'processed', resultLabel: ENTERED_LABEL }
        : { result: 'wrong-showtime', resultLabel: '현재 회차의 티켓이 아닙니다' };
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: '이 좌석 입장 처리' }));
    expect(await screen.findByRole('status', { name: '현재 회차의 티켓이 아닙니다' })).toBeInTheDocument();
    const [firstAttempt] = verifyAttemptIds();

    // The same QR read again is a new scan.
    await user.click(screen.getByRole('button', { name: '다음 티켓' }));
    await user.type(screen.getByLabelText('QR 링크 또는 내용'), RAW_TICKET_TOKEN);
    await user.click(screen.getByRole('button', { name: '티켓 확인' }));
    await screen.findByRole('button', { name: '이 좌석 입장 처리' });
    const rescanAttempt = verifyAttemptIds().at(-1);
    expect(rescanAttempt).not.toBe(firstAttempt);

    await user.selectOptions(screen.getByRole('combobox', { name: '검표할 공연·회차' }), OTHER_SHOWTIME_ID);
    await user.click(await screen.findByRole('button', { name: '이 좌석 입장 처리' }));
    expect(await screen.findByRole('status', { name: ENTERED_LABEL })).toBeInTheDocument();

    const showtimeAttempt = verifyAttemptIds().at(-1);
    expect(new Set([firstAttempt, rescanAttempt, showtimeAttempt]).size).toBe(3);
    expect(mocks.verifyInputs.at(-1)).toMatchObject({ showtimeId: OTHER_SHOWTIME_ID, deviceAttemptId: showtimeAttempt });
    expect(mocks.consumeMutateAsync.mock.calls.at(-1)?.[0]).toMatchObject({ showtimeId: OTHER_SHOWTIME_ID, deviceAttemptId: showtimeAttempt });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('retries a failed benefit redemption with its first attempt id across a queue change that used to remount the scan (D4)', async () => {
    await queueOtherEntry();
    const releaseSync = holdAutoSync();
    mocks.benefitRedeemMutateAsync.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: '사용 처리' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('실물을 다시 지급하지 말고');

    await releaseSync();
    expect(await screen.findByText('서버 확정')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '사용 처리' }));
    await waitFor(() => expect(mocks.benefitRedeemMutateAsync).toHaveBeenCalledTimes(2));
    const [first, retry] = mocks.benefitRedeemMutateAsync.mock.calls.map(([request]) => request.deviceAttemptId as string);
    expect(retry).toBe(first);
    expect(first).not.toBe(verifyAttemptIds()[0]);
  });

  it('shows the server explanation of a 409 redemption conflict and retries the same attempt (D6)', async () => {
    const conflict = '같은 회차 결제 처리와 겹쳐 특전 지급을 확인하지 못했습니다. 실물을 지급하지 말고 같은 요청으로 다시 확인해주세요.';
    mocks.benefitRedeemMutateAsync.mockRejectedValueOnce(Object.assign(new Error(conflict), { statusCode: 409 }));
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: '사용 처리' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(conflict);
    await user.click(screen.getByRole('button', { name: '사용 처리' }));

    await waitFor(() => expect(mocks.benefitRedeemMutateAsync).toHaveBeenCalledTimes(2));
    expect(mocks.benefitRedeemMutateAsync.mock.calls[1]?.[0].deviceAttemptId)
      .toBe(mocks.benefitRedeemMutateAsync.mock.calls[0]?.[0].deviceAttemptId);
    expect(await screen.findByText('혜택 사용 처리 완료')).toBeInTheDocument();
  });

  // #116 guard: another attempt of this QR sat in the queue, so the cached
  // "processable" result was hidden. When that entry is synced (admitted), the
  // guard lifts; the cached result must not offer entry again (field-ops-1).
  it('asks the server again with the same attempt once another attempt of the QR is synced, and shows already used', async () => {
    const processable = {
      result: 'processable', resultLabel: '입장 가능 티켓입니다', processable: true,
      reservationNumber: 'GRP-FIELD-ATTEMPT-001', performanceTitle: 'Attempt Scanner Performance',
      showtimeAt: '2099-01-01T10:00:00.000Z', showtimeId: SHOWTIME_ID, seats: ['VIP A열 1번'],
      ticketStatus: 'ACTIVE', offlineQueue: [], benefitEntitlements: [],
    };
    const alreadyUsed = {
      ...processable, result: 'duplicate', resultLabel: '이미 입장 처리된 티켓입니다', processable: false, ticketStatus: 'USED',
    };
    let admitted = false;
    const server = vi.fn(async (_input: Record<string, unknown>) => (admitted ? alreadyUsed : processable));
    mocks.verifyServer = server;
    // This tab's own sync fails; another tab on the device syncs the entry.
    mocks.offlineSyncMutateAsync.mockRejectedValue(new TypeError('Failed to fetch'));
    await addPendingScanAttempt({
      deviceAttemptId: 'queued-same-qr', scannerUserId: SCANNER_USER_ID, eventId: 'field-event', showtimeId: SHOWTIME_ID,
      token: RAW_TICKET_TOKEN, redactedTokenRef: 'tok_raw-ti...empt', attemptedAt: '2099-01-01T09:00:00.000Z', syncState: 'pending',
    });
    renderPage();

    expect(await screen.findByText('이 기기에서 이미 입장 동기화 대기 중인 QR입니다')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '이 좌석 입장 처리' })).not.toBeInTheDocument();
    expect(server).toHaveBeenCalledTimes(1);

    admitted = true;
    await updatePendingScanAttempt('queued-same-qr', { syncState: 'synced', result: 'processed', resultLabel: '보류 스캔 동기화 완료' });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });

    expect(await screen.findByRole('status', { name: '이미 입장 처리된 티켓입니다' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '이 좌석 입장 처리' })).not.toBeInTheDocument();
    expect(server).toHaveBeenCalledTimes(2);
    const [first, recheck] = server.mock.calls.map(([input]) => input);
    expect(recheck).toMatchObject({ token: RAW_TICKET_TOKEN, showtimeId: SHOWTIME_ID, deviceAttemptId: first!.deviceAttemptId });
    expect(first!.deviceAttemptId).not.toBe('queued-same-qr');
    expect(mocks.consumeMutateAsync).not.toHaveBeenCalled();
  });

  it('does not re-ask the server when the queue changes without lifting the guard', async () => {
    renderPage();
    await screen.findByRole('button', { name: '이 좌석 입장 처리' });

    await queueOtherEntry();
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

    expect(mocks.verifyRefetch).not.toHaveBeenCalled();
  });
});
