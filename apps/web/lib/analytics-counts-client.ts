'use client';
import { analyticsCountPage, analyticsCountsSchema, type AnalyticsCountName, type AnalyticsCountPage, type AnalyticsCounts } from '@grabit/shared';
import { apiUrl } from './api-url';

const OPT_OUT = 'grabit-aggregate-opt-out-v1';
const CHANGED = 'grabit:aggregate-choice';
let disabledInMemory = false;
let enabled = false;
let currentPath: string | null = null;
let currentPage: AnalyticsCountPage | null = null;
let lastTick = 0;
let visibleMs = 0;
let sentEngagement = false;
let sentScroll = false;
let signupCounted = false;
const queue = new Map<string, AnalyticsCounts['counts'][number]>();

export function aggregateAnalyticsDisabled() {
  try { const explicit = localStorage.getItem(OPT_OUT); if (explicit !== null) return explicit === '1'; return JSON.parse(localStorage.getItem('grabit-analytics-choice-v1') ?? 'null')?.value === 'declined'; } catch { return disabledInMemory; }
}
export function setAggregateAnalyticsDisabled(disabled: boolean) {
  disabledInMemory = disabled;
  try { localStorage.setItem(OPT_OUT, disabled ? '1' : '0'); } catch { /* preference remains in memory */ }
  if (disabled) queue.clear();
  window.dispatchEvent(new Event(CHANGED));
}
export function subscribeAggregateChoice(listener: () => void) {
  window.addEventListener(CHANGED, listener); window.addEventListener('storage', listener);
  return () => { window.removeEventListener(CHANGED, listener); window.removeEventListener('storage', listener); };
}
function allowed() {
  return enabled && !aggregateAnalyticsDisabled() && !navigator.webdriver && navigator.doNotTrack !== '1'
    && !(navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl;
}
export function configureAggregateAnalytics(active: boolean) {
  if (enabled && !active) flushAggregateAnalytics();
  enabled = active;
  if (!active || !allowed()) { queue.clear(); currentPath = null; currentPage = null; }
}
export function trackAggregateAnalytics(name: string) {
  try {
    if (!allowed() || !currentPage || analyticsCountPage(window.location.pathname) === null) return;
    if (name === 'signup_start' && signupCounted) return;
    const parsed = analyticsCountsSchema.safeParse({ counts: [{ page: currentPage, name, count: 1 }] });
    if (!parsed.success) return;
    if (name === 'signup_start') signupCounted = true;
    const key = `${currentPage}:${name}`; const row = queue.get(key);
    if (row) row.count++; else queue.set(key, parsed.data.counts[0]!);
    if ([...queue.values()].reduce((sum, value) => sum + value.count, 0) >= 20) flushAggregateAnalytics();
  } catch { /* counts must not block the service */ }
}
export function observeAggregatePage(pathname: string) {
  try {
    if (!allowed() || currentPath === pathname) return;
    tickAggregateEngagement(); flushAggregateAnalytics();
    currentPath = pathname; currentPage = analyticsCountPage(pathname);
    visibleMs = 0; lastTick = performance.now(); sentEngagement = false; sentScroll = false; signupCounted = false;
    trackAggregateAnalytics('page_view');
    if (currentPage === 'performance') trackAggregateAnalytics('performance_view');
    if (currentPage === 'booking') trackAggregateAnalytics('booking_start');
  } catch { /* no navigation dependency */ }
}
export function tickAggregateEngagement(visible = document.visibilityState === 'visible') {
  const now = performance.now();
  if (lastTick && visible) visibleMs += Math.min(now - lastTick, 10000);
  lastTick = now;
  if (!sentEngagement && visibleMs >= 30000) { trackAggregateAnalytics('engaged_30s'); sentEngagement = true; }
}
export function scrollAggregateAnalytics() {
  const height = document.documentElement.scrollHeight - window.innerHeight;
  if (!sentScroll && height > 0 && window.scrollY / height >= .75) { trackAggregateAnalytics('scroll_75'); sentScroll = true; }
}
export function flushAggregateAnalytics() {
  if (!allowed()) { queue.clear(); return; }
  if (!queue.size) return;
  const body = JSON.stringify({ counts: [...queue.values()] }); queue.clear();
  // No visitor ID, event ID, client timestamp, URL, cookie, auth or referrer.
  void fetch(apiUrl('/api/v1/analytics/counts'), { method: 'POST', body, headers: { 'Content-Type': 'application/json' },
    credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: true }).catch(() => undefined);
}
export const aggregateEventLabels: Record<AnalyticsCountName, string> = {
  page_view: '페이지 표시', performance_view: '공연 화면 표시', booking_start: '예매 화면 진입', signup_start: '가입 시작',
  queue_enter: '대기열 진입', seat_select: '좌석 선택 동작', checkout_start: '결제 시작', link_click: '링크 클릭', scroll_75: '75% 스크롤', engaged_30s: '30초 이상 표시',
};
