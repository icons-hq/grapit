'use client';
import { useQuery } from '@tanstack/react-query';
import type { AdminBookingSupportEvidence } from '@grabit/shared';
import { apiClient } from '@/lib/api-client';
import { formatAdminKstDateTime } from '@/lib/admin-datetime';

const date = (value?: string | null) => value ? `${formatAdminKstDateTime(value).replace('T', ' ')} KST` : '기록 없음';
const phaseLabels: Record<string, string> = { REQUESTED: '요청 접수', SENT_TO_PG: '결제사 전송', PROCESSING_AT_PG: '결제사 처리 중', COMPLETED: '결제사 취소 완료', FAILED: '실패·확인 필요' };
export function BookingSupportEvidencePanel({ bookingId }: { bookingId: string }) {
  const query = useQuery({ queryKey: ['admin', 'booking-support-evidence', bookingId],
    queryFn: () => apiClient.get<AdminBookingSupportEvidence>(`/api/v1/admin/bookings/${bookingId}/support-evidence`) });
  if (query.isPending) return <p role="status" className="py-4 text-sm">권리·환불·전달 기록 조회 중</p>;
  if (query.isError || !query.data) return <p role="alert" className="py-4 text-sm text-red-700">운영 근거를 조회하지 못했습니다. <button className="underline" onClick={() => void query.refetch()}>다시 조회</button></p>;
  const data = query.data;
  const provider = data.provider;
  const refund = data.refundTimeline;
  return <section aria-label="고객 대응 근거" className="my-5 space-y-4 rounded-lg border border-gray-200 bg-slate-50 p-4 text-sm">
    <div className="flex justify-between gap-3"><h3 className="font-semibold">고객 대응 근거</h3><button className="text-violet-700 underline" onClick={() => void query.refetch()}>기록 새로 조회</button></div>
    <p className="text-xs text-gray-500">조회 {date(data.generatedAt)}</p>
    <dl className="space-y-2">
      <div><dt className="text-gray-500">원 주문액</dt><dd>KRW {data.originalOrderAmount.toLocaleString('ko-KR')}</dd></div>
      <div><dt className="text-gray-500">결제사 원 청구액</dt><dd>{provider ? provider.originalAmountMinor === null ? `${provider.currency} · 청구액 미확인`
        : `${provider.currency} ${(provider.originalAmountMinor / (provider.currency === 'USD' ? 100 : 1)).toLocaleString('ko-KR', { minimumFractionDigits: provider.currency === 'USD' ? 2 : 0 })}` : '결제 기록 없음'}</dd></div>
      <div><dt className="text-gray-500">PG 최신 상태 대조</dt><dd>{provider?.checkedAt ? `${provider.checkStatus ?? '결과 미확인'} · ${date(provider.checkedAt)}` : '미조회 · 아래 상태는 저장된 처리 기록입니다.'}</dd></div>
      <div><dt className="text-gray-500">환불 진행</dt><dd>{refund ? `${phaseLabels[refund.currentState] ?? refund.currentState} · 요청 ${date(refund.requestedAt)}` : '진행 중이거나 완료된 취소 기록 없음'}</dd></div>
      {data.refundProviderAmount && <div><dt className="text-gray-500">확정된 결제사 누적 취소액</dt><dd>{data.refundProviderAmount.currency} {data.refundProviderAmount.amountDecimal}</dd></div>}
      {refund?.completedAt && <div><dt className="text-gray-500">결제사 취소 완료 시각</dt><dd>{date(refund.completedAt)} · 카드사 반영일은 미확인</dd></div>}
      <div><dt className="text-gray-500">좌석 권리</dt><dd>{data.rights.seatStatesKnown ? `유효 ${data.rights.activeSeats}석 · 취소 대기 ${data.rights.pendingSeats}석 · 취소 ${data.rights.cancelledSeats}석 · 입장 ${data.rights.enteredSeats}석` : '기존 예매의 좌석별 권리 기록이 없어 추가 확인이 필요합니다.'}</dd></div>
      <div><dt className="text-gray-500">이메일 서비스 발송 기록</dt><dd>{date(data.delivery.lastSentAt)}</dd><dd className="text-xs text-gray-500">수신함 도착·열람은 확인되지 않았습니다.</dd></div>
    </dl>
    {data.delivery.history.length > 0 && <details><summary className="cursor-pointer font-medium">좌석별 전달 기록</summary><ul className="mt-2 space-y-2">{data.delivery.history.map((item) => <li key={item.id}>{item.seat} · 발송 {date(item.sentAt)}{item.scheduledAt && !item.sentAt ? ` · 예약 ${date(item.scheduledAt)}` : ''}</li>)}</ul></details>}
    {data.rights.benefits.length > 0 && <details><summary className="cursor-pointer font-medium">좌석별 특전 권리</summary><ul className="mt-2 space-y-2">{data.rights.benefits.map((benefit) => <li key={benefit.id}>{benefit.seat} · {benefit.name} · {benefit.state === 'redeemed' ? `지급 ${date(benefit.redeemedAt)}` : benefit.state === 'active' ? '미수령' : '비활성'}</li>)}</ul></details>}
  </section>;
}
