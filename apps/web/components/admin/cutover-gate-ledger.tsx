'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileCheck2,
  LockKeyhole,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
import type {
  AdminCutoverGateRow,
  AdminCutoverGateSummary,
  CutoverGateState,
} from '@/hooks/use-admin-cutover';

interface CutoverGateLedgerProps {
  summary: AdminCutoverGateSummary | undefined;
  isLoading: boolean;
  isError: boolean;
  isRefreshing?: boolean;
  onRefresh: () => void;
}

const STATE_COPY: Record<
  CutoverGateState,
  { label: string; className: string; icon: typeof CheckCircle2 }
> = {
  PASS: {
    label: '검증 완료',
    className: 'bg-[#F0FDF4] text-[#15803D] border-transparent',
    icon: CheckCircle2,
  },
  FAIL: {
    label: '실패',
    className: 'bg-[#FEF2F2] text-[#C62828] border-transparent',
    icon: ShieldAlert,
  },
  BLOCKED: {
    label: '차단',
    className: 'bg-[#FEF2F2] text-[#C62828] border-transparent',
    icon: AlertTriangle,
  },
  ACCEPTED_RISK: {
    label: '승인된 리스크',
    className: 'bg-[#FFFBEB] text-[#8B6306] border-transparent',
    icon: FileCheck2,
  },
  CONFIG_READY_NOT_DRILLED: {
    label: '설정 증거',
    className: 'bg-[#FFFBEB] text-[#8B6306] border-transparent',
    icon: Clock3,
  },
};

const STATE_RANK: Record<CutoverGateState, number> = {
  BLOCKED: 0,
  FAIL: 1,
  ACCEPTED_RISK: 3,
  CONFIG_READY_NOT_DRILLED: 4,
  PASS: 5,
};

function formatDateTime(value: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function sortGateRows(rows: AdminCutoverGateRow[]) {
  return [...rows].sort((left, right) => {
    if (left.blocking !== right.blocking) {
      return Number(right.blocking) - Number(left.blocking);
    }
    if (left.evidenceMissing !== right.evidenceMissing) {
      return Number(right.evidenceMissing) - Number(left.evidenceMissing);
    }
    const stateDelta = STATE_RANK[left.state] - STATE_RANK[right.state];
    if (stateDelta !== 0) return stateDelta;
    return left.gateId.localeCompare(right.gateId);
  });
}

function stateCount(summary: AdminCutoverGateSummary, state: CutoverGateState) {
  return summary.countsByState[state] ?? 0;
}

function getFinalEnableReason(summary: AdminCutoverGateSummary | undefined) {
  if (!summary) return 'Gate Ledger 데이터를 불러온 뒤 다시 확인하세요.';
  if (summary.finalEnableAllowed) {
    return '모든 필수 게이트가 검토되었습니다. 운영 runbook에서 rollback trigger를 다시 확인한 뒤 진행하세요.';
  }

  const blockingGate = summary.firstBlockingGate;
  if (!blockingGate) {
    return '서버가 finalEnableAllowed=false로 판단했습니다. Gate Ledger artifact와 API 상태를 확인하세요.';
  }

  return `BOOKING_ENABLED=true는 ${blockingGate.gateId} 때문에 비활성화되어 있습니다.`;
}

function isNonPassState(state: CutoverGateState) {
  return state !== 'PASS';
}

function StateBadge({ state }: { state: CutoverGateState }) {
  const copy = STATE_COPY[state];
  const Icon = copy.icon;
  return (
    <Badge className={copy.className}>
      <Icon className="h-3 w-3" />
      {state}
    </Badge>
  );
}

function SummaryCard({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  tone?: 'pass' | 'blocked' | 'amber' | 'neutral';
}) {
  return (
    <Card className="gap-3 rounded-lg py-4">
      <CardContent className="space-y-1 px-4">
        <p className="text-sm font-semibold text-gray-600">{label}</p>
        <p
          className={cn(
            'text-heading font-semibold leading-[1.2]',
            tone === 'pass' && 'text-[#15803D]',
            tone === 'blocked' && 'text-[#C62828]',
            tone === 'amber' && 'text-[#8B6306]',
            tone === 'neutral' && 'text-gray-900',
          )}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function LoadingRows() {
  return (
    <TableBody>
      {Array.from({ length: 5 }).map((_, index) => (
        <TableRow key={`cutover-skeleton-${index}`}>
          <TableCell><Skeleton className="h-4 w-40" /></TableCell>
          <TableCell><Skeleton className="h-5 w-28" /></TableCell>
          <TableCell><Skeleton className="h-4 w-24" /></TableCell>
          <TableCell><Skeleton className="h-4 w-28" /></TableCell>
          <TableCell><Skeleton className="h-4 w-52" /></TableCell>
        </TableRow>
      ))}
    </TableBody>
  );
}

function GateDetail({ row }: { row: AdminCutoverGateRow | null }) {
  if (!row) {
    return (
      <aside className="rounded-lg bg-white p-4 shadow-sm" aria-label="게이트 상세">
        <p className="text-sm font-semibold text-gray-900">게이트를 선택하세요</p>
        <p className="mt-2 text-sm text-gray-600">
          행을 선택하면 증거, 승인 상태, 보완 모니터링, rollback trigger를 확인할 수 있습니다.
        </p>
      </aside>
    );
  }

  return (
    <aside className="rounded-lg bg-white p-4 shadow-sm" aria-label="게이트 상세">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-heading font-semibold leading-[1.2] text-gray-900">
              {row.gateId}
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              {row.requirementIds.length > 0
                ? row.requirementIds.join(', ')
                : '요구사항 미연결'}
              {' · '}
              {row.environment ?? '환경 미기록'}
            </p>
          </div>
          <StateBadge state={row.state} />
        </div>

        {isNonPassState(row.state) && (
          <div className="rounded-lg border border-[#F5E4B8] bg-[#FFFBEB] p-3 text-sm text-[#8B6306]">
            {row.state === 'CONFIG_READY_NOT_DRILLED'
              ? '설정 증거는 있지만 실제 drill PASS는 아닙니다'
              : 'PASS가 아닌 상태로 진행하려면 실패 게이트, 보완 모니터링, rollback trigger를 기록해야 합니다'}
          </div>
        )}

        <dl className="grid gap-3 text-sm">
          <div>
            <dt className="font-semibold text-gray-600">실패/주의 사유</dt>
            <dd className="mt-1 text-gray-900">
              {row.failureReason ?? row.blockingReason ?? '기록된 실패 사유 없음'}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-gray-600">승인 상태</dt>
            <dd className="mt-1 text-gray-900">
              {row.approvalState}
              {row.approver ? ` · ${row.approver}` : ''}
              {row.approvalTimestamp
                ? ` · ${formatDateTime(row.approvalTimestamp)}`
                : ''}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-gray-600">보완 모니터링</dt>
            <dd className="mt-1 text-gray-900">
              {row.compensatingMonitoring ?? '미기록'}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-gray-600">Rollback / close trigger</dt>
            <dd className="mt-1 text-gray-900">
              {row.rollbackOrCloseTrigger ?? '미기록'}
            </dd>
          </div>
        </dl>

        <div>
          <p className="text-sm font-semibold text-gray-600">Evidence refs</p>
          {row.evidenceRefs.length > 0 ? (
            <ul className="mt-2 space-y-1 text-sm text-gray-900">
              {row.evidenceRefs.map((ref) => (
                <li key={ref} className="break-all rounded-md bg-[#F5F5F7] px-3 py-2">
                  {ref}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 rounded-md bg-[#F5F5F7] px-3 py-2 text-sm text-gray-700">
              증거가 비어 있어 no-go입니다
            </p>
          )}
        </div>

        <div className="rounded-lg bg-[#F5F5F7] p-3 text-sm text-gray-700">
          {row.redactionNotes ??
            'Evidence preview는 redacted refs/metadata만 표시하며 raw provider payload는 표시하지 않습니다.'}
        </div>
      </div>
    </aside>
  );
}

export function CutoverGateLedger({
  summary,
  isLoading,
  isError,
  isRefreshing = false,
  onRefresh,
}: CutoverGateLedgerProps) {
  const sortedRows = useMemo(
    () => sortGateRows(summary?.rows ?? []),
    [summary?.rows],
  );
  const [selectedGateId, setSelectedGateId] = useState<string | null>(null);
  const preferredGateId =
    summary?.firstBlockingGate?.gateId ?? sortedRows[0]?.gateId ?? null;
  const effectiveSelectedGateId =
    selectedGateId && sortedRows.some((row) => row.gateId === selectedGateId)
      ? selectedGateId
      : preferredGateId;
  const selectedRow =
    sortedRows.find((row) => row.gateId === effectiveSelectedGateId) ?? null;
  const finalEnableReason = getFinalEnableReason(summary);
  const blockedCount = summary
    ? stateCount(summary, 'BLOCKED') + stateCount(summary, 'FAIL')
    : 0;

  if (isError) {
    return (
      <Card className="rounded-lg border-[#F3C7C7]">
        <CardContent className="p-6">
          <div
            role="alert"
            className="rounded-lg bg-[#FEF2F2] p-4 text-sm font-semibold text-[#C62828]"
          >
            게이트 상태를 불러오지 못했습니다. 새로고침 후 다시 시도하고, 반복되면 Gate Ledger artifact와 API 상태를 확인하세요.
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!isLoading && sortedRows.length === 0) {
    return (
      <Card className="rounded-lg">
        <CardContent className="p-8 text-center">
          <h2 className="text-heading font-semibold leading-[1.2] text-gray-900">
            등록된 게이트 증거가 없습니다
          </h2>
          <p className="mx-auto mt-3 max-w-[640px] text-base text-gray-700">
            Gate Ledger 행을 생성하고 각 게이트의 상태와 증거 파일을 연결하세요. 빈 행이 있으면 BOOKING_ENABLED=true는 no-go입니다.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <section
        className={cn(
          'rounded-lg border p-5 shadow-sm',
          summary?.finalEnableAllowed
            ? 'border-[#B7E4C7] bg-[#F0FDF4]'
            : 'border-[#F3C7C7] bg-[#FEF2F2]',
        )}
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-600">Go / no-go</p>
            <h2
              className={cn(
                'mt-1 text-heading font-semibold leading-[1.2]',
                summary?.finalEnableAllowed ? 'text-[#15803D]' : 'text-[#C62828]',
              )}
            >
              {summary?.finalEnableAllowed
                ? '모든 필수 게이트가 검토되었습니다'
                : '아직 라이브 예매를 열 수 없습니다'}
            </h2>
            <p className="mt-2 text-sm text-gray-700">
              {summary?.firstBlockingGate
                ? `첫 번째 blocking gate: ${summary.firstBlockingGate.gateId}`
                : '서버가 내려준 Gate Ledger readiness만 표시합니다.'}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-11 bg-white"
            onClick={onRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} />
            게이트 검증하기
          </Button>
        </div>
        <div className="mt-4 grid gap-2 text-sm md:grid-cols-2">
          <p className="rounded-lg border border-[#F5E4B8] bg-white/70 px-3 py-2 font-semibold text-[#8B6306]">
            설정 증거는 있지만 실제 drill PASS는 아닙니다
          </p>
          <p className="rounded-lg border border-[#F5E4B8] bg-white/70 px-3 py-2 font-semibold text-[#8B6306]">
            PASS가 아닌 상태로 진행하려면 실패 게이트, 보완 모니터링, rollback trigger를 기록해야 합니다
          </p>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6" aria-label="게이트 상태 요약">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={`cutover-summary-${index}`} className="h-24 rounded-lg" />
          ))
        ) : summary ? (
          <>
            <SummaryCard label="PASS" value={stateCount(summary, 'PASS')} tone="pass" />
            <SummaryCard label="BLOCKED/FAIL" value={blockedCount} tone="blocked" />
            <SummaryCard
              label="ACCEPTED_RISK"
              value={stateCount(summary, 'ACCEPTED_RISK')}
              tone="amber"
            />
            <SummaryCard
              label="CONFIG_READY_NOT_DRILLED"
              value={stateCount(summary, 'CONFIG_READY_NOT_DRILLED')}
              tone="amber"
            />
            <SummaryCard
              label="증거 누락"
              value={summary.missingEvidenceCount}
              tone={summary.missingEvidenceCount > 0 ? 'blocked' : 'neutral'}
            />
            <SummaryCard
              label="다음 no-go"
              value={summary.firstBlockingGate?.gateId ?? '-'}
              tone={summary.firstBlockingGate ? 'blocked' : 'neutral'}
            />
          </>
        ) : null}
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Card className="gap-0 overflow-hidden rounded-lg py-0">
          <CardHeader className="gap-2 border-b bg-white px-4 py-4">
            <CardTitle className="text-heading leading-[1.2]">
              Gate Ledger
            </CardTitle>
            <CardDescription>
              blockers-first 정렬로 상태, 증거 freshness, 승인 metadata, rollback/close trigger를 확인합니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow className="bg-[#F5F5F7]">
                    <TableHead scope="col">Gate</TableHead>
                    <TableHead scope="col">상태</TableHead>
                    <TableHead scope="col">요구사항</TableHead>
                    <TableHead scope="col">증거 freshness</TableHead>
                    <TableHead scope="col">실패/주의 사유</TableHead>
                  </TableRow>
                </TableHeader>
                {isLoading ? (
                  <LoadingRows />
                ) : (
                  <TableBody>
                    {sortedRows.map((row) => (
                      <TableRow
                        key={row.gateId}
                        data-testid="cutover-gate-row"
                        role="button"
                        tabIndex={0}
                        aria-label={`${row.gateId} 게이트 상세 보기`}
                        className={cn(
                          'min-h-11 cursor-pointer hover:bg-gray-50',
                          effectiveSelectedGateId === row.gateId && 'bg-[#F3EFFF]',
                          row.blocking && 'border-l-4 border-l-[#C62828]',
                        )}
                        onClick={() => setSelectedGateId(row.gateId)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setSelectedGateId(row.gateId);
                          }
                        }}
                      >
                        <TableCell className="max-w-[220px] whitespace-normal">
                          <div className="flex flex-col gap-1">
                            <span className="font-semibold text-gray-900">
                              {row.gateId}
                            </span>
                            <span className="text-sm text-gray-600">
                              {row.environment ?? '환경 미기록'}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <StateBadge state={row.state} />
                        </TableCell>
                        <TableCell className="whitespace-normal text-sm text-gray-700">
                          {row.requirementIds.join(', ') || '-'}
                        </TableCell>
                        <TableCell className="whitespace-normal text-sm text-gray-700">
                          {row.evidenceMissing
                            ? '증거가 비어 있어 no-go입니다'
                            : `${row.evidenceRefs.length}개 evidence ref`}
                        </TableCell>
                        <TableCell className="max-w-[320px] whitespace-normal text-sm text-gray-700">
                          {row.blockingReason ?? row.failureReason ?? STATE_COPY[row.state].label}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                )}
              </Table>
            </div>

            <div className="space-y-3 p-4 md:hidden">
              {isLoading
                ? Array.from({ length: 4 }).map((_, index) => (
                    <Skeleton key={`cutover-card-${index}`} className="h-32 rounded-lg" />
                  ))
                : sortedRows.map((row) => (
                    <button
                      key={row.gateId}
                      type="button"
                      className={cn(
                        'w-full rounded-lg border bg-white p-4 text-left',
                        effectiveSelectedGateId === row.gateId && 'border-primary bg-[#F3EFFF]',
                        row.blocking && 'border-l-4 border-l-[#C62828]',
                      )}
                      onClick={() => setSelectedGateId(row.gateId)}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="min-w-0 break-all text-sm font-semibold text-gray-900">
                          {row.gateId}
                        </p>
                        <StateBadge state={row.state} />
                      </div>
                      <p className="mt-2 text-sm text-gray-600">
                        {row.requirementIds.join(', ') || '요구사항 미연결'} · {row.environment ?? '환경 미기록'}
                      </p>
                      <p className="mt-2 text-sm text-gray-700">
                        {row.blockingReason ?? row.failureReason ?? STATE_COPY[row.state].label}
                      </p>
                    </button>
                  ))}
            </div>
          </CardContent>
        </Card>

        <GateDetail row={selectedRow} />
      </div>

      <section className="sticky bottom-4 z-10 rounded-lg border bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[#F5F5F7] text-gray-700">
              <LockKeyhole className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-heading font-semibold leading-[1.2] text-gray-900">
                BOOKING_ENABLED=true final action
              </h2>
              <p className="mt-2 text-sm text-gray-700">{finalEnableReason}</p>
              <p className="mt-1 text-sm text-gray-600">
                금융 또는 좌석 안전 기준을 위반하면 즉시 예매를 닫습니다
              </p>
            </div>
          </div>
          <Button
            type="button"
            className="h-12 w-full lg:w-auto"
            disabled={!summary?.finalEnableAllowed}
          >
            BOOKING_ENABLED=true 활성화
          </Button>
        </div>
      </section>

      <section className="grid gap-3 text-sm text-gray-700 md:grid-cols-2">
        <div className="rounded-lg bg-white p-4 shadow-sm">
          100% 직접 배포 후 15분 동안 핵심 경로를 감시합니다
        </div>
        <div className="rounded-lg bg-white p-4 shadow-sm">
          이 phase는 Cloud Run traffic-split canary를 사용하지 않습니다
        </div>
      </section>
    </div>
  );
}
