import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { Ga4Config } from '@grabit/shared';

const privacy = vi.hoisted(() => ({ blocked: false }));
vi.mock('../analytics-client', () => ({ analyticsPrivacySignal: () => privacy.blocked }));
const config: Ga4Config = { enabled: true, measurementId: 'G-TESTABCD', noticeVersion: 'google-interests-v2', transferCountries: ['US'] };
const id = '00000000-0000-4000-8000-000000000001';
type TestWindow = Window & { dataLayer?: Array<IArguments>; gtag?: unknown; 'ga-disable-G-TESTABCD'?: boolean };

describe('Google interest analytics consent and sanitization', () => {
  beforeEach(() => { vi.resetModules(); localStorage.clear(); document.head.querySelectorAll('#grabit-google-interests').forEach((s) => s.remove()); const win = window as TestWindow; delete win.gtag; delete win.dataLayer; delete win['ga-disable-G-TESTABCD']; privacy.blocked = false; window.history.replaceState(null, '', '/'); });
  afterEach(() => vi.restoreAllMocks());
  it('makes no Google script or event before the separate choice, including disabled setup and privacy signals', async () => {
    const client = await import('../ga4-client');
    client.updateGa4(config, '/'); expect(document.querySelector('#grabit-google-interests')).toBeNull();
    client.setGa4Choice(true, true); client.updateGa4({ ...config, enabled: false }, '/'); expect(document.querySelector('#grabit-google-interests')).toBeNull();
    client.updateGa4({ ...config, noticeVersion: 'google-interests-v1' }, '/'); expect(document.querySelector('#grabit-google-interests')).toBeNull();
    privacy.blocked = true; client.updateGa4(config, '/'); expect(document.querySelector('#grabit-google-interests')).toBeNull();
  });
  it('sends only sanitized public paths, deduplicates the page and disables loaded tags on private routes', async () => {
    const client = await import('../ga4-client'); client.setGa4Choice(true, true);
    window.history.replaceState(null, '', `/performance/${id}?utm_source=instagram&utm_content=photo-benefit&email=private@example.test&token=private-token`);
    client.updateGa4(config, `/performance/${id}`); client.updateGa4(config, `/performance/${id}`);
    expect(document.querySelectorAll('#grabit-google-interests')).toHaveLength(1);
    const calls = (window as TestWindow).dataLayer!.map((c) => Array.from(c));
    expect(calls.filter((c) => c[0] === 'event')).toHaveLength(1);
    expect(JSON.stringify(calls)).toContain('photo-benefit'); expect(JSON.stringify(calls)).not.toMatch(/private@example|private-token|user_id/);
    client.updateGa4(config, '/mypage/interests'); expect((window as TestWindow)['ga-disable-G-TESTABCD']).toBe(true);
    expect((window as TestWindow).dataLayer).toHaveLength(calls.length);
  });
  it('withdraws in this tab even when browser storage fails, and never resumes an old consent', async () => {
    const client = await import('../ga4-client'); client.setGa4Choice(true, true); client.updateGa4(config, '/');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(client.setGa4Choice(false)).toBe(false); expect(client.getGa4Choice()).toBe('declined');
    client.updateGa4(config, '/categories'); expect((window as TestWindow)['ga-disable-G-TESTABCD']).toBe(true);
  });
  it('requires fresh adult, collection and transfer choices', async () => {
    const client = await import('../ga4-client');
    for (const patch of [{ at: Date.now() - 91 * 86400000 }, { transfer: false }, { adult: false }, { version: 'google-interests-v1' }]) {
      localStorage.setItem('grabit:google-interests:v1', JSON.stringify({ version: 'google-interests-v2', choice: 'accepted', at: Date.now(), collection: true, transfer: true, adult: true, ...patch }));
      client.updateGa4(config, '/'); expect(document.querySelector('#grabit-google-interests')).toBeNull();
    }
  });
  it('saves direct consent without inventing an age confirmation, then starts after explicit age confirmation', async () => {
    const client = await import('../ga4-client');
    expect(client.setGa4Choice(true)).toBe(true);
    expect(client.getGa4Choice()).toBe('accepted');
    expect(client.getGa4AdultConfirmed()).toBe(false);
    client.updateGa4(config, '/');
    expect(document.querySelector('#grabit-google-interests')).toBeNull();
    client.setGa4Choice(true, true); client.updateGa4(config, '/');
    expect(document.querySelector('#grabit-google-interests')).not.toBeNull();
  });
  it('uses a confirmed adult account without recording self-confirmation and stops when that account is absent', async () => {
    const client = await import('../ga4-client');
    client.updateGa4(config, '/', true);
    expect(document.querySelector('#grabit-google-interests')).toBeNull();
    client.setGa4Choice(true); client.updateGa4(config, '/', true);
    expect(document.querySelector('#grabit-google-interests')).not.toBeNull();
    expect(client.getGa4AdultConfirmed()).toBe(false);
    client.updateGa4(config, '/');
    expect((window as TestWindow)['ga-disable-G-TESTABCD']).toBe(true);
    client.setGa4Choice(false); client.updateGa4(config, '/', true);
    expect((window as TestWindow)['ga-disable-G-TESTABCD']).toBe(true);
  });
  it('prevents the vendor bootstrap from emitting a default page view before stream configuration', async () => {
    const client = await import('../ga4-client'); client.setGa4Choice(true, true);
    window.history.replaceState(null, '', '/categories?utm_source=qa&token=must-not-leave');
    const globalFields: Record<string, unknown> = {};
    const hits: Record<string, unknown>[] = [];
    // The real Google tag was observed to bootstrap with document.location
    // before per-stream config. Model that boundary, not just dataLayer contents.
    (window as TestWindow).gtag = (command: string, first: unknown, second?: unknown) => {
      if (command === 'set' && typeof first === 'object' && first) Object.assign(globalFields, first);
      if (command === 'js' && globalFields.send_page_view !== false) hits.push({ page_location: globalFields.page_location ?? window.location.href });
      if (command === 'event' && first === 'page_view') hits.push(second as Record<string, unknown>);
    };
    client.updateGa4(config, '/categories');
    expect(hits).toHaveLength(1);
    expect(JSON.stringify(hits)).not.toContain('must-not-leave');
    expect(hits[0]?.page_location).toBe(`${location.origin}/categories?utm_source=qa`);
  });
});
