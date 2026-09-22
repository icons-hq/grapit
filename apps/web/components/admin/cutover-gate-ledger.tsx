'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileCheck2,
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
import { cutoverLabel } from '@/lib/admin-vocabulary';
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
    label: '예외 승인',
    className: 'bg-[#FFFBEB] text-[#8B6306] border-transparent',
    icon: FileCheck2,
  },
  CONFIG_READY_NOT_DRILLED: {
    label: '설정만 확인',
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
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Seoul',
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

function isNonPassState(state: CutoverGateState) {
  return state !== 'PASS';
}

function StateBadge({ state }: { state: CutoverGateState }) {
  const copy = STATE_COPY[state];
  const Icon = copy.icon;
  return (
    <Badge className={copy.className}>
      <Icon className="h-3 w-3" />
      {copy.label}
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
      <aside className="rounded-lg bg-white p-4 shadow-sm" aria-label="점검 상세" id="cutover-detail" tabIndex={-1} style={{ scrollMarginTop: 90 }}>
        <p className="text-sm font-semibold text-gray-900">점검 항목을 선택하세요</p>
        <p className="mt-2 text-sm text-gray-600">
          항목을 선택하면 확인 자료, 승인 기록과 판매 중단·복구 기준이 표시됩니다.
        </p>
      </aside>
    );
  }

  return (
    <aside className="rounded-lg bg-white p-4 shadow-sm" aria-label="점검 상세" id="cutover-detail" tabIndex={-1} style={{ scrollMarginTop: 90 }}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-heading font-semibold leading-[1.2] text-gray-900">
              {cutoverLabel(row.gateId)}
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              {row.requirementIds.length > 0
                ? row.requirementIds.join(', ')
                : '요구사항 미연결'}
              {` · ${row.gateId}`}
              {' · '}
              {row.environment ?? '환경 미기록'}
            </p>
          </div>
          <StateBadge state={row.state} />
        </div>

        {isNonPassState(row.state) && (
          <div className="rounded-lg border border-[#F5E4B8] bg-[#FFFBEB] p-3 text-sm text-[#8B6306]">
            {row.state === 'CONFIG_READY_NOT_DRILLED'
              ? '설정 확인만으로 실제 운영 테스트가 완료되지는 않습니다'
              : '미완료 항목이 있다면 승인 사유, 추가 확인 방법과 판매 중단·복구 기준을 기록해야 합니다'}
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
              {({ approved: '승인됨', not_requested: '승인 요청 전', pending: '승인 대기', rejected: '반려', not_required: '승인 불필요' } as Record<string, string>)[row.approvalState] ?? row.approvalState}
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
            <dt className="font-semibold text-gray-600">판매 중단·복구 기준</dt>
            <dd className="mt-1 text-gray-900">
              {row.rollbackOrCloseTrigger ?? '미기록'}
            </dd>
          </div>
        </dl>

        <div>
          <p className="text-sm font-semibold text-gray-600">확인 자료</p>
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
              확인 자료가 없어 판매를 시작할 수 없습니다
            </p>
          )}
        </div>

        <div className="rounded-lg bg-[#F5F5F7] p-3 text-sm text-gray-700">
          {row.redactionNotes ??
            '확인 자료는 개인정보를 가린 요약으로 표시합니다.'}
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
  function selectGate(id: string) {
    setSelectedGateId(id);
    if (window.innerWidth < 1280) requestAnimationFrame(() => {
      const detail = document.getElementById('cutover-detail');
      detail?.focus({ preventScroll: true });
      detail?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    });
  }
  const selectedRow =
    sortedRows.find((row) => row.gateId === effectiveSelectedGateId) ?? null;
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
            점검 상태를 불러오지 못했습니다. 다시 확인해주세요. 반복되면 기술 담당자에게 문의하세요.
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
            등록된 점검 자료가 없습니다
          </h2>
          <p className="mx-auto mt-3 max-w-[640px] text-base text-gray-700">
            점검 항목별 결과와 확인 자료를 등록해야 합니다. 점검 기록이 없으면 판매를 시작할 수 없습니다.
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
            <p className="text-sm font-semibold text-gray-600">판매 시작 준비 상태</p>
            <h2
              className={cn(
                'mt-1 text-heading font-semibold leading-[1.2]',
                summary?.finalEnableAllowed ? 'text-[#15803D]' : 'text-[#C62828]',
              )}
            >
              {summary?.finalEnableAllowed
                ? '기록상 필수 점검이 검토되었습니다'
                : '기록상 미완료 점검이 있습니다'}
            </h2>
            <p className="mt-2 text-sm text-gray-700">
              {summary?.firstBlockingGate
                ? `먼저 확인할 항목: ${cutoverLabel(summary.firstBlockingGate.gateId)}`
                : '저장된 점검 결과를 기준으로 표시합니다. 실제 판매 상태는 공연에서 확인하세요.'}
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
            점검 결과 새로고침
          </Button>
        </div>
        <div className="mt-4 grid gap-2 text-sm md:grid-cols-2">
          <p className="rounded-lg border border-[#F5E4B8] bg-white/70 px-3 py-2 font-semibold text-[#8B6306]">
            설정 확인만으로 실제 운영 테스트가 완료되지는 않습니다
          </p>
          <p className="rounded-lg border border-[#F5E4B8] bg-white/70 px-3 py-2 font-semibold text-[#8B6306]">
            미완료 항목이 있다면 승인 사유, 추가 확인 방법과 판매 중단·복구 기준을 기록해야 합니다
          </p>
        </div>
      </section>

      <p className="text-sm text-muted-foreground">점검 자료 기준: {summary?.ledgerGeneratedAt ? formatDateTime(summary.ledgerGeneratedAt) : '기준 시각 미기록'} · 현재 판매 상태와 자동으로 일치하지 않을 수 있습니다.</p>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="게이트 상태 요약">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={`cutover-summary-${index}`} className="h-24 rounded-lg" />
          ))
        ) : summary ? (
          <>
            <SummaryCard label="검증 완료" value={stateCount(summary, 'PASS')} tone="pass" />
            <SummaryCard label="보완 필요" value={blockedCount} tone="blocked" />
            <SummaryCard
              label="예외 승인"
              value={stateCount(summary, 'ACCEPTED_RISK')}
              tone="amber"
            />
            <SummaryCard
              label="설정만 확인"
              value={stateCount(summary, 'CONFIG_READY_NOT_DRILLED')}
              tone="amber"
            />
            <SummaryCard
              label="증거 누락"
              value={summary.missingEvidenceCount}
              tone={summary.missingEvidenceCount > 0 ? 'blocked' : 'neutral'}
            />
            <SummaryCard
              label="우선 확인"
              value={summary.firstBlockingGate ? cutoverLabel(summary.firstBlockingGate.gateId) : '-'}
              tone={summary.firstBlockingGate ? 'blocked' : 'neutral'}
            />
          </>
        ) : null}
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="gap-0 overflow-hidden rounded-lg py-0">
          <CardHeader className="gap-2 border-b bg-white px-4 py-4">
            <CardTitle className="text-heading leading-[1.2]">
              판매 시작 점검표
            </CardTitle>
            <CardDescription>
              판매를 막는 항목부터 표시합니다. 결과, 확인 자료와 승인 여부를 차례로 살펴보세요.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow className="bg-[#F5F5F7]">
                    <TableHead scope="col">점검 항목</TableHead>
                    <TableHead scope="col">상태</TableHead>
                    <TableHead scope="col">요구사항</TableHead>
                    <TableHead scope="col">확인 자료</TableHead>
                  </TableRow>
                </TableHeader>
                {isLoading ? (
                  <LoadingRows />
                ) : (
                  <TableBody>
                    {sortedRows.map((row) => (
                      <TableRow
                        key={cutoverLabel(row.gateId)}
                        data-testid="cutover-gate-row"
                        role="button"
                        tabIndex={0}
                        aria-label={`${cutoverLabel(row.gateId)} 점검 상세 보기`}
                        className={cn(
                          'min-h-11 cursor-pointer hover:bg-gray-50',
                          effectiveSelectedGateId === row.gateId && 'bg-[#F3EFFF]',
                          row.blocking && 'border-l-4 border-l-[#C62828]',
                        )}
                        onClick={() => selectGate(row.gateId)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            selectGate(row.gateId);
                          }
                        }}
                      >
                        <TableCell className="max-w-[220px] whitespace-normal">
                          <div className="flex flex-col gap-1">
                            <span className="font-semibold text-gray-900">
                              {cutoverLabel(row.gateId)}
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
                            ? '확인 자료가 없어 판매를 시작할 수 없습니다'
                            : `${row.evidenceRefs.length}개 확인 자료`}
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
                      key={cutoverLabel(row.gateId)}
                      type="button"
                      className={cn(
                        'w-full rounded-lg border bg-white p-4 text-left',
                        effectiveSelectedGateId === row.gateId && 'border-primary bg-[#F3EFFF]',
                        row.blocking && 'border-l-4 border-l-[#C62828]',
                      )}
                      onClick={() => selectGate(row.gateId)}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="min-w-0 break-all text-sm font-semibold text-gray-900">
                          {cutoverLabel(row.gateId)}
                        </p>
                        <StateBadge state={row.state} />
                      </div>
                      <p className="mt-2 text-sm text-gray-600">
                        {row.requirementIds.join(', ') || '요구사항 미연결'} · {row.environment ?? '환경 미기록'}
                      </p>
                      <p className="mt-2 text-sm text-gray-700">
                        {row.evidenceMissing ? '확인 자료 누락' : STATE_COPY[row.state].label}
                      </p>
                    </button>
                  ))}
            </div>
          </CardContent>
        </Card>

        <GateDetail row={selectedRow} />
      </div>

      <section className="admin-panel text-sm text-muted-foreground">
        <h2 className="mb-2 font-semibold text-gray-900">판매 시작은 별도로 진행합니다</h2>
        <p>이 화면은 저장된 점검 기록을 보여줍니다. 여기에서 판매를 켜거나 끌 수 없습니다. 공연 담당자가 공개 여부와 판매 시작 시각을 확인하고, 운영 담당자가 승인된 절차에 따라 예매 허용 설정을 변경해야 합니다.</p>
      </section>
    </div>
  );
}
