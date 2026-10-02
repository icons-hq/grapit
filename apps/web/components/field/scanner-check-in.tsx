'use client';

import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Gift,
  Home,
  LogOut,
  ShieldAlert,
  TicketCheck,
  UserCheck,
  WifiOff,
} from 'lucide-react';
import type { AdminCapabilityUser, FieldBenefitEntitlement } from '@grabit/shared';
import { hasAdminCapability } from '@grabit/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { OfflineSyncStatus } from '@/components/field/offline-sync-status';
import {
  canRedeemBenefitsForVerification,
  labelForResult,
  type ScannerBenefitRedemptionResult,
  type ScannerCheckInConsumeResult,
  type ScannerCheckInResult,
  type ScannerCheckInVerification,
} from '@/hooks/use-field-operations';
import { cn } from '@/lib/cn';
import { formatFieldShowtimeKst } from '@/lib/field/showtime-format';

interface ScannerCheckInProps {
  user: AdminCapabilityUser | null;
  verification?: ScannerCheckInVerification | null;
  consumeResult?: ScannerCheckInConsumeResult | null;
  benefitRedemptionResults?: Record<string, ScannerBenefitRedemptionResult>;
  isConsuming?: boolean;
  isOnline?: boolean;
  actionError?: string | null;
  redeemingBenefitId?: string | null;
  isSyncingOffline?: boolean;
  onProcessEntry: () => void;
  onRedeemBenefit?: (benefitEntitlementId: string) => void;
  onSyncOffline: () => void;
  /**
   * Signs this account out and opens the login screen. Without it the access
   * denied screen only links home.
   */
  onSwitchAccount?: () => void;
  /** Whether a QR was scanned; the access denied title names the ticket only then. */
  hasTicket?: boolean;
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
  benefitRedemptionResults = {},
  isConsuming = false,
  isOnline = true,
  actionError = null,
  redeemingBenefitId = null,
  isSyncingOffline = false,
  onProcessEntry,
  onRedeemBenefit,
  onSyncOffline,
  onSwitchAccount,
  hasTicket = true,
}: ScannerCheckInProps) {
  if (!hasScannerAccess(user)) {
    return <ScannerAccessDenied hasTicket={hasTicket} onSwitchAccount={onSwitchAccount} />;
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
    hasAdminCapability(user, 'field.scan.consume') && !consumeResult &&
    (verification.processable || verification.result === 'processable');
  const canRedeemBenefits =
    isOnline && hasAdminCapability(user, 'field.benefits.redeem') && Boolean(onRedeemBenefit)
    && (!consumeResult || ['processed', 'synced', 'duplicate'].includes(consumeResult.result))
    && canRedeemBenefitsForVerification(verification);
  const showOfflineQueue =
    verification.result === 'offline-pending' || verification.offlineQueue.length > 0;
  // A forged or unreadable QR identifies no ticket. A card of empty fields
  // would read as a lookup still in progress, so it is left out.
  const unverifiable = isUnverifiableResult(activeResult) || isUnverifiableResult(verification.result);
  const hasTicketIdentity = verification.seats.length > 0 || Boolean(verification.reservationNumber?.trim());

  return (
    // Rendered inside the scanner page's main landmark, so no main of its own.
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col bg-[#F5F5F7]">
      <div className="flex-1 space-y-4 p-4 pb-6">
        {actionError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{actionError}</p>}
        {!isOnline && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">연결이 끊겼습니다. 연결이 끊기기 전에 서버 확인을 마친 이 티켓만 입장 동기화 대기로 저장할 수 있습니다. 끊긴 뒤 새로 스캔한 QR은 확인·입장 처리할 수 없으니 현장 책임자의 예외 원장 절차를 따르세요. 특전 지급은 연결 복구 후 가능합니다.</p>}
        <ResultBand
          result={activeResult}
          label={activeLabel}
          rejectionReason={consumeResult ? consumeResult.rejectionReason : verification.rejectionReason}
          priorScanContext={
            consumeResult ? consumeResult.priorScanContext : verification.priorScanContext
          }
        />

        {showOfflineQueue && (
          <OfflineSyncStatus
            queue={verification.offlineQueue}
            isSyncing={isSyncingOffline}
            onSyncOffline={onSyncOffline}
          />
        )}

        {(hasTicketIdentity || !unverifiable) && (
          <TicketIdentity verification={verification} result={activeResult} unverifiable={unverifiable} />
        )}

        {verification.benefitsAvailable === false && <p role="alert" className="text-sm text-red-700">특전 내역을 불러오지 못했습니다. 지급 전에 다시 확인해주세요.</p>}
        <BenefitRedemptionPanel
          benefits={verification.benefitEntitlements}
          redemptionResults={benefitRedemptionResults}
          redeemingBenefitId={redeemingBenefitId}
          onRedeemBenefit={canRedeemBenefits ? onRedeemBenefit : undefined}
        />
      </div>

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
            {isConsuming ? '처리 중' : '이 좌석 입장 처리'}
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

type BenefitUiState = 'available' | 'used' | 'inactive' | 'rejected';

function BenefitRedemptionPanel({
  benefits,
  redemptionResults,
  redeemingBenefitId,
  onRedeemBenefit,
}: {
  benefits: readonly FieldBenefitEntitlement[];
  redemptionResults: Record<string, ScannerBenefitRedemptionResult>;
  redeemingBenefitId: string | null;
  onRedeemBenefit?: (benefitEntitlementId: string) => void;
}) {
  if (benefits.length === 0) {
    return null;
  }

  return (
    <Card
      data-testid="scanner-benefit-panel"
      className="border-gray-200 bg-white shadow-sm"
    >
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#F3EFFF] text-[#6C3CE0]">
            <Gift className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-heading font-semibold text-gray-900">티켓 혜택</h2>
            <p className="mt-1 text-sm leading-[1.45] text-gray-600">
              사용 처리된 혜택은 다시 사용할 수 없습니다.
            </p>
          </div>
        </div>

        <ul className="space-y-3">
          {benefits.map((benefit) => (
            <BenefitRedemptionItem
              key={benefit.id}
              benefit={benefit}
              redemptionResult={redemptionResults[benefit.id]}
              isRedeeming={redeemingBenefitId === benefit.id}
              onRedeemBenefit={onRedeemBenefit}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function BenefitRedemptionItem({
  benefit,
  redemptionResult,
  isRedeeming,
  onRedeemBenefit,
}: {
  benefit: FieldBenefitEntitlement;
  redemptionResult?: ScannerBenefitRedemptionResult;
  isRedeeming: boolean;
  onRedeemBenefit?: (benefitEntitlementId: string) => void;
}) {
  const uiState = getBenefitUiState(benefit, redemptionResult);
  const redeemedAt =
    redemptionResult?.redeemedAt ??
    redemptionResult?.priorRedemption?.redeemedAt ??
    benefit.redeemedAt ??
    null;
  const canRedeem = uiState === 'available' && Boolean(onRedeemBenefit);

  return (
    <li
      data-testid={`scanner-benefit-${benefit.id}`}
      className="rounded-lg border border-gray-100 bg-gray-50/80 p-3"
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="min-w-0 break-words text-base font-semibold leading-[1.35] text-gray-900">
              {benefit.displayCopy.ko.name}
            </p>
            <Badge className="shrink-0 border-transparent bg-white text-gray-700">
              {getBenefitKindLabel(benefit.kind)}
            </Badge>
            <Badge className={getBenefitStateBadgeClassName(uiState)}>
              {getBenefitStateLabel(uiState, redemptionResult)}
            </Badge>
          </div>
          <p className="mt-1 break-words text-sm leading-[1.45] text-gray-600">
            {benefit.displayCopy.ko.description}
          </p>
          {redeemedAt && uiState === 'used' && (
            <p className="mt-2 text-sm font-semibold text-gray-700">
              사용 일시: {formatTimestamp(redeemedAt)}
            </p>
          )}
          {redemptionResult?.rejectionReason && uiState === 'rejected' && (
            <p className="mt-2 break-words text-sm font-semibold text-[#C62828]">
              {redemptionResult.rejectionReason}
            </p>
          )}
        </div>

        {canRedeem ? (
          <Button
            type="button"
            size="sm"
            className="shrink-0 bg-[#6C3CE0] hover:bg-[#5730B8]"
            disabled={isRedeeming}
            onClick={() => onRedeemBenefit?.(benefit.id)}
          >
            {isRedeeming ? '처리 중' : '사용 처리'}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function getBenefitUiState(
  benefit: FieldBenefitEntitlement,
  redemptionResult?: ScannerBenefitRedemptionResult,
): BenefitUiState {
  if (redemptionResult) {
    return redemptionResult.outcome === 'redeemed' || redemptionResult.outcome === 'duplicate'
      ? 'used'
      : 'rejected';
  }
  if (benefit.state === 'redeemed') {
    return 'used';
  }
  if (benefit.state === 'inactive') {
    return 'inactive';
  }

  return 'available';
}

function getBenefitKindLabel(kind: FieldBenefitEntitlement['kind']): string {
  return kind === 'included' ? 'ALL' : '한정';
}

function getBenefitStateLabel(
  state: BenefitUiState,
  redemptionResult?: ScannerBenefitRedemptionResult,
): string {
  if (redemptionResult) {
    return redemptionResult.outcomeLabel;
  }
  switch (state) {
    case 'used':
      return '사용됨';
    case 'inactive':
      return '비활성';
    case 'rejected':
      return '사용 불가';
    default:
      return '사용 가능';
  }
}

function getBenefitStateBadgeClassName(state: BenefitUiState): string {
  switch (state) {
    case 'used':
      return 'border-transparent bg-[#F3EFFF] text-[#6C3CE0]';
    case 'inactive':
      return 'border-transparent bg-[#F3F4F6] text-gray-600';
    case 'rejected':
      return 'border-transparent bg-[#FEF2F2] text-[#C62828]';
    default:
      return 'border-transparent bg-[#F0FDF4] text-[#15803D]';
  }
}

function ScannerAccessDenied({
  hasTicket,
  onSwitchAccount,
}: {
  hasTicket: boolean;
  onSwitchAccount?: () => void;
}) {
  const title = hasTicket ? '이 티켓을 검표할 권한이 없습니다' : '검표 권한이 없습니다';
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl items-center bg-[#F5F5F7] p-4">
      <section
        role="alert"
        aria-label={title}
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
              {title}
            </h1>
            <p className="mt-3 text-base leading-[1.5] text-gray-700">
              검표 전용 계정 또는 관리자 권한이 있는 계정으로 다시 로그인하세요.
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          {onSwitchAccount && (
            <Button
              type="button"
              className="h-11 w-full bg-[#6C3CE0] hover:bg-[#5730B8] sm:flex-1"
              onClick={onSwitchAccount}
            >
              <LogOut className="h-4 w-4" />
              다른 계정으로 로그인
            </Button>
          )}
          <Button asChild variant="outline" className="h-11 w-full sm:flex-1">
            <Link href="/">
              <Home className="h-4 w-4" />
              홈으로
            </Link>
          </Button>
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
  unverifiable,
}: {
  verification: ScannerCheckInVerification;
  result: ScannerCheckInResult;
  unverifiable: boolean;
}) {
  const style = RESULT_STYLES[result];
  // The card renders only for a settled verify result, so a missing field is
  // unknown, never "still loading".
  const statusLabel = TICKET_STATUS_LABELS[verification.ticketStatus ?? '']
    ?? (unverifiable ? '검증 실패' : '상태 확인 불가');

  return (
    <Card className="border-gray-200 bg-white shadow-sm">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-gray-500">티켓 정보</p>
            <h2 className="mt-1 text-heading font-semibold text-gray-900">
              {verification.seats.length > 0 ? verification.seats.join(', ') : '좌석 확인 불가'}
            </h2>
          </div>
          <Badge className={cn('shrink-0 whitespace-nowrap', style.badge)}>{statusLabel}</Badge>
        </div>

        <dl className="space-y-3 text-base leading-[1.5]">
          <MetadataRow label="예매 번호" value={verification.reservationNumber} />
          <MetadataRow label="공연" value={verification.performanceTitle} />
          <MetadataRow label="회차" value={formatFieldShowtimeKst(verification.showtimeAt)} />
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
        {value && value.trim().length > 0 ? value : '확인 불가'}
      </dd>
    </div>
  );
}

const TICKET_STATUS_LABELS: Record<string, string> = {
  ACTIVE: '유효',
  USED: '입장 완료',
  REVOKED: '사용 불가',
  EXPIRED: '만료',
};

function isUnverifiableResult(result: ScannerCheckInResult): boolean {
  return result === 'tampered' || result === 'rejected';
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
