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
import { AdminStatCard } from '@/components/admin/admin-stat-card';
import { AdminBookingTable } from '@/components/admin/admin-booking-table';
import { AdminBookingDetailModal } from '@/components/admin/admin-booking-detail-modal';
import { ReservationExportPanel } from '@/components/admin/reservation-export-panel';
import { useAdminBookings, useAdminRefund } from '@/hooks/use-reservations';
import type { AdminBookingFunnelStatus, PaymentStatus } from '@grabit/shared';

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

export function AdminBookingDashboard() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
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

  const { data, isLoading } = useAdminBookings({
    funnelStatus,
    paymentStatus,
    paymentMethod,
    audienceRegion,
    search: debouncedSearch.trim() || undefined,
    page,
  });

  const refundMutation = useAdminRefund();

  function handleRefund(id: string, reason: string) {
    refundMutation.mutate(
      { id, reason },
      {
        onSuccess: () => {
          toast.success('환불이 완료되었습니다');
          setSelectedBookingId(null);
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
  const bookings = data?.bookings ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const processingCount =
    (stats?.pendingPaymentCount ?? 0)
    + (stats?.paymentProcessingCount ?? 0)
    + (stats?.cancelProcessingCount ?? 0);
  const completedCancelCount =
    (stats?.cancelledCount ?? 0) + (stats?.partialCancelledCount ?? 0);

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold text-gray-900">예매 관리</h1>

      {/* Stats cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard
          icon={TicketCheck}
          label="판매 완료"
          value={stats?.soldCount ?? 0}
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

      <div className="mt-6">
        <ReservationExportPanel />
      </div>

      {/* Search + filter */}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          type="search"
          placeholder="예매번호, Toss 주문번호, 공연명, 좌석, 회원 이름/이메일/전화/ID 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full lg:max-w-[460px]"
          aria-label="예매 검색"
        />
        <div className="grid w-full grid-cols-2 gap-2 lg:flex lg:w-auto lg:flex-wrap">
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
      </div>

      {/* Booking table */}
      <div className="mt-4">
        <AdminBookingTable
          bookings={bookings}
          isLoading={isLoading}
          onRowClick={(id) => setSelectedBookingId(id)}
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
        open={selectedBookingId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedBookingId(null);
        }}
        bookingId={selectedBookingId}
        onRefund={handleRefund}
        isRefunding={refundMutation.isPending}
      />
    </div>
  );
}

interface SelectFilterProps {
  id: string;
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onValueChange: (value: string) => void;
}

function SelectFilter({
  id,
  label,
  value,
  options,
  onValueChange,
}: SelectFilterProps) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs font-semibold text-gray-600">
        {label}
      </label>
      <Select value={value} onValueChange={onValueChange}>
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
