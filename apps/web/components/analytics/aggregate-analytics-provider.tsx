'use client';
import { useEffect, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { useAnalyticsConfig } from '@/hooks/use-analytics-config';
import { analyticsCountPage } from '@grabit/shared';
import { useAuthStore } from '@/stores/use-auth-store';
import { aggregateAnalyticsDisabled, configureAggregateAnalytics, flushAggregateAnalytics, observeAggregatePage, scrollAggregateAnalytics, subscribeAggregateChoice, tickAggregateEngagement, trackAggregateAnalytics } from '@/lib/analytics-counts-client';

export function AggregateAnalyticsProvider() {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user); const initialized = useAuthStore((s) => s.isInitialized);
  const disabled = useSyncExternalStore(subscribeAggregateChoice, aggregateAnalyticsDisabled, () => true);
  const permitted = initialized && user?.role !== 'admin' && analyticsCountPage(pathname) !== null;
  const config = useAnalyticsConfig(permitted);
  const active = permitted && !disabled && !config.isError && config.data?.aggregateEnabled === true;
  useEffect(() => { configureAggregateAnalytics(active); if (active) observeAggregatePage(pathname); }, [active, pathname]);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => { tickAggregateEngagement(); flushAggregateAnalytics(); }, 10000);
    const hide = () => { tickAggregateEngagement(false); flushAggregateAnalytics(); };
    const click = (event: MouseEvent) => { const link = (event.target as Element | null)?.closest?.('a'); if (link) trackAggregateAnalytics('link_click'); };
    document.addEventListener('visibilitychange', hide); window.addEventListener('pagehide', hide);
    window.addEventListener('scroll', scrollAggregateAnalytics, { passive: true }); document.addEventListener('click', click);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', hide); window.removeEventListener('pagehide', hide); window.removeEventListener('scroll', scrollAggregateAnalytics); document.removeEventListener('click', click); };
  }, [active]);
  return null;
}
