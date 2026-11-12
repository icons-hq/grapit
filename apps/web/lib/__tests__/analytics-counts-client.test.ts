import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
let client: typeof import('../analytics-counts-client');
describe('browser usage counter', () => {
  beforeEach(async () => {
    vi.resetModules(); localStorage.clear(); sessionStorage.clear(); history.replaceState({}, '', '/');
    Object.defineProperty(navigator, 'webdriver', { configurable: true, value: false });
    Object.defineProperty(navigator, 'doNotTrack', { configurable: true, value: '0' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    client = await import('../analytics-counts-client');
  });
  afterEach(() => vi.unstubAllGlobals());
  it('does not collect before activation and sends only counters without storage identifiers or credentials', () => {
    client.observeAggregatePage('/'); client.flushAggregateAnalytics(); expect(fetch).not.toHaveBeenCalled();
    client.configureAggregateAnalytics(true); client.observeAggregatePage('/'); client.trackAggregateAnalytics('signup_start'); client.flushAggregateAnalytics();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/analytics/counts'), expect.objectContaining({ credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: true }));
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string);
    expect(body).toEqual({ counts: [{ page: 'home', name: 'page_view', count: 1 }, { page: 'home', name: 'signup_start', count: 1 }] });
    expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
  });
  it('honors refusal, legacy refusal and browser privacy signals and drops queued data', () => {
    localStorage.setItem('grabit-analytics-choice-v1', JSON.stringify({ value: 'declined' }));
    client.configureAggregateAnalytics(true); client.observeAggregatePage('/'); client.flushAggregateAnalytics(); expect(fetch).not.toHaveBeenCalled();
    client.setAggregateAnalyticsDisabled(false); client.configureAggregateAnalytics(true); client.observeAggregatePage('/');
    client.setAggregateAnalyticsDisabled(true); client.flushAggregateAnalytics(); expect(fetch).not.toHaveBeenCalled();
    client.setAggregateAnalyticsDisabled(false); Object.defineProperty(navigator, 'doNotTrack', { value: '1' });
    client.configureAggregateAnalytics(true); client.observeAggregatePage('/'); client.flushAggregateAnalytics(); expect(fetch).not.toHaveBeenCalled();
  });
  it('bounds batches, deduplicates a mounted page and isolates network failure from interactions', () => {
    vi.mocked(fetch).mockRejectedValue(new Error('offline'));
    client.configureAggregateAnalytics(true); client.observeAggregatePage('/'); client.observeAggregatePage('/');
    for (let i = 0; i < 39; i++) client.trackAggregateAnalytics('link_click');
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [, init] of vi.mocked(fetch).mock.calls) expect(JSON.parse(init!.body as string).counts.reduce((sum: number, row: {count: number}) => sum + row.count, 0)).toBe(20);
  });
});
