import { describe, expect, it } from 'vitest';
import { analyticsReplayBatchSchema, sanitizeReplayEvent } from './analytics-replay.schema';
import { ANALYTICS_NOTICE_VERSION, analyticsBatchSchema, analyticsEventSchema, normalizeAnalyticsPath } from './analytics.schema';
const id = '00000000-0000-4000-8000-000000000001';
describe('personal interaction and replay privacy boundary', () => {
  it('removes credentials, scripts, network URLs, user text and input values from nested snapshots', () => {
    const event = { type: 2, timestamp: Date.now(), data: { initialOffset: { top: 0, left: 0 }, node: { type: 0, id: 1, childNodes: [
      { type: 2, id: 2, tagName: 'input', attributes: { value: 'password-secret', name: 'private@example.com', onclick: 'steal()', src: 'https://private.test/a', style: 'color:red;background:url(https://private.test/t)' }, childNodes: [] },
      { type: 2, id: 3, tagName: 'script', attributes: {}, childNodes: [{ type: 3, id: 4, textContent: 'execute-secret' }] },
      { type: 3, id: 5, textContent: 'private@example.com' },
    ] } } };
    const result = sanitizeReplayEvent(event); const encoded = JSON.stringify(result);
    expect(encoded).not.toMatch(/password-secret|private|execute-secret|onclick|steal/);
    expect(encoded).toContain('color:red'); expect(encoded).toContain('***');
    expect(sanitizeReplayEvent(result)).toEqual(result);
  });
  it('masks incremental input and mutations and rejects unknown/custom/network/canvas events', () => {
    for (const event of [{ type: 5, data: { payload: 'private' } }, { type: 3, data: { source: 9, commands: ['private'] } }]) expect(sanitizeReplayEvent({ ...event, timestamp: Date.now() })).toBeNull();
    expect(JSON.stringify(sanitizeReplayEvent({ type: 3, timestamp: Date.now(), data: { source: 5, id: 1, text: 'private', isChecked: true } }))).not.toContain('private');
    expect(JSON.stringify(sanitizeReplayEvent({ type: 3, timestamp: Date.now(), data: { source: 0, texts: [{ id: 1, value: 'private' }], attributes: [{ id: 2, attributes: { title: 'private', href: 'https://private.test' } }] } }))).not.toContain('private');
  });
  it('validates fixed pointer properties and excludes localized sensitive routes', () => {
    const event = { id, pageId: id, path: '/', previousPath: null, at: new Date().toISOString(), name: 'pointer_click', props: { x: 10, y: 20, scrollX: 0, scrollY: 0, viewportWidth: 390, viewportHeight: 844, documentWidth: 390, documentHeight: 1000, pointer: 'touch', element: 'button', label: 'booking' } };
    expect(analyticsEventSchema.safeParse(event).success).toBe(true);
    expect(analyticsEventSchema.safeParse({ ...event, props: { ...event.props, text: 'email' } }).success).toBe(false);
    for (const route of ['/en/admin/users', '/th/mypage', '/zh-TW/payment/return']) expect(normalizeAnalyticsPath(route)).toBeNull();
  });
  it('requires fresh separate consents and sanitized bounded replay payloads', () => {
    const payload = { consentVersion: ANALYTICS_NOTICE_VERSION, consentedAt: new Date().toISOString(), visitorId: id, sessionId: id, touch: { landingPath: '/', referrerHost: null, source: null, medium: null, campaign: null, term: null, content: null }, device: 'mobile', browser: 'safari', os: 'ios', screen: 'small', language: 'ko', events: [{ id, pageId: id, name: 'page_view', path: '/', previousPath: null, at: new Date().toISOString(), props: {} }] };
    expect(analyticsBatchSchema.safeParse(payload).success).toBe(false);
    expect(analyticsBatchSchema.safeParse({ ...payload, collectionConsent: true, overseasConsent: true }).success).toBe(true);
    expect(analyticsReplayBatchSchema.safeParse({ id, recordingId: id, pageId: id, visitorId: id, sessionId: id, consentVersion: ANALYTICS_NOTICE_VERSION, path: '/?secret=1', events: [{ type: 4, timestamp: Date.now(), data: { href: 'private' } }] }).success).toBe(false);
  });
});
