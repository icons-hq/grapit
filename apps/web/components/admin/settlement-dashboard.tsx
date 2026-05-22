'use client';

import { useMemo, useState } from 'react';
import {
  Banknote,
  Download,
  FileSpreadsheet,
  ShieldAlert,
  TicketCheck,
  UsersRound,
} from 'lucide-react';
import {
  resolveAdminCapabilitySnapshot,
  type AdminCapability,
  type AdminCapabilityBundle,
  type SettlementExportDataset,
  type SettlementSummary,
} from '@grabit/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  useAdminSettlementExport,
  useAdminSettlementSummary,
  type AdminSettlementExportPayload,
  type AdminSettlementFilters,
} from '@/hooks/use-admin-settlement';
import { useAuthStore } from '@/stores/use-auth-store';
import { cn } from '@/lib/cn';

type SettlementUser = {
  id: string;
  role?: string | null;
  adminCapabilityBundle?: AdminCapabilityBundle | null;
  adminCapabilities?: readonly AdminCapability[];
};

type SettlementDashboardSummaryInput = Partial<SettlementSummary> & {
  salesAmount?: number;
  paidReservations?: number;
  refundedAmount?: number;
  entered?: number;
  noShow?: number;
  exportReady?: boolean;
};

interface SettlementMaskedSample {
  reservationNumber?: string;
  buyerName?: string;
  buyerEmail?: string;
  entryStatus?: string;
}

interface SettlementDashboardData {
  summary?: SettlementDashboardSummaryInput | null;
  maskedSamples?: readonly SettlementMaskedSample[];
  rawRows?: readonly unknown[];
}

interface SettlementDashboardProps {
  user?: SettlementUser | null;
  data?: SettlementDashboardData | null;
  requiredFilters?: Partial<AdminSettlementFilters>;
  onExport?: (payload: AdminSettlementExportPayload) => void;
}

const DATASET_ACTIONS = [
  {
    dataset: 'entry_status',
    label: '입장 상태 CSV 내보내기',
    shortLabel: '입장 상태',
    description: '입장 처리, 중복, 거절, 오프라인 동기화 상태를 대조합니다.',
  },
  {
    dataset: 'no_show_reservations',
    label: '노쇼 예약 CSV 내보내기',
    shortLabel: '노쇼 예약',
    description: '결제 완료 후 입장하지 않은 예매를 확인합니다.',
  },
  {
    dataset: 'reservation_payment_refund_summary',
    label: '예매/결제/환불 CSV 내보내기',
    shortLabel: '예매/결제/환불',
    description: '예매 상태, 결제 수단, 환불 상태를 정산 전 대조합니다.',
  },
  {
    dataset: 'settlement_accounting_input',
    label: '정산 CSV 내보내기',
    shortLabel: '정산 입력',
    description: '외부 회계 연동 전 정산 입력용 CSV를 생성합니다.',
  },
] as const satisfies readonly {
  dataset: SettlementExportDataset;
  label: string;
  shortLabel: string;
  description: string;
}[];

const PAYMENT_METHOD_OPTIONS = [
  { value: 'all', label: '전체 결제수단' },
  { value: 'CARD', label: '카드' },
  { value: 'TRANSFER', label: '계좌이체' },
  { value: 'VIRTUAL_ACCOUNT', label: '가상계좌' },
  { value: 'MOBILE_PHONE', label: '휴대폰' },
  { value: 'EASY_PAY', label: '간편결제' },
] as const;

const RESERVATION_STATUS_OPTIONS = [
  { value: 'all', label: '전체 예매' },
  { value: 'PENDING_PAYMENT', label: '결제 대기' },
  { value: 'CONFIRMED', label: '예매 완료' },
  { value: 'CANCELLED', label: '취소 완료' },
  { value: 'FAILED', label: '실패' },
] as const;

const ENTRY_STATUS_OPTIONS = [
  { value: 'all', label: '전체 입장' },
  { value: 'entered', label: '입장 완료' },
  { value: 'not_entered', label: '미입장' },
  { value: 'duplicate', label: '중복' },
  { value: 'rejected', label: '거절' },
] as const;

const REFUND_STATUS_OPTIONS = [
  { value: 'all', label: '전체 환불' },
  { value: 'none', label: '환불 없음' },
  { value: 'requested', label: '환불 요청' },
  { value: 'completed', label: '환불 완료' },
] as const;

export function SettlementDashboard({
  user: controlledUser,
  data: controlledData,
  requiredFilters,
  onExport,
}: SettlementDashboardProps) {
  const authUser = useAuthStore((state) => state.user);
  const user = controlledUser ?? authUser;

  if (controlledData || onExport) {
    return (
      <SettlementDashboardControlled
        user={user}
        data={controlledData}
        requiredFilters={requiredFilters}
        onExport={onExport}
      />
    );
  }

  return (
    <SettlementDashboardLive
      user={user}
      requiredFilters={requiredFilters}
    />
  );
}

function SettlementDashboardControlled({
  user,
  data,
  requiredFilters,
  onExport,
}: {
  user: SettlementUser | null | undefined;
  data?: SettlementDashboardData | null;
  requiredFilters?: Partial<AdminSettlementFilters>;
  onExport?: (payload: AdminSettlementExportPayload) => void;
}) {
  const filterControls = useSettlementFilterControls(requiredFilters);

  return (
    <SettlementDashboardContent
      user={user}
      summaryInput={data?.summary ?? null}
      maskedSamples={data?.maskedSamples ?? []}
      isSummaryError={false}
      isExportPending={false}
      filterControls={filterControls}
      submitExport={(payload, onSuccess) => {
        onExport?.(payload);
        onSuccess();
      }}
    />
  );
}

function SettlementDashboardLive({
  user,
  requiredFilters,
}: {
  user: SettlementUser | null | undefined;
  requiredFilters?: Partial<AdminSettlementFilters>;
}) {
  const filterControls = useSettlementFilterControls(requiredFilters);
  const summaryQuery = useAdminSettlementSummary(filterControls.filters);
  const exportMutation = useAdminSettlementExport();

  return (
    <SettlementDashboardContent
      user={user}
      summaryInput={summaryQuery.data ?? null}
      maskedSamples={[]}
      isSummaryError={summaryQuery.isError}
      isExportPending={exportMutation.isPending}
      filterControls={filterControls}
      submitExport={(payload, onSuccess) => {
        exportMutation.mutate(payload, { onSuccess });
      }}
    />
  );
}

function useSettlementFilterControls(
  requiredFilters?: Partial<AdminSettlementFilters>,
) {
  const [filters, setFilters] = useState<AdminSettlementFilters>({
    eventId: requiredFilters?.eventId ?? '',
    showtimeId: requiredFilters?.showtimeId ?? '',
    dateFrom: requiredFilters?.dateFrom ?? '',
    dateTo: requiredFilters?.dateTo ?? '',
    paymentMethod: requiredFilters?.paymentMethod ?? 'all',
    reservationStatus: requiredFilters?.reservationStatus ?? 'all',
    entryStatus: requiredFilters?.entryStatus ?? 'all',
    refundStatus: requiredFilters?.refundStatus ?? 'all',
  });

  return { filters, setFilters };
}

type SettlementFilterControls = ReturnType<typeof useSettlementFilterControls>;

function SettlementDashboardContent({
  user,
  summaryInput,
  maskedSamples,
  isSummaryError,
  isExportPending,
  filterControls,
  submitExport,
}: {
  user: SettlementUser | null | undefined;
  summaryInput: SettlementDashboardSummaryInput | null;
  maskedSamples: readonly SettlementMaskedSample[];
  isSummaryError: boolean;
  isExportPending: boolean;
  filterControls: SettlementFilterControls;
  submitExport: (
    payload: AdminSettlementExportPayload,
    onSuccess: () => void,
  ) => void;
}) {
  const { filters, setFilters } = filterControls;
  const [reason, setReason] = useState('');
  const [pendingDataset, setPendingDataset] = useState<SettlementExportDataset | null>(null);

  const allowed = canAccessSettlement(user);
  const summary = normalizeSummary(summaryInput, filters);
  const selectedDataset = DATASET_ACTIONS.find(
    (action) => action.dataset === pendingDataset,
  );
  const requiredFiltersReady = Boolean(
    filters.eventId && filters.showtimeId && filters.dateFrom && filters.dateTo,
  );
  const canConfirmExport =
    allowed && requiredFiltersReady && reason.trim().length > 0 && !isExportPending;
  const filterSummary = useMemo(
    () => buildFilterSummary(filters, user?.id ?? 'unknown'),
    [filters, user?.id],
  );

  function updateFilter<K extends keyof AdminSettlementFilters>(
    key: K,
    value: AdminSettlementFilters[K],
  ) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function handleConfirmExport() {
    if (!pendingDataset || !canConfirmExport || !filters.eventId) {
      return;
    }

    const payload: AdminSettlementExportPayload = compactPayload({
      eventId: filters.eventId,
      showtimeId: filters.showtimeId,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      dataset: pendingDataset,
      reason: reason.trim(),
    });

    submitExport(payload, () => {
        setReason('');
        setPendingDataset(null);
    });
  }

  if (!allowed) {
    return (
      <section className="rounded-lg border border-[#F3C7C7] bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3 text-[#C62828]">
          <ShieldAlert className="mt-1 h-5 w-5" aria-hidden="true" />
          <div>
            <h1 className="text-xl font-semibold text-gray-900">
              정산 데이터를 내보낼 권한이 없습니다
            </h1>
            <p className="mt-2 text-sm font-semibold text-[#C62828]">
              scanner-only accounts cannot access settlement export
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-5" aria-label="정산·내보내기">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold leading-[1.2] text-gray-900">
            정산·내보내기
          </h1>
          <p className="mt-2 text-base leading-[1.5] text-gray-600">
            행사 종료 후 매출, 결제, 환불, 입장, 노쇼 데이터를 검토하고 필요한 CSV만 내보냅니다.
          </p>
        </div>
        <Badge className="w-fit border-transparent bg-[#F3EFFF] text-[#6C3CE0]">
          정산 입력 자료
        </Badge>
      </div>

      <SettlementFilters filters={filters} updateFilter={updateFilter} />

      {isSummaryError && (
        <div
          role="alert"
          className="rounded-lg border border-[#F3C7C7] bg-white p-4 text-sm font-semibold text-[#C62828]"
        >
          정산 데이터를 불러오지 못했습니다. 필터, 권한, API 상태를 확인하세요.
        </div>
      )}

      <div data-testid="settlement-summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard icon={Banknote} label="총 매출" value={formatCurrency(summary.grossSalesAmount)} tone="green" />
        <MetricCard icon={UsersRound} label="결제 완료" value={`${summary.paidReservationCount.toLocaleString('ko-KR')}건`} tone="neutral" />
        <MetricCard icon={Banknote} label="환불 금액" value={formatCurrency(summary.refundedAmount)} tone="red" />
        <MetricCard icon={TicketCheck} label="입장 완료" value={`${summary.enteredCount.toLocaleString('ko-KR')}건`} tone="green" />
        <MetricCard icon={UsersRound} label="노쇼" value={`${summary.noShowCount.toLocaleString('ko-KR')}건`} tone="amber" />
      </div>

      <Tabs defaultValue="summary" className="rounded-lg border bg-white p-4 shadow-sm">
        <TabsList>
          <TabsTrigger value="summary">요약</TabsTrigger>
          <TabsTrigger value="entry">입장/노쇼</TabsTrigger>
          <TabsTrigger value="payments">결제/환불</TabsTrigger>
          <TabsTrigger value="exports">내보내기</TabsTrigger>
        </TabsList>
        <TabsContent value="summary" className="mt-4 bg-[#F5F5F7] p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <SummaryTile label="입장률" value={`${Math.round(summary.entryRate * 100)}%`} />
            <SummaryTile label="환불 건수" value={`${summary.refundCount.toLocaleString('ko-KR')}건`} />
            <SummaryTile label="생성 시각" value={formatTimestamp(summary.generatedAt)} />
          </div>
        </TabsContent>
        <TabsContent value="entry" className="mt-4 bg-[#F5F5F7] p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <SummaryTile label="입장 완료" value={`${summary.enteredCount.toLocaleString('ko-KR')}건`} />
            <SummaryTile label="노쇼 예약" value={`${summary.noShowCount.toLocaleString('ko-KR')}건`} />
          </div>
          <MaskedSampleTable samples={maskedSamples} />
        </TabsContent>
        <TabsContent value="payments" className="mt-4 bg-[#F5F5F7] p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <SummaryTile label="결제 완료" value={`${summary.paidReservationCount.toLocaleString('ko-KR')}건`} />
            <SummaryTile label="총 매출" value={formatCurrency(summary.grossSalesAmount)} />
            <SummaryTile label="환불 금액" value={formatCurrency(summary.refundedAmount)} />
          </div>
        </TabsContent>
        <TabsContent value="exports" className="mt-4 bg-[#F5F5F7] p-4">
          <ExportActions
            requiredFiltersReady={requiredFiltersReady}
            onSelectDataset={setPendingDataset}
          />
        </TabsContent>
      </Tabs>

      <div data-testid="settlement-export-panel">
        <ExportActions
          requiredFiltersReady={requiredFiltersReady}
          onSelectDataset={setPendingDataset}
        />
      </div>

      <Dialog open={pendingDataset !== null} onOpenChange={(open) => !open && setPendingDataset(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>정산 데이터를 내보내시겠습니까?</DialogTitle>
            <DialogDescription>
              개인정보와 결제/환불 정보가 포함될 수 있습니다. 필터, 권한, 사유를 확인한 뒤 내보내세요.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div role="alert" className="flex gap-3 rounded-lg border border-[#F3C7C7] bg-[#FEF2F2] p-3 text-sm font-semibold text-[#C62828]">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>원본 CSV에는 개인정보와 결제/환불 정보가 포함될 수 있습니다.</span>
            </div>

            <div className="rounded-lg bg-[#F5F5F7] p-3">
              <p className="text-sm font-semibold text-gray-700">필터 요약</p>
              <dl className="mt-2 grid gap-2 text-sm text-gray-700 sm:grid-cols-2">
                {filterSummary.map((item) => (
                  <div key={item.label} className="flex justify-between gap-3 rounded-md bg-white px-3 py-2">
                    <dt className="font-semibold">{item.label}</dt>
                    <dd className="text-right">{item.value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {selectedDataset && (
              <div className="rounded-lg border p-3 text-sm text-gray-700">
                <p className="font-semibold text-gray-900">{selectedDataset.shortLabel}</p>
                <p className="mt-1">{selectedDataset.description}</p>
              </div>
            )}

            <p className="text-sm font-semibold text-[#8B6306]">
              감사 로그에 내보내기 사유와 필터가 기록됩니다.
            </p>

            {!requiredFiltersReady && (
              <p role="alert" className="text-sm font-semibold text-[#C62828]">
                이벤트, 회차, 조회 시작일, 조회 종료일을 모두 입력해야 합니다.
              </p>
            )}

            <label className="space-y-1.5 text-sm font-semibold text-gray-700">
              <span>내보내기 사유</span>
              <Textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                aria-label="내보내기 사유"
                placeholder="예: 행사 종료 정산 대조"
              />
            </label>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingDataset(null)}>
              취소
            </Button>
            <Button
              type="button"
              disabled={!canConfirmExport}
              onClick={handleConfirmExport}
              className="bg-[#C62828] hover:bg-[#A81F1F]"
            >
              CSV 내보내기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function SettlementFilters({
  filters,
  updateFilter,
}: {
  filters: AdminSettlementFilters;
  updateFilter: <K extends keyof AdminSettlementFilters>(
    key: K,
    value: AdminSettlementFilters[K],
  ) => void;
}) {
  return (
    <Card className="border-gray-200 bg-white py-0 shadow-sm">
      <CardContent className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
        <Input
          className="h-11"
          placeholder="event ID"
          value={filters.eventId ?? ''}
          aria-label="이벤트"
          onChange={(event) => updateFilter('eventId', event.target.value)}
        />
        <Input
          className="h-11"
          placeholder="showtime ID"
          value={filters.showtimeId ?? ''}
          aria-label="회차"
          onChange={(event) => updateFilter('showtimeId', event.target.value)}
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
        <Select
          value={filters.paymentMethod ?? 'all'}
          onValueChange={(value) => updateFilter('paymentMethod', value)}
        >
          <SelectTrigger className="h-11" aria-label="결제 수단">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAYMENT_METHOD_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.reservationStatus ?? 'all'}
          onValueChange={(value) => updateFilter('reservationStatus', value)}
        >
          <SelectTrigger className="h-11" aria-label="예매 상태">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RESERVATION_STATUS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.entryStatus ?? 'all'}
          onValueChange={(value) => updateFilter('entryStatus', value)}
        >
          <SelectTrigger className="h-11" aria-label="입장 상태">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ENTRY_STATUS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.refundStatus ?? 'all'}
          onValueChange={(value) => updateFilter('refundStatus', value)}
        >
          <SelectTrigger className="h-11" aria-label="환불 상태">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REFUND_STATUS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardContent>
    </Card>
  );
}

function ExportActions({
  requiredFiltersReady,
  onSelectDataset,
}: {
  requiredFiltersReady: boolean;
  onSelectDataset: (dataset: SettlementExportDataset) => void;
}) {
  return (
    <section className="grid gap-3 md:grid-cols-2" aria-label="정산 CSV 내보내기">
      {DATASET_ACTIONS.map((action) => (
        <Card key={action.dataset} className="border-gray-200 bg-white py-0 shadow-sm">
          <CardContent className="flex h-full flex-col justify-between gap-4 p-4">
            <div>
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-gray-500" aria-hidden="true" />
                <h3 className="text-base font-semibold text-gray-900">{action.shortLabel}</h3>
              </div>
              <p className="mt-2 text-sm leading-[1.4] text-gray-600">
                {action.description}
              </p>
            </div>
            <Button
              type="button"
              className="h-11 w-full"
              disabled={!requiredFiltersReady}
              onClick={() => onSelectDataset(action.dataset)}
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              {action.label}
            </Button>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Banknote;
  label: string;
  value: string;
  tone: 'green' | 'amber' | 'red' | 'neutral';
}) {
  return (
    <Card className="border-gray-200 bg-white py-0 shadow-sm">
      <CardContent className="flex min-h-[116px] items-start justify-between gap-3 p-4">
        <div>
          <p className="text-sm font-semibold leading-[1.4] text-gray-500">{label}</p>
          <p className="mt-3 text-[28px] font-semibold leading-[1.2] text-gray-900">{value}</p>
        </div>
        <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-lg', toneClass(tone))}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white p-4">
      <p className="text-sm font-semibold text-gray-500">{label}</p>
      <p className="mt-2 text-base font-semibold text-gray-900">{value}</p>
    </div>
  );
}

function MaskedSampleTable({ samples }: { samples: readonly SettlementMaskedSample[] }) {
  return (
    <div className="mt-4 overflow-x-auto rounded-lg border bg-white">
      <Table aria-label="masked settlement sample">
        <TableHeader>
          <TableRow>
            <TableHead>예매번호</TableHead>
            <TableHead>마스킹 이름</TableHead>
            <TableHead>마스킹 이메일</TableHead>
            <TableHead>입장 상태</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {samples.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="h-24 text-center text-gray-600">
                개인정보 원본 row는 브라우저에서 미리보기하지 않습니다.
              </TableCell>
            </TableRow>
          ) : (
            samples.map((sample, index) => (
              <TableRow key={`${sample.reservationNumber ?? 'sample'}-${index}`}>
                <TableCell className="font-semibold">{sample.reservationNumber ?? '-'}</TableCell>
                <TableCell>{sample.buyerName ?? '-'}</TableCell>
                <TableCell>{sample.buyerEmail ?? '-'}</TableCell>
                <TableCell>{sample.entryStatus ?? '-'}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function canAccessSettlement(user: SettlementUser | null | undefined): boolean {
  const snapshot = resolveAdminCapabilitySnapshot({
    id: user?.id ?? 'anonymous',
    role: user?.role ?? null,
    adminCapabilityBundle: user?.adminCapabilityBundle ?? null,
    adminCapabilities: user?.adminCapabilities ?? [],
  });

  return snapshot.superuser || snapshot.capabilities.includes('settlement.export');
}

function normalizeSummary(
  summary: SettlementDashboardSummaryInput | null,
  filters: AdminSettlementFilters,
) {
  return {
    eventId: summary?.eventId ?? filters.eventId ?? '',
    showtimeId: summary?.showtimeId ?? filters.showtimeId,
    currency: summary?.currency ?? 'KRW',
    grossSalesAmount: toNumber(summary?.grossSalesAmount ?? summary?.salesAmount),
    paidReservationCount: toNumber(summary?.paidReservationCount ?? summary?.paidReservations),
    refundedAmount: toNumber(summary?.refundedAmount),
    refundCount: toNumber(summary?.refundCount),
    enteredCount: toNumber(summary?.enteredCount ?? summary?.entered),
    noShowCount: toNumber(summary?.noShowCount ?? summary?.noShow),
    entryRate: toNumber(summary?.entryRate),
    generatedAt: summary?.generatedAt ?? new Date(0).toISOString(),
  };
}

function buildFilterSummary(filters: AdminSettlementFilters, actorId: string) {
  return [
    { label: '이벤트', value: filters.eventId || '필수' },
    { label: '회차', value: filters.showtimeId || '필수' },
    {
      label: '기간',
      value: `${filters.dateFrom || '필수'} ~ ${filters.dateTo || '필수'}`,
    },
    { label: '결제 수단', value: labelFor(PAYMENT_METHOD_OPTIONS, filters.paymentMethod ?? 'all') },
    { label: '예매 상태', value: labelFor(RESERVATION_STATUS_OPTIONS, filters.reservationStatus ?? 'all') },
    { label: '입장 상태', value: labelFor(ENTRY_STATUS_OPTIONS, filters.entryStatus ?? 'all') },
    { label: '환불 상태', value: labelFor(REFUND_STATUS_OPTIONS, filters.refundStatus ?? 'all') },
    { label: '작업자', value: actorId },
  ];
}

function compactPayload(
  payload: AdminSettlementExportPayload,
): AdminSettlementExportPayload {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined && value !== ''),
  ) as AdminSettlementExportPayload;
}

function labelFor<T extends readonly { value: string; label: string }[]>(
  options: T,
  value: string,
): string {
  return options.find((option) => option.value === value)?.label ?? value;
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

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('ko-KR', {
    style: 'currency',
    currency: 'KRW',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatTimestamp(value?: string): string {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() === 0) {
    return '-';
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
