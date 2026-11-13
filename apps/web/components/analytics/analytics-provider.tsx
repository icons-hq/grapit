'use client';
import { AggregateAnalyticsProvider } from './aggregate-analytics-provider';
import { useEffect, useSyncExternalStore } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useLocale } from 'next-intl';
import { useAnalyticsConfig } from '@/hooks/use-analytics-config';
import { getLocalizedPathname } from '@/lib/i18n/locale-path';
import type { SupportedLocale } from '@grabit/shared';
import { normalizeAnalyticsPath } from '@grabit/shared';
import { useAuthStore } from '@/stores/use-auth-store';
import { analyticsCopy } from './analytics-copy';
import { AnalyticsConsentBanner } from './analytics-consent-banner';
import { analyticsPrivacySignal, configureAnalytics, finishAnalyticsPage, flushAnalytics, getAnalyticsChoice, getAnalyticsWithdrawalPending, identifyAnalytics, observeAnalyticsPage, recordAnalyticsPointer, recordAnalyticsEngagement, recordAnalyticsScroll, resumeAnalyticsEngagement, retryAnalyticsWithdrawal, setAnalyticsChoice, subscribeAnalyticsChoice, touchAnalyticsActivity, trackAnalytics } from '@/lib/analytics-client';

const serverChoice = () => null;
export function AnalyticsProvider() {
  return <><AggregateAnalyticsProvider /><PersonalAnalyticsProvider /></>;
}
function PersonalAnalyticsProvider() {
  const pathname = usePathname(); const search = useSearchParams(); const locale = useLocale();
  const user = useAuthStore((s) => s.user); const initialized = useAuthStore((s) => s.isInitialized);
  const choice = useSyncExternalStore(subscribeAnalyticsChoice, getAnalyticsChoice, serverChoice);
  const pending = useSyncExternalStore(subscribeAnalyticsChoice, getAnalyticsWithdrawalPending, () => false);
  const permittedRoute = normalizeAnalyticsPath(pathname) !== null && user?.role !== 'admin';
  const config = useAnalyticsConfig(initialized && permittedRoute);
  const active = initialized && permittedRoute && !config.isError && config.data?.enabled === true;
  const queryKey = search.toString();
  useEffect(() => {
    if (!permittedRoute) return;
    void retryAnalyticsWithdrawal();
    const retry = window.setInterval(() => { void retryAnalyticsWithdrawal(); }, 60000);
    return () => clearInterval(retry);
  }, [permittedRoute, choice]);
  useEffect(() => {
    configureAnalytics(active, locale);
    if (active && choice === 'accepted') { observeAnalyticsPage(pathname); void identifyAnalytics(); }
  }, [active, choice, pathname, queryKey, locale, user?.id]);
  useEffect(() => {
    if (!active || choice !== 'accepted') return;
    let cancelled = false; let stop: (() => void) | undefined;
    void import('@/lib/analytics-replay-client').then((module) => { if (!cancelled) stop = module.startAnalyticsReplay(); }).catch(() => undefined);
    return () => { cancelled = true; stop?.(); };
  }, [active, choice, pathname, user?.id]);
  useEffect(() => {
    if (!active || choice !== 'accepted') return;
    const tick = window.setInterval(() => { if (document.visibilityState === 'visible') { recordAnalyticsEngagement(); flushAnalytics(); void identifyAnalytics(); } }, 20_000);
    const visibility = () => { if (document.visibilityState === 'hidden') finishAnalyticsPage(); else resumeAnalyticsEngagement(); };
    const link = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.('a'); if (!anchor) return;
      try { const target = new URL(anchor.href); if (target.origin !== location.origin) return; const path = normalizeAnalyticsPath(target.pathname); if (path) trackAnalytics('link_click', { target: path }); } catch { /* not a URL */ }
    };
    document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', finishAnalyticsPage);
    window.addEventListener('scroll', recordAnalyticsScroll, { passive: true }); document.addEventListener('pointerdown', touchAnalyticsActivity, { passive: true });
    document.addEventListener('keydown', touchAnalyticsActivity, { passive: true }); document.addEventListener('click', link); document.addEventListener('click', recordAnalyticsPointer);
    return () => { clearInterval(tick); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', finishAnalyticsPage);
      window.removeEventListener('scroll', recordAnalyticsScroll); document.removeEventListener('pointerdown', touchAnalyticsActivity); document.removeEventListener('keydown', touchAnalyticsActivity); document.removeEventListener('click', link); document.removeEventListener('click', recordAnalyticsPointer); };
  }, [active, choice]);
  if (!active || choice !== null || analyticsPrivacySignal() || normalizeAnalyticsPath(pathname) === '/legal') return null;
  const copy = analyticsCopy(locale);
  const detailsHref = getLocalizedPathname('/legal/analytics', locale as SupportedLocale);
  return <AnalyticsConsentBanner label={copy.title} detailsHref={detailsHref} acceptDisabled={pending}
    onAccept={() => { setAnalyticsChoice('accepted', { collectionConsent: true, overseasConsent: true }); return getAnalyticsChoice() === 'accepted'; }}
    onDecline={() => setAnalyticsChoice('declined')} />;
}
