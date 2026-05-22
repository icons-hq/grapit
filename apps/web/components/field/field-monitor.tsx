'use client';

import { useState } from 'react';
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
  reservationNumber?: string;
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
    label: 'entered',
    icon: TicketCheck,
    tone: 'green',
    value: (summary: NormalizedSummary) => summary.enteredCount,
  },
  {
    key: 'not-entered',
    label: 'not-entered',
    icon: Clock3,
    tone: 'neutral',
    value: (summary: NormalizedSummary) => summary.notEnteredCount,
  },
  {
    key: 'entry-rate',
    label: 'entry rate',
    icon: CheckCircle2,
    tone: 'green',
    value: (summary: NormalizedSummary) => `${summary.entryRatePercent}%`,
  },
  {
    key: 'duplicate-scans',
    label: 'duplicate scans',
    icon: AlertTriangle,
    tone: 'red',
    value: (summary: NormalizedSummary) => summary.duplicateScanCount,
  },
  {
    key: 'rejected-scans',
    label: 'rejected scans',
    icon: ShieldAlert,
    tone: 'red',
    value: (summary: NormalizedSummary) => summary.rejectedScanCount,
  },
  {
    key: 'offline-pending',
    label: 'offline pending',
    icon: WifiOff,
    tone: 'amber',
    value: (summary: NormalizedSummary) => summary.offlinePendingCount,
  },
  {
    key: 'offline-synced',
    label: 'offline synced',
    icon: CheckCircle2,
    tone: 'green',
    value: (summary: NormalizedSummary) => summary.offlineSyncedCount,
  },
  {
    key: 'latest-abnormal',
    label: 'latest abnormal',
    icon: AlertTriangle,
    tone: 'amber',
    value: (summary: NormalizedSummary) => summary.alerts.length,
  },
] as const;

const OUTCOME_OPTIONS = [
  { value: 'all', label: '전체 결과' },
  { value: 'entered', label: '입장 처리' },
  { value: 'duplicate', label: '중복' },
  { value: 'tampered', label: '위조/거절' },
  { value: 'refunded_cancelled', label: '환불/취소' },
  { value: 'offline_pending', label: '오프라인 보류' },
] as const;

const OFFLINE_STATE_OPTIONS = [
  { value: 'all', label: '전체 동기화' },
  { value: 'pending', label: 'pending' },
  { value: 'synced', label: 'synced' },
  { value: 'rejected', label: 'rejected' },
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
  offlinePendingCount: number;
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
  ticketRef: string;
  scannedAt?: string;
}

export function FieldMonitor({
  summary: controlledSummary,
  scanLogs: controlledLogs,
  initialFilters,
}: FieldMonitorProps) {
  const [filters, setFilters] = useState<FieldMonitorLogFilter>({
    eventId: initialFilters?.eventId ?? controlledSummary?.eventId ?? '',
    showtimeId: initialFilters?.showtimeId ?? controlledSummary?.showtimeId ?? undefined,
    outcome: initialFilters?.outcome,
    syncState: initialFilters?.syncState,
    scannerUserId: initialFilters?.scannerUserId,
    dateFrom: initialFilters?.dateFrom,
    dateTo: initialFilters?.dateTo,
  });

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
  const isLoading = summaryQuery.isLoading || logsQuery.isLoading;
  const isError = summaryQuery.isError || logsQuery.isError;

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
    void summaryQuery.manualRefresh();
    void logsQuery.manualRefresh();
  }

  return (
    <section className="space-y-5" aria-label="현장 모니터">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">현장 모니터</h1>
          <p className="mt-2 text-base leading-[1.5] text-gray-600">
            입장 흐름이 정상입니다
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full sm:w-auto"
          onClick={handleRefresh}
          disabled={summaryQuery.isFetching || logsQuery.isFetching}
        >
          <RefreshCcw className="h-4 w-4" />
          {summaryQuery.isFetching || logsQuery.isFetching
            ? '새로고침 중'
            : '새로고침'}
        </Button>
      </div>

      <MonitorFilters filters={filters} updateFilter={updateFilter} />

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
            value={summary ? definition.value(summary) : '-'}
            icon={definition.icon}
            tone={definition.tone}
            isLoading={isLoading && !summary}
          />
        ))}
      </div>

      <AlertPanel alerts={summary?.alerts ?? []} />

      <ScanLogTable logs={logs} />
    </section>
  );
}

function MonitorFilters({
  filters,
  updateFilter,
}: {
  filters: FieldMonitorLogFilter;
  updateFilter: <K extends keyof FieldMonitorLogFilter>(
    key: K,
    value: FieldMonitorLogFilter[K] | 'all' | '',
  ) => void;
}) {
  return (
    <Card className="border-gray-200 bg-white shadow-sm">
      <CardContent className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-6">
        <Input
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
        />
        <Select
          value={filters.outcome ?? 'all'}
          onValueChange={(value) =>
            updateFilter('outcome', value as FieldCheckInOutcome | 'all')
          }
        >
          <SelectTrigger className="h-11" aria-label="스캔 결과 필터">
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
          <SelectTrigger className="h-11" aria-label="오프라인 상태 필터">
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
        <Input
          className="h-11"
          placeholder="scanner account"
          value={filters.scannerUserId ?? ''}
          aria-label="스캐너 계정 필터"
          onChange={(event) => updateFilter('scannerUserId', event.target.value)}
        />
        <div className="grid grid-cols-2 gap-2">
          <Input
            type="date"
            className="h-11"
            value={filters.dateFrom ?? ''}
            aria-label="조회 시작일"
            onChange={(event) => updateFilter('dateFrom', event.target.value)}
          />
          <Input
            type="date"
            className="h-11"
            value={filters.dateTo ?? ''}
            aria-label="조회 종료일"
            onChange={(event) => updateFilter('dateTo', event.target.value)}
          />
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

function AlertPanel({ alerts }: { alerts: readonly NormalizedAlert[] }) {
  return (
    <Card
      data-testid="field-monitor-alerts"
      className="border-[#FDE68A] bg-white shadow-sm"
    >
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-heading font-semibold text-gray-900">
          {alerts.length > 0 ? '이상 징후를 확인하세요' : '입장 흐름이 정상입니다'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 p-4 pt-2">
        {alerts.length === 0 ? (
          <p className="text-base leading-[1.5] text-gray-600">
            아직 경고 기준을 넘은 이상 징후가 없습니다.
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

function ScanLogTable({ logs }: { logs: readonly NormalizedLog[] }) {
  return (
    <Card className="border-gray-200 bg-white shadow-sm">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-heading font-semibold text-gray-900">
          스캔 로그
        </CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto p-4 pt-2">
        <Table aria-label="스캔 로그">
          <TableHeader>
            <TableRow>
              <TableHead>예매번호</TableHead>
              <TableHead>결과</TableHead>
              <TableHead>오프라인</TableHead>
              <TableHead>스캐너</TableHead>
              <TableHead>티켓 참조</TableHead>
              <TableHead>시각</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-gray-600">
                  아직 스캔 기록이 없습니다
                </TableCell>
              </TableRow>
            ) : (
              logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="font-semibold">
                    {log.reservationNumber}
                  </TableCell>
                  <TableCell>{labelOutcome(log.outcome)}</TableCell>
                  <TableCell>{log.syncState}</TableCell>
                  <TableCell>{log.scannerUserId}</TableCell>
                  <TableCell>{log.ticketRef}</TableCell>
                  <TableCell>{formatTimestamp(log.scannedAt)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
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
    offlinePendingCount: toNumber(
      summary.offlinePendingCount ?? summary.offlinePending,
    ),
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
      alert.message ??
      alert.title ??
      ALERT_FALLBACKS[type] ??
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
    ticketRef: String(log.redactedTokenRef ?? log.maskedTicketRef ?? 'redacted'),
    scannedAt: log.scannedAt,
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

function labelOutcome(outcome: string): string {
  switch (outcome) {
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
    case 'expired':
    case 'wrong_showtime':
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
