import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ user: null as { id: string; role: string } | null, accessToken: null as string | null }));
vi.mock('@/stores/use-auth-store', () => ({ useAuthStore: { getState: () => auth } }));
let client: typeof import('../analytics-client');
function storage() { const data = new Map<string,string>(); return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key), clear: () => data.clear() }; }
describe('first-party browser tracker', () => {
  beforeEach(async () => {
    vi.resetModules(); vi.stubGlobal('localStorage', storage()); vi.stubGlobal('sessionStorage', storage());
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ deleted: true, linked: true }) }));
    Object.defineProperty(navigator, 'sendBeacon', { value: vi.fn().mockReturnValue(true), configurable: true });
    Object.defineProperty(navigator, 'webdriver', { value: false, configurable: true }); Object.defineProperty(navigator, 'doNotTrack', { value: '0', configurable: true });
    auth.user = null; auth.accessToken = null; history.replaceState({}, '', '/?utm_source=instagram&utm_campaign=launch_20261111&email=secret@example.com&ticket=secret');
    client = await import('../analytics-client');
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  it('creates no identity or transmission until enabled and accepted; errors remain outside user flows', () => {
    client.observeAnalyticsPage('/'); client.trackAnalytics('signup_start'); client.flushAnalytics();
    expect(localStorage.getItem('grabit-analytics-visitor-v1')).toBeNull(); expect(navigator.sendBeacon).not.toHaveBeenCalled();
    client.setAnalyticsChoice('accepted'); client.observeAnalyticsPage('/'); expect(navigator.sendBeacon).not.toHaveBeenCalled();
    client.configureAnalytics(true, 'ko'); client.observeAnalyticsPage('/'); client.flushAnalytics(); expect(navigator.sendBeacon).toHaveBeenCalledOnce();
    client.configureAnalytics(false, 'ko'); client.trackAnalytics('signup_start'); client.flushAnalytics(); expect(navigator.sendBeacon).toHaveBeenCalledOnce();
  });
  it('sends a sanitized batch through Beacon and falls back to quiet keepalive fetch', async () => {
    client.setAnalyticsChoice('accepted'); client.configureAnalytics(true, 'ko'); client.observeAnalyticsPage('/'); client.trackAnalytics('signup_start'); client.flushAnalytics();
    const blob = vi.mocked(navigator.sendBeacon).mock.calls[0]![1] as Blob;
    const serialized = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.readAsText(blob); });
    expect(serialized).toContain('instagram'); expect(serialized).toContain('launch_20261111'); expect(serialized).not.toMatch(/secret|email|ticket=/);
    vi.mocked(navigator.sendBeacon).mockReturnValue(false); vi.mocked(fetch).mockRejectedValue(new Error('offline'));
    expect(() => { client.trackAnalytics('link_click', { target: '/search' }); client.flushAnalytics(); }).not.toThrow();
    await Promise.resolve(); expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/analytics/events'), expect.objectContaining({ keepalive: true, credentials: 'omit' }));
  });
  it('excludes sensitive routes and respects DNT even with prior acceptance', () => {
    client.setAnalyticsChoice('accepted'); client.configureAnalytics(true, 'ko'); history.replaceState({}, '', '/auth/callback?token=secret');
    client.observeAnalyticsPage('/auth/callback'); client.trackAnalytics('signup_start'); client.flushAnalytics(); expect(navigator.sendBeacon).not.toHaveBeenCalled();
    history.replaceState({}, '', '/'); Object.defineProperty(navigator, 'doNotTrack', { value: '1', configurable: true });
    client.observeAnalyticsPage('/'); client.flushAnalytics(); expect(navigator.sendBeacon).not.toHaveBeenCalled();
  });
  it('rotates sessions after 30 minutes of inactivity without rotating the visitor', async () => {
    vi.useFakeTimers(); client.setAnalyticsChoice('accepted'); client.configureAnalytics(true, 'ko'); client.observeAnalyticsPage('/'); client.flushAnalytics();
    const first = JSON.parse(sessionStorage.getItem('grabit-analytics-session-v1')!);
    vi.advanceTimersByTime(31 * 60000); client.touchAnalyticsActivity(); client.flushAnalytics();
    const next = JSON.parse(sessionStorage.getItem('grabit-analytics-session-v1')!);
    expect(next.id).not.toBe(first.id); expect(next.visitorId).toBe(first.visitorId);
  });
  it('stops immediately on withdrawal, retains only a failed deletion request and retries without falsely reporting completion', async () => {
    client.setAnalyticsChoice('accepted'); client.configureAnalytics(true, 'ko'); client.observeAnalyticsPage('/'); client.flushAnalytics();
    vi.mocked(fetch).mockResolvedValue({ ok: false } as Response); client.setAnalyticsChoice('declined'); await Promise.resolve(); await Promise.resolve();
    expect(client.getAnalyticsChoice()).toBe('declined'); expect(localStorage.getItem('grabit-analytics-visitor-v1')).toBeNull(); expect(client.getAnalyticsWithdrawalPending()).toBe(true);
    client.setAnalyticsChoice('accepted'); expect(client.getAnalyticsChoice()).toBe('declined');
    const calls = vi.mocked(navigator.sendBeacon).mock.calls.length; client.trackAnalytics('signup_start'); client.flushAnalytics(); expect(navigator.sendBeacon).toHaveBeenCalledTimes(calls);
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ deleted: true }) } as Response); await client.retryAnalyticsWithdrawal(); expect(client.getAnalyticsWithdrawalPending()).toBe(false);
  });
  it('can withdraw earlier visits from a fresh tab before that tab creates a session', async () => {
    client.setAnalyticsChoice('accepted'); client.configureAnalytics(true, 'ko'); client.observeAnalyticsPage('/'); client.flushAnalytics();
    const prior = JSON.parse(sessionStorage.getItem('grabit-analytics-session-v1')!);
    sessionStorage.clear(); vi.resetModules(); client = await import('../analytics-client');
    client.setAnalyticsChoice('declined'); await Promise.resolve(); await Promise.resolve();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/analytics/withdraw'), expect.objectContaining({ body: JSON.stringify({ visitorId: prior.visitorId, sessionId: prior.id, consentVersion: 'analytics-v1' }) }));
  });
});
