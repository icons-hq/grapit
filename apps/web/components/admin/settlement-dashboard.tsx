'use client';

import { useState } from 'react';
import { financeLedgerQuerySchema, resolveAdminCapabilitySnapshot, type FinanceLedger, type FinanceLedgerExportRequest,
  type FinanceLedgerQuery, type FinancePaymentRow } from '@grabit/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAdminFinanceExport, useAdminFinanceLedger } from '@/hooks/use-admin-settlement';
import { useAuthStore } from '@/stores/use-auth-store';
import { useAdminEventContext } from './admin-event-context';
import { formatAdminKstDate, formatAdminKstDateTime } from '@/lib/admin-datetime';

interface Props {
  user?: Parameters<typeof resolveAdminCapabilitySnapshot>[0];
  data?: FinanceLedger | null;
  requiredFilters?: Partial<FinanceLedgerQuery>;
  onExport?: (payload: FinanceLedgerExportRequest) => void;
}
const datasetLabels = { payments: '결제·환불 원장 CSV', tickets: '좌석·입장 원장 CSV', provider: 'PG 정산 자료 CSV' } as const;
const inputStyle = 'h-11 w-full min-w-0 rounded-lg border border-gray-200 bg-white px-3 text-sm';

export function SettlementDashboard({ user: suppliedUser, data: suppliedData, requiredFilters, onExport }: Props) {
  const authUser = useAuthStore((state) => state.user);
  const capability = resolveAdminCapabilitySnapshot(suppliedUser ?? authUser);
  const allowed = capability.superuser || capability.capabilities.includes('settlement.export');
  const context = useAdminEventContext();
  const [form, setForm] = useState(() => {
    const now = new Date().toISOString();
    return { eventId: requiredFilters?.eventId ?? suppliedData?.query.eventId ?? '', showtimeId: requiredFilters?.showtimeId ?? suppliedData?.query.showtimeId ?? '',
      dateFrom: requiredFilters?.dateFrom ?? suppliedData?.query.dateFrom ?? `${formatAdminKstDate(now).slice(0, 7)}-01`,
      dateTo: requiredFilters?.dateTo ?? suppliedData?.query.dateTo ?? formatAdminKstDate(now),
      dateBasis: requiredFilters?.dateBasis ?? suppliedData?.query.dateBasis ?? 'paid_at',
      asOfLocal: formatAdminKstDateTime(requiredFilters?.asOf ?? suppliedData?.query.asOf ?? now),
      providerDateBasis: requiredFilters?.providerDateBasis ?? suppliedData?.query.providerDateBasis ?? 'paidOutDate' };
  });
  const current = { ...form, ...(context ? { eventId: context.performanceId, showtimeId: context.showtimeId } : {}) };
  const [applied, setApplied] = useState<FinanceLedgerQuery | null>(suppliedData?.query ?? null);
  const [validation, setValidation] = useState('');
  const [reason, setReason] = useState('');
  const [dataset, setDataset] = useState<FinanceLedgerExportRequest['dataset']>('payments');
  const [exportNotice, setExportNotice] = useState('');
  const query = useAdminFinanceLedger(applied, allowed && suppliedData === undefined);
  const exportMutation = useAdminFinanceExport();
  const unchanged = applied && applied.eventId === current.eventId && (applied.showtimeId ?? '') === current.showtimeId
    && applied.dateFrom === current.dateFrom && applied.dateTo === current.dateTo && applied.dateBasis === current.dateBasis
    && formatAdminKstDateTime(applied.asOf) === current.asOfLocal && applied.providerDateBasis === current.providerDateBasis;
  const ledger = unchanged ? suppliedData ?? query.data : null;
  const paused = suppliedData === undefined && query.fetchStatus === 'paused';
  const loading = suppliedData === undefined && (query.isFetching || paused);
  const failed = suppliedData === undefined && query.isError;
  const hasData = Boolean(ledger && !failed && !loading);
  const canExport = hasData && Boolean(reason.trim()) && !exportMutation.isPending
    && (dataset !== 'provider' || ['ready', 'empty'].includes(ledger!.provider.status));

  function read(includeProvider = false) {
    const parsed = financeLedgerQuerySchema.safeParse({ eventId: current.eventId, ...(current.showtimeId ? { showtimeId: current.showtimeId } : {}),
      dateFrom: current.dateFrom, dateTo: current.dateTo, dateBasis: current.dateBasis,
      asOf: `${current.asOfLocal}+09:00`, providerDateBasis: current.providerDateBasis, includeProvider: includeProvider ? 'true' : 'false' });
    if (!parsed.success || context?.invalidShowtime) {
      setValidation(!parsed.success ? parsed.error.issues.find((issue) => issue.code === 'custom')?.message
        ?? '공연·기간·기준 시각을 확인해주세요.' : '선택한 공연에 속하는 회차를 확인해주세요.'); return;
    }
    if (new Date(parsed.data.asOf).getTime() > Date.now()) { setValidation('기준 시각은 현재보다 늦을 수 없습니다.'); return; }
    setValidation(''); setExportNotice('');
    if (JSON.stringify(applied) === JSON.stringify(parsed.data)) void query.refetch();
    else setApplied(parsed.data);
  }

  function exportCsv() {
    if (!ledger || !canExport) return;
    const payload = { query: ledger.query, dataset, reason: reason.trim() };
    if (onExport) { onExport(payload); return; }
    setExportNotice('');
    exportMutation.mutate(payload, { onSuccess: () => { setExportNotice('CSV를 내려받았습니다. 필터와 사유를 감사 로그에 기록했습니다.'); },
      onError: (error) => setExportNotice(error.message) });
  }

  if (!allowed) return <section role="alert" className="rounded-xl border bg-white p-6"><h1 className="text-xl font-semibold">정산을 조회할 권한이 없습니다</h1><p className="mt-2 text-gray-600">재무 권한이 있는 계정으로 확인해주세요.</p></section>;
  return <section className="space-y-6" aria-label="정산·내보내기">
    <header><p className="text-sm font-semibold text-violet-700">재무 대조</p><h1 className="mt-1 text-2xl font-semibold text-gray-950">정산·내보내기</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">원 주문과 환불, 남은 티켓을 확인하고 PG 정산 자료를 대조합니다. 금액은 통화별로 확인하며 은행 실입금과 마감은 증빙을 따로 확인해야 합니다.</p></header>
    <form onSubmit={(event) => { event.preventDefault(); read(); }} className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {!context && <label className="space-y-1 text-sm">공연 ID<Input aria-label="공연 ID" value={form.eventId} onChange={(event) => setForm({ ...form, eventId: event.target.value })} /></label>}
        <label className="space-y-1 text-sm">거래 선택 기준<select aria-label="거래 선택 기준" className={inputStyle} value={form.dateBasis} onChange={(event) => setForm({ ...form, dateBasis: event.target.value as FinanceLedgerQuery['dateBasis'] })}>
          <option value="paid_at">결제 승인일</option><option value="cancelled_at">취소 완료일 · 처리 중은 요청일</option></select></label>
        <label className="space-y-1 text-sm">조회 시작일 · KST<Input type="date" aria-label="조회 시작일" value={form.dateFrom} onChange={(event) => setForm({ ...form, dateFrom: event.target.value })} /></label>
        <label className="space-y-1 text-sm">조회 종료일 · KST<Input type="date" aria-label="조회 종료일" value={form.dateTo} onChange={(event) => setForm({ ...form, dateTo: event.target.value })} /></label>
        <label className="space-y-1 text-sm sm:col-span-2 xl:col-span-2">원장 기준 시각 · KST
          <div className="flex flex-wrap gap-2"><Input type="datetime-local" step="1" aria-label="원장 기준 시각" className="min-w-0 flex-1" value={form.asOfLocal} onChange={(event) => setForm({ ...form, asOfLocal: event.target.value.length === 16 ? `${event.target.value}:00` : event.target.value })} />
            <Button type="button" variant="outline" onClick={() => setForm({ ...form, asOfLocal: formatAdminKstDateTime(new Date().toISOString()) })}>현재 시각</Button></div></label>
        <label className="space-y-1 text-sm">PG 자료의 기간 기준<select aria-label="PG 기간 기준" className={inputStyle} value={form.providerDateBasis} onChange={(event) => setForm({ ...form, providerDateBasis: event.target.value as FinanceLedgerQuery['providerDateBasis'] })}>
          <option value="paidOutDate">정산 지급일</option><option value="soldDate">정산 매출일</option></select></label>
      </div>
      <div className="flex flex-wrap items-center gap-3"><Button type="submit" disabled={loading || !current.eventId}>원장 조회</Button>
        <Button type="button" variant="outline" disabled={loading || !current.eventId} onClick={() => read(true)}>PG 자료까지 조회</Button><span className="text-sm text-gray-500">모든 날짜는 한국 시간(KST)입니다. PG 자료는 한 번에 최대 31일까지 조회합니다.</span></div>
      {validation && <p role="alert" className="text-sm text-red-700">{validation}</p>}
    </form>
    {!applied || !unchanged ? <StateMessage>{applied ? '조회 조건이 변경되었습니다. 다시 조회하면 새 조건의 금액을 확인할 수 있습니다.' : '공연과 조회 조건을 선택한 뒤 원장을 조회해주세요.'}</StateMessage>
      : loading ? <StateMessage>{paused ? '연결 복구를 기다리고 있습니다. 연결되면 원장을 다시 조회합니다.' : '원장과 요청한 PG 자료를 조회하고 있습니다.'}</StateMessage>
      : failed ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">원장 조회에 실패했습니다. 원장 조회 버튼으로 다시 시도해주세요. 금액은 확인되지 않았습니다.</div>
      : ledger && <>
        <div className="space-y-1 text-sm text-gray-600"><p className="font-medium text-gray-950">{ledger.performanceTitle} · {ledger.summary.paymentCount.toLocaleString('ko-KR')}개 결제</p>
          <p>{ledger.query.dateFrom} ~ {ledger.query.dateTo} · {ledger.query.dateBasis === 'paid_at' ? '승인일' : '취소 완료일/요청일'}로 거래 선택</p>
          <p>누적 금액 기준 {dateTime(ledger.query.asOf)} · 조회 {dateTime(ledger.generatedAt)}</p></div>
        {ledger.rows.length === 0 && <StateMessage>조회가 완료되었습니다. 선택한 기간에 해당하는 승인·취소 거래가 없습니다. PG 정산 자료는 별도 기간 기준으로 표시됩니다.</StateMessage>}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="settlement-summary">
          <Amount label="선택 거래 원 주문액" value={ledger.summary.originalOrderKrw} /><Amount label="저장된 확정 결제액" value={ledger.summary.confirmedPaymentKrw} /><Amount label="확정 환불 누계" value={ledger.summary.confirmedRefundKrw} />
          <Amount label="처리 중 환불 요청액" value={ledger.summary.pendingRefundKrw} /><Amount label="남은 유효 티켓 금액" value={ledger.summary.remainingTicketKrw} />
          <Amount label="유지된 취소 수수료" value={ledger.summary.retainedCancellationFeeKrw} /><Amount label="취소 좌석의 유지 서비스 수수료" value={ledger.summary.retainedServiceFeeKrw} />
          <Amount label="선택 거래의 기간 내 승인액" value={ledger.summary.periodApprovedKrw} /><Amount label="선택 거래의 기간 내 환불액" value={ledger.summary.periodRefundKrw} />
        </div>
        <p className="text-sm leading-6 text-gray-600">위 금액은 원화 주문 기준입니다. 환불 누계는 기준 시각까지 완료된 금액이며, 처리 중 요청액은 포함하지 않습니다. 결제별 누적액을 월별로 중복 합산하지 마세요.</p>
        {ledger.warnings.length > 0 && <div role="alert" className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{ledger.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
        <section aria-label="통화별 PG 청구와 취소" className="space-y-3"><h2 className="text-lg font-semibold">통화별 PG 청구·취소 기록</h2>
          <p className="text-sm text-gray-600">저장된 승인·취소 기록 기준입니다. 아래 잔액은 PG 정산 지급액과 다릅니다.</p>
          <div className="grid gap-3 lg:grid-cols-2">{ledger.currencies.map((total) => <div key={total.currency} className="space-y-2 rounded-xl border bg-white p-4">
            <h3 className="font-semibold">{total.currency}</h3>{total.unknownPaymentCount > 0 && <p className="text-sm text-amber-800">{total.unknownPaymentCount}개 거래의 금액 증거 누락 · 관련 합계는 미확인으로 표시</p>}
            <dl className="grid grid-cols-2 gap-3 text-sm">{[['원 청구', total.chargeMinor], ['확정 취소', total.confirmedCancelMinor], ['취소 처리 중', total.pendingCancelMinor], ['계산 잔액', total.balanceMinor]].map(([label, amount]) => <div key={String(label)}><dt className="text-gray-500">{label}</dt><dd className="mt-1 font-semibold">{money(amount as number | null, total.currency)}</dd><dd className="text-xs text-gray-500">{amount === null ? '금액 증거 미확인' : `${amount} minor units`}</dd></div>)}</dl></div>)}</div>
        </section>
        <ProviderEvidence ledger={ledger} />
        <section className="space-y-3" aria-label="결제별 대조"><h2 className="text-lg font-semibold">결제별 대조</h2>
          {ledger.rows.map((row) => <PaymentDetails key={row.paymentId} row={row} />)}</section>
        <section className="space-y-4 rounded-xl border bg-white p-4" aria-label="정산 CSV 내보내기"><h2 className="text-lg font-semibold">같은 기준으로 내보내기</h2>
          <p className="text-sm leading-6 text-gray-600">이름·연락처·결제 키는 포함하지 않습니다. 조회 조건, 통화, 원본 거래 식별자와 사유를 기록합니다. CSV 생성 시 같은 기준 시각으로 다시 조회하며 PG 자료에는 별도 조회 시각이 남습니다.</p>
          <label className="block space-y-1 text-sm">자료 종류<select aria-label="자료 종류" className={inputStyle} value={dataset} onChange={(event) => setDataset(event.target.value as typeof dataset)}>{Object.entries(datasetLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label className="block space-y-1 text-sm">내보내기 사유<Textarea aria-label="내보내기 사유" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder="예: 9월 승인·취소와 정산 지급 자료 대조" /></label>
          <Button disabled={!canExport} onClick={exportCsv}>{exportMutation.isPending ? 'CSV 생성 중' : datasetLabels[dataset]}</Button>
          {dataset === 'provider' && !['ready', 'empty'].includes(ledger.provider.status) && <p className="text-sm text-amber-800">PG 자료를 모두 조회한 뒤 내보낼 수 있습니다.</p>}
          {exportNotice && <p role="status" className="text-sm">{exportNotice}</p>}
        </section>
      </>}
    <aside className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950"><strong>은행 실입금 미확인 · 마감 미완료</strong><p>PG 정산 지급일과 지급액만으로 은행 입금을 확정하지 않습니다. 은행 거래 내역, 차이 원인과 담당자의 마감 기록을 별도 대조 문서에 남겨주세요.</p></aside>
  </section>;
}

function ProviderEvidence({ ledger }: { ledger: FinanceLedger }) {
  const totals = new Map<string, { amount: number; fee: number; payout: number }>();
  for (const row of ledger.provider.rows) {
    const sum = totals.get(row.currency) ?? { amount: 0, fee: 0, payout: 0 };
    sum.amount += row.amountMinor; sum.fee += row.feeMinor; sum.payout += row.payoutMinor; totals.set(row.currency, sum);
  }
  return <section className="space-y-3 rounded-xl border bg-white p-4" aria-label="PG 정산 자료"><h2 className="text-lg font-semibold">PG 정산 자료</h2>
    <p className="text-sm leading-6 text-gray-600">선택한 공연·회차 전체에서 {ledger.query.dateFrom} ~ {ledger.query.dateTo}의 {ledger.provider.dateBasis === 'paidOutDate' ? '정산 지급일' : '정산 매출일'} 자료입니다. 위 승인·취소 거래 선택과 기간 기준이 다릅니다. PG가 현재 반환한 자료이며 과거 조회 결과를 복원한 자료가 아닙니다.</p>
    {ledger.provider.status === 'not_queried' ? <p className="text-sm text-gray-600">PG 자료 미조회 · 위의 PG 자료까지 조회 버튼을 눌러주세요.</p>
      : ledger.provider.status === 'failed' ? <p role="alert" className="text-sm text-red-800">PG 자료 조회 실패 · 지급액은 미확인입니다.</p>
      : ledger.provider.status === 'empty' ? <p className="text-sm text-gray-600">조회 완료 · 이 범위에 해당하는 PG 정산 자료 0건</p> : <>
        {ledger.provider.status === 'partial' && <p role="alert" className="text-sm text-amber-800">일부 PG 조회 실패 · 아래 금액은 조회된 자료만 포함합니다.</p>}
        <div className="grid gap-3 sm:grid-cols-2">{[...totals].map(([currency, total]) => <dl key={currency} className="space-y-1 rounded-lg bg-gray-50 p-3 text-sm"><dt className="font-semibold">{currency} 정산 자료</dt><dd>거래 순액 {money(total.amount, currency)}</dd><dd>차감액 {money(total.fee, currency)}</dd><dd className="font-semibold">PG 지급액 {money(total.payout, currency)}</dd></dl>)}</div>
        <details className="text-sm"><summary className="cursor-pointer py-2 font-medium">정산 거래 {ledger.provider.rows.length}건 보기</summary><ul className="space-y-3">{ledger.provider.rows.map((row) => <li key={row.transactionKey} className="rounded-lg border p-3"><p>{row.reservationNumber} · {money(row.amountMinor, row.currency)} → 지급 {money(row.payoutMinor, row.currency)}</p><p className="text-gray-600">매출일 {row.soldDate} / 지급일 {row.paidOutDate} KST</p><p className="break-all text-xs text-gray-500">거래 {row.transactionKey}</p></li>)}</ul></details>
      </>}
    {ledger.provider.scopes.filter((scope) => scope.status === 'failed').map((scope) => <p key={scope.scope} className="text-sm text-red-800">{scope.scope}: {scope.message}</p>)}
    {ledger.provider.observedAt && <p className="text-xs text-gray-500">PG 조회 {dateTime(ledger.provider.observedAt)}</p>}
  </section>;
}

function PaymentDetails({ row }: { row: FinancePaymentRow }) {
  const states = { active: '유효', cancellation_pending: '취소 처리 중', cancelled: '취소 완료', expired: '만료', unknown: '상태 증거 부족' };
  return <details className="rounded-xl border bg-white p-4"><summary className="cursor-pointer text-sm font-semibold"><span>{row.reservationNumber} · 원 주문 {money(row.originalOrderKrw, 'KRW')}</span><span className="ml-2 font-normal text-gray-600">환불 {money(row.confirmedRefundKrw, 'KRW')} / 남은 티켓 {money(row.remainingTicketKrw, 'KRW')}</span></summary>
    <div className="mt-4 space-y-3 text-sm"><p>승인 {dateTime(row.paidAt)} · {row.provider}</p><p className="break-all text-xs text-gray-500">주문 {row.orderId} / 결제 기록 {row.paymentId}</p><p>PG 청구 {money(row.chargeMinor, row.chargeCurrency)} / 취소 {money(row.confirmedCancelMinor, row.chargeCurrency)} / 잔액 {money(row.balanceMinor, row.chargeCurrency)}</p>
      <ul className="space-y-2">{row.tickets.map((item) => <li key={item.id} className="space-y-1 rounded-lg bg-gray-50 p-3"><p className="font-semibold">{item.seat} · {states[item.state]}</p><p>티켓 {money(item.priceKrw, 'KRW')} + 서비스 수수료 {money(item.serviceFeeKrw, 'KRW')} · 환불 {money(item.refundKrw, 'KRW')}</p>{item.requestedAt && <p className="text-gray-600">취소 요청 {dateTime(item.requestedAt)}{item.completedAt ? ` / 완료 ${dateTime(item.completedAt)}` : ' / 완료 대기'}</p>}<p className="text-gray-600">{item.enteredAt ? `입장 ${dateTime(item.enteredAt)}` : '입장 기록 없음'}</p></li>)}</ul>
    </div></details>;
}
function StateMessage({ children }: { children: React.ReactNode }) { return <p role="status" className="rounded-xl border bg-white p-5 text-sm leading-6 text-gray-600">{children}</p>; }
function Amount({ label, value }: { label: string; value: number | null }) { return <div className="rounded-xl border bg-white p-4"><p className="text-sm text-gray-500">{label}</p><p className="mt-2 text-xl font-semibold text-gray-950">{money(value, 'KRW')}</p></div>; }
function money(minor: number | null, currency: string | null) { if (typeof minor !== 'number' || !Number.isSafeInteger(minor) || !currency) return '미확인'; return `${currency} ${(minor / (currency === 'USD' ? 100 : 1)).toLocaleString('ko-KR', { minimumFractionDigits: currency === 'USD' ? 2 : 0, maximumFractionDigits: currency === 'USD' ? 2 : 0 })}`; }
function dateTime(value: string) { return `${formatAdminKstDateTime(value).replace('T', ' ')} KST`; }
