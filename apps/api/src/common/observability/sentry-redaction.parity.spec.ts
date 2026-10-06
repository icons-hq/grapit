import type { Breadcrumb, Event } from '@sentry/nestjs';
import { describe, expect, it } from 'vitest';
import * as apiRedaction from './sentry-redaction.js';
// The web package keeps a copy of the same redaction contract for the
// browser, Node.js and edge runtimes. It only has type imports, so it can be
// loaded here to check that both copies behave the same.
import * as webRedaction from '../../../../web/lib/sentry-redaction.js';

const SECRET = 'secret-value-123';
const PHONE = '+821012345678';
const CLIENT_IPV4 = '203.0.113.7';
const CLIENT_IPV6 = '2001:db8::1';

function eventFixtures(): Event[] {
  return [
    {
      exception: {
        values: [
          { type: 'Error', value: `Failed query: select 1 where "phone" = $1\nparams: ${PHONE}` },
          { type: 'Error', value: `GET /cb?token=${SECRET} failed` },
        ],
      },
      message: `Failed query: delete from "sessions"\nparams: ${SECRET}`,
      logentry: { message: `see https://h.test/x?token=${SECRET}` },
      request: {
        method: 'POST',
        url: `https://api.heygrabit.com/api/v1/x?token=${SECRET}#f`,
        query_string: `token=${SECRET}`,
        cookies: { refreshToken: SECRET },
        data: { phone: PHONE },
        headers: {
          Authorization: `Bearer ${SECRET}`,
          cookie: `refreshToken=${SECRET}`,
          'x-toss-webhook-secret': SECRET,
          'x-api-key': SECRET,
          referer: `https://heygrabit.com/reset?token=${SECRET}`,
          'user-agent': 'vitest',
        },
      },
      breadcrumbs: [
        {
          category: 'console',
          message: `failed /cb?token=${SECRET}`,
          data: { arguments: [`/p?token=${SECRET}`, new Error(`Failed query: x\nparams: ${PHONE}`)] },
        },
        { category: 'navigation', data: { from: `/a?token=${SECRET}`, to: '/b#frag' } },
      ],
    },
    {
      type: 'transaction',
      transaction: `GET /api/v1/hook?tossWebhookSecret=${SECRET}`,
      contexts: {
        trace: {
          trace_id: 'a'.repeat(32),
          span_id: 'b'.repeat(16),
          data: {
            'http.url': `https://h.test/p?x=${SECRET}`,
            'http.target': `/p?x=${SECRET}`,
            'url.query': `x=${SECRET}`,
            'http.request.header.cookie': SECRET,
            'http.request.header.referer': `https://h.test/r?x=${SECRET}`,
            'http.method': 'GET',
          },
        },
      },
      spans: [
        {
          span_id: 'c'.repeat(16),
          trace_id: 'a'.repeat(32),
          start_timestamp: 1,
          description: `GET https://api.example.test/v1?paymentKey=${SECRET}`,
          data: {
            'url.full': `https://api.example.test/v1?paymentKey=${SECRET}`,
            'http.query': `paymentKey=${SECRET}`,
            'drizzle.query.params': JSON.stringify([PHONE]),
            'db.query.parameter.0': PHONE,
            'db.statement': 'select 1 where "phone" = $1',
          },
        },
      ],
    },
    // Audit D6: Redis span statements, the HTTP server span's client address
    // and a Twilio error body carried the phone number and visitor IP.
    {
      type: 'transaction',
      transaction: 'POST /api/v1/sms/verify-code',
      exception: {
        values: [{ type: 'TwilioVerifyApiError', value: `Twilio Verify API 400: Invalid parameter \`To\`: ${PHONE}` }],
      },
      contexts: {
        trace: {
          trace_id: 'a'.repeat(32),
          span_id: 'b'.repeat(16),
          data: {
            'http.client_ip': CLIENT_IPV4,
            'client.address': CLIENT_IPV6,
            'net.peer.ip': CLIENT_IPV4,
            'network.peer.address': CLIENT_IPV6,
            'http.method': 'POST',
          },
        },
      },
      spans: [
        {
          span_id: 'd'.repeat(16),
          trace_id: 'a'.repeat(32),
          start_timestamp: 1,
          description: `get {sms:${PHONE}}:verified`,
          data: { 'db.system': 'redis', 'db.statement': `get {sms:${PHONE}}:verified` },
        },
      ],
    },
  ];
}

function breadcrumbFixtures(): Breadcrumb[] {
  return [
    { category: 'fetch', data: { url: `/api/v1/x?token=${SECRET}`, method: 'GET' } },
    { category: 'console', message: `Failed query: q\nparams: ${PHONE}`, data: { arguments: [1, null] } },
    { category: 'http', data: { 'http.response.header.set_cookie': SECRET } },
  ];
}

describe('API and web Sentry redaction parity', () => {
  it('scrubs the same events to the same result', () => {
    const apiEvents = eventFixtures().map((event) => apiRedaction.scrubSentryEvent(event));
    const webEvents = eventFixtures().map((event) => webRedaction.scrubSentryEvent(event));

    expect(webEvents).toEqual(apiEvents);
    const serialized = JSON.stringify(apiEvents);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain(PHONE);
    expect(serialized).not.toContain(CLIENT_IPV4);
    expect(serialized).not.toContain(CLIENT_IPV6);
  });

  it('scrubs the same breadcrumbs to the same result', () => {
    const apiBreadcrumbs = breadcrumbFixtures().map((b) => apiRedaction.scrubSentryBreadcrumb(b));
    const webBreadcrumbs = breadcrumbFixtures().map((b) => webRedaction.scrubSentryBreadcrumb(b));

    expect(webBreadcrumbs).toEqual(apiBreadcrumbs);
    expect(JSON.stringify(apiBreadcrumbs)).not.toContain(SECRET);
  });

  it('shares the helper results', () => {
    const texts = [
      `Failed query: q\nparams: ${PHONE}`,
      `GET /x?y=${SECRET}#z`,
      'Connection is closed.',
      '?a/b x?y/z a/b?c/d?e',
      `get {sms:${PHONE}}:verified`,
      'phone 01012345678 offset +0900',
    ];
    expect(texts.map(webRedaction.redactSensitiveText))
      .toEqual(texts.map(apiRedaction.redactSensitiveText));

    const urls = ['/a?b=1', 'https://h.test/p#f', '/plain'];
    expect(urls.map(webRedaction.stripUrlQuery)).toEqual(urls.map(apiRedaction.stripUrlQuery));

    const headers = [
      'Authorization',
      'x-csrf-token',
      'x-request-id',
      'Proxy-Authorization',
      'x-forwarded-for',
      'cf-connecting-ip',
      'x-grabit-client-ip',
    ];
    expect(headers.map(webRedaction.isSensitiveHeaderName))
      .toEqual(headers.map(apiRedaction.isSensitiveHeaderName));
    expect(webRedaction.SENTRY_FILTERED_VALUE).toBe(apiRedaction.SENTRY_FILTERED_VALUE);
  });
});
