'use client';

import type { DashboardPeriod } from '@grabit/shared';
import { useDashboardGenre, useDashboardPayment, useDashboardTop10 } from '@/hooks/use-admin-dashboard';
import { GenreDonutChart } from './genre-donut-chart';
import { PaymentBarChart } from './payment-bar-chart';
import { TopPerformancesTable } from './top-performances-table';
import { ChartPanelState } from './_state';

export default function SecondaryAnalytics({ period }: { period: DashboardPeriod }) {
  const genre = useDashboardGenre(period);
  const payment = useDashboardPayment(period);
  const top10 = useDashboardTop10();
  return <div className="flex flex-col gap-6">
    <p className="text-xs text-muted-foreground">장르·결제수단은 최근 {period.replace('d', '일')}, 공연별 실적은 최근 30일 기준입니다.</p>
    <div className="grid gap-6 lg:grid-cols-2">
      <section aria-label="장르별 예매"><h2 className="mb-3 text-sm font-semibold">장르별 예매</h2>
        {genre.data?.length && !genre.isError ? <GenreDonutChart data={genre.data} /> : <ChartPanelState mode={genre.isLoading ? 'loading' : genre.isError ? 'error' : 'empty'} onRetry={() => void genre.refetch()} emptyBody="이 기간의 예매 내역이 없습니다." />}</section>
      <section aria-label="결제수단별 이용"><h2 className="mb-3 text-sm font-semibold">결제수단별 이용</h2>
        {payment.data?.length && !payment.isError ? <PaymentBarChart data={payment.data} /> : <ChartPanelState mode={payment.isLoading ? 'loading' : payment.isError ? 'error' : 'empty'} onRetry={() => void payment.refetch()} emptyBody="이 기간의 결제 내역이 없습니다." />}</section>
    </div>
    <section aria-label="공연별 예매 실적"><h2 className="mb-3 text-sm font-semibold">공연별 예매 실적 · 상위 10개</h2><TopPerformancesTable data={top10.data} isLoading={top10.isLoading} isError={top10.isError} onRetry={() => void top10.refetch()} /></section>
  </div>;
}
