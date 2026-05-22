'use client';

import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  RefreshCcw,
  ShieldAlert,
  TicketCheck,
  UserCheck,
  WifiOff,
} from 'lucide-react';
import type { AdminCapabilityUser } from '@grabit/shared';
import { hasAdminCapability } from '@grabit/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  labelForResult,
  type ScannerCheckInConsumeResult,
  type ScannerCheckInResult,
  type ScannerCheckInVerification,
} from '@/hooks/use-field-operations';
import { cn } from '@/lib/cn';

interface ScannerCheckInProps {
  user: AdminCapabilityUser | null;
  verification?: ScannerCheckInVerification | null;
  consumeResult?: ScannerCheckInConsumeResult | null;
  isConsuming?: boolean;
  isSyncingOffline?: boolean;
  onProcessEntry: () => void;
  onSyncOffline: () => void;
}

const RESULT_STYLES: Record<
  ScannerCheckInResult,
  { band: string; badge: string; icon: typeof CheckCircle2 }
> = {
  processable: {
    band: 'border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]',
    badge: 'border-transparent bg-[#F0FDF4] text-[#15803D]',
    icon: TicketCheck,
  },
  processed: {
    band: 'border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]',
    badge: 'border-transparent bg-[#F0FDF4] text-[#15803D]',
    icon: CheckCircle2,
  },
  synced: {
    band: 'border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]',
    badge: 'border-transparent bg-[#F0FDF4] text-[#15803D]',
    icon: CheckCircle2,
  },
  'offline-pending': {
    band: 'border-[#FDE68A] bg-[#FFFBEB] text-[#8B6306]',
    badge: 'border-transparent bg-[#FFFBEB] text-[#8B6306]',
    icon: WifiOff,
  },
  duplicate: {
    band: 'border-[#F3C7C7] bg-[#FEF2F2] text-[#C62828]',
    badge: 'border-transparent bg-[#FEF2F2] text-[#C62828]',
    icon: AlertTriangle,
  },
  tampered: {
    band: 'border-[#F3C7C7] bg-[#FEF2F2] text-[#C62828]',
    badge: 'border-transparent bg-[#FEF2F2] text-[#C62828]',
    icon: ShieldAlert,
  },
  refunded: {
    band: 'border-[#F3C7C7] bg-[#FEF2F2] text-[#C62828]',
    badge: 'border-transparent bg-[#FEF2F2] text-[#C62828]',
    icon: AlertTriangle,
  },
  expired: {
    band: 'border-[#F3C7C7] bg-[#FEF2F2] text-[#C62828]',
    badge: 'border-transparent bg-[#FEF2F2] text-[#C62828]',
    icon: AlertTriangle,
  },
  'wrong-showtime': {
    band: 'border-[#F3C7C7] bg-[#FEF2F2] text-[#C62828]',
    badge: 'border-transparent bg-[#FEF2F2] text-[#C62828]',
    icon: Clock3,
  },
  rejected: {
    band: 'border-[#F3C7C7] bg-[#FEF2F2] text-[#C62828]',
    badge: 'border-transparent bg-[#FEF2F2] text-[#C62828]',
    icon: ShieldAlert,
  },
};

export function ScannerCheckIn({
  user,
  verification,
  consumeResult,
  isConsuming = false,
  isSyncingOffline = false,
  onProcessEntry,
  onSyncOffline,
}: ScannerCheckInProps) {
  if (!hasScannerAccess(user)) {
    return <ScannerAccessDenied />;
  }

  if (!verification) {
    return (
      <Card className="border-gray-200 bg-white shadow-sm">
        <CardContent className="space-y-3 p-5">
          <p className="text-heading font-semibold text-gray-900">
            QR 티켓을 확인하고 있습니다
          </p>
          <p className="text-base text-gray-600">
            서버 검표 결과를 불러온 뒤 입장 처리 여부를 선택할 수 있습니다.
          </p>
        </CardContent>
      </Card>
    );
  }

  const activeResult = consumeResult?.result ?? verification.result;
  const activeLabel =
    consumeResult?.resultLabel ?? verification.resultLabel ?? labelForResult(activeResult);
  const canProcess =
    !consumeResult &&
    (verification.processable || verification.result === 'processable');
  const showOfflineQueue =
    verification.result === 'offline-pending' || verification.offlineQueue.length > 0;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col bg-[#F5F5F7]">
      <main className="flex-1 space-y-4 p-4 pb-6">
        <ResultBand
          result={activeResult}
          label={activeLabel}
          rejectionReason={consumeResult?.rejectionReason ?? verification.rejectionReason}
          priorScanContext={
            consumeResult?.priorScanContext ?? verification.priorScanContext
          }
        />

        <TicketIdentity verification={verification} result={activeResult} />

        {showOfflineQueue && (
          <OfflineQueue
            queue={verification.offlineQueue}
            isSyncing={isSyncingOffline}
            onSyncOffline={onSyncOffline}
          />
        )}
      </main>

      <div
        data-testid="scanner-sticky-action"
        className="sticky bottom-0 z-20 border-t bg-white/95 p-4 shadow-[0_-8px_20px_rgba(15,23,42,0.08)] backdrop-blur"
      >
        {canProcess ? (
          <Button
            type="button"
            className="h-14 w-full bg-[#6C3CE0] text-base font-semibold hover:bg-[#5730B8]"
            disabled={isConsuming}
            onClick={onProcessEntry}
          >
            <UserCheck className="h-5 w-5" />
            {isConsuming ? '처리 중' : '입장 처리'}
          </Button>
        ) : activeResult === 'processed' || activeResult === 'synced' ? (
          <Button type="button" className="h-14 w-full" disabled>
            <CheckCircle2 className="h-5 w-5" />
            입장 처리 완료
          </Button>
        ) : (
          <p className="text-center text-sm font-semibold text-gray-600">
            이 검표 결과에서는 입장 처리를 진행할 수 없습니다.
          </p>
        )}
      </div>
    </div>
  );
}

function ScannerAccessDenied() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl items-center bg-[#F5F5F7] p-4">
      <section
        role="alert"
        aria-label="이 티켓을 검표할 권한이 없습니다"
        className="w-full rounded-lg border border-[#F3C7C7] bg-white p-5 shadow-sm"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[#FEF2F2] text-[#C62828]">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h1
              className="block text-heading font-semibold leading-[1.2] text-gray-900"
            >
              이 티켓을 검표할 권한이 없습니다
            </h1>
            <p className="mt-3 text-base leading-[1.5] text-gray-700">
              검표 전용 계정 또는 관리자 권한이 있는 계정으로 다시 로그인하세요.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

function ResultBand({
  result,
  label,
  rejectionReason,
  priorScanContext,
}: {
  result: ScannerCheckInResult;
  label: string;
  rejectionReason?: string | null;
  priorScanContext?: {
    checkedInAt?: string;
    scannedAt?: string;
    scannerName?: string;
    scannerUserId?: string;
    deviceAttemptId?: string;
  } | null;
}) {
  const style = RESULT_STYLES[result];
  const Icon = style.icon;

  return (
    <section
      role="status"
      aria-label={label}
      className={cn('rounded-lg border p-5', style.band)}
    >
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-6 w-6 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[28px] font-semibold leading-[1.2]">{label}</p>
          {rejectionReason && (
            <p className="mt-2 text-base leading-[1.5]">{rejectionReason}</p>
          )}
          {priorScanContext && (
            <p className="mt-2 text-sm font-semibold leading-[1.4]">
              이전 처리: {formatTimestamp(priorScanContext.checkedInAt ?? priorScanContext.scannedAt)}
              {priorScanContext.scannerName ? ` · ${priorScanContext.scannerName}` : ''}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function TicketIdentity({
  verification,
  result,
}: {
  verification: ScannerCheckInVerification;
  result: ScannerCheckInResult;
}) {
  const style = RESULT_STYLES[result];

  return (
    <Card className="border-gray-200 bg-white shadow-sm">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-gray-500">티켓 정보</p>
            <h2 className="mt-1 text-heading font-semibold text-gray-900">
              {verification.reservationNumber ?? '예매 번호 확인 중'}
            </h2>
          </div>
          <Badge className={style.badge}>{verification.ticketStatus ?? '검표 확인'}</Badge>
        </div>

        <dl className="space-y-3 text-base leading-[1.5]">
          <MetadataRow label="공연" value={verification.performanceTitle} />
          <MetadataRow label="회차" value={formatTimestamp(verification.showtimeAt)} />
          <MetadataRow label="장소" value={verification.venueName} />
          <MetadataRow
            label="좌석"
            value={verification.seats.length > 0 ? verification.seats.join(', ') : undefined}
          />
        </dl>
      </CardContent>
    </Card>
  );
}

function MetadataRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="grid grid-cols-[72px_1fr] gap-3">
      <dt className="font-semibold text-gray-500">{label}</dt>
      <dd className="min-w-0 font-semibold text-gray-900">
        {value && value.trim().length > 0 ? value : '확인 중'}
      </dd>
    </div>
  );
}

function OfflineQueue({
  queue,
  isSyncing,
  onSyncOffline,
}: {
  queue: ScannerCheckInVerification['offlineQueue'];
  isSyncing: boolean;
  onSyncOffline: () => void;
}) {
  return (
    <Card className="border-[#FDE68A] bg-white shadow-sm">
      <CardContent className="space-y-4 p-5">
        <div>
          <p className="text-heading font-semibold text-gray-900">보류 스캔</p>
          <p className="mt-2 text-base leading-[1.5] text-[#8B6306]">
            보류 상태는 최종 입장 증거가 아닙니다
          </p>
        </div>

        {queue.length > 0 && (
          <div className="space-y-2">
            {queue.map((item) => (
              <div
                key={item.deviceAttemptId}
                className="rounded-lg bg-[#FFFBEB] px-3 py-2 text-sm font-semibold text-[#8B6306]"
              >
                {formatTimestamp(item.attemptedAt)} · {item.state}
              </div>
            ))}
          </div>
        )}

        <Button
          type="button"
          variant="outline"
          className="h-11 w-full border-[#8B6306] text-[#8B6306]"
          disabled={isSyncing}
          onClick={onSyncOffline}
        >
          <RefreshCcw className="h-4 w-4" />
          보류 스캔 동기화
        </Button>
      </CardContent>
    </Card>
  );
}

function hasScannerAccess(user: AdminCapabilityUser | null): boolean {
  return (
    hasAdminCapability(user, 'field.scan.verify') ||
    hasAdminCapability(user, 'field.scan.consume')
  );
}

function formatTimestamp(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Seoul',
  }).format(date);
}
