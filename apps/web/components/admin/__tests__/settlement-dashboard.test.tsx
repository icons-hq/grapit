import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinanceLedger } from '@grabit/shared';
import { SettlementDashboard } from '../settlement-dashboard';
import { apiClient } from '@/lib/api-client';

const finance = { id: 'finance', role: 'admin', adminCapabilityBundle: 'finance' } as const;
const query: FinanceLedger['query'] = { eventId: '12345678-1234-4000-8000-123456789012', showtimeId: '12345678-1234-4000-8000-123456789013',
  dateFrom: '2026-09-01', dateTo: '2026-09-01', dateBasis: 'paid_at', asOf: '2026-09-04T00:00:00Z', providerDateBasis: 'paidOutDate', includeProvider: 'false' };
const summary = { paymentCount: 1, unknownPaymentCount: 0, originalOrderKrw: 104000, confirmedPaymentKrw: 104000, confirmedRefundKrw: 45000, pendingRefundKrw: 0,
  remainingTicketKrw: 52000, retainedCancellationFeeKrw: 5000, retainedServiceFeeKrw: 2000, periodApprovedKrw: 104000, periodRefundKrw: 0 };
const ledger: FinanceLedger = { query, generatedAt: '2026-09-04T00:00:01Z', performanceTitle: '정산 검증 공연', timezone: 'Asia/Seoul',
  summary, currencies: [{ currency: 'USD', exponent: 2, chargeMinor: 8000, confirmedCancelMinor: 3461, pendingCancelMinor: 0, balanceMinor: 4539, unknownPaymentCount: 0 }],
  rows: [], provider: { status: 'not_queried', observedAt: null, dateBasis: 'paidOutDate', rows: [], scopes: [] }, bankEvidence: 'unverified', closingStatus: 'not_closed', warnings: [] };
function setup(props: Partial<React.ComponentProps<typeof SettlementDashboard>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><SettlementDashboard user={finance} data={ledger} {...props} /></QueryClientProvider>);
}

describe('Finance ledger dashboard', () => {
  beforeEach(() => vi.restoreAllMocks());
  it('keeps KRW orders and USD charge/cancellation minor units separate', () => {
    setup();
    const totals = within(screen.getByRole('region', { name: '통화별 PG 청구와 취소' }));
    expect(totals.getByText('USD 80.00')).toBeInTheDocument();
    expect(totals.getByText('USD 34.61')).toBeInTheDocument();
    expect(totals.getByText('USD 45.39')).toBeInTheDocument();
    expect(totals.getByText('3461 minor units')).toBeInTheDocument();
    expect(screen.getByText('KRW 52,000')).toBeInTheDocument();
    expect(screen.getByText('은행 실입금 미확인 · 마감 미완료')).toBeInTheDocument();
    expect(screen.queryByText('최종 차이')).not.toBeInTheDocument();
  });
  it('distinguishes an unqueried provider from failed and successful empty responses', () => {
    const view = setup();
    expect(screen.getByText(/PG 자료 미조회/)).toBeInTheDocument();
    view.unmount();
    const empty = setup({ data: { ...ledger, provider: { ...ledger.provider, status: 'empty', observedAt: ledger.generatedAt } } });
    expect(screen.getByText(/조회 완료 · 이 범위에 해당하는 PG 정산 자료 0건/)).toBeInTheDocument();
    empty.unmount();
    setup({ data: { ...ledger, provider: { ...ledger.provider, status: 'failed', observedAt: ledger.generatedAt } } });
    expect(screen.getByText(/PG 자료 조회 실패 · 지급액은 미확인/)).toBeInTheDocument();
  });
  it('does not query automatically before the finance operator applies a scope', () => {
    const api = vi.spyOn(apiClient, 'get');
    setup({ data: undefined, requiredFilters: query });
    expect(api).not.toHaveBeenCalled();
    expect(screen.getByText(/공연과 조회 조건을 선택/)).toBeInTheDocument();
    expect(screen.queryByText('KRW 0')).not.toBeInTheDocument();
  });
  it('sends showtime, period, KST cutoff and provider date basis to the API on an explicit query', async () => {
    const api = vi.spyOn(apiClient, 'get').mockResolvedValue(ledger);
    setup({ data: undefined, requiredFilters: query });
    await userEvent.click(screen.getByRole('button', { name: 'PG 자료까지 조회' }));
    await screen.findByText('KRW 52,000');
    const url = new URL(api.mock.calls[0]![0], 'https://example.test');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ eventId: query.eventId, showtimeId: query.showtimeId, dateFrom: '2026-09-01', dateTo: '2026-09-01', dateBasis: 'paid_at', asOf: '2026-09-04T09:00:00+09:00', providerDateBasis: 'paidOutDate', includeProvider: 'true' });
  });
  it('shows no invented zero on API failure and lets the same query recover', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValue(ledger);
    setup({ data: undefined, requiredFilters: query });
    await userEvent.click(screen.getByRole('button', { name: '원장 조회' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('금액은 확인되지 않았습니다');
    expect(screen.queryByText('KRW 0')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '원장 조회' }));
    expect(await screen.findByText('KRW 52,000')).toBeInTheDocument();
  });
  it('requires a reason and sends the exact displayed scope when exporting', async () => {
    const exportFile = vi.fn();
    setup({ onExport: exportFile });
    const button = screen.getByRole('button', { name: '결제·환불 원장 CSV' });
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox', { name: '내보내기 사유' }), '9월 원장 대조');
    await userEvent.click(button);
    expect(exportFile).toHaveBeenCalledWith({ query, dataset: 'payments', reason: '9월 원장 대조' });
  });
  it('hides stale totals and their export after a period is edited', async () => {
    setup();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '거래 선택 기준' }), 'cancelled_at');
    expect(screen.getByText(/조회 조건이 변경되었습니다/)).toBeInTheDocument();
    expect(screen.queryByText('KRW 52,000')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '결제·환불 원장 CSV' })).not.toBeInTheDocument();
  });
  it('blocks provider export while any merchant query is unavailable', async () => {
    setup({ data: { ...ledger, provider: { ...ledger.provider, status: 'partial' } } });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '자료 종류' }), 'provider');
    await userEvent.type(screen.getByRole('textbox', { name: '내보내기 사유' }), 'PG 대조');
    expect(screen.getByRole('button', { name: 'PG 정산 자료 CSV' })).toBeDisabled();
  });
  it('keeps scanner accounts outside the finance flow', () => {
    setup({ user: { id: 'scanner', role: 'admin', adminCapabilityBundle: 'scanner' } });
    expect(screen.getByRole('alert')).toHaveTextContent('정산을 조회할 권한이 없습니다');
    expect(screen.queryByRole('button', { name: '원장 조회' })).not.toBeInTheDocument();
  });
  it('marks an offline request as waiting and does not enable exports or show stale amounts', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue(ledger);
    const view = setup({ data: undefined, requiredFilters: query });
    onlineManager.setOnline(false);
    try {
      await userEvent.click(screen.getByRole('button', { name: '원장 조회' }));
      expect(screen.getByText(/연결 복구를 기다리고 있습니다/)).toBeInTheDocument();
      expect(screen.queryByTestId('settlement-summary')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '결제·환불 원장 CSV' })).not.toBeInTheDocument();
    } finally { view.unmount(); onlineManager.setOnline(true); }
  });
});
