'use client';

import { formatAdminKstDateTime } from '@/lib/admin-datetime';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type {
  AdminBookingFunnelStatus,
  AdminBookingListItem,
  PaymentStatus,
  ReservationStatus,
} from '@grabit/shared';
import { getPaymentFailureBucketLabel } from './payment-failure-buckets';

const FUNNEL_STATUS_CONFIG: Record<
  AdminBookingFunnelStatus,
  { label: string; className: string }
> = {
  SOLD: {
    label: '판매 완료',
    className: 'bg-[#F0FDF4] text-[#15803D] border-transparent',
  },
  PAYMENT_PENDING: {
    label: '결제 대기',
    className: 'bg-[#FFFBEB] text-[#8B6306] border-transparent',
  },
  PAYMENT_PROCESSING: {
    label: '결제 확인 중',
    className: 'bg-[#EEF2FF] text-[#4338CA] border-transparent',
  },
  PAYMENT_FAILED: {
    label: '결제 실패/만료',
    className: 'bg-[#FEF2F2] text-[#C62828] border-transparent',
  },
  CANCEL_PROCESSING: {
    label: '취소/환불 처리 중',
    className: 'bg-[#FFF7ED] text-[#C2410C] border-transparent',
  },
  PARTIAL_CANCELLED: {
    label: '부분 취소',
    className: 'bg-[#F5F3FF] text-[#6D28D9] border-transparent',
  },
  CANCELLED: {
    label: '취소 완료',
    className: 'bg-[#F3F4F6] text-[#4B5563] border-transparent',
  },
};

const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  READY: '결제 준비',
  IN_PROGRESS: '결제 진행 중',
  DONE: '결제 완료',
  PARTIAL_CANCELED: '부분 환불 완료',
  CANCELED: '결제 취소',
  ABORTED: '결제 중단',
  EXPIRED: '결제 만료',
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CARD: '카드',
  VIRTUAL_ACCOUNT: '가상계좌',
  TRANSFER: '계좌이체',
  MOBILE_PHONE: '휴대폰',
  FOREIGN_EASY_PAY: '해외 간편결제',
  SIMPLE_PAY: '국내 간편결제',
};

function formatDateTime(dateString: string): string {
  return formatAdminKstDateTime(dateString).replace('T', ' ');
}

function formatSeatSummary(seats: AdminBookingListItem['seats']): string {
  if (seats.length === 0) return '-';
  const first = seats[0];
  const base = `${first.tierName} ${first.row}열${first.number}번`;
  if (seats.length === 1) return base;
  return `${base} 외 ${seats.length - 1}석`;
}

function fallbackFunnelStatus(status: ReservationStatus): AdminBookingFunnelStatus {
  switch (status) {
    case 'CONFIRMED':
      return 'SOLD';
    case 'PENDING_PAYMENT':
      return 'PAYMENT_PENDING';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'FAILED':
      return 'PAYMENT_FAILED';
  }
}

function getFunnelStatusConfig(booking: AdminBookingListItem) {
  const funnelStatus =
    booking.funnelStatus ?? fallbackFunnelStatus(booking.status);
  return FUNNEL_STATUS_CONFIG[funnelStatus];
}

function getPaymentStatusLabel(status: PaymentStatus | null): string | null {
  if (!status) return null;
  return PAYMENT_STATUS_LABELS[status] ?? '결제 상태 확인 필요';
}

function getPaymentMethodLabel(method: string | null): string | null {
  if (!method) return null;
  if (PAYMENT_METHOD_LABELS[method]) {
    return PAYMENT_METHOD_LABELS[method];
  }
  return /[가-힣]/.test(method) ? method : '기타 결제수단';
}

function getPaymentSummary(booking: AdminBookingListItem): string {
  const statusLabel = getPaymentStatusLabel(booking.paymentStatus);
  const methodLabel = booking.paymentMethodAttribution.label
    || getPaymentMethodLabel(booking.paymentMethod);
  return [statusLabel, methodLabel].filter(Boolean).join(' · ') || '결제 정보 없음';
}

interface AdminBookingTableProps {
  bookings: AdminBookingListItem[];
  isLoading: boolean;
  onRowClick: (id: string) => void;
}

export function AdminBookingTable({
  bookings,
  isLoading,
  onRowClick,
}: AdminBookingTableProps) {
  return <div>
    <Table className="admin-booking-table table-fixed">
      <TableHeader><TableRow>
        <TableHead className="w-[46%] md:w-[28%]">예매·공연</TableHead>
        <TableHead className="hidden w-[20%] md:table-cell">예매자</TableHead>
        <TableHead className="hidden w-[20%] xl:table-cell">일시·좌석</TableHead>
        <TableHead className="w-[25%] md:w-[16%]">결제금액</TableHead>
        <TableHead className="w-[29%] md:w-[22%] xl:w-[16%]">상태</TableHead>
      </TableRow></TableHeader>
      <TableBody>
        {isLoading && Array.from({ length: 5 }, (_, index) => <TableRow key={index}><TableCell colSpan={5}><Skeleton className="h-12 w-full" /></TableCell></TableRow>)}
        {!isLoading && bookings.length === 0 && <TableRow><TableCell colSpan={5} className="py-12 text-center"><p className="font-semibold">예매 내역이 없습니다</p><p className="mt-2 text-sm text-gray-500">검색 조건을 바꾸거나 전체 예매를 확인해주세요.</p></TableCell></TableRow>}
        {!isLoading && bookings.map((booking) => {
          const statusConfig = getFunnelStatusConfig(booking);
          const failureBucketLabel = getPaymentFailureBucketLabel(booking.paymentFailureBucket);
          return <TableRow key={booking.id} role="button" tabIndex={0} aria-label={`${booking.userName} ${booking.performanceTitle} 예매 상세 보기`}
            className="cursor-pointer focus-visible:bg-accent" onClick={() => onRowClick(booking.id)}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onRowClick(booking.id); } }}>
            <TableCell className="whitespace-normal">
              <p className="break-all text-xs font-semibold text-gray-900">{booking.reservationNumber}</p>
              <p className="mt-1 line-clamp-2 text-xs text-gray-600" title={booking.performanceTitle}>{booking.performanceTitle}</p>
              <p className="mt-1 text-xs text-gray-600 md:hidden">{booking.userName}</p>
              <p className="mt-1 text-xs text-gray-500 xl:hidden">{formatDateTime(booking.showDateTime)} · {formatSeatSummary(booking.seats)}</p>
            </TableCell>
            <TableCell className="hidden whitespace-normal md:table-cell"><p className="font-medium">{booking.userName}</p><p className="mt-1 truncate text-xs text-gray-500" title={booking.userEmail}>{booking.userEmail}</p><p className="text-xs text-gray-500">{booking.userCountry}</p></TableCell>
            <TableCell className="hidden whitespace-normal text-xs text-gray-600 xl:table-cell"><p>{formatDateTime(booking.showDateTime)}</p><p className="mt-1">{formatSeatSummary(booking.seats)}</p></TableCell>
            <TableCell className="whitespace-normal break-words text-xs font-semibold tabular-nums sm:text-sm">{booking.totalAmount.toLocaleString('ko-KR')}원</TableCell>
            <TableCell className="whitespace-normal"><div className="flex flex-col items-start gap-1">
              <Badge className={`${statusConfig.className} whitespace-normal text-left`}>{statusConfig.label}</Badge>
              {failureBucketLabel && <span className="text-xs text-gray-600">{failureBucketLabel}</span>}
              <p className="hidden text-xs leading-5 text-gray-500 sm:block">{getPaymentSummary(booking)}</p>
            </div></TableCell>
          </TableRow>;
        })}
      </TableBody>
    </Table>
  </div>;
}
