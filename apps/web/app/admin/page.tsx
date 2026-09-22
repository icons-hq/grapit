'use client';

import { useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Banknote, RotateCcw, Ticket, TrendingDown, RefreshCw } from 'lucide-react';
import { resolveAdminCapabilitySnapshot, type DashboardPeriod } from '@grabit/shared';
import { AdminPageHeader } from '@/components/admin/admin-page-header';
import { AdminStatCard } from '@/components/admin/admin-stat-card';
import { PeriodFilter } from '@/components/admin/dashboard/period-filter';
import { RevenueAreaChart } from '@/components/admin/dashboard/revenue-area-chart';
import { ChartPanelState, SectionError } from '@/components/admin/dashboard/_state';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { useDashboardSummary, useDashboardRevenue } from '@/hooks/use-admin-dashboard';
import { useAdminOperationsInbox } from '@/hooks/use-admin-operations';
import { useAuthStore } from '@/stores/use-auth-store';
import { ADMIN_NAVIGATION, canAccessAdminItem } from '@/lib/admin-navigation';

const SecondaryAnalytics = dynamic(() => import('@/components/admin/dashboard/secondary-analytics'), {
  loading: () => <p role="status" className="p-5 text-sm text-muted-foreground">상세 통계를 불러오고 있습니다.</p>,
});
const SHORTCUT_PATHS = ['/admin/performances', '/admin/bookings', '/admin/operations', '/admin/field-monitor'];

function PendingInquiries() {
  const inbox = useAdminOperationsInbox();
  if (inbox.isLoading) return <p role="status" className="mt-4 text-sm text-muted-foreground">처리 대기 문의를 확인하고 있습니다.</p>;
  if (inbox.isError || !inbox.data) return <p className="mt-4 text-sm text-muted-foreground">문의 현황을 확인하지 못했습니다. <button className="underline" onClick={() => void inbox.refetch()}>다시 확인</button></p>;
  return <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-sm">
    <p>처리 대기 문의 <strong>{inbox.data.totals.all.toLocaleString('ko-KR')}건</strong>
      {inbox.data.totals.overdue > 0 && <span className="ml-3 text-destructive">답변 기한 초과 {inbox.data.totals.overdue}건</span>}</p>
    <Link className="inline-flex items-center gap-2 font-medium" href="/admin/operations">문의 확인<ArrowRight size={14} aria-hidden="true" /></Link>
  </div>;
}

export default function AdminDashboardPage() {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useState<DashboardPeriod>('30d');
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const user = useAuthStore((state) => state.user);
  const capabilities = resolveAdminCapabilitySnapshot(user);
  const summary = useDashboardSummary();
  const revenue = useDashboardRevenue(period);
  const shortcuts = SHORTCUT_PATHS.flatMap((href) => ADMIN_NAVIGATION.flatMap((group) => group.items).filter((item) => item.href === href && canAccessAdminItem(item, capabilities)));
  const canReadInquiries = capabilities.superuser || capabilities.capabilities.includes('support.manage');
  const revenueMode = revenue.isLoading ? 'loading' : revenue.isError ? 'error' : !revenue.data?.some((bucket) => bucket.revenue !== 0) ? 'empty' : 'data';
  async function refreshOverview() {
    setRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard'] }),
        ...(canReadInquiries ? [queryClient.invalidateQueries({ queryKey: ['admin', 'operations'] })] : []),
      ]);
    } finally {
      setRefreshing(false);
    }
  }

  return <div className="admin-overview flex flex-col gap-6">
    <AdminPageHeader title="운영 현황" description="오늘의 예매를 확인하고 필요한 업무를 시작하세요. 모든 날짜는 한국 시간 기준입니다."
      actions={<Button variant="outline" disabled={refreshing || summary.isFetching || revenue.isFetching} onClick={() => void refreshOverview()}><RefreshCw size={15} />새로고침</Button>} />
    <section className="admin-panel" aria-labelledby="work-heading">
      <h2 id="work-heading" className="admin-panel-title">자주 하는 업무</h2>
      <p className="admin-panel-description">공연 준비부터 고객 응대와 현장 입장까지</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {shortcuts.map((item) => <Link key={item.href} href={item.href} className="admin-task-link"><strong>{item.label}<ArrowRight size={15} aria-hidden="true" /></strong><span>{item.description}</span></Link>)}
      </div>
      {canReadInquiries && <PendingInquiries />}
    </section>
    <section aria-labelledby="today-heading">
      <div className="mb-4"><h2 id="today-heading" className="admin-panel-title">오늘의 예매·매출</h2><p className="admin-panel-description">전체 공연 · 결제 승인과 취소 처리 시각 기준</p></div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        {summary.isLoading ? Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-28 w-full" />)
          : summary.isError || !summary.data ? <SectionError onRetry={() => void summary.refetch()} /> : <>
            <AdminStatCard icon={Ticket} label="오늘 예매" value={summary.data.todayBookings} format="count" description="오늘 결제한 예매" />
            <AdminStatCard icon={RotateCcw} label="오늘 취소 처리" value={summary.data.todayCancellationEvents} format="count" description="좌석 취소와 과거 예매 취소" />
            <AdminStatCard icon={Banknote} label="오늘 결제 금액" value={summary.data.todayGrossRevenue} format="currency" description="오늘 승인된 결제" />
            <AdminStatCard icon={TrendingDown} label="오늘 취소 차감액" value={summary.data.todayNegativeCancellationRevenue} format="currency" description="오늘 처리한 취소 금액" />
            <AdminStatCard icon={Banknote} label="오늘 순매출" value={summary.data.todayNetRevenue} format="currency" description="결제 금액 + 취소 차감액" />
          </>}
      </div>
      <p className="mt-3 text-xs leading-6 text-muted-foreground">취소 처리 수는 좌석별 취소와 과거 예매·자동 복구 취소 건을 합산합니다. 실제 정산 입금액은 정산 자료에서 확인하세요.</p>
    </section>
    <section className="admin-panel" aria-labelledby="revenue-heading">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4"><div><h2 id="revenue-heading" className="admin-panel-title">매출 추이</h2><p className="admin-panel-description">최근 {period.replace('d', '일')} · 전체 공연</p></div><PeriodFilter value={period} onChange={setPeriod} /></div>
      {revenueMode === 'data' && revenue.data ? <RevenueAreaChart data={revenue.data} /> : <ChartPanelState mode={revenueMode === 'data' ? 'empty' : revenueMode} onRetry={revenueMode === 'error' ? () => void revenue.refetch() : undefined} emptyBody="이 기간에는 매출이 없습니다. 기간을 바꾸거나 예매 목록을 확인해주세요." />}
    </section>
    <details className="admin-disclosure" open={analyticsOpen} onToggle={(event) => setAnalyticsOpen(event.currentTarget.open)}>
      <summary>상세 통계 · 장르, 결제수단, 공연별 실적</summary>
      {analyticsOpen && <div className="admin-disclosure-body"><SecondaryAnalytics period={period} /></div>}
    </details>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-xs text-muted-foreground"><p>화면의 금액과 실제 정산 입금액은 다를 수 있습니다.</p><Link href="/admin/patch-notes" className="inline-flex items-center gap-2">업데이트 내역<ArrowRight size={14} aria-hidden="true" /></Link></div>
  </div>;
}
