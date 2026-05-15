'use client';

import { useState, useEffect } from 'react';
import { Ticket, Banknote, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
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

const STATUS_OPTIONS = [
  { value: 'all', label: '전체' },
  { value: 'CONFIRMED', label: '예매완료' },
  { value: 'CANCELLED', label: '취소완료' },
  { value: 'FAILED', label: '환불완료' },
] as const;

export function AdminBookingDashboard() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(
    null,
  );

  // Debounce search input by 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading } = useAdminBookings({
    status: filter !== 'all' ? filter : undefined,
    search: debouncedSearch || undefined,
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

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold text-gray-900">예매 관리</h1>

      {/* Stats cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <AdminStatCard
          icon={Ticket}
          label="총 예매수"
          value={stats?.totalBookings ?? 0}
          format="count"
        />
        <AdminStatCard
          icon={Banknote}
          label="총 매출액"
          value={stats?.totalRevenue ?? 0}
          format="currency"
        />
        <AdminStatCard
          icon={RotateCcw}
          label="취소율"
          value={stats?.cancelRate ?? 0}
          format="percent"
        />
      </div>

      <div className="mt-6">
        <ReservationExportPanel />
      </div>

      {/* Search + filter */}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          type="search"
          placeholder="예매번호 또는 예매자명 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full sm:w-72"
          aria-label="예매 검색"
        />
        <Select value={filter} onValueChange={(v) => { setFilter(v); setPage(1); }}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Booking table */}
      <div className="mt-4">
        <AdminBookingTable
          bookings={bookings}
          isLoading={isLoading}
          onRowClick={(id) => setSelectedBookingId(id)}
        />
      </div>

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
