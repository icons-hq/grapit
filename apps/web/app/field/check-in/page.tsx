'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { hasAdminCapability, parseFieldCheckInToken } from '@grabit/shared';
import { AlertTriangle, ChevronDown, Loader2, LogOut, ScanLine, WifiOff } from 'lucide-react';
import { ScannerCheckIn } from '@/components/field/scanner-check-in';
import {
  canRedeemBenefitsForVerification,
  labelForResult,
  useFieldBenefitRedeem,
  useFieldCheckInConsume,
  useFieldCheckInVerify,
  useFieldShowtimes,
  type FieldShowtimeOption,
  type ScannerBenefitRedemptionResult,
  type ScannerCheckInConsumeResult,
  type ScannerCheckInResult,
  type ScannerOfflineQueueItem,
} from '@/hooks/use-field-operations';
import {
  useFieldOfflineQueue,
  useFieldOnlineStatus,
  type FieldPendingRecordOutcome,
} from '@/hooks/use-field-offline-queue';
import { OfflineSyncStatus } from '@/components/field/offline-sync-status';
import { DevicePendingBanner } from '@/components/field/device-pending-banner';
import { findPendingScanAttemptByToken, type PendingScanAttemptRecord } from '@/lib/field/offline-scan-store';
import {
  clearFieldShowtimeSelection,
  readFieldShowtimeSelection,
  resolveRestorableFieldShowtime,
  saveFieldShowtimeSelection,
} from '@/lib/field/showtime-selection';
import {
  readFieldTicketParam,
  scrubFieldTicketFromLocation,
  searchWithoutFieldTicketParams,
} from '@/lib/field/ticket-url-redaction';
import { formatFieldShowtimeKst } from '@/lib/field/showtime-format';
import { apiClient } from '@/lib/api-client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuthStore } from '@/stores/use-auth-store';

const ALREADY_PENDING_RESULT: ScannerCheckInConsumeResult = {
  result: 'offline-pending',
  resultLabel: '이 기기에서 이미 입장 동기화 대기 중인 QR입니다',
  rejectionReason: '같은 QR로 다시 입장 처리하지 마세요. 연결이 복구되면 보류 스캔을 동기화해 서버 판정을 확인하세요.',
};

/**
 * One scan of one QR. The page owns its device attempt id so that the verify,
 * consume and offline-sync receipts of a scan share one id however often the
 * scan screen re-renders or remounts. A new id is issued only for a new scan:
 * a QR read again (even the same QR), another showtime or another account.
 */
interface ScanAttempt {
  token: string;
  attemptId: string;
  /** Showtime and account the attempt was issued for. */
  scope: string;
}

function newScanAttempt(token: string, scope: string): ScanAttempt {
  return { token, attemptId: createDeviceAttemptId(), scope };
}

export default function FieldCheckInPage() {
  const searchParams = useSearchParams();
  const { isInitialized, accessToken, user, clearAuth } = useAuthStore();
  const router = useRouter();
  const queryClient = useQueryClient();
  // The QR credential moves from the URL into memory and is scrubbed from the
  // address bar, so history, the /auth returnTo and telemetry never keep it.
  const routeToken = readFieldTicketParam(searchParams);
  const [showtimeId, setShowtimeId] = useState(searchParams.get('showtimeId') ?? '');
  const scanScope = `${showtimeId}:${user?.id ?? ''}`;
  const [scan, setScan] = useState<ScanAttempt | null>(() => (routeToken ? newScanAttempt(routeToken, scanScope) : null));
  const [adoptedRouteToken, setAdoptedRouteToken] = useState(routeToken);
  if (routeToken !== adoptedRouteToken) {
    // The scrubbed URL clears the adopted token, so the same QR link opened
    // again in this tab is a new scan.
    setAdoptedRouteToken(routeToken);
    if (routeToken) setScan(newScanAttempt(routeToken, scanScope));
  } else if (scan && scan.scope !== scanScope) {
    // The server binds an attempt's receipt to its showtime and scanner, so a
    // new showtime or account starts a new attempt for the same QR.
    setScan(newScanAttempt(scan.token, scanScope));
  }
  // Benefit attempt ids per scan attempt, so a retried redemption reuses its
  // first id even if the scan screen remounts.
  const benefitAttempts = useRef(new Map<string, Map<string, string>>());
  const benefitAttemptIdFor = useCallback((scanAttemptId: string, benefitEntitlementId: string) => {
    let attempts = benefitAttempts.current.get(scanAttemptId);
    if (!attempts) {
      benefitAttempts.current.clear();
      attempts = new Map();
      benefitAttempts.current.set(scanAttemptId, attempts);
    }
    let attemptId = attempts.get(benefitEntitlementId);
    if (!attemptId) {
      attemptId = createDeviceAttemptId();
      attempts.set(benefitEntitlementId, attemptId);
    }
    return attemptId;
  }, []);
  const [input, setInput] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [restoredShowtimeId, setRestoredShowtimeId] = useState<string | null>(null);
  const [restoreCheckedFor, setRestoreCheckedFor] = useState<string | null>(null);
  const canVerify = hasAdminCapability(user, 'field.scan.verify');
  // Syncing confirms entry, so the server requires the consume permission too.
  const canSync = hasAdminCapability(user, 'field.scan.sync') && hasAdminCapability(user, 'field.scan.consume');
  const isOnline = useFieldOnlineStatus();
  const queue = useFieldOfflineQueue(canVerify ? user?.id : undefined, showtimeId, { autoSync: canVerify && canSync });
  const showtimes = useFieldShowtimes(isInitialized && Boolean(accessToken) && canVerify);
  const selected = showtimes.data?.find((showtime) => showtime.id === showtimeId);
  const token = scan?.token ?? '';
  const scanQueueItem = scan ? queue.items.find((item) => item.deviceAttemptId === scan.attemptId) ?? null : null;
  useEffect(() => {
    if (!routeToken) return;
    // On first hydration the App Router installs its history.replaceState bridge
    // in an ancestor effect that runs after this one. Defer so the bridge sees
    // the call and useSearchParams follows the scrubbed URL.
    const timer = window.setTimeout(scrubFieldTicketFromLocation, 0);
    return () => window.clearTimeout(timer);
  }, [routeToken]);
  // The login route back to this screen, never with the QR credential.
  const authRoute = `/auth?returnTo=${encodeURIComponent(`/field/check-in${searchWithoutFieldTicketParams(searchParams.toString())}`)}`;
  useEffect(() => {
    if (!isInitialized || accessToken) return;
    router.replace(authRoute);
  }, [accessToken, authRoute, isInitialized, router]);
  useEffect(() => {
    // A phone camera opens every QR link in a new tab. Restore the scanner's
    // recent choice there instead of asking for the showtime on every scan.
    const userId = user?.id;
    if (!userId || !showtimes.data || restoreCheckedFor === userId) return;
    setRestoreCheckedFor(userId);
    if (showtimeId) {
      // A showtime given in the link is this scanner's choice once the server lists it.
      const listed = showtimes.data.find((showtime) => showtime.id === showtimeId);
      if (listed) saveFieldShowtimeSelection(userId, listed);
      return;
    }
    const selection = readFieldShowtimeSelection(userId);
    const restorable = resolveRestorableFieldShowtime(selection, showtimes.data);
    if (restorable) {
      setShowtimeId(restorable.id);
      setRestoredShowtimeId(restorable.id);
      // Each tab that keeps scanning with the choice renews its 12 hour window.
      saveFieldShowtimeSelection(userId, restorable);
    } else if (selection) {
      clearFieldShowtimeSelection(userId);
    }
  }, [restoreCheckedFor, showtimeId, showtimes.data, user?.id]);

  const describeShowtime = (id: string) => showtimes.data?.find((showtime) => showtime.id === id) ?? null;
  const changeShowtime = (nextShowtimeId: string) => {
    if (nextShowtimeId === showtimeId) return;
    const pendingHere = queue.items.filter((item) => item.state === 'pending').length;
    if (pendingHere > 0 && !window.confirm(
      `현재 회차에 서버에 동기화되지 않은 입장 대기 ${pendingHere}건이 있습니다. 회차를 바꿔도 기록은 이 기기에 남고 상단 경고에 계속 표시됩니다. 회차를 바꿀까요?`,
    )) return;
    setShowtimeId(nextShowtimeId);
    setRestoredShowtimeId(null);
    if (!user?.id) return;
    const next = describeShowtime(nextShowtimeId);
    if (next) saveFieldShowtimeSelection(user.id, next);
    else clearFieldShowtimeSelection(user.id);
  };
  const ownPendingCount = queue.devicePending
    .filter((group) => group.scannerUserId === user?.id)
    .reduce((sum, group) => sum + group.count, 0);
  /** Ends this device's session; false when staff kept it for unsynced entries. */
  const endSession = async (): Promise<boolean> => {
    if (ownPendingCount > 0 && !window.confirm(
      `이 계정으로 저장한 입장 대기 ${ownPendingCount}건이 아직 서버에 동기화되지 않았습니다. 로그아웃하면 같은 계정으로 다시 로그인해야 동기화할 수 있습니다. 그래도 로그아웃할까요?`,
    )) return false;
    try { await apiClient.post('/api/v1/auth/logout', undefined, { showErrorToast: false }); } catch { /* Clear this device's session even when offline. */ }
    // Cached verify results are keyed by raw QR tokens; drop them with the session.
    queryClient.clear();
    clearAuth();
    return true;
  };
  const handleLogout = async () => { await endSession(); };
  // An account without scanner access signs out here and goes straight to the
  // login form. No extra /auth/refresh: AuthInitializer owns session restore.
  const handleSwitchAccount = async () => {
    if (await endSession()) router.replace(authRoute);
  };

  if (!isInitialized || !accessToken) return <ScannerLoading variant="page" message="검표 세션을 확인하고 있습니다" />;
  if (!canVerify) {
    return <ScannerCheckIn user={user} hasTicket={Boolean(token)} onSwitchAccount={() => { void handleSwitchAccount(); }}
      onProcessEntry={() => undefined} onSyncOffline={() => undefined} />;
  }
  const scanRule = 'QR 한 장은 해당 좌석 한 명의 입장만 처리합니다. 특전은 품목별로 따로 지급합니다.';
  const inputGuide = '휴대폰 카메라로 QR 링크를 열면 새 탭에서도 이 계정이 최근 12시간 안에 고른 오늘 회차를 다시 불러옵니다. 카메라 이용이 어려우면 위 입력란을 사용하세요.';
  // The one main landmark of the scanner; scan results and notices render inside it.
  return <main className="mx-auto min-h-dvh max-w-xl bg-[#F5F5F7]">
    <header className="space-y-4 border-b bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-sm font-semibold text-primary">Grabit · 현장</p><h1 className="mt-1 text-2xl font-semibold">좌석별 검표</h1>
          {!selected && <p className="mt-2 text-sm text-gray-600">{scanRule}</p>}</div>
        <Button type="button" variant="outline" size="sm" className="min-h-11 shrink-0" onClick={() => { void handleLogout(); }}>
          <LogOut className="h-4 w-4" />검표 종료
        </Button>
      </div>
      <label className="block space-y-2 text-sm font-semibold">검표할 공연·회차 · 한국 시간
        <select aria-label="검표할 공연·회차" className="min-h-11 w-full rounded-lg border bg-white px-3" value={showtimeId} onChange={(event) => changeShowtime(event.target.value)}>
          <option value="">공연·회차를 선택하세요</option>{showtimes.data?.map((showtime) => <option key={showtime.id} value={showtime.id}>
            {showtime.title} · {formatFieldShowtimeKst(showtime.dateTime)}
          </option>)}</select>
      </label>
      {showtimes.isError && <p role="alert" className="text-sm text-red-700">공연·회차를 불러오지 못했습니다. 연결을 확인한 뒤 다시 시도해주세요.</p>}
      {selected && <SelectedShowtimeSummary showtime={selected} restored={restoredShowtimeId === selected.id} />}
      <form className="space-y-2" onSubmit={(event) => {
        event.preventDefault(); setInputError(null);
        try {
          const value = input.trim();
          const nextToken = value.startsWith('http') ? parseFieldCheckInToken({ qrUrl: value }) : value;
          if (!nextToken) throw new Error('empty');
          setScan(newScanAttempt(nextToken, scanScope)); setInput('');
        } catch { setInputError('QR 링크 또는 QR 내용을 확인해주세요.'); }
      }}>
        <label className="block space-y-2 text-sm font-semibold">QR 링크 또는 내용
          <Input aria-label="QR 링크 또는 내용" type="password" autoComplete="off" value={input} onChange={(event) => setInput(event.target.value)} placeholder="카메라로 읽은 QR 내용을 붙여넣으세요" />
        </label>
        {!selected && <p className="text-xs text-gray-500">{inputGuide}</p>}
        {inputError && <p role="alert" className="text-sm text-red-700">{inputError}</p>}
        <div className="flex gap-2"><Button type="submit" disabled={!selected || !input.trim()} className="min-h-11 flex-1">티켓 확인</Button>
          {token && <Button type="button" variant="outline" className="min-h-11" onClick={() => { setScan(null); setInput(''); }}>다음 티켓</Button>}</div>
      </form>
      {/* Once a showtime is chosen the guide folds away, so a scan result fits the first screen. */}
      {selected && <details className="group -mt-2 text-sm text-gray-600">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 font-semibold text-gray-700 [&::-webkit-details-marker]:hidden">
          검표 안내 보기<ChevronDown aria-hidden="true" className="h-4 w-4 transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-1 pb-1"><p>{scanRule}</p><p>{inputGuide}</p></div>
      </details>}
    </header>
    {queue.error && <p role="alert" className="p-4 text-sm text-red-700">{queue.error}</p>}
    <div className="p-4 pb-0 empty:hidden">
      <DevicePendingBanner groups={queue.devicePending} currentUserId={user?.id} currentShowtimeId={selected?.id ?? ''}
        ownPendingCount={ownPendingCount} canSync={isOnline && canSync} isSyncing={queue.isSyncing} describeShowtime={describeShowtime}
        onSelectShowtime={changeShowtime} onSync={() => { void queue.sync(); }} />
    </div>
    {queue.items.length > 0 && <div className="p-4 pb-0"><OfflineSyncStatus queue={queue.items} isSyncing={queue.isSyncing}
      canSync={isOnline && canSync} onSyncOffline={() => { void queue.sync(); }} /></div>}
    {scan && selected ? <ActiveScan
      // Queue changes (auto sync, another tab's sync) arrive as props. A remount
      // would drop this scan's entry result card.
      key={`${scan.token}:${selected.id}:${user?.id}:${scan.attemptId}`}
      ticketToken={scan.token} deviceAttemptId={scan.attemptId} showtimeId={selected.id} eventId={selected.eventId}
      recordPending={queue.record} queueItem={scanQueueItem} queueRevision={queue.revision}
      benefitAttemptIdFor={(benefitEntitlementId) => benefitAttemptIdFor(scan.attemptId, benefitEntitlementId)} />
      : <p role="status" className="p-5 text-sm text-gray-600">{scanStatusMessage({ hasToken: Boolean(token), hasSelection: Boolean(selected), loadingShowtimes: Boolean(showtimes.isLoading) })}</p>}
  </main>;
}

function scanStatusMessage({ hasToken, hasSelection, loadingShowtimes }: { hasToken: boolean; hasSelection: boolean; loadingShowtimes: boolean }): string {
  if (!hasSelection && loadingShowtimes) return '검표할 공연·회차를 불러오고 있습니다.';
  if (!hasSelection) {
    return hasToken
      ? 'QR을 읽었습니다. 검표할 공연과 회차를 선택하면 바로 확인합니다.'
      : '먼저 현장에서 검표할 공연과 회차를 선택해주세요.';
  }
  return 'QR을 확인한 뒤 좌석과 상태를 보고 입장 또는 특전 지급을 선택하세요.';
}

function SelectedShowtimeSummary({ showtime, restored }: { showtime: FieldShowtimeOption; restored: boolean }) {
  return (
    <section aria-label="검표 중인 회차" className="rounded-lg border border-[#D9CCF8] bg-[#F3EFFF] p-3">
      <p className="text-xs font-semibold text-[#6C3CE0]">검표 중인 회차</p>
      <p className="mt-1 break-words text-xl font-semibold leading-[1.3] text-gray-900">{showtime.title}</p>
      <p className="mt-1 text-base font-semibold text-gray-800">
        {formatFieldShowtimeKst(showtime.dateTime)}{showtime.venueName ? ` · ${showtime.venueName}` : ''}
      </p>
      {restored && (
        <p role="status" className="mt-2 text-sm font-semibold text-[#5730B8]">
          이전에 선택한 회차를 불러왔습니다. 공연명과 시각이 맞는지 확인하세요.
        </p>
      )}
    </section>
  );
}

type LocalPendingState = 'checking' | 'none' | 'pending';

function ActiveScan({
  ticketToken, deviceAttemptId, showtimeId, eventId, recordPending, queueItem, queueRevision, benefitAttemptIdFor,
}: {
  ticketToken: string; deviceAttemptId: string; showtimeId: string; eventId: string;
  recordPending: (attempt: PendingScanAttemptRecord) => Promise<FieldPendingRecordOutcome>;
  /** This scan's own record in the device queue, once it was saved for sync. */
  queueItem: ScannerOfflineQueueItem | null;
  queueRevision: number;
  benefitAttemptIdFor: (benefitEntitlementId: string) => string;
}) {
  const { isInitialized, accessToken, user } = useAuthStore();
  const isOnline = useFieldOnlineStatus();
  const [actionError, setActionError] = useState<string | null>(null);
  const consumingRef = useRef(false);
  const [offlineConsumeResult, setOfflineConsumeResult] =
    useState<ScannerCheckInConsumeResult | null>(null);
  const [localPending, setLocalPending] = useState<LocalPendingState>('checking');
  const localPendingRef = useRef<LocalPendingState>('checking');
  const [recheckingVerify, setRecheckingVerify] = useState(false);
  const [benefitRedemptionResults, setBenefitRedemptionResults] = useState<
    Record<string, ScannerBenefitRedemptionResult>
  >({});
  const [redeemingBenefitId, setRedeemingBenefitId] = useState<string | null>(null);
  const regionRef = useRef<HTMLDivElement>(null);
  const scrolledForAttempt = useRef<string | null>(null);
  const hasScannerAccess = hasAdminCapability(user, 'field.scan.verify');
  const canRedeemFieldBenefit = hasAdminCapability(user, 'field.benefits.redeem');

  const verifyQuery = useFieldCheckInVerify({
    token: ticketToken,
    showtimeId,
    // Same attempt as consume: the server records one rejected scan per attempt.
    deviceAttemptId,
    enabled: isInitialized && Boolean(accessToken) && hasScannerAccess && ticketToken.length > 0,
  });
  const consumeMutation = useFieldCheckInConsume();
  const benefitRedeemMutation = useFieldBenefitRedeem();
  const scannerShowtimeId = showtimeId;
  // Stable for the query observer's lifetime.
  const refetchVerify = verifyQuery.refetch;

  const applyLocalPending = useCallback((next: LocalPendingState) => {
    const previous = localPendingRef.current;
    localPendingRef.current = next;
    setLocalPending(next);
    if (previous !== 'pending' || next !== 'none') return;
    // The other unsynced entry of this QR left the queue, normally because a
    // sync admitted it. The cached "processable" result predates that, so ask
    // the server again before offering entry. Same attempt id, so the server
    // still records at most one rejected scan for this attempt.
    setRecheckingVerify(true);
    void refetchVerify().finally(() => setRecheckingVerify(false));
  }, [refetchVerify]);

  useEffect(() => {
    // A cached "processable" verify result must not admit a second holder of a
    // QR that this device already queued while offline. Re-checked whenever the
    // device queue changes, e.g. when that other record is synced.
    let cancelled = false;
    findPendingScanAttemptByToken(ticketToken)
      .then((existing) => {
        if (!cancelled) applyLocalPending(existing && existing.deviceAttemptId !== deviceAttemptId ? 'pending' : 'none');
      })
      .catch(() => { if (!cancelled) applyLocalPending('none'); });
    return () => { cancelled = true; };
  }, [applyLocalPending, ticketToken, deviceAttemptId, queueRevision]);

  const sessionReady = isInitialized && Boolean(accessToken);
  // TanStack pauses the verify request while offline (fetchStatus 'paused'),
  // which would otherwise leave "확인하고 있습니다" on screen forever.
  const offlineUnverified = !verifyQuery.data
    && (verifyQuery.fetchStatus === 'paused' || !isOnline
      || (verifyQuery.isError && isNetworkFailure(verifyQuery.error)));
  const verifying = (verifyQuery.isLoading && !verifyQuery.data) || localPending === 'checking' || recheckingVerify;
  // The first settled view of this scan: its result, an offline notice or an error.
  const settled = sessionReady && ticketToken.length > 0 && hasScannerAccess && (offlineUnverified || !verifying);

  useEffect(() => {
    // The header, device banner and held scans sit above the result. A camera
    // tab opens at the top, so bring this scan's result into view once.
    if (!settled || scrolledForAttempt.current === deviceAttemptId) return;
    scrolledForAttempt.current = deviceAttemptId;
    regionRef.current?.scrollIntoView({ block: 'start' });
  }, [settled, deviceAttemptId]);

  const renderContent = () => {
    if (!sessionReady) {
      return <ScannerLoading variant="inline" message="검표 세션을 확인하고 있습니다" />;
    }

    if (!ticketToken) {
      return (
        <ScannerNotice
          variant="inline"
          tone="error"
          title="확인할 QR 티켓이 없습니다"
          description="QR 티켓을 다시 스캔하거나 현장 운영자에게 문의하세요."
        />
      );
    }

    if (!hasScannerAccess) {
      return (
        <ScannerCheckIn
          user={user}
          onProcessEntry={() => undefined}
          onSyncOffline={() => undefined}
        />
      );
    }

    const retryVerify = () => { void refetchVerify(); };

    if (offlineUnverified) {
      return (
        <ScannerNotice
          variant="inline"
          tone="offline"
          title="연결이 끊겨 이 QR을 확인할 수 없습니다"
          description="연결이 끊긴 뒤 새로 스캔한 QR은 확인·입장 처리할 수 없고 동기화 대기에도 저장되지 않습니다. 현장 책임자의 예외 원장에 예매번호·좌석·시각·담당자를 기록하고, 연결이 복구되면 이 QR을 다시 확인하세요."
          onRetry={retryVerify}
        />
      );
    }

    if (verifying) {
      return (
        <ScannerLoading
          variant="inline"
          message={recheckingVerify ? 'QR 티켓 상태를 다시 확인하고 있습니다' : 'QR 티켓을 확인하고 있습니다'}
        />
      );
    }

    if (verifyQuery.isError && !verifyQuery.data) {
      return (
        <ScannerNotice
          variant="inline"
          tone="error"
          title="QR 티켓을 확인할 수 없습니다"
          description="네트워크 상태를 확인한 뒤 다시 스캔하세요."
          onRetry={retryVerify}
        />
      );
    }

    const savePendingEntry = async () => {
      if (!user?.id) return;
      const outcome = await recordPending(
        createPendingAttempt({
          deviceAttemptId,
          scannerUserId: user.id,
          eventId,
          showtimeId: scannerShowtimeId,
          token: ticketToken,
          attemptedAt: new Date().toISOString(),
          seatLabel: verifyQuery.data?.seats.join(', '),
        }),
      );
      if (outcome === 'duplicate') {
        applyLocalPending('pending');
        return;
      }
      setOfflineConsumeResult({
        result: 'offline-pending',
        resultLabel:
          '입장 동기화 대기',
      });
    };

    return (
      <ScannerCheckIn
        user={user}
        verification={verifyQuery.data}
        consumeResult={
          queueItemConsumeResult(queueItem)
          ?? offlineConsumeResult
          ?? (localPending === 'pending' ? ALREADY_PENDING_RESULT : null)
          ?? consumeMutation.data
        }
        isOnline={isOnline}
        actionError={actionError}
        benefitRedemptionResults={benefitRedemptionResults}
        isConsuming={consumeMutation.isPending}
        redeemingBenefitId={redeemingBenefitId}
        isSyncingOffline={false}
        onProcessEntry={() => {
          void (async () => {
            if (
              !verifyQuery.data?.processable || !hasAdminCapability(user, 'field.scan.consume')
              || consumingRef.current || localPending !== 'none'
            ) return;
            consumingRef.current = true; setActionError(null);
            try {
            // Another tab may have queued the same QR since this screen opened.
            const queued = await findPendingScanAttemptByToken(ticketToken).catch(() => null);
            if (queued) {
              if (queued.deviceAttemptId !== deviceAttemptId) applyLocalPending('pending');
              return;
            }

            if (isBrowserOffline() && accessToken && user?.id) {
              await savePendingEntry();
              return;
            }

            try {
              setOfflineConsumeResult(null);
              await consumeMutation.mutateAsync({
                token: ticketToken,
                showtimeId: scannerShowtimeId,
                deviceAttemptId,
                confirmed: true,
              });
            } catch (error) {
              if (!isNetworkFailure(error) || !accessToken || !user?.id) {
                setActionError('입장 결과를 확인하지 못했습니다. 티켓 상태를 다시 확인한 뒤 재시도해주세요.'); return;
              }

              await savePendingEntry();
            }
            } catch { setActionError('대기 기록을 저장하지 못했습니다. 입장이 확정되지 않았으니 현장 책임자에게 확인해주세요.'); }
            finally { consumingRef.current = false; }
          })();
        }}
        onRedeemBenefit={
          canRedeemFieldBenefit
            ? (benefitEntitlementId) => {
                void (async () => {
                  if (
                    !isOnline || !canRedeemBenefitsForVerification(verifyQuery.data)
                    || redeemingBenefitId
                  ) {
                    return;
                  }

                  setRedeemingBenefitId(benefitEntitlementId); setActionError(null);
                  try {
                    const result = await benefitRedeemMutation.mutateAsync({
                      token: ticketToken,
                      showtimeId: scannerShowtimeId,
                      benefitEntitlementId,
                      // A retry repeats the same request, so the server returns its first result.
                      deviceAttemptId: benefitAttemptIdFor(benefitEntitlementId),
                      confirmed: true,
                    });
                    setBenefitRedemptionResults((current) => ({
                      ...current,
                      [benefitEntitlementId]: result,
                    }));
                  } catch (error) {
                    setActionError(benefitRedeemErrorMessage(error));
                  } finally {
                    setRedeemingBenefitId(null);
                  }
                })();
              }
            : undefined
        }
        onSyncOffline={() => undefined}
      />
    );
  };

  return <div ref={regionRef} data-testid="field-scan-result" className="scroll-mt-2">{renderContent()}</div>;
}

type ScannerViewVariant = 'page' | 'inline';

/**
 * `page` fills the screen before the scanner header exists (session check).
 * `inline` is a card in the scan area below the header, without a second
 * `main` landmark or a full-height box that pushes it out of view.
 */
function ScannerViewFrame({ variant, label, children }: { variant: ScannerViewVariant; label: string; children: ReactNode }) {
  if (variant === 'page') {
    return <main className="mx-auto flex min-h-dvh w-full max-w-xl items-center bg-[#F5F5F7] p-4">{children}</main>;
  }
  return <section aria-label={label} className="p-4">{children}</section>;
}

function ScannerLoading({ message, variant }: { message: string; variant: ScannerViewVariant }) {
  return (
    <ScannerViewFrame variant={variant} label={message}>
      <Card className="w-full border-gray-200 bg-white shadow-sm">
        <CardContent className="flex items-center gap-3 p-5">
          <Loader2 className="h-5 w-5 animate-spin text-[#6C3CE0]" />
          <p className="text-base font-semibold text-gray-800">{message}</p>
        </CardContent>
      </Card>
    </ScannerViewFrame>
  );
}

function ScannerNotice({
  variant,
  tone,
  title,
  description,
  onRetry,
}: {
  variant: ScannerViewVariant;
  tone: 'error' | 'neutral' | 'offline';
  title: string;
  description: string;
  onRetry?: () => void;
}) {
  const iconClass = tone === 'neutral' ? 'text-[#6C3CE0]' : tone === 'offline' ? 'text-[#8B6306]' : 'text-[#C62828]';
  const Icon = tone === 'neutral' ? ScanLine : tone === 'offline' ? WifiOff : AlertTriangle;
  const Heading = variant === 'page' ? 'h1' : 'h2';

  return (
    <ScannerViewFrame variant={variant} label={title}>
      <Card className="w-full border-gray-200 bg-white shadow-sm">
        <CardContent className="space-y-4 p-5">
          <div role={tone === 'neutral' ? undefined : 'alert'} className="flex items-start gap-3">
            <Icon className={`mt-0.5 h-6 w-6 shrink-0 ${iconClass}`} />
            <div>
              <Heading className="text-heading font-semibold text-gray-900">{title}</Heading>
              <p className="mt-2 text-base leading-[1.5] text-gray-700">
                {description}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full"
            onClick={onRetry ?? (() => window.location.reload())}
          >
            다시 확인
          </Button>
        </CardContent>
      </Card>
    </ScannerViewFrame>
  );
}

const SCANNER_RESULTS: readonly ScannerCheckInResult[] = [
  'processable', 'processed', 'duplicate', 'tampered', 'refunded', 'expired', 'wrong-showtime',
  'offline-pending', 'synced', 'rejected',
];
const NON_REJECTION_RESULTS: readonly ScannerCheckInResult[] = ['processable', 'processed', 'synced', 'offline-pending'];

/** What the scan screen shows once this scan's own entry sits in the device queue. */
function queueItemConsumeResult(item: ScannerOfflineQueueItem | null): ScannerCheckInConsumeResult | null {
  if (!item) return null;
  if (item.state === 'pending') return { result: 'offline-pending', resultLabel: '입장 동기화 대기' };
  if (item.state === 'synced') return { result: 'synced', resultLabel: item.resultLabel ?? labelForResult('synced') };
  const known = SCANNER_RESULTS.find((result) => result === item.result);
  const result: ScannerCheckInResult = known && !NON_REJECTION_RESULTS.includes(known) ? known : 'rejected';
  const resultLabel = item.resultLabel ?? labelForResult(result);
  return {
    result,
    resultLabel,
    rejectionReason: item.rejectionReason && item.rejectionReason !== resultLabel ? item.rejectionReason : null,
  };
}

function benefitRedeemErrorMessage(error: unknown): string {
  // 409: the server could not settle this request now (e.g. a payment held the
  // showtime) and says how to retry it. The attempt id is kept for that retry.
  if (error instanceof Error && (error as { statusCode?: unknown }).statusCode === 409 && error.message.trim()) {
    return error.message;
  }
  return '특전 지급 결과를 확인하지 못했습니다. 실물을 다시 지급하지 말고 같은 요청으로 확인해주세요.';
}

function createDeviceAttemptId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `scanner-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createPendingAttempt({
  deviceAttemptId,
  scannerUserId,
  eventId,
  showtimeId,
  token,
  attemptedAt,
  seatLabel,
}: {
  deviceAttemptId: string;
  scannerUserId: string;
  eventId: string;
  showtimeId: string;
  token: string;
  attemptedAt: string;
  seatLabel?: string;
}): PendingScanAttemptRecord {
  return {
    deviceAttemptId,
    scannerUserId,
    eventId,
    showtimeId,
    token,
    redactedTokenRef: redactedTokenRef(token),
    attemptedAt,
    // Shown on the held scan row so staff can tell which seat is waiting.
    ...(seatLabel ? { seatLabel } : {}),
    syncState: 'pending',
  };
}

function redactedTokenRef(token: string): string {
  const trimmed = token.trim();
  if (trimmed.length <= 12) {
    return 'tok_[redacted]';
  }
  return `tok_${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
}

function isNetworkFailure(error: unknown): boolean {
  if (isBrowserOffline()) {
    return true;
  }
  if (error instanceof TypeError) {
    return true;
  }
  // An HTTP response (ApiClientError carries statusCode) proves the server was reached.
  if (error && typeof error === 'object' && typeof (error as { statusCode?: unknown }).statusCode === 'number') {
    return false;
  }
  if (error instanceof Error) {
    return /network|fetch|failed to fetch|load failed/i.test(error.message);
  }
  return false;
}

function isBrowserOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}
