'use client';

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
  const date = new Date(dateString);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}.${m}.${d} ${h}:${min}`;
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

function getPaymentDiagnosticSummary(booking: AdminBookingListItem): string | null {
  const diagnostic = booking.paymentFailureDiagnostic;
  if (!diagnostic) return null;
  return [diagnostic.code, diagnostic.message].filter(Boolean).join(' · ');
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
  return (
    <div className="rounded-lg bg-white shadow-sm">
      <Table>
        <TableHeader>
          <TableRow className="bg-[#F5F5F7]">
            <TableHead scope="col" className="text-sm font-semibold text-gray-600">
              예매번호
            </TableHead>
            <TableHead scope="col" className="text-sm font-semibold text-gray-600">
              예매자
            </TableHead>
            <TableHead scope="col" className="hidden text-sm font-semibold text-gray-600 md:table-cell">
              공연명
            </TableHead>
            <TableHead scope="col" className="hidden text-sm font-semibold text-gray-600 lg:table-cell">
              공연일시
            </TableHead>
            <TableHead scope="col" className="hidden text-sm font-semibold text-gray-600 lg:table-cell">
              좌석
            </TableHead>
            <TableHead scope="col" className="text-sm font-semibold text-gray-600">
              결제금액
            </TableHead>
            <TableHead scope="col" className="text-sm font-semibold text-gray-600">
              상태
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading &&
            Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={`skeleton-${i}`}>
                <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-32" /></TableCell>
                <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-28" /></TableCell>
                <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                <TableCell><Skeleton className="h-5 w-16" /></TableCell>
              </TableRow>
            ))}

          {!isLoading && bookings.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="py-12 text-center">
                <p className="text-base font-semibold text-gray-900">
                  예매 내역이 없습니다
                </p>
                <p className="mt-1 text-sm text-gray-600">
                  아직 예매가 접수되지 않았습니다
                </p>
              </TableCell>
            </TableRow>
          )}

          {!isLoading &&
            bookings.map((booking) => {
              const statusConfig = getFunnelStatusConfig(booking);
              const diagnosticSummary = getPaymentDiagnosticSummary(booking);
              return (
                <TableRow
                  key={booking.id}
                  role="button"
                  className="cursor-pointer hover:bg-gray-50 focus-visible:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                  onClick={() => onRowClick(booking.id)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onRowClick(booking.id);
                    }
                  }}
                  aria-label={`${booking.userName} ${booking.performanceTitle} 예매 상세 보기`}
                >
                  <TableCell className="text-sm">
                    <div className="space-y-0.5">
                      <p className="font-semibold text-gray-900">
                        {booking.reservationNumber}
                      </p>
                      {booking.tossOrderId && (
                        <p className="max-w-[180px] truncate text-xs text-gray-500">
                          Toss 주문번호 {booking.tossOrderId}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    <div className="space-y-0.5">
                      <p className="font-semibold text-gray-900">
                        {booking.userName}
                      </p>
                      <p className="max-w-[180px] truncate text-xs text-gray-500">
                        {booking.userEmail} · {booking.userCountry}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="hidden max-w-[200px] truncate text-sm md:table-cell">
                    {booking.performanceTitle}
                  </TableCell>
                  <TableCell className="hidden text-sm text-gray-600 lg:table-cell">
                    {formatDateTime(booking.showDateTime)}
                  </TableCell>
                  <TableCell className="hidden text-sm text-gray-600 lg:table-cell">
                    {formatSeatSummary(booking.seats)}
                  </TableCell>
                  <TableCell className="text-sm font-semibold">
                    {booking.totalAmount.toLocaleString('ko-KR')}원
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <Badge className={statusConfig.className}>
                        {statusConfig.label}
                      </Badge>
                      <p className="text-xs text-gray-500">
                        {getPaymentSummary(booking)}
                      </p>
                      {diagnosticSummary && (
                        <p className="max-w-[220px] truncate text-xs font-medium text-[#C62828]">
                          {diagnosticSummary}
                        </p>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
        </TableBody>
      </Table>
    </div>
  );
}
