'use client';
import { trackAggregateAnalytics } from './analytics-counts-client';
import { ANALYTICS_MAX_BATCH, ANALYTICS_NOTICE_VERSION, ANALYTICS_SESSION_MS, analyticsBatchSchema, analyticsEventSchema, analyticsTouchSchema, normalizeAnalyticsPath, sanitizeAnalyticsCampaign, type AnalyticsBatch, type AnalyticsEvent, type AnalyticsEventName, type AnalyticsTouch } from '@grabit/shared';
import { apiUrl } from './api-url';
import { stripUrlQuery } from './sentry-redaction';
import { useAuthStore } from '@/stores/use-auth-store';

export const ANALYTICS_CHOICE_KEY = 'grabit-analytics-choice-v1';
const VISITOR_KEY = 'grabit-analytics-visitor-v1';
const SESSION_KEY = 'grabit-analytics-session-v1';
const WITHDRAWAL_KEY = 'grabit-analytics-withdrawal-v1';
export const ANALYTICS_CHOICE_EVENT = 'grabit:analytics-choice';
const RETENTION_MS = 90 * 86400000;
type Session = { id: string; visitorId: string; lastActivity: number; touch: AnalyticsTouch; owner: string | null };
let enabled = false; let memoryChoice: string | null = null; let session: Session | null = null;
let page: { id: string; path: string; previous: string | null; since: number; seen: Set<string> } | null = null;
let queue: AnalyticsEvent[] = []; let language: AnalyticsBatch['language'] = 'ko'; let identified = ''; let identifying = false;
let pendingWithdrawal: { visitorId: string; sessionId: string; requestedAt: number } | null = null;
let withdrawing = false;

export function analyticsPrivacySignal() {
  return typeof navigator !== 'undefined' && (navigator.doNotTrack === '1' || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true);
}
export function getAnalyticsChoice(): 'accepted' | 'declined' | null {
  try {
    let raw = memoryChoice;
    try { raw = localStorage.getItem(ANALYTICS_CHOICE_KEY); } catch { /* in-memory fallback */ }
    const value = JSON.parse(raw ?? 'null') as { value?: string; version?: string; at?: number } | null;
    return value?.version === ANALYTICS_NOTICE_VERSION && typeof value.at === 'number' && Date.now() - value.at < RETENTION_MS
      && (value.value === 'accepted' || value.value === 'declined') ? value.value : null;
  } catch { return null; }
}
export function subscribeAnalyticsChoice(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    // Invalidate this tab even if a later re-consent is already in shared storage.
    // Never remove the new visitor ID created by the tab that accepted again.
    if (event.key === ANALYTICS_CHOICE_KEY || event.key === null) resetSession();
    listener();
  };
  window.addEventListener(ANALYTICS_CHOICE_EVENT, listener); window.addEventListener('storage', onStorage);
  return () => { window.removeEventListener(ANALYTICS_CHOICE_EVENT, listener); window.removeEventListener('storage', onStorage); };
}
export function setAnalyticsChoice(value: 'accepted' | 'declined') {
  if (value === 'accepted' && getAnalyticsWithdrawalPending()) return;
  const previous = getAnalyticsChoice();
  if (value === 'declined') {
    try { let saved = session ?? JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null') as Session | null;
      if (!saved) { const visitor = JSON.parse(localStorage.getItem(VISITOR_KEY) ?? 'null') as { id?: string; lastSessionId?: string } | null;
        if (visitor?.id && visitor.lastSessionId) saved = { visitorId: visitor.id, id: visitor.lastSessionId } as Session;
      }
      if (saved?.visitorId && saved.id) { pendingWithdrawal = { visitorId: saved.visitorId, sessionId: saved.id, requestedAt: Date.now() }; localStorage.setItem(WITHDRAWAL_KEY, JSON.stringify(pendingWithdrawal)); }
    } catch { /* in-memory request can still be sent */ }
  }
  if (previous !== 'accepted') resetIdentity();
  // Publish the shared identity before acceptance wakes other tabs. Otherwise
  // both tabs can race to create different visitor IDs after a withdrawal.
  try { if (value === 'accepted' && enabled && !analyticsPrivacySignal()) browserVisitorId(Date.now()); } catch { /* optional identifier support */ }
  memoryChoice = JSON.stringify({ version: ANALYTICS_NOTICE_VERSION, value, at: Date.now() });
  try { localStorage.setItem(ANALYTICS_CHOICE_KEY, memoryChoice); } catch { /* session-only choice */ }
  if (value === 'declined') resetIdentity();
  window.dispatchEvent(new Event(ANALYTICS_CHOICE_EVENT));
  if (value === 'declined') void retryAnalyticsWithdrawal();
}
export function getAnalyticsWithdrawalPending() {
  try { return pendingWithdrawal !== null || localStorage.getItem(WITHDRAWAL_KEY) !== null; } catch { return pendingWithdrawal !== null; }
}
export async function retryAnalyticsWithdrawal() {
  if (withdrawing) return;
  try {
    const request = pendingWithdrawal ?? JSON.parse(localStorage.getItem(WITHDRAWAL_KEY) ?? 'null') as { visitorId: string; sessionId: string; requestedAt: number } | null;
    if (!request) return;
    if (Date.now() - request.requestedAt > RETENTION_MS) { pendingWithdrawal = null; localStorage.removeItem(WITHDRAWAL_KEY); return; }
    withdrawing = true;
    const response = await fetch(apiUrl('/api/v1/analytics/withdraw'), { method: 'POST', credentials: 'omit', keepalive: true,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visitorId: request.visitorId, sessionId: request.sessionId, consentVersion: ANALYTICS_NOTICE_VERSION }), signal: AbortSignal.timeout(2500) });
    if (!response.ok) return;
    const result = await response.json() as { deleted?: boolean };
    if (result.deleted) { pendingWithdrawal = null; try { localStorage.removeItem(WITHDRAWAL_KEY); } catch { /* already in memory */ } }
  } catch { /* collection remains stopped; retain only the deletion request for retry */ }
  finally { withdrawing = false; window.dispatchEvent(new Event(ANALYTICS_CHOICE_EVENT)); }
}
function allowed() {
  return enabled && getAnalyticsChoice() === 'accepted' && !analyticsPrivacySignal() && !navigator.webdriver
    && useAuthStore.getState().user?.role !== 'admin' && normalizeAnalyticsPath(window.location.pathname) !== null;
}
function resetSession() {
  queue = []; page = null; session = null; identified = '';
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* optional storage */ }
}
function resetIdentity() {
  resetSession();
  try { localStorage.removeItem(VISITOR_KEY); } catch { /* optional storage */ }
}
function discardStaleSession() {
  if (!session) return;
  try {
    const visitor = JSON.parse(localStorage.getItem(VISITOR_KEY) ?? 'null') as { id?: string; expires?: number } | null;
    if (visitor?.id !== session.visitorId || !(visitor.expires && visitor.expires > Date.now())) resetSession();
  } catch { /* unavailable storage keeps the current in-memory session */ }
}
export function configureAnalytics(active: boolean, locale: string) {
  enabled = active;
  language = locale.startsWith('zh') ? 'zh' : ['ko', 'en', 'th'].includes(locale) ? locale as 'ko' | 'en' | 'th' : 'other';
  if (getAnalyticsChoice() !== 'accepted' || analyticsPrivacySignal()) resetSession();
  else if (!active) { queue = []; page = null; }
}
export function analyticsTouch(url: URL, referrer: string): AnalyticsTouch {
  let referrerHost: string | null = null;
  try { const host = new URL(referrer).hostname.toLowerCase(); if (host !== url.hostname && /^[a-z0-9.-]+\.[a-z]{2,24}$/.test(host)) referrerHost = host; } catch { /* direct */ }
  const utm = (key: string) => sanitizeAnalyticsCampaign(url.searchParams.get(`utm_${key}`));
  return { landingPath: normalizeAnalyticsPath(stripUrlQuery(url.pathname)) ?? '/other', referrerHost,
    source: utm('source'), medium: utm('medium'), campaign: utm('campaign'), term: utm('term'), content: utm('content') };
}
function consentTime() {
  let raw = memoryChoice;
  try { raw = localStorage.getItem(ANALYTICS_CHOICE_KEY); } catch { /* fallback */ }
  return new Date((JSON.parse(raw ?? 'null') as { at: number }).at).toISOString();
}
function dimensions(): Pick<AnalyticsBatch, 'device' | 'browser' | 'os' | 'screen' | 'language'> {
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua) ? 'android' : /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'ios' : /Windows/.test(ua) ? 'windows' : /Mac/.test(ua) ? 'macos' : /Linux/.test(ua) ? 'linux' : 'other';
  const browser = /Edg\//.test(ua) ? 'edge' : /SamsungBrowser/.test(ua) ? 'samsung' : /Firefox|FxiOS/.test(ua) ? 'firefox' : /Chrome|CriOS/.test(ua) ? 'chrome' : /Safari/.test(ua) ? 'safari' : 'other';
  return { language, os, browser, device: /iPad|Tablet/.test(ua) || (os === 'ios' && navigator.maxTouchPoints > 1 && /Macintosh/.test(ua)) ? 'tablet' : /Mobi|iPhone/.test(ua) ? 'mobile' : 'desktop', screen: window.innerWidth < 768 ? 'small' : window.innerWidth < 1280 ? 'medium' : 'large' };
}
function saveSession() {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    const visitor = JSON.parse(localStorage.getItem(VISITOR_KEY) ?? 'null') as { id?: string; expires?: number } | null;
    if (session && visitor?.id === session.visitorId) localStorage.setItem(VISITOR_KEY, JSON.stringify({ ...visitor, lastSessionId: session.id }));
  } catch { /* optional storage */ }
}
function browserVisitorId(now: number) {
  try { const saved = JSON.parse(localStorage.getItem(VISITOR_KEY) ?? 'null'); if (saved?.expires > now && /^[0-9a-f-]{36}$/i.test(saved?.id ?? '')) return saved.id as string; } catch { /* optional storage */ }
  const id = crypto.randomUUID();
  try { localStorage.setItem(VISITOR_KEY, JSON.stringify({ id, expires: now + RETENTION_MS })); } catch { /* ephemeral */ }
  return id;
}
function ensureSession(interaction: boolean): boolean {
  const now = Date.now(); const userId = useAuthStore.getState().user?.id ?? null;
  if (!session) {
    try {
      const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null') as Session | null;
      if (saved && /^[0-9a-f-]{36}$/i.test(saved.id) && /^[0-9a-f-]{36}$/i.test(saved.visitorId) && analyticsTouchSchema.safeParse(saved.touch).success && Number.isFinite(saved.lastActivity)) session = saved;
    } catch { /* corrupt or disabled storage */ }
  }
  // A suspended tab can miss storage events. Recheck before any use of its ID.
  discardStaleSession();
  if (session?.owner && session.owner !== userId) resetIdentity();
  if (session && now - session.lastActivity > ANALYTICS_SESSION_MS) {
    if (!interaction) return false;
    flushAnalytics(); session = null; page = null; identified = '';
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* optional storage */ }
  }
  if (!session) {
    if (!interaction) return false;
    session = { id: crypto.randomUUID(), visitorId: browserVisitorId(now), lastActivity: now, touch: analyticsTouch(new URL(window.location.href), document.referrer), owner: null };
  }
  if (interaction) session.lastActivity = now;
  saveSession(); return true;
}
function append(name: AnalyticsEventName, props: AnalyticsEvent['props']) {
  if (!page) return;
  const event = analyticsEventSchema.safeParse({ id: crypto.randomUUID(), pageId: page.id, name, path: page.path, previousPath: page.previous, props, at: new Date().toISOString() });
  if (event.success && queue.length < ANALYTICS_MAX_BATCH) queue.push(event.data);
  if (queue.length >= ANALYTICS_MAX_BATCH) flushAnalytics();
}
export function observeAnalyticsPage(pathname: string) {
  try {
    if (!allowed() || !ensureSession(true)) return;
    const arrival = analyticsTouch(new URL(window.location.href), document.referrer);
    if (session && [arrival.source, arrival.medium, arrival.campaign, arrival.term, arrival.content].some(Boolean)
      && JSON.stringify([arrival.source, arrival.medium, arrival.campaign, arrival.term, arrival.content]) !== JSON.stringify([session.touch.source, session.touch.medium, session.touch.campaign, session.touch.term, session.touch.content])) {
      finishAnalyticsPage(); session = null; page = null; identified = '';
      try { sessionStorage.removeItem(SESSION_KEY); } catch { /* optional storage */ }
      if (!ensureSession(true)) return;
    }
    const path = normalizeAnalyticsPath(stripUrlQuery(pathname)); if (!path || page?.path === path) return;
    const previous = page?.path ?? null; finishAnalyticsPage();
    page = { id: crypto.randomUUID(), path, previous, since: performance.now(), seen: new Set() };
    append('page_view', {});
    const match = path.match(/^\/(performance|booking)\/([0-9a-f-]{36})$/i);
    if (match) append(match[1] === 'performance' ? 'performance_view' : 'booking_start', { performanceId: match[2] });
  } catch { /* measurement must never interrupt navigation */ }
}
export function trackAnalytics(name: AnalyticsEventName, props: AnalyticsEvent['props'] = {}) {
  // Page/link/scroll/engagement counts have one independent provider. Forward
  // only business-flow hooks so enabling personal analytics cannot double count.
  if (['signup_start', 'queue_enter', 'seat_select', 'checkout_start'].includes(name)) trackAggregateAnalytics(name);
  try {
    if (!allowed() || !ensureSession(true)) return;
    if (!page) observeAnalyticsPage(window.location.pathname);
    if (name === 'signup_start' && page?.seen.has(name)) return;
    page?.seen.add(name); append(name, props);
  } catch { /* measurement must never interrupt signup/booking/payment */ }
}
export function touchAnalyticsActivity() {
  try { if (allowed() && ensureSession(true) && !page) observeAnalyticsPage(window.location.pathname); } catch { /* no impact */ }
}
export function recordAnalyticsEngagement() {
  try {
    if (!allowed() || !page || !ensureSession(false)) return;
    const seconds = Math.min(1800, Math.floor((performance.now() - page.since) / 1000));
    page.since = performance.now(); if (seconds > 0) append('engagement', { seconds });
  } catch { /* no impact */ }
}
export function resumeAnalyticsEngagement() { if (page) page.since = performance.now(); }
export function finishAnalyticsPage() { recordAnalyticsEngagement(); flushAnalytics(); }
export function recordAnalyticsScroll() {
  try {
    if (!allowed() || !page) return;
    const height = document.documentElement.scrollHeight - window.innerHeight;
    if (height <= 0) return;
    const depth = Math.min(100, Math.round(window.scrollY / height * 100));
    for (const point of [25, 50, 75, 100] as const) if (depth >= point && !page.seen.has(`scroll:${point}`)) { page.seen.add(`scroll:${point}`); trackAnalytics('scroll_depth', { depth: point }); }
  } catch { /* no impact */ }
}
export function flushAnalytics() {
  try {
    discardStaleSession();
    if (!queue.length || !session) return;
    if (!allowed()) { queue = []; return; }
    const batch = analyticsBatchSchema.safeParse({ consentVersion: ANALYTICS_NOTICE_VERSION, consentedAt: consentTime(), visitorId: session.visitorId, sessionId: session.id, touch: session.touch, ...dimensions(), events: queue.splice(0, ANALYTICS_MAX_BATCH) });
    if (!batch.success) return;
    const body = new Blob([JSON.stringify(batch.data)], { type: 'application/json' });
    if (body.size > 16 * 1024) return;
    const url = apiUrl('/api/v1/analytics/events');
    let sent = false;
    try { sent = typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(url, body); } catch { /* fetch fallback */ }
    if (!sent) void fetch(url, { method: 'POST', body, keepalive: true, credentials: 'omit' }).catch(() => undefined);
  } catch { queue = []; }
}
export async function identifyAnalytics() {
  try {
    discardStaleSession();
    const { user, accessToken } = useAuthStore.getState();
    if (!allowed() || !session || !user || user.role !== 'user' || !accessToken || identifying || identified === `${user.id}:${session.id}`) return;
    identifying = true; flushAnalytics();
    const current = session;
    const response = await fetch(apiUrl('/api/v1/analytics/identify'), { method: 'POST', credentials: 'omit', keepalive: true,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ visitorId: current.visitorId, sessionId: current.id, consentVersion: ANALYTICS_NOTICE_VERSION }), signal: AbortSignal.timeout(1500) });
    const result = response.ok ? await response.json() as { linked?: boolean } : null;
    if (result?.linked && session === current) { identified = `${user.id}:${current.id}`; current.owner = user.id; saveSession(); }
  } catch { /* a future heartbeat may retry; never refresh or redirect auth */ }
  finally { identifying = false; }
}
