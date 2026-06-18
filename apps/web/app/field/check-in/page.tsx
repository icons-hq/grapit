'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { hasAdminCapability } from '@grabit/shared';
import { AlertTriangle, Loader2, ScanLine } from 'lucide-react';
import { ScannerCheckIn } from '@/components/field/scanner-check-in';
import {
  useFieldBenefitRedeem,
  useFieldCheckInConsume,
  useFieldCheckInVerify,
  useFieldOfflineSync,
  type ScannerBenefitRedemptionResult,
  type ScannerCheckInConsumeResult,
  type ScannerCheckInVerification,
  type ScannerOfflineQueueItem,
  type ScannerOfflineSyncResult,
} from '@/hooks/use-field-operations';
import {
  addPendingScanAttempt,
  listPendingScanAttempts,
  updatePendingScanAttempt,
  type PendingScanAttemptRecord,
} from '@/lib/field/offline-scan-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuthStore } from '@/stores/use-auth-store';

const FALLBACK_SHOWTIME_ID = '00000000-0000-4000-8000-000000000000';

export default function FieldCheckInPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isInitialized, accessToken, user } = useAuthStore();
  const ticketToken = searchParams.get('ticket') ?? searchParams.get('token') ?? '';
  const showtimeId = searchParams.get('showtimeId') ?? undefined;
  const eventId = searchParams.get('eventId') ?? 'field-event';
  const shouldSeedOfflineAttempt = searchParams.get('offlineAttempt') === '1';
  const seededOfflineAttemptRef = useRef(false);
  const [offlineQueue, setOfflineQueue] = useState<ScannerOfflineQueueItem[]>([]);
  const [offlineConsumeResult, setOfflineConsumeResult] =
    useState<ScannerCheckInConsumeResult | null>(null);
  const [benefitRedemptionResults, setBenefitRedemptionResults] = useState<
    Record<string, ScannerBenefitRedemptionResult>
  >({});
  const [redeemingBenefitId, setRedeemingBenefitId] = useState<string | null>(null);
  const returnTarget = useMemo(() => {
    const query = searchParams.toString();
    return `${pathname}${query ? `?${query}` : ''}`;
  }, [pathname, searchParams]);
  const hasScannerAccess =
    hasAdminCapability(user, 'field.scan.verify') ||
    hasAdminCapability(user, 'field.scan.consume');
  const canConsumeFieldScan = hasAdminCapability(user, 'field.scan.consume');
  const deviceAttemptId = useMemo(() => createDeviceAttemptId(), []);

  useEffect(() => {
    if (!isInitialized || accessToken) {
      return;
    }
    router.replace(`/auth?returnTo=${encodeURIComponent(returnTarget)}`);
  }, [accessToken, isInitialized, returnTarget, router]);

  const verifyQuery = useFieldCheckInVerify({
    token: ticketToken,
    showtimeId,
    enabled: isInitialized && Boolean(accessToken) && hasScannerAccess && ticketToken.length > 0,
  });
  const consumeMutation = useFieldCheckInConsume();
  const benefitRedeemMutation = useFieldBenefitRedeem();
  const offlineSyncMutation = useFieldOfflineSync();
  const effectiveShowtimeId =
    verifyQuery.data?.showtimeId ?? showtimeId ?? FALLBACK_SHOWTIME_ID;
  const mergedVerification = useMemo(
    () =>
      verifyQuery.data
        ? mergeVerificationOfflineQueue(verifyQuery.data, offlineQueue)
        : null,
    [offlineQueue, verifyQuery.data],
  );

  const refreshOfflineQueue = useCallback(async () => {
    const records = await listPendingScanAttempts();
    setOfflineQueue(records.map(pendingRecordToQueueItem));
  }, []);

  useEffect(() => {
    setBenefitRedemptionResults({});
    setRedeemingBenefitId(null);
  }, [ticketToken]);

  useEffect(() => {
    if (!isInitialized || !accessToken || !hasScannerAccess) {
      return;
    }
    void refreshOfflineQueue();
  }, [accessToken, hasScannerAccess, isInitialized, refreshOfflineQueue]);

  useEffect(() => {
    if (
      !shouldSeedOfflineAttempt ||
      seededOfflineAttemptRef.current ||
      !isInitialized ||
      !accessToken ||
      !hasScannerAccess ||
      !verifyQuery.data
    ) {
      return;
    }

    seededOfflineAttemptRef.current = true;
    void (async () => {
      await addPendingScanAttempt(
        createPendingAttempt({
          deviceAttemptId: 'device-attempt-phase27-rejected',
          scannerUserId: user?.id ?? 'scanner-session',
          eventId,
          showtimeId: effectiveShowtimeId,
          token: ticketToken,
          attemptedAt: new Date().toISOString(),
        }),
      );
      await refreshOfflineQueue();
    })();
  }, [
    accessToken,
    effectiveShowtimeId,
    eventId,
    hasScannerAccess,
    isInitialized,
    refreshOfflineQueue,
    shouldSeedOfflineAttempt,
    ticketToken,
    user?.id,
    verifyQuery.data,
  ]);

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

  if (verifyQuery.isLoading || verifyQuery.isFetching) {
    return <ScannerLoading message="QR 티켓을 확인하고 있습니다" />;
  }

  if (verifyQuery.isError) {
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
      verification={mergedVerification}
      consumeResult={consumeMutation.data ?? offlineConsumeResult}
      benefitRedemptionResults={benefitRedemptionResults}
      isConsuming={consumeMutation.isPending}
      redeemingBenefitId={redeemingBenefitId}
      isSyncingOffline={offlineSyncMutation.isPending}
      onProcessEntry={() => {
        void (async () => {
          if (!verifyQuery.data) {
            return;
          }

          if (isBrowserOffline() && accessToken && user?.id) {
            await addPendingScanAttempt(
              createPendingAttempt({
                deviceAttemptId,
                scannerUserId: user.id,
                eventId,
                showtimeId: effectiveShowtimeId,
                token: ticketToken,
                attemptedAt: new Date().toISOString(),
              }),
            );
            setOfflineConsumeResult({
              result: 'offline-pending',
              resultLabel:
                '네트워크 문제로 보류 스캔에 저장했습니다. 연결이 복구되면 서버와 동기화하세요.',
            });
            await refreshOfflineQueue();
            return;
          }

          try {
            setOfflineConsumeResult(null);
            await consumeMutation.mutateAsync({
              token: ticketToken,
              showtimeId: effectiveShowtimeId,
              deviceAttemptId,
              confirmed: true,
            });
          } catch (error) {
            if (!isNetworkFailure(error) || !accessToken || !user?.id) {
              return;
            }

            await addPendingScanAttempt(
              createPendingAttempt({
                deviceAttemptId,
                scannerUserId: user.id,
                eventId,
                showtimeId: effectiveShowtimeId,
                token: ticketToken,
                attemptedAt: new Date().toISOString(),
              }),
            );
            setOfflineConsumeResult({
              result: 'offline-pending',
              resultLabel:
                '네트워크 문제로 보류 스캔에 저장했습니다. 연결이 복구되면 서버와 동기화하세요.',
            });
            await refreshOfflineQueue();
          }
        })();
      }}
      onRedeemBenefit={
        canConsumeFieldScan
          ? (benefitEntitlementId) => {
              void (async () => {
                if (!verifyQuery.data || redeemingBenefitId) {
                  return;
                }

                setRedeemingBenefitId(benefitEntitlementId);
                try {
                  const result = await benefitRedeemMutation.mutateAsync({
                    token: ticketToken,
                    showtimeId: effectiveShowtimeId,
                    benefitEntitlementId,
                    deviceAttemptId: createDeviceAttemptId(),
                    confirmed: true,
                  });
                  setBenefitRedemptionResults((current) => ({
                    ...current,
                    [benefitEntitlementId]: result,
                  }));
                } finally {
                  setRedeemingBenefitId(null);
                }
              })();
            }
          : undefined
      }
      onSyncOffline={() => {
        void (async () => {
          const pendingAttempts = await listPendingScanAttempts({
            syncState: 'pending',
          });
          if (pendingAttempts.length === 0) {
            return;
          }

          const results = await offlineSyncMutation.mutateAsync({
            attempts: pendingAttempts.map(pendingRecordToSyncAttempt),
          });
          await persistSyncResults({
            results,
            pendingAttempts,
            eventId,
            showtimeId: effectiveShowtimeId,
            token: ticketToken,
            scannerUserId: user?.id ?? 'scanner-session',
          });
          setOfflineConsumeResult(null);
          await refreshOfflineQueue();
        })();
      }}
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

function mergeVerificationOfflineQueue(
  verification: ScannerCheckInVerification,
  offlineQueue: ScannerOfflineQueueItem[],
): ScannerCheckInVerification {
  const byId = new Map<string, ScannerOfflineQueueItem>();
  for (const item of verification.offlineQueue) {
    byId.set(item.deviceAttemptId, item);
  }
  for (const item of offlineQueue) {
    byId.set(item.deviceAttemptId, item);
  }

  return {
    ...verification,
    offlineQueue: [...byId.values()].sort((a, b) =>
      a.attemptedAt.localeCompare(b.attemptedAt),
    ),
  };
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

function pendingRecordToQueueItem(
  record: PendingScanAttemptRecord,
): ScannerOfflineQueueItem {
  return {
    deviceAttemptId: record.deviceAttemptId,
    state: record.syncState,
    attemptedAt: record.attemptedAt,
    reason: record.resultLabel ?? record.rejectionReason ?? null,
  };
}

function pendingRecordToSyncAttempt(record: PendingScanAttemptRecord) {
  return {
    deviceAttemptId: record.deviceAttemptId,
    scannerUserId: record.scannerUserId,
    showtimeId: record.showtimeId,
    attemptedAt: record.attemptedAt,
    token: record.token,
    redactedTokenRef: record.redactedTokenRef,
    syncState: record.syncState,
    lastSyncAttemptAt: new Date().toISOString(),
    rejectionReason: record.rejectionReason ?? null,
  };
}

async function persistSyncResults({
  results,
  pendingAttempts,
  eventId,
  showtimeId,
  token,
  scannerUserId,
}: {
  results: ScannerOfflineSyncResult[];
  pendingAttempts: PendingScanAttemptRecord[];
  eventId: string;
  showtimeId: string;
  token: string;
  scannerUserId: string;
}) {
  const pendingById = new Map(
    pendingAttempts.map((attempt) => [attempt.deviceAttemptId, attempt]),
  );

  await Promise.all(
    results.map(async (result) => {
      const existing = pendingById.get(result.deviceAttemptId);
      const updated = await updatePendingScanAttempt(result.deviceAttemptId, {
        syncState: result.state,
        lastSyncAttemptAt: new Date().toISOString(),
        rejectionReason: result.reason ?? null,
        result: result.result,
        resultLabel: result.resultLabel,
        scanEventId: result.scanEventId ?? null,
        resolvedAt: result.resolvedAt ?? new Date().toISOString(),
      });

      if (updated) {
        return;
      }

      await addPendingScanAttempt({
        deviceAttemptId: result.deviceAttemptId,
        scannerUserId,
        eventId,
        showtimeId: existing?.showtimeId ?? showtimeId,
        token: existing?.token ?? token,
        redactedTokenRef: existing?.redactedTokenRef ?? redactedTokenRef(token),
        attemptedAt: existing?.attemptedAt ?? new Date().toISOString(),
        syncState: result.state,
        lastSyncAttemptAt: new Date().toISOString(),
        rejectionReason: result.reason ?? null,
        result: result.result,
        resultLabel: result.resultLabel,
        scanEventId: result.scanEventId ?? null,
        resolvedAt: result.resolvedAt ?? new Date().toISOString(),
      });
    }),
  );
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
