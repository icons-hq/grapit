import { GA4_CONSENT_VERSION, normalizeGa4Path, sanitizeAnalyticsCampaign, type Ga4Config } from '@grabit/shared';
import { analyticsPrivacySignal } from './analytics-client';

const CHOICE_KEY = 'grabit:google-interests:v1';
const CHANGED = 'grabit:google-interests-choice';
const TTL = 90 * 86400000;
type Gtag = (...args: unknown[]) => void;
type GoogleWindow = Window & { dataLayer?: unknown[]; gtag?: Gtag };
let measurement: string | null = null;
let configured: string | null = null;
let lastPage: string | null = null;
let blockedInMemory = false;

export function getGa4Choice(): 'accepted' | 'declined' | null {
  if (typeof window === 'undefined') return null;
  if (blockedInMemory) return 'declined';
  try {
    const row = JSON.parse(localStorage.getItem(CHOICE_KEY) ?? 'null');
    if (!row || row.version !== GA4_CONSENT_VERSION || !Number.isFinite(row.at) || row.at > Date.now() || Date.now() - row.at >= TTL) return null;
    if (row.choice === 'declined') return 'declined';
    return row.choice === 'accepted' && row.collection === true && row.transfer === true && row.adult === true ? 'accepted' : null;
  } catch { return null; }
}
export function subscribeGa4Choice(listener: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === CHOICE_KEY || event.key === null) { blockedInMemory = false; listener(); } };
  window.addEventListener('storage', storage); window.addEventListener(CHANGED, listener);
  return () => { window.removeEventListener('storage', storage); window.removeEventListener(CHANGED, listener); };
}
export function setGa4Choice(accepted: boolean) {
  if (!accepted) { blockedInMemory = true; stopGa4(true); }
  try {
    localStorage.setItem(CHOICE_KEY, JSON.stringify({ version: GA4_CONSENT_VERSION, at: Date.now(), choice: accepted ? 'accepted' : 'declined', collection: accepted, transfer: accepted, adult: accepted }));
  } catch { blockedInMemory = true; stopGa4(); window.dispatchEvent(new Event(CHANGED)); return false; }
  blockedInMemory = !accepted;
  window.dispatchEvent(new Event(CHANGED));
  return true;
}
function disable(id: string, value: boolean) { (window as unknown as Record<string, unknown>)[`ga-disable-${id}`] = value; }
export function stopGa4(clearCookies = false) {
  if (typeof window === 'undefined') return;
  if (measurement) disable(measurement, true);
  lastPage = null;
  // No consent update is transmitted on withdrawal. The disabled flag stops
  // the already loaded runtime, and cookies are removed locally.
  if (clearCookies) {
    for (const cookie of document.cookie.split(';')) {
      const name = cookie.trim().split('=')[0]!;
      if (name !== '_ga' && !name.startsWith('_ga_')) continue;
      document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
      const parts = location.hostname.split('.');
      for (let start = 0; start < parts.length - 1; start++) document.cookie = `${name}=; Max-Age=0; Path=/; Domain=.${parts.slice(start).join('.')}; SameSite=Lax`;
    }
  }
}
export function updateGa4(config: Ga4Config | undefined, pathname: string) {
  if (typeof window === 'undefined') return;
  const path = normalizeGa4Path(pathname);
  if (!config?.enabled || config.noticeVersion !== GA4_CONSENT_VERSION || !/^G-[A-Z0-9]{4,20}$/.test(config.measurementId ?? '')
    || getGa4Choice() !== 'accepted' || analyticsPrivacySignal() || !path) { stopGa4(); return; }
  const id = config.measurementId!;
  if (measurement && measurement !== id) disable(measurement, true);
  measurement = id;
  const win = window as GoogleWindow;
  win.dataLayer ??= [];
  win.gtag ??= function () { win.dataLayer!.push(arguments); };
  const gtag = win.gtag;
  const denied = { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' };
  const granted = { analytics_storage: 'granted', ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted' };
  const pageLocation = new URL(path, window.location.origin);
  const query = new URLSearchParams(window.location.search);
  for (const key of ['source', 'medium', 'campaign', 'term', 'content']) {
    const value = sanitizeAnalyticsCampaign(query.get(`utm_${key}`));
    if (value) pageLocation.searchParams.set(`utm_${key}`, value);
  }
  const title = path === '/' ? 'Grabit' : path.startsWith('/performance/') ? 'Grabit show' : 'Grabit catalogue';
  let referrer = '';
  try { const url = new URL(document.referrer); if (['https:', 'http:'].includes(url.protocol) && url.origin !== location.origin) referrer = url.origin; } catch { /* no referrer */ }
  disable(id, false);
  // Google can bootstrap a page view before per-stream config is processed.
  // Set the safe URL and disable automatic views globally before consent/js.
  gtag('set', { send_page_view: false, page_location: pageLocation.href, page_referrer: referrer, page_title: title });
  if (configured !== id) {
    gtag('consent', 'default', denied);
    gtag('consent', 'update', granted);
    gtag('js', new Date());
    gtag('config', id, { send_page_view: false, page_location: pageLocation.href, page_referrer: referrer, page_title: title,
      cookie_expires: 60 * 86400, cookie_update: false, allow_google_signals: true, allow_ad_personalization_signals: true });
    const script = document.createElement('script'); script.id = 'grabit-google-interests'; script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
    script.onerror = () => { configured = null; script.remove(); stopGa4(); };
    document.head.appendChild(script); configured = id;
  }
  if (lastPage !== pageLocation.href) {
    gtag('event', 'page_view', { send_to: id, page_location: pageLocation.href, page_referrer: referrer, page_title: title });
    lastPage = pageLocation.href;
  }
}
