'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { hasAdminCapability, parseFieldCheckInToken } from '@grabit/shared';
import { AlertTriangle, Loader2, ScanLine } from 'lucide-react';
import { ScannerCheckIn } from '@/components/field/scanner-check-in';
import {
  canRedeemBenefitsForVerification,
  useFieldBenefitRedeem,
  useFieldCheckInConsume,
  useFieldCheckInVerify,
  useFieldShowtimes,
  type ScannerBenefitRedemptionResult,
  type ScannerCheckInConsumeResult,
} from '@/hooks/use-field-operations';
import { useFieldOfflineQueue, useFieldOnlineStatus } from '@/hooks/use-field-offline-queue';
import { OfflineSyncStatus } from '@/components/field/offline-sync-status';
import type { PendingScanAttemptRecord } from '@/lib/field/offline-scan-store';
import { formatAdminKstDateTime } from '@/lib/admin-datetime';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuthStore } from '@/stores/use-auth-store';

export default function FieldCheckInPage() {
  const searchParams = useSearchParams();
  const { isInitialized, accessToken, user } = useAuthStore();
  const router = useRouter();
  const routeToken = searchParams.get('ticket') ?? searchParams.get('token') ?? '';
  const [manualToken, setManualToken] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [showtimeId, setShowtimeId] = useState(searchParams.get('showtimeId') ?? '');
  const canVerify = hasAdminCapability(user, 'field.scan.verify');
  const isOnline = useFieldOnlineStatus();
  const queue = useFieldOfflineQueue(canVerify ? user?.id : undefined, showtimeId);
  const showtimes = useFieldShowtimes(isInitialized && Boolean(accessToken) && canVerify);
  const selected = showtimes.data?.find((showtime) => showtime.id === showtimeId);
  const token = manualToken ?? routeToken;
  useEffect(() => {
    if (isInitialized && !accessToken) router.replace(`/auth?returnTo=${encodeURIComponent(`/field/check-in?${searchParams.toString()}`)}`);
  }, [accessToken, isInitialized, router, searchParams]);
  useEffect(() => {
    if (!user?.id || showtimeId) return;
    setShowtimeId(sessionStorage.getItem(`grabit-field-showtime:${user.id}`) ?? '');
  }, [showtimeId, user?.id]);
  if (!isInitialized || !accessToken) return <ScannerLoading message="검표 세션을 확인하고 있습니다" />;
  if (!canVerify) return <ScannerCheckIn user={user} onProcessEntry={() => undefined} onSyncOffline={() => undefined} />;
  return <div className="mx-auto min-h-dvh max-w-xl bg-[#F5F5F7]">
    <header className="space-y-4 border-b bg-white p-4">
      <div><p className="text-sm font-semibold text-primary">Grabit · 현장</p><h1 className="mt-1 text-2xl font-semibold">좌석별 검표</h1>
        <p className="mt-2 text-sm text-gray-600">QR 한 장은 해당 좌석 한 명의 입장만 처리합니다. 특전은 품목별로 따로 지급합니다.</p></div>
      <label className="block space-y-2 text-sm font-semibold">검표할 공연·회차 · 한국 시간
        <select aria-label="검표할 공연·회차" className="min-h-11 w-full rounded-lg border bg-white px-3" value={showtimeId} onChange={(event) => {
          setShowtimeId(event.target.value); if (user?.id) sessionStorage.setItem(`grabit-field-showtime:${user.id}`, event.target.value);
        }}><option value="">공연·회차를 선택하세요</option>{showtimes.data?.map((showtime) => <option key={showtime.id} value={showtime.id}>
          {showtime.title} · {formatAdminKstDateTime(showtime.dateTime).replace('T', ' ')} KST
        </option>)}</select>
      </label>
      {showtimes.isError && <p role="alert" className="text-sm text-red-700">공연·회차를 불러오지 못했습니다. 연결을 확인한 뒤 다시 시도해주세요.</p>}
      <form className="space-y-2" onSubmit={(event) => {
        event.preventDefault(); setInputError(null);
        try {
          const value = input.trim();
          const nextToken = value.startsWith('http') ? parseFieldCheckInToken({ qrUrl: value }) : value;
          if (!nextToken) throw new Error('empty');
          setManualToken(nextToken); setInput('');
        } catch { setInputError('QR 링크 또는 QR 내용을 확인해주세요.'); }
      }}>
        <label className="block space-y-2 text-sm font-semibold">QR 링크 또는 내용
          <Input aria-label="QR 링크 또는 내용" type="password" autoComplete="off" value={input} onChange={(event) => setInput(event.target.value)} placeholder="카메라로 읽은 QR 내용을 붙여넣으세요" />
        </label>
        <p className="text-xs text-gray-500">휴대폰 카메라로 QR 링크를 열거나, 카메라 이용이 어려우면 위 입력란을 사용하세요.</p>
        {inputError && <p role="alert" className="text-sm text-red-700">{inputError}</p>}
        <div className="flex gap-2"><Button type="submit" disabled={!selected || !input.trim()} className="min-h-11 flex-1">티켓 확인</Button>
          {token && <Button type="button" variant="outline" className="min-h-11" onClick={() => { setManualToken(''); setInput(''); }}>다음 티켓</Button>}</div>
      </form>
    </header>
    {queue.error && <p role="alert" className="p-4 text-sm text-red-700">{queue.error}</p>}
    {queue.items.length > 0 && <div className="p-4 pb-0"><OfflineSyncStatus queue={queue.items} isSyncing={queue.isSyncing}
      canSync={isOnline && hasAdminCapability(user, 'field.scan.sync')} onSyncOffline={() => { void queue.sync(); }} /></div>}
    {token && selected ? <ActiveScan key={`${token}:${selected.id}:${user?.id}:${queue.items.filter((item) => item.state !== 'pending').map((item) => `${item.deviceAttemptId}:${item.state}`).join(',')}`} ticketToken={token} showtimeId={selected.id} eventId={selected.eventId} recordPending={queue.record} />
      : <p role="status" className="p-5 text-sm text-gray-600">{!selected ? '먼저 현장에서 검표할 공연과 회차를 선택해주세요.' : 'QR을 확인한 뒤 좌석과 상태를 보고 입장 또는 특전 지급을 선택하세요.'}</p>}
  </div>;
}

function ActiveScan({ ticketToken, showtimeId, eventId, recordPending }: {
  ticketToken: string; showtimeId: string; eventId: string;
  recordPending: (attempt: PendingScanAttemptRecord) => Promise<void>;
}) {
  const { isInitialized, accessToken, user } = useAuthStore();
  const isOnline = useFieldOnlineStatus();
  const [actionError, setActionError] = useState<string | null>(null);
  const consumingRef = useRef(false);
  const redemptionAttempts = useRef(new Map<string, string>());
  const [offlineConsumeResult, setOfflineConsumeResult] =
    useState<ScannerCheckInConsumeResult | null>(null);
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

  if (verifyQuery.isLoading && !verifyQuery.data) {
    return <ScannerLoading message="QR 티켓을 확인하고 있습니다" />;
  }

  if (verifyQuery.isError && !verifyQuery.data) {
    return (
      <ScannerNotice
        tone="error"
        title="QR 티켓을 확인할 수 없습니다"
        description="네트워크 상태를 확인한 뒤 다시 스캔하세요."
      />
    );
  }

  return (
    <ScannerCheckIn
      user={user}
      verification={verifyQuery.data}
      consumeResult={offlineConsumeResult ?? consumeMutation.data}
      isOnline={isOnline}
      actionError={actionError}
      benefitRedemptionResults={benefitRedemptionResults}
      isConsuming={consumeMutation.isPending}
      redeemingBenefitId={redeemingBenefitId}
      isSyncingOffline={false}
      onProcessEntry={() => {
        void (async () => {
          if (!verifyQuery.data?.processable || !hasAdminCapability(user, 'field.scan.consume') || consumingRef.current) return;
          consumingRef.current = true; setActionError(null);
          try {

          if (isBrowserOffline() && accessToken && user?.id) {
            await recordPending(
              createPendingAttempt({
                deviceAttemptId,
                scannerUserId: user.id,
                eventId,
                showtimeId: scannerShowtimeId,
                token: ticketToken,
                attemptedAt: new Date().toISOString(),
              }),
            );
            setOfflineConsumeResult({
              result: 'offline-pending',
              resultLabel:
                '입장 동기화 대기',
            });
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

            await recordPending(
              createPendingAttempt({
                deviceAttemptId,
                scannerUserId: user.id,
                eventId,
                showtimeId: scannerShowtimeId,
                token: ticketToken,
                attemptedAt: new Date().toISOString(),
              }),
            );
            setOfflineConsumeResult({
              result: 'offline-pending',
              resultLabel:
                '입장 동기화 대기',
            });
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
}: {
  tone: 'error' | 'neutral';
  title: string;
  description: string;
}) {
  const iconClass = tone === 'error' ? 'text-[#C62828]' : 'text-[#6C3CE0]';
  const Icon = tone === 'error' ? AlertTriangle : ScanLine;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl items-center bg-[#F5F5F7] p-4">
      <Card className="w-full border-gray-200 bg-white shadow-sm">
        <CardContent className="space-y-4 p-5">
          <div className="flex items-start gap-3">
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
            onClick={() => window.location.reload()}
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
  if (error instanceof Error) {
    return /network|fetch|failed to fetch|load failed/i.test(error.message);
  }
  return false;
}

function isBrowserOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}
