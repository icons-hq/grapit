'use client';

import { useState, useEffect } from 'react';
import { Banknote, Clock3, RotateCcw, TicketCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
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
import { AdminStatCard } from '@/components/admin/admin-stat-card';
import { AdminBookingTable } from '@/components/admin/admin-booking-table';
import { AdminBookingDetailModal } from '@/components/admin/admin-booking-detail-modal';
import { ReservationExportPanel } from '@/components/admin/reservation-export-panel';
import { useAdminBookings, useAdminRefund } from '@/hooks/use-reservations';
import { useAdminPerformanceDetail, useAdminPerformances } from '@/hooks/use-admin';
import type {
  AdminBookingFunnelStatus,
  AdminBookingTierStats,
  BookingStats,
  PaymentStatus,
} from '@grabit/shared';

const FUNNEL_STATUS_OPTIONS = [
  { value: 'all', label: '전체 퍼널' },
  { value: 'SOLD', label: '판매 완료' },
  { value: 'PAYMENT_PENDING', label: '결제 대기' },
  { value: 'PAYMENT_PROCESSING', label: '결제 확인 중' },
  { value: 'PAYMENT_FAILED', label: '결제 실패/만료' },
  { value: 'CANCEL_PROCESSING', label: '취소/환불 처리 중' },
  { value: 'PARTIAL_CANCELLED', label: '부분 취소' },
  { value: 'CANCELLED', label: '취소 완료' },
] as const satisfies ReadonlyArray<{
  value: AdminBookingFunnelStatus | 'all';
  label: string;
}>;

const PAYMENT_STATUS_OPTIONS = [
  { value: 'all', label: '전체 결제 상태' },
  { value: 'READY', label: '결제 준비' },
  { value: 'IN_PROGRESS', label: '결제 진행 중' },
  { value: 'DONE', label: '결제 완료' },
  { value: 'CANCELED', label: '결제 취소' },
  { value: 'ABORTED', label: '결제 중단' },
  { value: 'EXPIRED', label: '결제 만료' },
] as const satisfies ReadonlyArray<{
  value: PaymentStatus | 'all';
  label: string;
}>;

const PAYMENT_METHOD_OPTIONS = [
  { value: 'all', label: '전체 결제수단' },
  { value: 'CARD', label: '카드' },
  { value: 'TRANSFER', label: '계좌이체' },
  { value: 'VIRTUAL_ACCOUNT', label: '가상계좌' },
  { value: 'MOBILE_PHONE', label: '휴대폰' },
  { value: 'FOREIGN_EASY_PAY', label: '해외 간편결제' },
  { value: 'SIMPLE_PAY', label: '국내 간편결제' },
] as const;

const AUDIENCE_REGION_OPTIONS = [
  { value: 'all', label: '전체 지역' },
  { value: 'domestic', label: '국내' },
  { value: 'overseas', label: '해외' },
] as const;

const PAGE_SIZE = 20;

const PAYMENT_FAILURE_BREAKDOWN_ITEMS = [
  ['localDeadlineExpiredCount', '내부 시간 만료'],
  ['providerExpiredCount', 'Toss 만료'],
  ['providerAbortedCount', 'Toss 실패/중단'],
  ['buyerCancelledBeforeConfirmCount', '승인 전 취소'],
  ['unreconciledProviderExpiredCount', 'Toss 만료 수신/미반영'],
  ['compensatedCancelCount', '자동 취소 보상'],
  ['otherPaymentFailureCount', '원인 확인 필요'],
] as const satisfies ReadonlyArray<readonly [keyof BookingStats, string]>;

function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}.${m}.${d} ${h}:${min}`;
}

function PaymentFailureBreakdown({ stats }: { stats?: BookingStats }) {
  const items = PAYMENT_FAILURE_BREAKDOWN_ITEMS
    .map(([key, label]) => ({
      label,
      value: Number(stats?.[key] ?? 0),
    }))
    .filter((item) => item.value > 0);

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 rounded-lg border border-[#E5E7EB] bg-white px-4 py-3 shadow-sm">
      <p className="text-sm font-semibold text-gray-900">실패/만료 분석</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {items.map((item) => (
          <span
            key={item.label}
            className="inline-flex items-center rounded border border-[#E5E7EB] bg-[#F8FAFC] px-2.5 py-1 text-xs font-medium text-[#334155]"
          >
            {item.label} {item.value.toLocaleString('ko-KR')}
          </span>
        ))}
      </div>
    </div>
  );
}

function formatWon(amount: number): string {
  return `${amount.toLocaleString('ko-KR')}원`;
}

function formatSeats(count: number): string {
  return `${count.toLocaleString('ko-KR')}석`;
}

export function AdminBookingDashboard() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [seatQuery, setSeatQuery] = useState('');
  const [debouncedSeatQuery, setDebouncedSeatQuery] = useState('');
  const [performanceId, setPerformanceId] = useState('all');
  const [showtimeId, setShowtimeId] = useState('all');
  const [seatTier, setSeatTier] = useState('all');
  const [floorKey, setFloorKey] = useState('all');
  const [funnelStatus, setFunnelStatus] =
    useState<AdminBookingFunnelStatus | 'all'>('all');
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | 'all'>(
    'all',
  );
  const [paymentMethod, setPaymentMethod] = useState('all');
  const [audienceRegion, setAudienceRegion] = useState<
    'domestic' | 'overseas' | 'all'
  >('all');
  const [page, setPage] = useState(1);
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(
    null,
  );
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailSessionKey, setDetailSessionKey] = useState(0);

  // Debounce search input by 300ms
  useEffect(() => {
    if (search === debouncedSearch) {
      return;
    }

    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, debouncedSearch]);

  useEffect(() => {
    if (seatQuery === debouncedSeatQuery) {
      return;
    }

    const timer = setTimeout(() => {
      setDebouncedSeatQuery(seatQuery);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [seatQuery, debouncedSeatQuery]);

  const {
    data: performanceList,
    isLoading: isPerformanceListLoading,
    isError: isPerformanceListError,
  } = useAdminPerformances({ page: 1, limit: 200 });
  const {
    data: selectedPerformance,
    isLoading: isPerformanceDetailLoading,
    isError: isPerformanceDetailError,
  } = useAdminPerformanceDetail(
    performanceId !== 'all' ? performanceId : '',
  );

  const { data, isLoading } = useAdminBookings({
    performanceId: performanceId !== 'all' ? performanceId : undefined,
    showtimeId: showtimeId !== 'all' ? showtimeId : undefined,
    funnelStatus,
    paymentStatus,
    paymentMethod,
    audienceRegion,
    seatTier: seatTier !== 'all' ? seatTier : undefined,
    floorKey: floorKey !== 'all' ? floorKey : undefined,
    seatQuery: debouncedSeatQuery.trim() || undefined,
    search: debouncedSearch.trim() || undefined,
    page,
  });

  const refundMutation = useAdminRefund();

  function handleBookingDetailOpen(id: string) {
    setSelectedBookingId(id);
    setDetailSessionKey((current) => current + 1);
    setDetailOpen(true);
  }

  function handleRefund(id: string, reason: string) {
    refundMutation.mutate(
      { id, reason },
      {
        onSuccess: () => {
          toast.success('환불이 완료되었습니다');
          setDetailOpen(false);
        },
        onError: () => {
          toast.error(
            '환불 처리에 실패했습니다. 잠시 후 다시 시도해주세요.',
          );
        },
      },
    );
  }

  const stats = data?.stats;
  const tierStats = data?.tierStats ?? [];
  const bookings = data?.bookings ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const processingCount =
    (stats?.pendingPaymentCount ?? 0)
    + (stats?.paymentProcessingCount ?? 0)
    + (stats?.cancelProcessingCount ?? 0);
  const completedCancelCount =
    (stats?.cancelledCount ?? 0) + (stats?.partialCancelledCount ?? 0);
  const totalSoldSeats = tierStats.reduce((sum, tier) => sum + tier.soldSeats, 0);
  const performanceOptions = [
    {
      value: 'all',
      label: isPerformanceListError
        ? '공연 옵션 로드 실패'
        : isPerformanceListLoading
          ? '공연 불러오는 중'
          : '전체 공연',
    },
    ...(performanceList?.data ?? []).map((performance) => ({
      value: performance.id,
      label: performance.title,
    })),
  ];
  const showtimeOptions = [
    {
      value: 'all',
      label: performanceId !== 'all' && isPerformanceDetailError
        ? '회차 옵션 로드 실패'
        : performanceId !== 'all' && isPerformanceDetailLoading
          ? '회차 불러오는 중'
          : '전체 회차',
    },
    ...(selectedPerformance?.showtimes ?? []).map((showtime) => ({
      value: showtime.id,
      label: formatDateTime(showtime.dateTime),
    })),
  ];
  const seatTierOptions = [
    {
      value: 'all',
      label: performanceId !== 'all' && isPerformanceDetailError
        ? '등급 옵션 로드 실패'
        : performanceId !== 'all' && isPerformanceDetailLoading
          ? '등급 불러오는 중'
          : '전체 등급',
    },
    ...(selectedPerformance?.priceTiers ?? []).map((tier) => ({
      value: tier.tierName,
      label: tier.tierName,
    })),
  ];
  const floorOptions = [
    {
      value: 'all',
      label: performanceId !== 'all' && isPerformanceDetailError
        ? '층 옵션 로드 실패'
        : performanceId !== 'all' && isPerformanceDetailLoading
          ? '층 불러오는 중'
          : '전체 층',
    },
    ...(selectedPerformance?.seatMaps ?? []).map((seatMap) => ({
      value: seatMap.floorKey,
      label: seatMap.floorLabel,
    })),
  ];
  const activeManifestContext = performanceId !== 'all' && showtimeId !== 'all'
    ? {
        performanceLabel:
          performanceOptions.find((option) => option.value === performanceId)?.label
          ?? performanceId,
        showtimeId,
        showtimeLabel:
          showtimeOptions.find((option) => option.value === showtimeId)?.label
          ?? showtimeId,
      }
    : undefined;

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold text-gray-900">예매 관리</h1>

      {/* Stats cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard
          icon={TicketCheck}
          label="판매 좌석"
          value={totalSoldSeats}
          format="count"
        />
        <AdminStatCard
          icon={Clock3}
          label="결제/취소 진행"
          value={processingCount}
          format="count"
        />
        <AdminStatCard
          icon={RotateCcw}
          label="취소 완료"
          value={completedCancelCount}
          format="count"
        />
        <AdminStatCard
          icon={Banknote}
          label="판매 매출"
          value={stats?.completedRevenue ?? 0}
          format="currency"
        />
      </div>
      <PaymentFailureBreakdown stats={stats} />

      <div className="mt-6">
        <TierStatsTable tierStats={tierStats} />
      </div>

      {/* Search + filter */}
      <div className="mt-6 flex flex-col gap-3">
        <Input
          type="search"
          placeholder="예매번호, Toss 주문번호, 공연명, 좌석, 회원 이름/이메일/전화/ID 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full lg:max-w-[460px]"
          aria-label="예매 검색"
        />
        <div className="grid w-full grid-cols-2 gap-2 xl:flex xl:w-auto xl:flex-wrap">
          <SelectFilter
            id="admin-booking-performance"
            label="공연"
            value={performanceId}
            options={performanceOptions}
            disabled={isPerformanceListLoading || isPerformanceListError}
            onValueChange={(value) => {
              setPerformanceId(value);
              setShowtimeId('all');
              setSeatTier('all');
              setFloorKey('all');
              setPage(1);
            }}
          />
          <SelectFilter
            id="admin-booking-showtime"
            label="회차"
            value={showtimeId}
            options={showtimeOptions}
            disabled={performanceId === 'all' || isPerformanceDetailLoading || isPerformanceDetailError}
            onValueChange={(value) => {
              setShowtimeId(value);
              setPage(1);
            }}
          />
          <SelectFilter
            id="admin-booking-seat-tier"
            label="좌석 등급"
            value={seatTier}
            options={seatTierOptions}
            disabled={performanceId === 'all' || isPerformanceDetailLoading || isPerformanceDetailError}
            onValueChange={(value) => {
              setSeatTier(value);
              setPage(1);
            }}
          />
          <SelectFilter
            id="admin-booking-floor"
            label="층"
            value={floorKey}
            options={floorOptions}
            disabled={performanceId === 'all' || isPerformanceDetailLoading || isPerformanceDetailError}
            onValueChange={(value) => {
              setFloorKey(value);
              setPage(1);
            }}
          />
          <SelectFilter
            id="admin-booking-funnel-status"
            label="퍼널 상태"
            value={funnelStatus}
            options={FUNNEL_STATUS_OPTIONS}
            onValueChange={(value) => {
              setFunnelStatus(value as AdminBookingFunnelStatus | 'all');
              setPage(1);
            }}
          />
          <SelectFilter
            id="admin-booking-payment-status"
            label="결제 상태"
            value={paymentStatus}
            options={PAYMENT_STATUS_OPTIONS}
            onValueChange={(value) => {
              setPaymentStatus(value as PaymentStatus | 'all');
              setPage(1);
            }}
          />
          <SelectFilter
            id="admin-booking-payment-method"
            label="결제 수단"
            value={paymentMethod}
            options={PAYMENT_METHOD_OPTIONS}
            onValueChange={(value) => {
              setPaymentMethod(value);
              setPage(1);
            }}
          />
          <SelectFilter
            id="admin-booking-audience-region"
            label="국내/해외"
            value={audienceRegion}
            options={AUDIENCE_REGION_OPTIONS}
            onValueChange={(value) => {
              setAudienceRegion(value as 'domestic' | 'overseas' | 'all');
              setPage(1);
            }}
          />
        </div>
        <Input
          type="search"
          placeholder="좌석만 검색"
          value={seatQuery}
          onChange={(e) => setSeatQuery(e.target.value)}
          className="w-full lg:max-w-[240px]"
          aria-label="좌석 검색"
        />
      </div>

      {/* Booking table */}
      <div className="mt-4">
        <ReservationExportPanel activeManifestContext={activeManifestContext} />
      </div>

      <div className="mt-4">
        <AdminBookingTable
          bookings={bookings}
          isLoading={isLoading}
          onRowClick={handleBookingDetailOpen}
        />
      </div>

      {total > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page <= 1 || isLoading}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            이전
          </Button>
          <span className="text-sm text-gray-600">
            {page.toLocaleString('ko-KR')} / {totalPages.toLocaleString('ko-KR')}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= totalPages || isLoading}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
          >
            다음
          </Button>
        </div>
      )}

      {/* Detail modal */}
      <AdminBookingDetailModal
        key={detailSessionKey}
        open={detailOpen}
        onOpenChange={(open) => {
          setDetailOpen(open);
        }}
        bookingId={selectedBookingId}
        onRefund={handleRefund}
        isRefunding={refundMutation.isPending}
      />
    </div>
  );
}

function TierStatsTable({ tierStats }: { tierStats: AdminBookingTierStats[] }) {
  return (
    <div className="rounded-lg bg-white shadow-sm">
      <div className="border-b px-4 py-3">
        <h2 className="text-base font-semibold text-gray-900">
          등급별 좌석 통계
        </h2>
      </div>
      <Table aria-label="좌석 등급별 통계">
        <TableHeader>
          <TableRow className="bg-[#F5F5F7]">
            <TableHead scope="col" className="text-sm font-semibold text-gray-600">
              등급
            </TableHead>
            <TableHead scope="col" className="text-sm font-semibold text-gray-600">
              판매
            </TableHead>
            <TableHead scope="col" className="text-sm font-semibold text-gray-600">
              매출
            </TableHead>
            <TableHead scope="col" className="text-sm font-semibold text-gray-600">
              평균단가
            </TableHead>
            <TableHead scope="col" className="text-sm font-semibold text-gray-600">
              잔여
            </TableHead>
            <TableHead scope="col" className="text-sm font-semibold text-gray-600">
              판매율
            </TableHead>
            <TableHead scope="col" className="text-sm font-semibold text-gray-600">
              취소
            </TableHead>
            <TableHead scope="col" className="text-sm font-semibold text-gray-600">
              입장
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tierStats.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="py-8 text-center text-sm text-gray-600">
                등급별 좌석 통계가 없습니다
              </TableCell>
            </TableRow>
          )}
          {tierStats.map((tier) => (
            <TableRow key={`${tier.tierName}-${tier.price}`}>
              <TableCell className="font-semibold text-gray-900">
                {tier.tierName}
              </TableCell>
              <TableCell>{formatSeats(tier.soldSeats)}</TableCell>
              <TableCell>{formatWon(tier.activeRevenue)}</TableCell>
              <TableCell>{formatWon(tier.averageTicketAmount)}</TableCell>
              <TableCell>
                {tier.remainingSeats === null ? '-' : formatSeats(tier.remainingSeats)}
              </TableCell>
              <TableCell>
                {tier.sellThroughRate === null ? '-' : `${tier.sellThroughRate}%`}
              </TableCell>
              <TableCell>
                처리중 {tier.cancelProcessingSeats.toLocaleString('ko-KR')} / 취소{' '}
                {tier.cancelledSeats.toLocaleString('ko-KR')}
              </TableCell>
              <TableCell>{formatSeats(tier.enteredSeats)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

interface SelectFilterProps {
  id: string;
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  disabled?: boolean;
  onValueChange: (value: string) => void;
}

function SelectFilter({
  id,
  label,
  value,
  options,
  disabled = false,
  onValueChange,
}: SelectFilterProps) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs font-semibold text-gray-600">
        {label}
      </label>
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger id={id} aria-label={label} className="h-10 w-full lg:w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
