'use client';

import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import {
  ADMIN_SECURITY_REQUIRED_CAPABILITY,
  type AdminSecurityStatusResponse,
} from '@/hooks/use-admin-security';

interface AdminSecuritySummaryProps {
  status: AdminSecurityStatusResponse | undefined;
  isLoading: boolean;
  isError: boolean;
}

const MFA_DEFERRED_COPY =
  '추가 본인 인증은 아직 적용되지 않았습니다. 허용된 접속 주소와 관리자 활동 기록으로 접근을 확인합니다.';

const ALLOWLIST_MODE_LABELS: Record<
  AdminSecurityStatusResponse['ipAllowlist']['mode'],
  string
> = {
  disabled: '비활성',
  monitoring: '모니터링',
  enforced: '적용 중',
};

const SOURCE_LABELS: Record<
  AdminSecurityStatusResponse['currentRequest']['source'],
  string
> = {
  env_bootstrap: '초기 설정',
  db_managed: '등록된 허용 주소',
  temporary_exception: '임시 허용',
  non_production_bypass: '개발 환경 허용',
  denied: '접속 거부',
};

export function AdminSecuritySummary({
  status,
  isLoading,
  isError,
}: AdminSecuritySummaryProps) {
  if (isLoading) {
    return (
      <section className="grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={`security-summary-skeleton-${index}`} className="rounded-lg bg-white p-4 shadow-sm">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="mt-4 h-8 w-24" />
            <Skeleton className="mt-3 h-4 w-full" />
          </div>
        ))}
      </section>
    );
  }

  if (isError || !status) {
    return (
      <div
        role="alert"
        className="rounded-lg bg-[#FEF2F2] p-4 text-sm font-semibold text-[#C62828]"
      >
        보안 상태를 불러오지 못했습니다. 새로고침 후 다시 시도하세요.
      </div>
    );
  }

  const requestAllowed = status.currentRequest.allowed;

  return (
    <section
      className="grid gap-4 lg:grid-cols-3"
      data-required-capability={ADMIN_SECURITY_REQUIRED_CAPABILITY}
    >
      <div className="rounded-lg bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-gray-900">접속 허용 주소</h2>
          <Badge
            className={cn(
              'border-transparent',
              status.ipAllowlist.mode === 'enforced'
                ? 'bg-[#F0FDF4] text-[#15803D]'
                : 'bg-[#FFFBEB] text-[#8B6306]',
            )}
          >
            {ALLOWLIST_MODE_LABELS[status.ipAllowlist.mode]}
          </Badge>
        </div>
        <dl className="mt-4 grid gap-3 text-sm">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-gray-600">사용 중인 허용 주소</dt>
            <dd className="font-semibold text-gray-900">{status.ipAllowlist.activeRecords}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-gray-600">최근 변경</dt>
            <dd className="font-semibold text-gray-900">
              {formatDateTime(status.ipAllowlist.lastChangedAt)}
            </dd>
          </div>
        </dl>
      </div>

      <div className="rounded-lg bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-gray-900">현재 요청</h2>
          <Badge
            className={cn(
              'border-transparent',
              requestAllowed
                ? 'bg-[#F0FDF4] text-[#15803D]'
                : 'bg-[#FEF2F2] text-[#C62828]',
            )}
          >
            {requestAllowed ? '허용' : '거부'}
          </Badge>
        </div>
        <dl className="mt-4 grid gap-3 text-sm">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-gray-600">현재 접속 주소</dt>
            <dd className="font-semibold text-gray-900">{status.currentRequest.maskedIpAddress}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-gray-600">허용 근거</dt>
            <dd className="font-semibold text-gray-900">
              {SOURCE_LABELS[status.currentRequest.source]}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-gray-600">허용된 주소 범위</dt>
            <dd className="font-semibold text-gray-900">
              {status.currentRequest.matchedCidr ?? '-'}
            </dd>
          </div>
        </dl>
      </div>

      <div className="rounded-lg bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-[#8B6306]" />
          <h2 className="text-base font-semibold text-gray-900">추가 본인 인증</h2>
        </div>
        <Badge className="mt-4 border-transparent bg-[#FFFBEB] text-[#8B6306]">
          추가 인증 미적용
        </Badge>
        <p className="mt-3 text-sm font-semibold text-gray-900">
          {MFA_DEFERRED_COPY}
        </p>
        <div className="mt-4 flex items-center gap-2 text-sm text-gray-600">
          <ShieldCheck className="h-4 w-4 text-[#6C3CE0]" />
          최근 감사 이벤트: {formatDateTime(status.lastAuditEventAt)}
        </div>
      </div>
    </section>
  );
}

function formatDateTime(value: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Seoul',
  }).format(date);
}
