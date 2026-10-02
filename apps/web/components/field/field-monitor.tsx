'use client';

import { useState } from 'react';
import { useAdminEventContext } from '@/components/admin/admin-event-context';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  RefreshCcw,
  ShieldAlert,
  TicketCheck,
  WifiOff,
} from 'lucide-react';
import type {
  FieldCheckInOutcome,
  FieldMonitorAlert,
  FieldMonitorLogFilter,
  FieldMonitorLogRow,
  FieldMonitorSummary,
  FieldOfflineSyncState,
} from '@grabit/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  useFieldMonitorLogs,
  useFieldMonitorSummary,
} from '@/hooks/use-field-monitor';
import { cn } from '@/lib/cn';
import { useAuthStore } from '@/stores/use-auth-store';

type AlertInput = Omit<Partial<FieldMonitorAlert>, 'severity' | 'type'> & {
  id?: string;
  type?: string;
  title?: string;
  message?: string;
  severity?: string;
};

type SummaryInput = Omit<
  Partial<FieldMonitorSummary>,
  'latestAbnormalAlerts'
> & {
  entered?: number;
  notEntered?: number;
  duplicateScans?: number;
  rejectedScans?: number;
  offlinePending?: number;
  offlineSynced?: number;
  alerts?: AlertInput[];
  latestAbnormalAlerts?: AlertInput[];
  lastUpdatedAt?: string;
};

type LogInput = Omit<Partial<FieldMonitorLogRow>, 'outcome' | 'syncState'> & {
  reservationNumber?: string | null;
  outcome?: string | null;
  result?: string | null;
  syncState?: string | null;
  maskedTicketRef?: string;
  rawToken?: string;
  rawJti?: string;
  buyerEmail?: string;
  buyerPhone?: string;
};

interface FieldMonitorProps {
  summary?: SummaryInput | null;
  scanLogs?: readonly LogInput[];
  initialFilters?: Partial<FieldMonitorLogFilter>;
}

const KPI_DEFINITIONS = [
  {
    key: 'entered',
    label: '입장 완료',
    icon: TicketCheck,
    tone: 'green',
    value: (summary: NormalizedSummary) => summary.enteredCount,
  },
  {
    key: 'not-entered',
    label: '미입장',
    icon: Clock3,
    tone: 'neutral',
    value: (summary: NormalizedSummary) => summary.notEnteredCount,
  },
  {
    key: 'entry-rate',
    label: '입장률',
    icon: CheckCircle2,
    tone: 'green',
    value: (summary: NormalizedSummary) => `${summary.entryRatePercent}%`,
  },
  {
    key: 'duplicate-scans',
    label: '중복 스캔',
    icon: AlertTriangle,
    tone: 'red',
    value: (summary: NormalizedSummary) => summary.duplicateScanCount,
  },
  {
    key: 'rejected-scans',
    label: '거절 스캔',
    icon: ShieldAlert,
    tone: 'red',
    value: (summary: NormalizedSummary) => summary.rejectedScanCount,
  },
  // No server KPI for offline pending: those attempts stay on each device until
  // synced, so a server count is always 0. DeviceBacklogNotice says where to look.
  {
    key: 'offline-synced',
    label: '동기화 완료',
    icon: CheckCircle2,
    tone: 'green',
    value: (summary: NormalizedSummary) => summary.offlineSyncedCount,
  },
  {
    key: 'latest-abnormal',
    label: '최근 이상 알림',
    icon: AlertTriangle,
    tone: 'amber',
    value: (summary: NormalizedSummary) => summary.alerts.length,
  },
] as const;

// Each option matches the results the server records. '중복' covers both
// duplicate and already_used, like the duplicate KPI and alert. Offline pending
// is never recorded on the server, so it is not offered.
const OUTCOME_OPTIONS = [
  { value: 'all', label: '전체 결과' },
  { value: 'entered', label: '입장 처리' },
  { value: 'duplicate', label: '중복' },
  { value: 'tampered', label: '위조/확인 불가' },
  { value: 'wrong_showtime', label: '다른 회차' },
  { value: 'expired', label: '만료' },
  { value: 'refunded_cancelled', label: '환불/취소' },
] as const;

const OFFLINE_STATE_OPTIONS = [
  { value: 'all', label: '전체 동기화' },
  { value: 'synced', label: '동기화 완료' },
  { value: 'rejected', label: '충돌/거절' },
] as const;

const ALERT_FALLBACKS: Record<string, string> = {
  duplicate_spike: '중복 스캔이 평소보다 많습니다',
  rejected_tampered_scan: '위조 또는 거절된 스캔이 발생했습니다',
  refunded_cancelled_attempt: '환불 또는 취소된 티켓 스캔이 있습니다',
  offline_backlog: '동기화되지 않은 보류 스캔이 남아 있습니다',
  sync_failure: '보류 스캔 동기화 실패가 발생했습니다',
};

interface NormalizedSummary {
  eventId: string;
  showtimeId: string;
  enteredCount: number;
  notEnteredCount: number;
  entryRatePercent: number;
  duplicateScanCount: number;
  rejectedScanCount: number;
  offlineSyncedCount: number;
  alerts: NormalizedAlert[];
  updatedAt?: string;
}

interface NormalizedAlert {
  id: string;
  type: string;
  severity: FieldMonitorAlert['severity'];
  message: string;
  count?: number;
  detectedAt?: string;
}

interface NormalizedLog {
  id: string;
  reservationNumber: string;
  outcome: string;
  syncState: string;
  scannerUserId: string;
  scannerName: string;
  seatLabel: string;
  source?: 'online' | 'offline_sync';
  ticketRef: string;
  scannedAt?: string;
  rejectionReason?: string;
}

/**
 * The server records a scan of a Ticket Item whose cancellation is not
 * confirmed yet (audit #115) as refunded_cancelled with its own reason.
 */
const CANCELLATION_PENDING_REASON_PREFIX = '취소 처리 중';
const CANCELLATION_PENDING_LABEL = '취소 처리 중(환불 미확정)';

export function FieldMonitor({
  summary: controlledSummary,
  scanLogs: controlledLogs,
  initialFilters,
}: FieldMonitorProps) {
  const context = useAdminEventContext();
  const user = useAuthStore((state) => state.user);
  const [localFilters, setFilters] = useState<FieldMonitorLogFilter>({
    eventId: initialFilters?.eventId ?? controlledSummary?.eventId ?? '',
    showtimeId: initialFilters?.showtimeId ?? controlledSummary?.showtimeId ?? undefined,
    outcome: initialFilters?.outcome,
    syncState: initialFilters?.syncState,
    scannerUserId: initialFilters?.scannerUserId,
    dateFrom: initialFilters?.dateFrom,
    dateTo: initialFilters?.dateTo,
  });

  const filters = context ? { ...localFilters, eventId: context.performanceId, showtimeId: context.showtimeId || undefined } : localFilters;

  const summaryQuery = useFieldMonitorSummary({
    eventId: filters.eventId,
    showtimeId: filters.showtimeId,
    enabled: !controlledSummary,
  });
  const logsQuery = useFieldMonitorLogs({
    ...filters,
    enabled: !controlledLogs,
  });

  const summary = normalizeSummary(controlledSummary ?? summaryQuery.summary);
  const logs = normalizeLogs(controlledLogs ?? logsQuery.logs);
  const scanners = [...new Map([
    ...(user ? [[user.id, { id: user.id, name: `${user.name} (내 기록)` }] as const] : []),
    ...logs.map((log) => [log.scannerUserId, { id: log.scannerUserId, name: log.scannerName }] as const),
  ]).values()];
  const paused = summaryQuery.fetchStatus === 'paused' || logsQuery.fetchStatus === 'paused';
  const isLoading = summaryQuery.isLoading || logsQuery.isLoading;
  const isError = summaryQuery.isError || logsQuery.isError;
  const canRefresh = Boolean(filters.eventId && filters.showtimeId);
  const summaryReady = canRefresh && !paused && !isError && summary?.eventId === filters.eventId && summary?.showtimeId === filters.showtimeId;
  const logsReady = canRefresh && !paused && !isError && (controlledLogs !== undefined || logsQuery.data !== undefined);
  const stateMessage = !canRefresh ? '공연과 회차를 선택하면 현장 현황을 조회합니다.'
    : paused ? '연결 복구를 기다리고 있습니다. 연결되면 현장 현황을 다시 조회합니다.'
      : isError ? null : !summaryReady || !logsReady ? '선택한 회차의 현장 현황을 조회하고 있습니다.' : null;

  function updateFilter<K extends keyof FieldMonitorLogFilter>(
    key: K,
    value: FieldMonitorLogFilter[K] | 'all' | '',
  ) {
    setFilters((current) => ({
      ...current,
      [key]: value === '' || value === 'all' ? undefined : value,
    }));
  }

  function handleRefresh() {
    if (!canRefresh) {
      return;
    }

    void summaryQuery.manualRefresh();
    void logsQuery.manualRefresh();
  }

  return (
    <section className="space-y-5" aria-label="현장 모니터">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">입장 현황</h1>
          <p className="mt-2 text-base leading-[1.5] text-gray-600">
            회차별 입장·중복·동기화 현황을 확인합니다.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full sm:w-auto"
          onClick={handleRefresh}
          disabled={!canRefresh || summaryQuery.isFetching || logsQuery.isFetching}
        >
          <RefreshCcw className="h-4 w-4" />
          {summaryQuery.isFetching || logsQuery.isFetching
            ? '새로고침 중'
            : '새로고침'}
        </Button>
      </div>

      <MonitorFilters filters={filters} updateFilter={updateFilter} scanners={scanners} />
      <p className="text-sm text-gray-600">요약은 선택한 회차 전체 기준입니다. 중복·거절 스캔과 스캔 로그는 검표 화면에서 이 회차를 선택하고 확인한 기록입니다. 결과·동기화·스캐너·기간 필터는 아래 스캔 로그에만 적용됩니다. 조회 날짜와 표시 시각은 한국 시간(KST)입니다.</p>
      {stateMessage && <p role="status" className="rounded-lg border border-gray-200 bg-white p-5 text-gray-600">{stateMessage}</p>}
      {summaryReady && summary?.updatedAt && <p className="text-sm text-gray-500">최근 조회 {formatTimestamp(summary.updatedAt)} KST{summaryQuery.isFetching || logsQuery.isFetching ? ' · 갱신 중' : ''}</p>}

      {isError && (
        <section
          role="alert"
          className="rounded-lg border border-[#F3C7C7] bg-white p-5 text-[#C62828]"
        >
          <p className="text-base font-semibold">
            행사 운영 데이터를 불러오지 못했습니다. 새로고침 후 다시 시도하고,
            반복되면 네트워크 상태, 권한, API 상태를 확인하세요.
          </p>
        </section>
      )}

      <div
        data-testid="field-monitor-kpi-grid"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        {KPI_DEFINITIONS.map((definition) => (
          <KpiCard
            key={definition.key}
            id={definition.key}
            label={definition.label}
            value={summaryReady && summary ? definition.value(summary) : '-'}
            icon={definition.icon}
            tone={definition.tone}
            isLoading={isLoading && !summary}
          />
        ))}
      </div>

      <DeviceBacklogNotice />

      {summaryReady && logsReady && <AlertPanel alerts={summary?.alerts ?? []} logs={logs} />}

      {logsReady && <ScanLogTable logs={logs} />}
    </section>
  );
}

// Same height and width as the native select and date inputs beside them. The
// shared trigger sets its height through data-size, which a plain h-11 loses to.
const SELECT_TRIGGER_CLASS = 'h-11 w-full data-[size=default]:h-11';

function MonitorFilters({
  filters,
  updateFilter,
  scanners,
}: {
  filters: FieldMonitorLogFilter;
  scanners: Array<{ id: string; name: string }>;
  updateFilter: <K extends keyof FieldMonitorLogFilter>(
    key: K,
    value: FieldMonitorLogFilter[K] | 'all' | '',
  ) => void;
}) {
  const context = useAdminEventContext();
  return (
    <Card className="border-gray-200 bg-white shadow-sm">
      <CardContent className="grid items-end gap-3 p-4 sm:grid-cols-2 xl:grid-cols-[minmax(130px,1fr)_minmax(130px,1fr)_minmax(160px,1fr)_minmax(320px,2fr)]">
        {!context && <><Input
          className="h-11"
          placeholder="event ID"
          value={filters.eventId ?? ''}
          aria-label="행사 필터"
          onChange={(event) => updateFilter('eventId', event.target.value)}
        />
        <Input
          className="h-11"
          placeholder="showtime ID"
          value={filters.showtimeId ?? ''}
          aria-label="회차 필터"
          onChange={(event) => updateFilter('showtimeId', event.target.value)}
        /></>}
        <Select
          value={filters.outcome ?? 'all'}
          onValueChange={(value) =>
            updateFilter('outcome', value as FieldCheckInOutcome | 'all')
          }
        >
          <SelectTrigger className={SELECT_TRIGGER_CLASS} aria-label="스캔 결과 필터">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OUTCOME_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.syncState ?? 'all'}
          onValueChange={(value) =>
            updateFilter('syncState', value as FieldOfflineSyncState | 'all')
          }
        >
          <SelectTrigger className={SELECT_TRIGGER_CLASS} aria-label="오프라인 상태 필터">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OFFLINE_STATE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <select className="h-11 w-full min-w-0 rounded-md border border-gray-200 bg-white px-3 text-sm"
          value={filters.scannerUserId ?? 'all'} aria-label="스캐너 계정 필터"
          onChange={(event) => updateFilter('scannerUserId', event.target.value)}>
          <option value="all">전체 담당자</option>
          {filters.scannerUserId && !scanners.some((scanner) => scanner.id === filters.scannerUserId)
            && <option value={filters.scannerUserId}>선택한 담당자</option>}
          {scanners.map((scanner) => <option key={scanner.id} value={scanner.id}>{scanner.name}</option>)}
        </select>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="text-xs text-gray-600">조회 시작일<Input
            type="date"
            className="h-11"
            value={filters.dateFrom ?? ''}
            aria-label="조회 시작일"
            onChange={(event) => updateFilter('dateFrom', event.target.value)}
          /></label>
          <label className="text-xs text-gray-600">조회 종료일<Input
            type="date"
            className="h-11"
            value={filters.dateTo ?? ''}
            aria-label="조회 종료일"
            onChange={(event) => updateFilter('dateTo', event.target.value)}
          /></label>
        </div>
      </CardContent>
    </Card>
  );
}

function KpiCard({
  id,
  label,
  value,
  icon: Icon,
  tone,
  isLoading,
}: {
  id: string;
  label: string;
  value: string | number;
  icon: typeof TicketCheck;
  tone: 'green' | 'amber' | 'red' | 'neutral';
  isLoading: boolean;
}) {
  return (
    <Card
      data-testid={`field-monitor-kpi-${id}`}
      className="border-gray-200 bg-white shadow-sm"
    >
      <CardContent className="flex min-h-[116px] items-start justify-between gap-3 p-4">
        <div>
          <p className="text-sm font-semibold leading-[1.4] text-gray-500">
            {label}
          </p>
          <p className="mt-3 text-[28px] font-semibold leading-[1.2] text-gray-900">
            {isLoading ? '-' : value}
          </p>
        </div>
        <div
          className={cn(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg',
            toneClass(tone),
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

function DeviceBacklogNotice() {
  return (
    <div
      data-testid="field-monitor-device-backlog-notice"
      className="flex items-start gap-3 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-4 text-[#8B6306]"
    >
      <WifiOff className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <p className="text-sm leading-[1.5]">
        <span className="font-semibold">동기화 대기는 이 화면에 집계되지 않습니다.</span>{' '}
        통신이 끊긴 동안 처리한 입장은 각 현장 단말의 동기화 대기 목록에만 있고, 동기화하기 전에는 입장 완료·중복 스캔에도 반영되지 않습니다.
        단말마다 대기 목록을 확인하고 연결이 복구되면 보류 스캔 동기화를 실행하도록 안내하세요.
      </p>
    </div>
  );
}

function AlertPanel({ alerts, logs }: { alerts: readonly NormalizedAlert[]; logs: readonly NormalizedLog[] }) {
  return (
    <Card
      data-testid="field-monitor-alerts"
      className="border-[#FDE68A] bg-white shadow-sm"
    >
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-heading font-semibold text-gray-900">
          {alerts.length > 0 ? '이상 징후를 확인하세요' : '조회된 경고 없음'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 p-4 pt-2">
        {alerts.length === 0 ? (
          <p className="text-base leading-[1.5] text-gray-600">
            이번 조회 범위에서 경고 기준을 넘은 기록이 없습니다. 기기별 미전송 기록은 현장 단말에서 확인해주세요.
          </p>
        ) : (
          alerts.map((alert) => (
            <div
              key={alert.id}
              className={cn(
                'rounded-lg border px-3 py-3',
                alert.severity === 'critical'
                  ? 'border-[#F3C7C7] bg-[#FEF2F2] text-[#C62828]'
                  : 'border-[#FDE68A] bg-[#FFFBEB] text-[#8B6306]',
              )}
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-semibold leading-[1.4]">
                    {alert.message}
                  </p>
                  {alert.type === 'refunded_cancelled_attempt' && (
                    <RefundedCancelledBreakdown total={alert.count ?? 0} logs={logs} />
                  )}
                  <p className="mt-1 text-sm leading-[1.4]">
                    {formatTimestamp(alert.detectedAt)}
                  </p>
                </div>
                <Badge
                  className={cn(
                    'w-fit border-transparent',
                    alert.severity === 'critical'
                      ? 'bg-[#FEF2F2] text-[#C62828]'
                      : 'bg-[#FFFBEB] text-[#8B6306]',
                  )}
                >
                  {alert.count ?? 0}건
                </Badge>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Splits the refunded/cancelled alert. The server counts both cases together
 * for the whole showtime; the split comes from the loaded scan log (latest 100
 * rows, filters applied), and rows outside it are reported as not split.
 */
function RefundedCancelledBreakdown({ total, logs }: { total: number; logs: readonly NormalizedLog[] }) {
  const refundedCancelled = logs.filter((log) => log.outcome === 'refunded_cancelled');
  const pending = refundedCancelled.filter(isCancellationPendingLog).length;
  const confirmed = refundedCancelled.length - pending;
  const outsideLog = Math.max(total - refundedCancelled.length, 0);

  return (
    <p data-testid="field-monitor-refunded-breakdown" className="mt-1 text-sm font-semibold leading-[1.4]">
      취소 처리 중 {pending}건 · 환불/취소 {confirmed}건
      {outsideLog > 0 ? ` · 스캔 로그 밖 ${outsideLog}건(구분 전)` : ''}
    </p>
  );
}

function ScanLogTable({ logs }: { logs: readonly NormalizedLog[] }) {
  return (
    <Card className="border-gray-200 bg-white shadow-sm">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-heading font-semibold text-gray-900">
          스캔 로그 · 최근 100개
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-2">
        {/* Phones get one card per scan instead of a table scrolled sideways. */}
        <ul aria-label="스캔 로그 목록" className="space-y-2 sm:hidden">
          {logs.length === 0 ? (
            <li className="py-6 text-center text-sm text-gray-600">선택한 조건에 해당하는 스캔 기록이 없습니다</li>
          ) : (
            logs.map((log) => (
              <li key={log.id} className="rounded-lg border border-gray-200 p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 break-keep font-semibold text-gray-900">{log.seatLabel}</p>
                  <span className="shrink-0 tabular-nums text-gray-600">{formatTime(log.scannedAt)}</span>
                </div>
                <p className="mt-1 font-semibold text-gray-900">{labelOutcome(log)}</p>
                {log.rejectionReason && <p className="mt-1 break-keep text-gray-600">{log.rejectionReason}</p>}
                <p className="mt-1 text-xs text-gray-500">
                  {log.reservationNumber} · {labelSource(log)} · {log.scannerName}
                </p>
              </li>
            ))
          )}
        </ul>
        <div data-testid="field-monitor-log-table" className="hidden sm:block">
        <Table aria-label="스캔 로그">
          <TableHeader>
            <TableRow>
              <TableHead>좌석</TableHead>
              <TableHead>결과</TableHead>
              <TableHead>예매번호</TableHead>
              <TableHead>오프라인</TableHead>
              <TableHead>스캐너</TableHead>
              <TableHead>티켓 참조</TableHead>
              <TableHead>시각</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-gray-600">
                  선택한 조건에 해당하는 스캔 기록이 없습니다
                </TableCell>
              </TableRow>
            ) : (
              logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="font-semibold">{log.seatLabel}</TableCell>
                  <TableCell className="whitespace-normal">
                    <span className="font-semibold">{labelOutcome(log)}</span>
                    {log.rejectionReason && (
                      <span className="mt-0.5 block max-w-[240px] break-keep text-xs text-gray-500">{log.rejectionReason}</span>
                    )}
                  </TableCell>
                  <TableCell className="font-semibold">
                    {log.reservationNumber}
                  </TableCell>
                  <TableCell>{labelSource(log)}</TableCell>
                  <TableCell title={log.scannerUserId}>{log.scannerName}</TableCell>
                  <TableCell>{log.ticketRef}</TableCell>
                  <TableCell className="tabular-nums">{formatShortTimestamp(log.scannedAt)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function isCancellationPendingLog(log: NormalizedLog): boolean {
  return log.outcome === 'refunded_cancelled'
    && Boolean(log.rejectionReason?.startsWith(CANCELLATION_PENDING_REASON_PREFIX));
}

function labelSource(log: NormalizedLog): string {
  if (log.source === 'online') return '온라인';
  return ({ pending: '대기', synced: '동기화 완료', rejected: '충돌/거절' } as Record<string, string>)[log.syncState] ?? '미확인';
}

function normalizeSummary(summary?: SummaryInput | null): NormalizedSummary | null {
  if (!summary) {
    return null;
  }

  const alerts = (summary.latestAbnormalAlerts ?? summary.alerts ?? []).map(
    normalizeAlert,
  );
  const entryRateValue = toNumber(summary.entryRate);

  return {
    eventId: String(summary.eventId ?? ''),
    showtimeId: String(summary.showtimeId ?? ''),
    enteredCount: toNumber(summary.enteredCount ?? summary.entered),
    notEnteredCount: toNumber(summary.notEnteredCount ?? summary.notEntered),
    entryRatePercent:
      entryRateValue <= 1
        ? Math.round(entryRateValue * 100)
        : Math.round(entryRateValue),
    duplicateScanCount: toNumber(
      summary.duplicateScanCount ?? summary.duplicateScans,
    ),
    rejectedScanCount: toNumber(summary.rejectedScanCount ?? summary.rejectedScans),
    offlineSyncedCount: toNumber(
      summary.offlineSyncedCount ?? summary.offlineSynced,
    ),
    alerts,
    updatedAt: summary.updatedAt ?? summary.lastUpdatedAt,
  };
}

function normalizeAlert(alert: AlertInput, index: number): NormalizedAlert {
  const type = String(alert.type ?? alert.id ?? `alert-${index}`);
  return {
    id: String(alert.id ?? `${type}-${index}`),
    type,
    severity: normalizeSeverity(alert.severity),
    message:
      ALERT_FALLBACKS[type] ??
      alert.message ??
      alert.title ??
      '이상 징후를 확인하세요',
    count: typeof alert.count === 'number' ? alert.count : undefined,
    detectedAt: alert.detectedAt,
  };
}

function normalizeSeverity(value: string | undefined): FieldMonitorAlert['severity'] {
  if (value === 'info' || value === 'warning' || value === 'critical') {
    return value;
  }

  return 'warning';
}

function normalizeLogs(logs: readonly LogInput[] | undefined): NormalizedLog[] {
  return (logs ?? []).map((log, index) => ({
    id: String(log.id ?? `scan-log-${index}`),
    reservationNumber: String(log.reservationNumber ?? '-'),
    outcome: String(log.outcome ?? log.result ?? 'rejected'),
    syncState: String(log.syncState ?? '-'),
    scannerUserId: String(log.scannerUserId ?? '-'),
    scannerName: log.scannerName ?? '담당자 이름 미확인',
    seatLabel: log.seatLabel ?? '좌석 정보 미확인',
    source: log.source,
    ticketRef: String(log.redactedTokenRef ?? log.maskedTicketRef ?? 'redacted'),
    scannedAt: log.scannedAt,
    rejectionReason: log.rejectionReason?.trim() || undefined,
  }));
}

function toneClass(tone: 'green' | 'amber' | 'red' | 'neutral'): string {
  switch (tone) {
    case 'green':
      return 'bg-[#F0FDF4] text-[#15803D]';
    case 'amber':
      return 'bg-[#FFFBEB] text-[#8B6306]';
    case 'red':
      return 'bg-[#FEF2F2] text-[#C62828]';
    case 'neutral':
      return 'bg-[#F5F5F7] text-[#6B6B7B]';
  }
}

function labelOutcome(log: NormalizedLog): string {
  if (isCancellationPendingLog(log)) return CANCELLATION_PENDING_LABEL;
  switch (log.outcome) {
    case 'entered':
    case 'success':
      return '입장 처리';
    case 'duplicate':
    case 'already_used':
      return '중복';
    case 'refunded_cancelled':
      return '환불/취소';
    case 'offline_pending':
      return '오프라인 보류';
    case 'tampered':
      return '위조/확인 불가';
    case 'wrong_showtime':
      return '다른 회차';
    case 'expired':
      return '만료';
    case 'rejected':
    default:
      return '거절';
  }
}

function formatTimestamp(value?: string): string {
  if (!value) {
    return '-';
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

const KST_PARTS = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function kstParts(value?: string): Partial<Record<Intl.DateTimeFormatPartTypes, string>> | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Object.fromEntries(KST_PARTS.formatToParts(date).map((part) => [part.type, part.value]));
}

/** `10.03 19:30` (KST) for the scan log table. */
function formatShortTimestamp(value?: string): string {
  const parts = kstParts(value);
  return parts ? `${parts.month}.${parts.day} ${parts.hour}:${parts.minute}` : value ?? '-';
}

/** `19:30` (KST) for the phone scan log cards. */
function formatTime(value?: string): string {
  const parts = kstParts(value);
  return parts ? `${parts.hour}:${parts.minute}` : value ?? '-';
}

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}
