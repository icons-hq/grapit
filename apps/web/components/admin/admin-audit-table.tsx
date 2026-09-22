'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/cn';
import {
  ADMIN_AUDIT_REQUIRED_CAPABILITY,
  type AdminAuditEvent,
  type AdminAuditFilters,
  type AdminAuditStatus,
} from '@/hooks/use-admin-security';

interface AdminAuditTableProps {
  rows: AdminAuditEvent[];
  filters?: AdminAuditFilters;
  isLoading: boolean;
  isError: boolean;
  onSearch: (filters: AdminAuditFilters) => void;
}

const STATUS_OPTIONS: Array<{ value: AdminAuditStatus | ''; label: string }> = [
  { value: '', label: '전체 상태' },
  { value: 'success', label: '성공' },
  { value: 'denied', label: '거부' },
  { value: 'failed', label: '실패' },
];

const STATUS_BADGE_CLASS: Record<AdminAuditStatus, string> = {
  success: 'bg-[#F0FDF4] text-[#15803D] border-transparent',
  denied: 'bg-[#FFFBEB] text-[#8B6306] border-transparent',
  failed: 'bg-[#FEF2F2] text-[#C62828] border-transparent',
};

const STATUS_LABELS: Record<AdminAuditStatus, string> = {
  success: '성공',
  denied: '거부',
  failed: '실패',
};

const SENSITIVE_FIELD_PATTERN =
  /(password|token|secret|otp|credential|authorization|cookie|session|rawExportRows|csvRows|rows)/i;

export function AdminAuditTable({
  rows,
  filters,
  isLoading,
  isError,
  onSearch,
}: AdminAuditTableProps) {
  const [actorUserId, setActorUserId] = useState(filters?.actorUserId ?? '');
  const [action, setAction] = useState(filters?.action ?? '');
  const [resourceType, setResourceType] = useState(filters?.resourceType ?? '');
  const [resourceId, setResourceId] = useState(filters?.resourceId ?? '');
  const [status, setStatus] = useState<AdminAuditStatus | ''>(
    filters?.status ?? '',
  );
  const [from, setFrom] = useState(filters?.from ?? '');
  const [to, setTo] = useState(filters?.to ?? '');

  const sortedRows = useMemo(
    () =>
      [...rows].sort(
        (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
      ),
    [rows],
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSearch({
      actorUserId,
      action,
      resourceType,
      resourceId,
      status,
      from,
      to,
      limit: filters?.limit ?? 50,
    });
  }

  return (
    <div
      className="space-y-4"
      data-required-capability={ADMIN_AUDIT_REQUIRED_CAPABILITY}
    >
      <form
        onSubmit={handleSubmit}
        className="grid gap-3 rounded-lg bg-white p-4 shadow-sm md:grid-cols-2 xl:grid-cols-4"
      >
        <label className="space-y-1.5 text-sm font-semibold text-gray-700">
          <span>관리자 계정</span>
          <Input
            value={actorUserId}
            onChange={(event) => setActorUserId(event.target.value)}
            placeholder="관리자 계정 ID"
            aria-label="관리자 계정"
          />
        </label>
        <label className="space-y-1.5 text-sm font-semibold text-gray-700">
          <span>수행 작업</span>
          <Input
            value={action}
            onChange={(event) => setAction(event.target.value)}
            placeholder="예: event.publish (공연 공개)"
            aria-label="수행 작업"
          />
        </label>
        <label className="space-y-1.5 text-sm font-semibold text-gray-700">
          <span>대상 종류</span>
          <Input
            value={resourceType}
            onChange={(event) => setResourceType(event.target.value)}
            placeholder="예: performance (공연)"
            aria-label="대상 종류"
          />
        </label>
        <label className="space-y-1.5 text-sm font-semibold text-gray-700">
          <span>대상 관리 번호</span>
          <Input
            value={resourceId}
            onChange={(event) => setResourceId(event.target.value)}
            placeholder="대상 관리 번호"
            aria-label="대상 관리 번호"
          />
        </label>
        <label className="space-y-1.5 text-sm font-semibold text-gray-700">
          <span>처리 결과</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as AdminAuditStatus | '')}
            aria-label="처리 결과"
            className="flex h-11 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value || 'all'} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1.5 text-sm font-semibold text-gray-700">
          <span>시작 시각</span>
          <Input
            type="datetime-local"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            aria-label="시작 시각"
          />
        </label>
        <label className="space-y-1.5 text-sm font-semibold text-gray-700">
          <span>종료 시각</span>
          <Input
            type="datetime-local"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            aria-label="종료 시각"
          />
        </label>
        <div className="flex items-end">
          <Button type="submit" className="h-11 w-full">
            <Search className="h-4 w-4" />
            조회
          </Button>
        </div>
      </form>

      <div className="rounded-lg bg-white shadow-sm">
        {isError && (
          <div
            role="alert"
            className="border-b bg-[#FEF2F2] px-4 py-3 text-sm font-semibold text-[#C62828]"
          >
            감사 로그를 불러오지 못했습니다. 필터를 확인하고 다시 시도하세요.
          </div>
        )}
        <Table className="admin-audit-table min-w-[1120px] table-fixed">
          <TableHeader>
            <TableRow className="bg-[#F5F5F7]">
              <TableHead className="text-sm font-semibold text-gray-600">관리자 계정</TableHead>
              <TableHead className="text-sm font-semibold text-gray-600">수행 작업</TableHead>
              <TableHead className="text-sm font-semibold text-gray-600">대상</TableHead>
              <TableHead className="text-sm font-semibold text-gray-600">처리 결과</TableHead>
              <TableHead className="text-sm font-semibold text-gray-600">작업 시각</TableHead>
              <TableHead className="text-sm font-semibold text-gray-600">접속 주소 (일부 가림)</TableHead>
              <TableHead className="text-sm font-semibold text-gray-600">사유</TableHead>
              <TableHead className="text-sm font-semibold text-gray-600">변경 내역</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading &&
              Array.from({ length: 5 }).map((_, index) => (
                <TableRow key={`audit-skeleton-${index}`}>
                  {Array.from({ length: 8 }).map((__, cellIndex) => (
                    <TableCell key={`audit-skeleton-${index}-${cellIndex}`}>
                      <Skeleton className="h-4 w-28" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}

            {!isLoading && sortedRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-12 text-center">
                  <p className="text-base font-semibold text-gray-900">
                    조회된 감사 로그가 없습니다
                  </p>
                  <p className="mt-1 text-sm text-gray-600">
                    관리자, 수행 작업, 대상이나 기간을 바꿔 다시 조회하세요.
                  </p>
                </TableCell>
              </TableRow>
            )}

            {!isLoading &&
              sortedRows.map((row) => (
                <TableRow key={row.id} data-testid="admin-audit-row">
                  <TableCell className="max-w-[180px] text-sm font-semibold text-gray-900">
                    <span className="break-all">{row.actorUserId}</span>
                  </TableCell>
                  <TableCell className="text-sm text-gray-700">
                    <code>{row.action}</code>
                  </TableCell>
                  <TableCell className="max-w-[180px] text-sm text-gray-700">
                    <span className="block font-semibold">{row.resourceType}</span>
                    <span className="block break-all text-xs text-gray-500">{row.resourceId}</span>
                  </TableCell>
                  <TableCell>
                    <Badge className={cn('whitespace-nowrap', STATUS_BADGE_CLASS[row.status])}>
                      {STATUS_LABELS[row.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-gray-700">
                    {formatDateTime(row.createdAt)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-gray-700">
                    {row.ipAddress ?? '-'}
                  </TableCell>
                  <TableCell className="max-w-[220px] text-sm text-gray-700">
                    <span className="line-clamp-2">{row.reason || '-'}</span>
                  </TableCell>
                  <TableCell className="max-w-[300px] text-sm text-gray-700">
                    {summarizeChangedFields(row)}
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function summarizeChangedFields(row: AdminAuditEvent): string {
  if (row.changedFields.length === 0) {
    return '-';
  }

  return row.changedFields
    .slice(0, 6)
    .map((field) => {
      const before = safeDiffValue(field, row.diff.before?.[field]);
      const after = safeDiffValue(field, row.diff.after?.[field]);
      return `${field}: ${before} -> ${after}`;
    })
    .join(', ');
}

function safeDiffValue(field: string, value: unknown): string {
  if (value === undefined) return '-';
  if (value === null) return 'null';
  if (SENSITIVE_FIELD_PATTERN.test(field)) return '[redacted]';
  if (typeof value === 'string') return truncate(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return truncate(JSON.stringify(redactNested(value)));
}

function redactNested(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactNested);
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      SENSITIVE_FIELD_PATTERN.test(key) ? '[redacted]' : redactNested(nestedValue),
    ]),
  );
}

function truncate(value: string): string {
  return value.length > 48 ? `${value.slice(0, 45)}...` : value;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
