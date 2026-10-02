'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { hasAdminCapability, parseFieldCheckInToken } from '@grabit/shared';
import { AlertTriangle, Loader2, LogOut, ScanLine, WifiOff } from 'lucide-react';
import { ScannerCheckIn } from '@/components/field/scanner-check-in';
import {
  canRedeemBenefitsForVerification,
  useFieldBenefitRedeem,
  useFieldCheckInConsume,
  useFieldCheckInVerify,
  useFieldShowtimes,
  type FieldShowtimeOption,
  type ScannerBenefitRedemptionResult,
  type ScannerCheckInConsumeResult,
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
import { formatAdminKstDateTime } from '@/lib/admin-datetime';
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

export default function FieldCheckInPage() {
  const searchParams = useSearchParams();
  const { isInitialized, accessToken, user, clearAuth } = useAuthStore();
  const router = useRouter();
  const queryClient = useQueryClient();
  // The QR credential moves from the URL into memory and is scrubbed from the
  // address bar, so history, the /auth returnTo and telemetry never keep it.
  const routeToken = readFieldTicketParam(searchParams);
  const [scanToken, setScanToken] = useState(routeToken);
  const [adoptedRouteToken, setAdoptedRouteToken] = useState(routeToken);
  if (routeToken && routeToken !== adoptedRouteToken) {
    setAdoptedRouteToken(routeToken);
    setScanToken(routeToken);
  }
  const [input, setInput] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [showtimeId, setShowtimeId] = useState(searchParams.get('showtimeId') ?? '');
  const [restoredShowtimeId, setRestoredShowtimeId] = useState<string | null>(null);
  const [restoreCheckedFor, setRestoreCheckedFor] = useState<string | null>(null);
  const canVerify = hasAdminCapability(user, 'field.scan.verify');
  const canSync = hasAdminCapability(user, 'field.scan.sync');
  const isOnline = useFieldOnlineStatus();
  const queue = useFieldOfflineQueue(canVerify ? user?.id : undefined, showtimeId, { autoSync: canVerify && canSync });
  const showtimes = useFieldShowtimes(isInitialized && Boolean(accessToken) && canVerify);
  const selected = showtimes.data?.find((showtime) => showtime.id === showtimeId);
  const token = scanToken;
  useEffect(() => {
    if (!routeToken) return;
    // On first hydration the App Router installs its history.replaceState bridge
    // in an ancestor effect that runs after this one. Defer so the bridge sees
    // the call and useSearchParams follows the scrubbed URL.
    const timer = window.setTimeout(scrubFieldTicketFromLocation, 0);
    return () => window.clearTimeout(timer);
  }, [routeToken]);
  useEffect(() => {
    if (!isInitialized || accessToken) return;
    const returnTo = `/field/check-in${searchWithoutFieldTicketParams(searchParams.toString())}`;
    router.replace(`/auth?returnTo=${encodeURIComponent(returnTo)}`);
  }, [accessToken, isInitialized, router, searchParams]);
  useEffect(() => {
    // A phone camera opens every QR link in a new tab. Restore the scanner's
    // recent choice there instead of asking for the showtime on every scan.
    const userId = user?.id;
    if (!userId || !showtimes.data || restoreCheckedFor === userId) return;
    setRestoreCheckedFor(userId);
    if (showtimeId) return;
    const selection = readFieldShowtimeSelection(userId);
    const restorable = resolveRestorableFieldShowtime(selection, showtimes.data);
    if (restorable) {
      setShowtimeId(restorable.id);
      setRestoredShowtimeId(restorable.id);
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
  const handleLogout = async () => {
    if (ownPendingCount > 0 && !window.confirm(
      `이 계정으로 저장한 입장 대기 ${ownPendingCount}건이 아직 서버에 동기화되지 않았습니다. 로그아웃하면 같은 계정으로 다시 로그인해야 동기화할 수 있습니다. 그래도 로그아웃할까요?`,
    )) return;
    try { await apiClient.post('/api/v1/auth/logout', undefined, { showErrorToast: false }); } catch { /* Clear this device's session even when offline. */ }
    // Cached verify results are keyed by raw QR tokens; drop them with the session.
    queryClient.clear();
    clearAuth();
  };

  if (!isInitialized || !accessToken) return <ScannerLoading message="검표 세션을 확인하고 있습니다" />;
  if (!canVerify) return <ScannerCheckIn user={user} onProcessEntry={() => undefined} onSyncOffline={() => undefined} />;
  return <div className="mx-auto min-h-dvh max-w-xl bg-[#F5F5F7]">
    <header className="space-y-4 border-b bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-sm font-semibold text-primary">Grabit · 현장</p><h1 className="mt-1 text-2xl font-semibold">좌석별 검표</h1>
          <p className="mt-2 text-sm text-gray-600">QR 한 장은 해당 좌석 한 명의 입장만 처리합니다. 특전은 품목별로 따로 지급합니다.</p></div>
        <Button type="button" variant="outline" size="sm" className="min-h-11 shrink-0" onClick={() => { void handleLogout(); }}>
          <LogOut className="h-4 w-4" />검표 종료
        </Button>
      </div>
      <label className="block space-y-2 text-sm font-semibold">검표할 공연·회차 · 한국 시간
        <select aria-label="검표할 공연·회차" className="min-h-11 w-full rounded-lg border bg-white px-3" value={showtimeId} onChange={(event) => changeShowtime(event.target.value)}>
          <option value="">공연·회차를 선택하세요</option>{showtimes.data?.map((showtime) => <option key={showtime.id} value={showtime.id}>
            {showtime.title} · {formatShowtimeKst(showtime.dateTime)} KST
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
          setScanToken(nextToken); setInput('');
        } catch { setInputError('QR 링크 또는 QR 내용을 확인해주세요.'); }
      }}>
        <label className="block space-y-2 text-sm font-semibold">QR 링크 또는 내용
          <Input aria-label="QR 링크 또는 내용" type="password" autoComplete="off" value={input} onChange={(event) => setInput(event.target.value)} placeholder="카메라로 읽은 QR 내용을 붙여넣으세요" />
        </label>
        <p className="text-xs text-gray-500">휴대폰 카메라로 QR 링크를 열면 새 탭에서도 이 계정이 최근 12시간 안에 고른 오늘 회차를 다시 불러옵니다. 카메라 이용이 어려우면 위 입력란을 사용하세요.</p>
        {inputError && <p role="alert" className="text-sm text-red-700">{inputError}</p>}
        <div className="flex gap-2"><Button type="submit" disabled={!selected || !input.trim()} className="min-h-11 flex-1">티켓 확인</Button>
          {token && <Button type="button" variant="outline" className="min-h-11" onClick={() => { setScanToken(''); setInput(''); }}>다음 티켓</Button>}</div>
      </form>
    </header>
    {queue.error && <p role="alert" className="p-4 text-sm text-red-700">{queue.error}</p>}
    <div className="p-4 pb-0 empty:hidden">
      <DevicePendingBanner groups={queue.devicePending} currentUserId={user?.id} currentShowtimeId={selected?.id ?? ''}
        canSync={isOnline && canSync} isSyncing={queue.isSyncing} describeShowtime={describeShowtime}
        onSelectShowtime={changeShowtime} onSync={() => { void queue.sync(); }} />
    </div>
    {queue.items.length > 0 && <div className="p-4 pb-0"><OfflineSyncStatus queue={queue.items} isSyncing={queue.isSyncing}
      canSync={isOnline && canSync} onSyncOffline={() => { void queue.sync(); }} /></div>}
    {token && selected ? <ActiveScan key={`${token}:${selected.id}:${user?.id}:${queue.items.filter((item) => item.state !== 'pending').map((item) => `${item.deviceAttemptId}:${item.state}`).join(',')}`} ticketToken={token} showtimeId={selected.id} eventId={selected.eventId} recordPending={queue.record} />
      : <p role="status" className="p-5 text-sm text-gray-600">{scanStatusMessage({ hasToken: Boolean(token), hasSelection: Boolean(selected), loadingShowtimes: Boolean(showtimes.isLoading) })}</p>}
  </div>;
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

function formatShowtimeKst(value: string): string {
  return formatAdminKstDateTime(value).replace('T', ' ');
}

function SelectedShowtimeSummary({ showtime, restored }: { showtime: FieldShowtimeOption; restored: boolean }) {
  return (
    <section aria-label="검표 중인 회차" className="rounded-lg border border-[#D9CCF8] bg-[#F3EFFF] p-3">
      <p className="text-xs font-semibold text-[#6C3CE0]">검표 중인 회차</p>
      <p className="mt-1 break-words text-xl font-semibold leading-[1.3] text-gray-900">{showtime.title}</p>
      <p className="mt-1 text-base font-semibold text-gray-800">
        {formatShowtimeKst(showtime.dateTime)} KST{showtime.venueName ? ` · ${showtime.venueName}` : ''}
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

function ActiveScan({ ticketToken, showtimeId, eventId, recordPending }: {
  ticketToken: string; showtimeId: string; eventId: string;
  recordPending: (attempt: PendingScanAttemptRecord) => Promise<FieldPendingRecordOutcome>;
}) {
  const { isInitialized, accessToken, user } = useAuthStore();
  const isOnline = useFieldOnlineStatus();
  const [actionError, setActionError] = useState<string | null>(null);
  const consumingRef = useRef(false);
  const redemptionAttempts = useRef(new Map<string, string>());
  const [offlineConsumeResult, setOfflineConsumeResult] =
    useState<ScannerCheckInConsumeResult | null>(null);
  const [localPending, setLocalPending] = useState<LocalPendingState>('checking');
  const [benefitRedemptionResults, setBenefitRedemptionResults] = useState<
    Record<string, ScannerBenefitRedemptionResult>
  >({});
  const [redeemingBenefitId, setRedeemingBenefitId] = useState<string | null>(null);
  const hasScannerAccess = hasAdminCapability(user, 'field.scan.verify');
  const canRedeemFieldBenefit = hasAdminCapability(user, 'field.benefits.redeem');
  const deviceAttemptId = useMemo(() => createDeviceAttemptId(), []);

  const verifyQuery = useFieldCheckInVerify({
    token: ticketToken,
    showtimeId,
    enabled: isInitialized && Boolean(accessToken) && hasScannerAccess && ticketToken.length > 0,
  });
  const consumeMutation = useFieldCheckInConsume();
  const benefitRedeemMutation = useFieldBenefitRedeem();
  const scannerShowtimeId = showtimeId;

  useEffect(() => {
    // A cached "processable" verify result must not admit a second holder of a
    // QR that this device already queued while offline.
    let cancelled = false;
    findPendingScanAttemptByToken(ticketToken)
      .then((existing) => { if (!cancelled) setLocalPending(existing ? 'pending' : 'none'); })
      .catch(() => { if (!cancelled) setLocalPending('none'); });
    return () => { cancelled = true; };
  }, [ticketToken]);

  if (!isInitialized || (!accessToken && isInitialized)) {
    return <ScannerLoading message="검표 세션을 확인하고 있습니다" />;
  }

  if (!ticketToken) {
    return (
      <ScannerNotice
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

  const retryVerify = () => { void verifyQuery.refetch(); };

  // TanStack pauses the verify request while offline (fetchStatus 'paused'),
  // which would otherwise leave "확인하고 있습니다" on screen forever.
  if (
    !verifyQuery.data
    && (verifyQuery.fetchStatus === 'paused' || !isOnline
      || (verifyQuery.isError && isNetworkFailure(verifyQuery.error)))
  ) {
    return (
      <ScannerNotice
        tone="offline"
        title="연결이 끊겨 이 QR을 확인할 수 없습니다"
        description="연결이 끊긴 뒤 새로 스캔한 QR은 확인·입장 처리할 수 없고 동기화 대기에도 저장되지 않습니다. 현장 책임자의 예외 원장에 예매번호·좌석·시각·담당자를 기록하고, 연결이 복구되면 이 QR을 다시 확인하세요."
        onRetry={retryVerify}
      />
    );
  }

  if ((verifyQuery.isLoading && !verifyQuery.data) || localPending === 'checking') {
    return <ScannerLoading message="QR 티켓을 확인하고 있습니다" />;
  }

  if (verifyQuery.isError && !verifyQuery.data) {
    return (
      <ScannerNotice
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
      }),
    );
    if (outcome === 'duplicate') {
      setLocalPending('pending');
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
        offlineConsumeResult
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
          if (await findPendingScanAttemptByToken(ticketToken).catch(() => null)) {
            setLocalPending('pending');
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
                if (!redemptionAttempts.current.has(benefitEntitlementId)) redemptionAttempts.current.set(benefitEntitlementId, createDeviceAttemptId());
                try {
                  const result = await benefitRedeemMutation.mutateAsync({
                    token: ticketToken,
                    showtimeId: scannerShowtimeId,
                    benefitEntitlementId,
                    deviceAttemptId: redemptionAttempts.current.get(benefitEntitlementId)!,
                    confirmed: true,
                  });
                  setBenefitRedemptionResults((current) => ({
                    ...current,
                    [benefitEntitlementId]: result,
                  }));
                } catch {
                  setActionError('특전 지급 결과를 확인하지 못했습니다. 실물을 다시 지급하지 말고 같은 요청으로 확인해주세요.');
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
}

function ScannerLoading({ message }: { message: string }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl items-center bg-[#F5F5F7] p-4">
      <Card className="w-full border-gray-200 bg-white shadow-sm">
        <CardContent className="flex items-center gap-3 p-5">
          <Loader2 className="h-5 w-5 animate-spin text-[#6C3CE0]" />
          <p className="text-base font-semibold text-gray-800">{message}</p>
        </CardContent>
      </Card>
    </main>
  );
}

function ScannerNotice({
  tone,
  title,
  description,
  onRetry,
}: {
  tone: 'error' | 'neutral' | 'offline';
  title: string;
  description: string;
  onRetry?: () => void;
}) {
  const iconClass = tone === 'neutral' ? 'text-[#6C3CE0]' : tone === 'offline' ? 'text-[#8B6306]' : 'text-[#C62828]';
  const Icon = tone === 'neutral' ? ScanLine : tone === 'offline' ? WifiOff : AlertTriangle;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl items-center bg-[#F5F5F7] p-4">
      <Card className="w-full border-gray-200 bg-white shadow-sm">
        <CardContent className="space-y-4 p-5">
          <div role={tone === 'neutral' ? undefined : 'alert'} className="flex items-start gap-3">
            <Icon className={`mt-0.5 h-6 w-6 shrink-0 ${iconClass}`} />
            <div>
              <h1 className="text-heading font-semibold text-gray-900">{title}</h1>
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
    </main>
  );
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
}: {
  deviceAttemptId: string;
  scannerUserId: string;
  eventId: string;
  showtimeId: string;
  token: string;
  attemptedAt: string;
}): PendingScanAttemptRecord {
  return {
    deviceAttemptId,
    scannerUserId,
    eventId,
    showtimeId,
    token,
    redactedTokenRef: redactedTokenRef(token),
    attemptedAt,
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
