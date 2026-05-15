'use client';

import { useMemo, useState } from 'react';
import { Download, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useReservationExport,
  type ReservationExportPayload,
} from '@/hooks/use-reservations';

const RESERVATION_STATUS_OPTIONS = [
  { value: 'all', label: '전체 상태' },
  { value: 'PENDING_PAYMENT', label: '결제 대기' },
  { value: 'CONFIRMED', label: '예매 완료' },
  { value: 'CANCELLED', label: '취소 완료' },
  { value: 'FAILED', label: '실패' },
] as const;

const AUDIENCE_REGION_OPTIONS = [
  { value: 'all', label: '전체 지역' },
  { value: 'domestic', label: '국내' },
  { value: 'overseas', label: '해외' },
] as const;

const PAYMENT_METHOD_OPTIONS = [
  { value: 'all', label: '전체 결제수단' },
  { value: 'CARD', label: '카드' },
  { value: 'TRANSFER', label: '계좌이체' },
  { value: 'VIRTUAL_ACCOUNT', label: '가상계좌' },
  { value: 'MOBILE_PHONE', label: '휴대폰' },
  { value: 'EASY_PAY', label: '간편결제' },
] as const;

type SelectAllValue = 'all';

interface ReservationExportFormState {
  eventId: string;
  tierName: string;
  zoneFloor: string;
  reservationStatus: SelectAllValue | ReservationExportPayload['reservationStatus'];
  audienceRegion: SelectAllValue | ReservationExportPayload['audienceRegion'];
  paymentMethod: string;
  dateFrom: string;
  dateTo: string;
}

const DEFAULT_FILTERS: ReservationExportFormState = {
  eventId: '',
  tierName: '',
  zoneFloor: '',
  reservationStatus: 'all',
  audienceRegion: 'all',
  paymentMethod: 'all',
  dateFrom: '',
  dateTo: '',
};

export function ReservationExportPanel() {
  const exportMutation = useReservationExport();
  const [filters, setFilters] = useState<ReservationExportFormState>(DEFAULT_FILTERS);
  const [reason, setReason] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  const payload = useMemo(
    () => buildExportPayload(filters, reason),
    [filters, reason],
  );
  const filterSummary = useMemo(() => buildFilterSummary(filters), [filters]);
  const canConfirm = reason.trim().length > 0 && !exportMutation.isPending;

  function setFilter<K extends keyof ReservationExportFormState>(
    key: K,
    value: ReservationExportFormState[K],
  ) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function handleConfirmExport() {
    if (!canConfirm) {
      return;
    }

    exportMutation.mutate(payload);
  }

  return (
    <section className="space-y-4 rounded-lg bg-white p-4 shadow-sm" aria-labelledby="reservation-export-title">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="reservation-export-title" className="text-xl font-semibold leading-tight text-gray-900">
            예약자 CSV 내보내기
          </h2>
          <p className="mt-1 text-base text-gray-600">
            원본 CSV는 개인정보가 포함되므로 필터와 사유를 확인한 뒤 내보내세요.
          </p>
        </div>
        <Button type="button" className="h-12 w-full sm:w-auto" onClick={() => setConfirmOpen(true)}>
          <Download className="h-4 w-4" />
          예약자 원본 CSV 내보내기
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="space-y-1.5 text-sm font-semibold text-gray-700">
          <span>이벤트</span>
          <Input
            value={filters.eventId}
            onChange={(event) => setFilter('eventId', event.target.value)}
            placeholder="performance id"
            aria-label="이벤트"
          />
        </label>
        <label className="space-y-1.5 text-sm font-semibold text-gray-700">
          <span>좌석 등급</span>
          <Input
            value={filters.tierName}
            onChange={(event) => setFilter('tierName', event.target.value)}
            placeholder="VIP"
            aria-label="좌석 등급"
          />
        </label>
        <label className="space-y-1.5 text-sm font-semibold text-gray-700">
          <span>구역/층</span>
          <Input
            value={filters.zoneFloor}
            onChange={(event) => setFilter('zoneFloor', event.target.value)}
            placeholder="2F"
            aria-label="구역/층"
          />
        </label>
        <div className="space-y-1.5">
          <label htmlFor="reservation-export-status" className="text-sm font-semibold text-gray-700">
            예매 상태
          </label>
          <Select
            value={filters.reservationStatus}
            onValueChange={(value) =>
              setFilter('reservationStatus', value as ReservationExportFormState['reservationStatus'])
            }
          >
            <SelectTrigger id="reservation-export-status" aria-label="예매 상태" className="h-11 w-full">
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
        </div>
        <div className="space-y-1.5">
          <label htmlFor="reservation-export-region" className="text-sm font-semibold text-gray-700">
            국내/해외
          </label>
          <Select
            value={filters.audienceRegion}
            onValueChange={(value) =>
              setFilter('audienceRegion', value as ReservationExportFormState['audienceRegion'])
            }
          >
            <SelectTrigger id="reservation-export-region" aria-label="국내/해외" className="h-11 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AUDIENCE_REGION_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="reservation-export-payment" className="text-sm font-semibold text-gray-700">
            결제 수단
          </label>
          <Select
            value={filters.paymentMethod}
            onValueChange={(value) => setFilter('paymentMethod', value)}
          >
            <SelectTrigger id="reservation-export-payment" aria-label="결제 수단" className="h-11 w-full">
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
        </div>
        <label className="space-y-1.5 text-sm font-semibold text-gray-700">
          <span>조회 시작일</span>
          <Input
            type="date"
            value={filters.dateFrom}
            onChange={(event) => setFilter('dateFrom', event.target.value)}
            aria-label="조회 시작일"
          />
        </label>
        <label className="space-y-1.5 text-sm font-semibold text-gray-700">
          <span>조회 종료일</span>
          <Input
            type="date"
            value={filters.dateTo}
            onChange={(event) => setFilter('dateTo', event.target.value)}
            aria-label="조회 종료일"
          />
        </label>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>예약자 원본 CSV를 내보내시겠습니까?</DialogTitle>
            <DialogDescription>
              개인정보가 포함됩니다. 필터와 사유를 확인한 뒤 내보내세요.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div role="alert" className="flex gap-3 rounded-lg border border-[#F3C8C8] bg-[#FEF2F2] p-3 text-sm font-semibold text-[#C62828]">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>원본 CSV에는 예약자 이름, 이메일, 전화번호가 포함됩니다.</span>
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

            <label className="space-y-1.5 text-sm font-semibold text-gray-700">
              <span>내보내기 사유</span>
              <Textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                aria-label="내보내기 사유"
                placeholder="예: 정산 대조, 고객 지원 확인"
              />
            </label>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
              취소
            </Button>
            <Button
              type="button"
              disabled={!canConfirm}
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

function buildExportPayload(
  filters: ReservationExportFormState,
  reason: string,
): ReservationExportPayload {
  return compactPayload({
    eventId: filters.eventId.trim(),
    tierName: filters.tierName.trim(),
    zoneFloor: filters.zoneFloor.trim(),
    reservationStatus:
      filters.reservationStatus === 'all' ? undefined : filters.reservationStatus,
    audienceRegion:
      filters.audienceRegion === 'all' ? undefined : filters.audienceRegion,
    paymentMethod:
      filters.paymentMethod === 'all' ? undefined : filters.paymentMethod,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    exportType: 'raw_pii',
    reason: reason.trim(),
  });
}

function compactPayload(payload: ReservationExportPayload): ReservationExportPayload {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined && value !== ''),
  ) as ReservationExportPayload;
}

function buildFilterSummary(filters: ReservationExportFormState) {
  return [
    { label: '이벤트', value: filters.eventId.trim() || '전체' },
    { label: '좌석 등급', value: filters.tierName.trim() || '전체' },
    { label: '구역/층', value: filters.zoneFloor.trim() || '전체' },
    { label: '예매 상태', value: labelFor(RESERVATION_STATUS_OPTIONS, filters.reservationStatus ?? 'all') },
    { label: '국내/해외', value: labelFor(AUDIENCE_REGION_OPTIONS, filters.audienceRegion ?? 'all') },
    { label: '결제 수단', value: labelFor(PAYMENT_METHOD_OPTIONS, filters.paymentMethod) },
    {
      label: '기간',
      value:
        filters.dateFrom || filters.dateTo
          ? `${filters.dateFrom || '처음'} ~ ${filters.dateTo || '오늘'}`
          : '전체',
    },
  ];
}

function labelFor<T extends readonly { value: string; label: string }[]>(
  options: T,
  value: string,
): string {
  return options.find((option) => option.value === value)?.label ?? value;
}
