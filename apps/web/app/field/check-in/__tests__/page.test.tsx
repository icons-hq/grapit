import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FieldBenefitEntitlement } from '@grabit/shared';

import FieldCheckInPage from '../page';
import {
  addPendingScanAttempt,
  clearPendingScanAttempts,
  listPendingScanAttempts,
  type PendingScanAttemptRecord,
} from '@/lib/field/offline-scan-store';
import { fieldShowtimeSelectionKey } from '@/lib/field/showtime-selection';

const REQUESTED_SHOWTIME_ID = '00000000-0000-4000-8000-000000000301';
const TICKET_SHOWTIME_ID = '00000000-0000-4000-8000-000000000302';
const OTHER_SHOWTIME_ID = '00000000-0000-4000-8000-000000000303';
const BENEFIT_ENTITLEMENT_ID = '00000000-0000-4000-8000-000000000801';
const RAW_TICKET_TOKEN = 'raw-ticket-token-for-benefit-redemption';
const SCANNER_USER_ID = 'scanner-user-1';

const mocks = vi.hoisted(() => ({
  routerReplace: vi.fn(),
  searchParams: new URLSearchParams(),
  verifyData: null as unknown,
  verifyState: {} as Record<string, unknown>,
  verifyRefetch: vi.fn(),
  verifyCalls: [] as Array<{ token?: string; showtimeId?: string; enabled?: boolean }>,
  useRealVerify: false,
  showtimes: [] as Array<{ id: string; eventId: string; title: string; dateTime: string; venueName: string | null }>,
  auth: { isInitialized: true, accessToken: 'scanner-access-token' as string | null },
  capabilities: [] as string[],
  clearAuth: vi.fn(),
  apiPost: vi.fn(),
  consumeMutateAsync: vi.fn(),
  benefitRedeemMutateAsync: vi.fn(),
  offlineSyncMutateAsync: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: mocks.routerReplace,
  }),
  usePathname: () => '/field/check-in',
  useSearchParams: () => mocks.searchParams,
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: { post: mocks.apiPost, get: vi.fn() },
}));

vi.mock('@/stores/use-auth-store', () => ({
  useAuthStore: () => ({
    ...mocks.auth,
    clearAuth: mocks.clearAuth,
    user: {
      id: SCANNER_USER_ID,
      name: '현장 스태프',
      role: 'admin',
      adminCapabilityBundle: 'scanner',
      adminCapabilities: mocks.capabilities,
    },
  }),
}));

vi.mock('@/hooks/use-field-operations', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/use-field-operations')>(
    '@/hooks/use-field-operations',
  );

  return {
    ...actual,
    useFieldShowtimes: () => ({ data: mocks.showtimes, isError: false, isLoading: false }),
    useFieldCheckInVerify: (input: Parameters<typeof actual.useFieldCheckInVerify>[0]) => {
      mocks.verifyCalls.push({ token: input.token, showtimeId: input.showtimeId, enabled: input.enabled });
      // useRealVerify is fixed per test and never toggled between renders.
      if (mocks.useRealVerify) return actual.useFieldCheckInVerify(input);
      return {
        data: mocks.verifyData,
        isLoading: false,
        isFetching: false,
        isError: false,
        error: null,
        fetchStatus: 'idle',
        refetch: mocks.verifyRefetch,
        ...mocks.verifyState,
      };
    },
    useFieldCheckInConsume: () => ({
      data: null,
      isPending: false,
      mutateAsync: mocks.consumeMutateAsync,
    }),
    useFieldBenefitRedeem: () => ({
      isPending: false,
      mutateAsync: mocks.benefitRedeemMutateAsync,
    }),
    useFieldOfflineSync: () => ({
      isPending: false,
      mutateAsync: mocks.offlineSyncMutateAsync,
    }),
  };
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(<FieldCheckInPage />, { wrapper });
}

function showtimeOption(id: string, title: string, dateTime: string) {
  return { id, eventId: `event-${id.slice(-3)}`, title, dateTime, venueName: 'Hall' };
}

function includedBenefit(): FieldBenefitEntitlement {
  return {
    id: BENEFIT_ENTITLEMENT_ID,
    runId: null,
    source: 'configuration',
    benefitIdentity: 'benefit_official_poster',
    kind: 'included',
    displayCopy: {
      ko: { name: '공식 포스터', description: '공식 포스터 설명' },
      en: { name: 'Official poster', description: 'Official poster benefit' },
      'zh-CN': { name: 'Official poster', description: 'Official poster benefit' },
      th: { name: 'Official poster', description: 'Official poster benefit' },
    },
    state: 'active',
    redeemedAt: null,
    attachedToTicket: true,
  };
}

function verification(overrides: Record<string, unknown> = {}) {
  return {
    result: 'processable',
    resultLabel: '입장 가능 티켓입니다',
    processable: true,
    reservationNumber: 'GRP-FIELD-BENEFIT-001',
    performanceTitle: 'Benefit Scanner Performance',
    showtimeAt: '2026-07-04T10:00:00.000Z',
    showtimeId: TICKET_SHOWTIME_ID,
    seats: ['VIP A열 1번'],
    ticketStatus: 'ACTIVE',
    offlineQueue: [],
    benefitEntitlements: [includedBenefit()],
    ...overrides,
  };
}

function pendingRecord(overrides: Partial<PendingScanAttemptRecord> = {}): PendingScanAttemptRecord {
  return {
    deviceAttemptId: 'pending-attempt-1',
    scannerUserId: SCANNER_USER_ID,
    eventId: 'event-303',
    showtimeId: OTHER_SHOWTIME_ID,
    token: 'pending-token-of-another-showtime',
    redactedTokenRef: 'tok_pendin...time',
    attemptedAt: '2026-10-03T08:00:00.000Z',
    syncState: 'pending',
    ...overrides,
  };
}

function saveSelection(showtimeId: string, showtimeDateTime: string, selectedAt: string) {
  localStorage.setItem(fieldShowtimeSelectionKey(SCANNER_USER_ID), JSON.stringify({ showtimeId, showtimeDateTime, selectedAt }));
}

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value });
  fireEvent(window, new Event(value ? 'online' : 'offline'));
}

beforeEach(async () => {
  await clearPendingScanAttempts(); sessionStorage.clear(); localStorage.clear();
  window.history.replaceState(null, '', '/field/check-in');
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  mocks.routerReplace.mockReset();
  mocks.clearAuth.mockReset();
  mocks.apiPost.mockReset().mockResolvedValue(undefined);
  mocks.verifyRefetch.mockReset();
  mocks.verifyCalls = [];
  mocks.verifyState = {};
  mocks.useRealVerify = false;
  mocks.auth = { isInitialized: true, accessToken: 'scanner-access-token' };
  mocks.capabilities = ['field.scan.verify', 'field.scan.consume', 'field.scan.sync', 'field.benefits.redeem'];
  mocks.showtimes = [showtimeOption(REQUESTED_SHOWTIME_ID, '현장 검증', '2099-01-01T10:00:00Z')];
  mocks.consumeMutateAsync.mockReset();
  mocks.benefitRedeemMutateAsync.mockReset().mockResolvedValue({
    outcome: 'redeemed',
    outcomeLabel: '혜택 사용 처리 완료',
    redeemedAt: '2026-07-04T08:45:00.000Z',
  });
  mocks.offlineSyncMutateAsync.mockReset();
  mocks.searchParams = new URLSearchParams({
    ticket: RAW_TICKET_TOKEN,
    showtimeId: REQUESTED_SHOWTIME_ID,
  });
  mocks.verifyData = verification();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  onlineManager.setOnline(true);
});

describe('FieldCheckInPage benefit redemption showtime contract', () => {
  it('submits the scanner-requested showtime when redeeming a benefit', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: '사용 처리' }));

    await waitFor(() => {
      expect(mocks.benefitRedeemMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          token: RAW_TICKET_TOKEN,
          showtimeId: REQUESTED_SHOWTIME_ID,
          benefitEntitlementId: BENEFIT_ENTITLEMENT_ID,
          confirmed: true,
        }),
      );
    });
    expect(mocks.benefitRedeemMutateAsync.mock.calls[0]?.[0].showtimeId)
      .not.toBe(TICKET_SHOWTIME_ID);
  });

  it('keeps benefits visible but disables redemption for wrong-showtime scans', async () => {
    mocks.verifyData = verification({
      result: 'wrong-showtime',
      resultLabel: '현재 회차의 티켓이 아닙니다',
      processable: false,
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('현재 회차의 티켓이 아닙니다')).toBeInTheDocument();
      const panel = screen.getByTestId('scanner-benefit-panel');
      expect(within(panel).getByText('공식 포스터')).toBeInTheDocument();
      expect(within(panel).queryByRole('button', { name: '사용 처리' }))
        .not.toBeInTheDocument();
    });
    expect(mocks.benefitRedeemMutateAsync).not.toHaveBeenCalled();
  });

  it('redeems active benefits for already-used tickets after entry processing', async () => {
    const user = userEvent.setup();
    mocks.verifyData = verification({
      result: 'duplicate',
      resultLabel: '이미 입장 처리된 티켓입니다',
      processable: false,
      ticketStatus: 'USED',
    });

    renderPage();

    await user.click(await screen.findByRole('button', { name: '사용 처리' }));

    await waitFor(() => {
      expect(mocks.benefitRedeemMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          token: RAW_TICKET_TOKEN,
          showtimeId: REQUESTED_SHOWTIME_ID,
          benefitEntitlementId: BENEFIT_ENTITLEMENT_ID,
          confirmed: true,
        }),
      );
    });
    expect(mocks.consumeMutateAsync).not.toHaveBeenCalled();
  });
  it('accepts manual QR content after choosing the real showtime and requires a separate entry action', async () => {
    mocks.searchParams = new URLSearchParams(); const user = userEvent.setup();
    renderPage();
    await user.selectOptions(screen.getByRole('combobox', { name: '검표할 공연·회차' }), REQUESTED_SHOWTIME_ID);
    await user.type(screen.getByLabelText('QR 링크 또는 내용'), RAW_TICKET_TOKEN);
    await user.click(screen.getByRole('button', { name: '티켓 확인' }));
    expect(await screen.findByRole('button', { name: '이 좌석 입장 처리' })).toBeEnabled();
    expect(mocks.consumeMutateAsync).not.toHaveBeenCalled();
  });

  it('stores an offline entry as pending and disables benefit redemption', async () => {
    const user = userEvent.setup(); renderPage();
    await screen.findByRole('button', { name: '이 좌석 입장 처리' });
    setOnline(false);
    expect(screen.queryByRole('button', { name: '사용 처리' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '이 좌석 입장 처리' }));
    await waitFor(async () => expect(await listPendingScanAttempts({ scannerUserId: SCANNER_USER_ID })).toHaveLength(1));
    expect(mocks.consumeMutateAsync).not.toHaveBeenCalled(); expect(mocks.benefitRedeemMutateAsync).not.toHaveBeenCalled();
    expect(screen.queryByText('입장 처리 완료')).not.toBeInTheDocument();
    expect(await screen.findByText('보류 상태는 최종 입장 증거가 아닙니다')).toBeInTheDocument();
  });

  it('shows failed online actions and preserves the same redemption attempt on retry', async () => {
    const user = userEvent.setup(); mocks.benefitRedeemMutateAsync.mockRejectedValue(new TypeError('Failed to fetch'));
    renderPage();
    await user.click(await screen.findByRole('button', { name: '사용 처리' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('실물을 다시 지급하지 말고');
    await user.click(screen.getByRole('button', { name: '사용 처리' }));
    expect(mocks.benefitRedeemMutateAsync.mock.calls[0]?.[0].deviceAttemptId).toBe(mocks.benefitRedeemMutateAsync.mock.calls[1]?.[0].deviceAttemptId);
    expect(await listPendingScanAttempts()).toHaveLength(0);
  });

});

describe('FieldCheckInPage camera tab showtime persistence (#39)', () => {
  const now = new Date('2026-10-03T09:00:00.000Z'); // 18:00 KST
  const evening = showtimeOption(REQUESTED_SHOWTIME_ID, '저녁 공연', '2026-10-03T10:00:00.000Z');
  const matinee = showtimeOption(OTHER_SHOWTIME_ID, '낮 공연', '2026-10-03T05:00:00.000Z');

  beforeEach(() => {
    vi.useFakeTimers({ now, toFake: ['Date'] });
    mocks.showtimes = [matinee, evening];
  });

  it('restores the showtime chosen in another tab when the camera opens a ticket-only link', async () => {
    const user = userEvent.setup();
    mocks.searchParams = new URLSearchParams();
    const firstTab = renderPage();
    await user.selectOptions(screen.getByRole('combobox', { name: '검표할 공연·회차' }), REQUESTED_SHOWTIME_ID);
    firstTab.unmount();

    // New tab opened by the OS camera: only ?ticket=, fresh sessionStorage.
    sessionStorage.clear();
    mocks.searchParams = new URLSearchParams({ ticket: RAW_TICKET_TOKEN });
    renderPage();

    expect(await screen.findByRole('button', { name: '이 좌석 입장 처리' })).toBeEnabled();
    expect(screen.getByRole('combobox', { name: '검표할 공연·회차' })).toHaveValue(REQUESTED_SHOWTIME_ID);
    const summary = screen.getByRole('region', { name: '검표 중인 회차' });
    expect(within(summary).getByText('저녁 공연')).toBeInTheDocument();
    expect(within(summary).getByText('이전에 선택한 회차를 불러왔습니다. 공연명과 시각이 맞는지 확인하세요.')).toBeInTheDocument();
    expect(mocks.verifyCalls.at(-1)).toEqual(expect.objectContaining({ token: RAW_TICKET_TOKEN, showtimeId: REQUESTED_SHOWTIME_ID }));
  });

  it('renews the restored choice so each camera tab extends its 12 hour window', async () => {
    localStorage.setItem(fieldShowtimeSelectionKey(SCANNER_USER_ID), JSON.stringify({
      showtimeId: REQUESTED_SHOWTIME_ID,
      showtimeDateTime: evening.dateTime,
      selectedAt: '2026-10-02T22:00:00.000Z',
    }));
    mocks.searchParams = new URLSearchParams({ ticket: RAW_TICKET_TOKEN });
    renderPage();

    expect(await screen.findByRole('button', { name: '이 좌석 입장 처리' })).toBeEnabled();
    expect(JSON.parse(localStorage.getItem(fieldShowtimeSelectionKey(SCANNER_USER_ID))!)).toEqual({
      showtimeId: REQUESTED_SHOWTIME_ID,
      showtimeDateTime: evening.dateTime,
      selectedAt: now.toISOString(),
    });
  });

  it('keeps the restored showtime\'s held scans listed after a sync that started before the restore', async () => {
    saveSelection(REQUESTED_SHOWTIME_ID, evening.dateTime, '2026-10-03T08:00:00.000Z');
    await addPendingScanAttempt(pendingRecord({ showtimeId: REQUESTED_SHOWTIME_ID, attemptedAt: '2026-10-03T08:30:00.000Z' }));
    // The automatic sync on load fails, so the entry stays pending.
    mocks.offlineSyncMutateAsync.mockRejectedValue(new TypeError('Failed to fetch'));
    mocks.searchParams = new URLSearchParams();
    renderPage();

    expect(await screen.findByText('동기화를 완료하지 못했습니다. 대기 기록은 유지되며 다시 시도할 수 있습니다.')).toBeInTheDocument();
    // Let the sync's closing refresh settle; it must reload the restored showtime, not the empty one it started with.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(screen.getByRole('combobox', { name: '검표할 공연·회차' })).toHaveValue(REQUESTED_SHOWTIME_ID);
    expect(screen.getByText('보류 스캔')).toBeInTheDocument();
    expect(screen.getByText('보류 1')).toBeInTheDocument();
  });

  it('remembers a listed showtime that came with the link and ignores an unlisted one', async () => {
    mocks.searchParams = new URLSearchParams({ ticket: RAW_TICKET_TOKEN, showtimeId: REQUESTED_SHOWTIME_ID });
    const { unmount } = renderPage();
    expect(await screen.findByRole('button', { name: '이 좌석 입장 처리' })).toBeEnabled();
    expect(JSON.parse(localStorage.getItem(fieldShowtimeSelectionKey(SCANNER_USER_ID))!)).toMatchObject({
      showtimeId: REQUESTED_SHOWTIME_ID,
      selectedAt: now.toISOString(),
    });
    unmount();

    localStorage.clear();
    mocks.searchParams = new URLSearchParams({ ticket: RAW_TICKET_TOKEN, showtimeId: TICKET_SHOWTIME_ID });
    renderPage();
    expect(await screen.findByText('QR을 읽었습니다. 검표할 공연과 회차를 선택하면 바로 확인합니다.')).toBeInTheDocument();
    expect(localStorage.getItem(fieldShowtimeSelectionKey(SCANNER_USER_ID))).toBeNull();
  });

  it('does not restore an expired choice and keeps the scanned QR until a showtime is picked', async () => {
    const user = userEvent.setup();
    localStorage.setItem(fieldShowtimeSelectionKey(SCANNER_USER_ID), JSON.stringify({
      showtimeId: REQUESTED_SHOWTIME_ID,
      showtimeDateTime: evening.dateTime,
      selectedAt: '2026-10-02T09:00:00.000Z',
    }));
    mocks.searchParams = new URLSearchParams({ ticket: RAW_TICKET_TOKEN });
    renderPage();

    expect(await screen.findByText('QR을 읽었습니다. 검표할 공연과 회차를 선택하면 바로 확인합니다.')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '검표할 공연·회차' })).toHaveValue('');
    expect(localStorage.getItem(fieldShowtimeSelectionKey(SCANNER_USER_ID))).toBeNull();

    await user.selectOptions(screen.getByRole('combobox', { name: '검표할 공연·회차' }), REQUESTED_SHOWTIME_ID);
    expect(await screen.findByRole('button', { name: '이 좌석 입장 처리' })).toBeEnabled();
    expect(within(screen.getByRole('region', { name: '검표 중인 회차' }))
      .queryByText('이전에 선택한 회차를 불러왔습니다. 공연명과 시각이 맞는지 확인하세요.')).not.toBeInTheDocument();
  });
});

describe('FieldCheckInPage offline verification (#40)', () => {
  it('explains that a QR scanned after the connection dropped cannot be verified', async () => {
    mocks.verifyData = undefined;
    mocks.verifyState = { fetchStatus: 'paused', isLoading: false };
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole('heading', { name: '연결이 끊겨 이 QR을 확인할 수 없습니다' })).toBeInTheDocument();
    expect(screen.getByText(/예외 원장에 예매번호·좌석·시각·담당자를 기록/)).toBeInTheDocument();
    expect(screen.queryByText('QR 티켓을 확인하고 있습니다')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '이 좌석 입장 처리' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '다시 확인' }));
    expect(mocks.verifyRefetch).toHaveBeenCalled();
    expect(await listPendingScanAttempts()).toHaveLength(0);
  });

  it('shows the offline notice when the real verify query is paused by TanStack', async () => {
    mocks.useRealVerify = true;
    onlineManager.setOnline(false);
    renderPage();

    expect(await screen.findByRole('heading', { name: '연결이 끊겨 이 QR을 확인할 수 없습니다' })).toBeInTheDocument();
    expect(mocks.apiPost).not.toHaveBeenCalledWith('/api/v1/field/check-in/verify', expect.anything(), expect.anything());
  });

  it('treats a fetch failure on venue Wi-Fi as offline but keeps server errors distinct', async () => {
    mocks.verifyData = undefined;
    mocks.verifyState = { isError: true, error: new TypeError('Failed to fetch') };
    const { unmount } = renderPage();
    expect(await screen.findByRole('heading', { name: '연결이 끊겨 이 QR을 확인할 수 없습니다' })).toBeInTheDocument();
    unmount();

    mocks.verifyState = { isError: true, error: Object.assign(new Error('Network policy rejected'), { statusCode: 503 }) };
    renderPage();
    expect(await screen.findByRole('heading', { name: 'QR 티켓을 확인할 수 없습니다' })).toBeInTheDocument();
  });

  it('tells staff that only already-verified tickets can be queued while offline', async () => {
    renderPage();
    await screen.findByRole('button', { name: '이 좌석 입장 처리' });
    setOnline(false);
    expect(await screen.findByText(/연결이 끊기기 전에 서버 확인을 마친 이 티켓만 입장 동기화 대기로 저장할 수 있습니다/)).toBeInTheDocument();
  });
});

describe('FieldCheckInPage offline duplicate guard (#116)', () => {
  it('blocks a second offline entry for the same QR after moving to the next ticket', async () => {
    const user = userEvent.setup();
    mocks.searchParams = new URLSearchParams({ showtimeId: REQUESTED_SHOWTIME_ID });
    renderPage();
    await user.type(screen.getByLabelText('QR 링크 또는 내용'), RAW_TICKET_TOKEN);
    await user.click(screen.getByRole('button', { name: '티켓 확인' }));
    await screen.findByRole('button', { name: '이 좌석 입장 처리' });
    setOnline(false);
    await user.click(screen.getByRole('button', { name: '이 좌석 입장 처리' }));
    await waitFor(async () => expect(await listPendingScanAttempts({ syncState: 'pending' })).toHaveLength(1));

    // A screenshot copy of the same QR: the cached verify result is still "processable".
    await user.click(screen.getByRole('button', { name: '다음 티켓' }));
    await user.type(screen.getByLabelText('QR 링크 또는 내용'), RAW_TICKET_TOKEN);
    await user.click(screen.getByRole('button', { name: '티켓 확인' }));

    expect(await screen.findByText('이 기기에서 이미 입장 동기화 대기 중인 QR입니다')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '이 좌석 입장 처리' })).not.toBeInTheDocument();
    expect(await listPendingScanAttempts({ syncState: 'pending' })).toHaveLength(1);
  });

  it('does not consume online while the same QR is still queued on this device', async () => {
    await addPendingScanAttempt(pendingRecord({ token: RAW_TICKET_TOKEN, showtimeId: REQUESTED_SHOWTIME_ID }));
    mocks.offlineSyncMutateAsync.mockRejectedValue(new TypeError('Failed to fetch'));
    renderPage();

    expect(await screen.findByText('이 기기에서 이미 입장 동기화 대기 중인 QR입니다')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '이 좌석 입장 처리' })).not.toBeInTheDocument();
    expect(mocks.consumeMutateAsync).not.toHaveBeenCalled();
  });
});

describe('FieldCheckInPage device-wide pending entries (#117)', () => {
  beforeEach(() => {
    mocks.showtimes = [
      showtimeOption(REQUESTED_SHOWTIME_ID, '현장 검증', '2099-01-01T10:00:00Z'),
      showtimeOption(OTHER_SHOWTIME_ID, '이전 회차', '2099-01-01T05:00:00Z'),
    ];
    mocks.searchParams = new URLSearchParams();
  });

  it('shows unsynced entries of other showtimes and accounts before any showtime is chosen', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    await addPendingScanAttempt(pendingRecord());
    await addPendingScanAttempt(pendingRecord({ deviceAttemptId: 'pending-attempt-2', token: 'second-token' }));
    await addPendingScanAttempt(pendingRecord({ deviceAttemptId: 'other-account', scannerUserId: 'scanner-user-2', token: 'third-token' }));
    const user = userEvent.setup();
    renderPage();

    const banner = await screen.findByRole('region', { name: '이 기기의 미동기화 입장 대기' });
    expect(within(banner).getByText('이 기기에 동기화되지 않은 입장 대기 3건')).toBeInTheDocument();
    expect(within(banner).getByText(/이전 회차 .* · 2건/)).toBeInTheDocument();
    expect(within(banner).getByText(/다른 현장 계정이 이 기기에 저장한 대기 1건/)).toBeInTheDocument();
    expect(within(banner).getByRole('button', { name: '이 계정 대기 전체 2건 동기화' })).toBeDisabled();

    await user.click(within(banner).getByRole('button', { name: '이 회차로 이동' }));
    expect(screen.getByRole('combobox', { name: '검표할 공연·회차' })).toHaveValue(OTHER_SHOWTIME_ID);
    expect(await screen.findByText('보류 스캔')).toBeInTheDocument();
  });

  it('asks before switching away from a showtime with unsynced entries', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    await addPendingScanAttempt(pendingRecord({ showtimeId: REQUESTED_SHOWTIME_ID }));
    mocks.searchParams = new URLSearchParams({ showtimeId: REQUESTED_SHOWTIME_ID });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('보류 스캔');

    await user.selectOptions(screen.getByRole('combobox', { name: '검표할 공연·회차' }), OTHER_SHOWTIME_ID);

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('동기화되지 않은 입장 대기 1건'));
    expect(screen.getByRole('combobox', { name: '검표할 공연·회차' })).toHaveValue(REQUESTED_SHOWTIME_ID);
  });

  it('syncs every showtime of this account when the connection returns, never another account', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    await addPendingScanAttempt(pendingRecord());
    await addPendingScanAttempt(pendingRecord({ deviceAttemptId: 'pending-current', showtimeId: REQUESTED_SHOWTIME_ID, token: 'current-token' }));
    await addPendingScanAttempt(pendingRecord({ deviceAttemptId: 'other-account', scannerUserId: 'scanner-user-2', token: 'third-token' }));
    mocks.offlineSyncMutateAsync.mockImplementation(async ({ attempts }: { attempts: Array<{ deviceAttemptId: string }> }) =>
      attempts.map((attempt) => ({ deviceAttemptId: attempt.deviceAttemptId, state: 'synced', result: 'synced', resultLabel: '입장 처리가 완료되었습니다' })));
    renderPage();
    await screen.findByRole('region', { name: '이 기기의 미동기화 입장 대기' });
    expect(mocks.offlineSyncMutateAsync).not.toHaveBeenCalled();

    act(() => setOnline(true));

    await waitFor(() => expect(mocks.offlineSyncMutateAsync).toHaveBeenCalledTimes(1));
    const sent = mocks.offlineSyncMutateAsync.mock.calls[0]?.[0].attempts as Array<{ deviceAttemptId: string; showtimeId: string; scannerUserId: string }>;
    expect(sent.map((attempt) => attempt.deviceAttemptId).sort()).toEqual(['pending-attempt-1', 'pending-current']);
    expect(sent.every((attempt) => attempt.scannerUserId === SCANNER_USER_ID)).toBe(true);
    await waitFor(async () => expect((await listPendingScanAttempts({ syncState: 'pending' })).map((record) => record.deviceAttemptId))
      .toEqual(['other-account']));
  });

  it('does not sync for an account that has sync but not entry permission, which the server rejects (#111)', async () => {
    mocks.capabilities = ['field.scan.verify', 'field.scan.sync'];
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    await addPendingScanAttempt(pendingRecord());
    renderPage();
    const banner = await screen.findByRole('region', { name: '이 기기의 미동기화 입장 대기' });

    act(() => setOnline(true));

    await waitFor(() => expect(within(banner).getByRole('button', { name: '이 계정 대기 전체 1건 동기화' })).toBeDisabled());
    expect(mocks.offlineSyncMutateAsync).not.toHaveBeenCalled();
    expect(await listPendingScanAttempts({ syncState: 'pending' })).toHaveLength(1);
  });

  it('tells staff another tab is syncing when a manual sync cannot take the device lock', async () => {
    await addPendingScanAttempt(pendingRecord({ showtimeId: REQUESTED_SHOWTIME_ID }));
    mocks.searchParams = new URLSearchParams({ showtimeId: REQUESTED_SHOWTIME_ID });
    // A frozen background tab holds the device sync lock.
    const request = vi.fn(async (_name: string, _options: unknown, callback: (lock: null) => Promise<void>) => callback(null));
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });
    try {
      const user = userEvent.setup();
      renderPage();
      await screen.findByText('보류 스캔');
      // The automatic sync on load skips quietly.
      await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
      expect(screen.queryByText('다른 탭에서 동기화 중입니다. 잠시 뒤 다시 시도하세요.')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: '보류 스캔 동기화' }));

      expect(await screen.findByText('다른 탭에서 동기화 중입니다. 잠시 뒤 다시 시도하세요.')).toBeInTheDocument();
      expect(request).toHaveBeenCalledTimes(2);
      expect(mocks.offlineSyncMutateAsync).not.toHaveBeenCalled();
      expect(await listPendingScanAttempts({ syncState: 'pending' })).toHaveLength(1);
    } finally {
      Reflect.deleteProperty(navigator, 'locks');
    }
  });

  it('counts the current showtime in the account-wide sync button because it syncs those entries too', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    await addPendingScanAttempt(pendingRecord());
    await addPendingScanAttempt(pendingRecord({ deviceAttemptId: 'current-1', showtimeId: REQUESTED_SHOWTIME_ID, token: 'current-token-1' }));
    await addPendingScanAttempt(pendingRecord({ deviceAttemptId: 'current-2', showtimeId: REQUESTED_SHOWTIME_ID, token: 'current-token-2' }));
    mocks.searchParams = new URLSearchParams({ showtimeId: REQUESTED_SHOWTIME_ID });
    renderPage();

    const banner = await screen.findByRole('region', { name: '이 기기의 미동기화 입장 대기' });
    expect(within(banner).getByText('다른 회차·계정의 동기화되지 않은 입장 대기 1건')).toBeInTheDocument();
    // The banner button sends every pending entry of this account, all three of them.
    expect(within(banner).getByRole('button', { name: '이 계정 대기 전체 3건 동기화' })).toBeDisabled();
  });

  it('warns before logging out with unsynced entries and clears the session only on confirmation', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    await addPendingScanAttempt(pendingRecord());
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('region', { name: '이 기기의 미동기화 입장 대기' });

    await user.click(screen.getByRole('button', { name: '검표 종료' }));
    expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining('입장 대기 1건이 아직 서버에 동기화되지 않았습니다'));
    expect(mocks.apiPost).not.toHaveBeenCalled();
    expect(mocks.clearAuth).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '검표 종료' }));
    await waitFor(() => expect(mocks.clearAuth).toHaveBeenCalled());
    expect(mocks.apiPost).toHaveBeenCalledWith('/api/v1/auth/logout', undefined, { showErrorToast: false });
    expect(await listPendingScanAttempts({ syncState: 'pending' })).toHaveLength(1);
  });
});

describe('FieldCheckInPage QR credential URL hygiene (#118)', () => {
  it('moves the ticket into memory and removes it from the address bar', async () => {
    window.history.replaceState(null, '', `/field/check-in?ticket=${RAW_TICKET_TOKEN}&showtimeId=${REQUESTED_SHOWTIME_ID}`);
    renderPage();

    expect(await screen.findByRole('button', { name: '이 좌석 입장 처리' })).toBeEnabled();
    await waitFor(() => expect(window.location.href).not.toContain(RAW_TICKET_TOKEN));
    expect(window.location.search).toBe(`?showtimeId=${REQUESTED_SHOWTIME_ID}`);
    expect(mocks.verifyCalls.at(-1)).toEqual(expect.objectContaining({ token: RAW_TICKET_TOKEN }));
  });

  it('never puts the ticket into the /auth returnTo', async () => {
    mocks.auth = { isInitialized: true, accessToken: null };
    renderPage();

    await waitFor(() => expect(mocks.routerReplace).toHaveBeenCalled());
    const target = mocks.routerReplace.mock.calls[0]?.[0] as string;
    expect(target).toBe(`/auth?returnTo=${encodeURIComponent(`/field/check-in?showtimeId=${REQUESTED_SHOWTIME_ID}`)}`);
    expect(decodeURIComponent(target)).not.toContain(RAW_TICKET_TOKEN);
  });
});
