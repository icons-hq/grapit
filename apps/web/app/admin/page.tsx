'use client';

import { useState } from 'react';
import {
  Ticket,
  Banknote,
  RotateCcw,
  Theater,
  TrendingUp,
  PieChart as PieIcon,
  CreditCard,
  Trophy,
} from 'lucide-react';
import { AdminStatCard } from '@/components/admin/admin-stat-card';
import { Skeleton } from '@/components/ui/skeleton';
import { PeriodFilter } from '@/components/admin/dashboard/period-filter';
import { RevenueAreaChart } from '@/components/admin/dashboard/revenue-area-chart';
import { GenreDonutChart } from '@/components/admin/dashboard/genre-donut-chart';
import { PaymentBarChart } from '@/components/admin/dashboard/payment-bar-chart';
import { TopPerformancesTable } from '@/components/admin/dashboard/top-performances-table';
import {
  ChartPanelState,
  SectionError,
} from '@/components/admin/dashboard/_state';
import {
  useDashboardSummary,
  useDashboardRevenue,
  useDashboardGenre,
  useDashboardPayment,
  useDashboardTop10,
} from '@/hooks/use-admin-dashboard';
import type { DashboardPeriod } from '@grabit/shared';

const PERIOD_LABEL: Record<DashboardPeriod, string> = {
  '7d': '7일',
  '30d': '30일',
  '90d': '90일',
};

type PanelMode = 'loading' | 'empty' | 'error' | 'data';

function pickMode<T>(
  q: { isLoading: boolean; isError: boolean; data: T | undefined },
  isEmpty: (d: T) => boolean,
): PanelMode {
  if (q.isLoading) return 'loading';
  if (q.isError) return 'error';
  if (!q.data || isEmpty(q.data)) return 'empty';
  return 'data';
}

export default function AdminDashboardPage() {
  const [period, setPeriod] = useState<DashboardPeriod>('30d');

  const summary = useDashboardSummary();
  const revenue = useDashboardRevenue(period);
  const genre = useDashboardGenre(period);
  const payment = useDashboardPayment(period);
  const top10 = useDashboardTop10();

  // WR-01: revenue service always pads the response with a full bucket
  // skeleton, so `d.length === 0` never fires. Detect empty via the numeric
  // signal (all-zero revenue) so the UI-SPEC D-01 empty copy ("해당 기간 동안
  // 예매 내역이 없습니다") is actually reachable for the revenue panel.
  const revenueMode = pickMode(
    revenue,
    (d) => d.length === 0 || d.every((b) => b.revenue === 0),
  );
  const genreMode = pickMode(genre, (d) => d.length === 0);
  const paymentMode = pickMode(payment, (d) => d.length === 0);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="mb-2 text-xl font-semibold text-gray-900">대시보드</h1>
        <p className="text-xs text-gray-600">
          오늘의 예매·매출 현황과 최근 추이를 확인하세요
        </p>
      </header>

      {/* KPI row (ADM-01) */}
      <section aria-labelledby="kpi-heading">
        <h2 id="kpi-heading" className="sr-only">
          오늘의 요약
        </h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {summary.isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))
          ) : summary.isError ? (
            <SectionError onRetry={() => summary.refetch()} />
          ) : (
            <>
              <AdminStatCard
                icon={Ticket}
                label="오늘 예매수"
                value={summary.data?.todayBookings ?? 0}
                format="count"
              />
              <AdminStatCard
                icon={Banknote}
                label="오늘 매출"
                value={summary.data?.todayRevenue ?? 0}
                format="currency"
              />
              <AdminStatCard
                icon={RotateCcw}
                label="오늘 취소"
                value={summary.data?.todayCancelled ?? 0}
                format="count"
              />
              <AdminStatCard
                icon={Theater}
                label="활성 공연"
                value={summary.data?.activePerformances ?? 0}
                format="count"
              />
            </>
          )}
        </div>
      </section>

      {/* Revenue area (ADM-02) */}
      <section
        aria-labelledby="revenue-heading"
        className="rounded-lg bg-white p-6 shadow-sm"
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp
              className="h-5 w-5 text-gray-600"
              aria-hidden="true"
            />
            <h2
              id="revenue-heading"
              className="text-sm font-semibold text-gray-900"
            >
              매출 추이
            </h2>
          </div>
          <PeriodFilter value={period} onChange={setPeriod} />
        </div>
        <p className="mb-4 text-xs text-gray-600">{`최근 ${PERIOD_LABEL[period]} 기준`}</p>
        {revenueMode === 'data' && revenue.data ? (
          <RevenueAreaChart data={revenue.data} />
        ) : (
          <ChartPanelState
            mode={revenueMode === 'data' ? 'empty' : revenueMode}
            onRetry={
              revenueMode === 'error' ? () => revenue.refetch() : undefined
            }
            emptyBody="해당 기간 동안 예매 내역이 없습니다"
          />
        )}
      </section>

      {/* Category + Payment row (ADM-03 + ADM-05) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section
          aria-labelledby="genre-heading"
          className="rounded-lg bg-white p-6 shadow-sm"
        >
          <div className="mb-4 flex items-center gap-2">
            <PieIcon className="h-5 w-5 text-gray-600" aria-hidden="true" />
            <h2
              id="genre-heading"
              className="text-sm font-semibold text-gray-900"
            >
              분류별 예매 분포
            </h2>
          </div>
          {genreMode === 'data' && genre.data ? (
            <GenreDonutChart data={genre.data} />
          ) : (
            <ChartPanelState
              mode={genreMode === 'data' ? 'empty' : genreMode}
              onRetry={
                genreMode === 'error' ? () => genre.refetch() : undefined
              }
              emptyBody="해당 기간 동안 예매 내역이 없습니다"
            />
          )}
        </section>

        <section
          aria-labelledby="payment-heading"
          className="rounded-lg bg-white p-6 shadow-sm"
        >
          <div className="mb-4 flex items-center gap-2">
            <CreditCard
              className="h-5 w-5 text-gray-600"
              aria-hidden="true"
            />
            <h2
              id="payment-heading"
              className="text-sm font-semibold text-gray-900"
            >
              결제수단 분포
            </h2>
          </div>
          {paymentMode === 'data' && payment.data ? (
            <PaymentBarChart data={payment.data} />
          ) : (
            <ChartPanelState
              mode={paymentMode === 'data' ? 'empty' : paymentMode}
              onRetry={
                paymentMode === 'error' ? () => payment.refetch() : undefined
              }
              emptyBody="해당 기간 동안 결제 내역이 없습니다"
            />
          )}
        </section>
      </div>

      {/* Top 10 (ADM-04) */}
      <section
        aria-labelledby="top10-heading"
        className="rounded-lg bg-white p-6 shadow-sm"
      >
        <div className="mb-2 flex items-center gap-2">
          <Trophy className="h-5 w-5 text-gray-600" aria-hidden="true" />
          <h2
            id="top10-heading"
            className="text-sm font-semibold text-gray-900"
          >
            인기 공연 Top 10
          </h2>
        </div>
        <p className="mb-4 text-xs text-gray-600">
          최근 30일 예매 건수 기준
        </p>
        <TopPerformancesTable
          data={top10.data}
          isLoading={top10.isLoading}
          isError={top10.isError}
          onRetry={() => top10.refetch()}
        />
      </section>
    </div>
  );
}
