import type { Event } from '@sentry/nextjs';
import { describe, expect, it } from 'vitest';
import {
  SENTRY_FILTERED_VALUE,
  scrubSentryBreadcrumb,
  scrubSentryEvent,
} from '../sentry-redaction';

const ACCESS_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.access-token-value';
const REFRESH_TOKEN = 'refresh-token-value-7d';
const RESET_TOKEN = 'password-reset-token-value';
const PAYMENT_KEY = 'tgen_payment_key_value';
const PHONE = '+821012345678';

const SECRETS = [ACCESS_TOKEN, REFRESH_TOKEN, RESET_TOKEN, PAYMENT_KEY, PHONE];

function expectNoSecrets(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const secret of SECRETS) {
    expect(serialized).not.toContain(secret);
  }
}

describe('web Sentry redaction (#155)', () => {
  it('scrubs a server request error captured by onRequestError', () => {
    const event: Event = {
      request: {
        method: 'POST',
        url: `https://heygrabit.com/auth/reset-password?token=${RESET_TOKEN}`,
        cookies: { refreshToken: REFRESH_TOKEN },
        data: { phone: PHONE },
        query_string: `token=${RESET_TOKEN}`,
        headers: {
          authorization: `Bearer ${ACCESS_TOKEN}`,
          cookie: `refreshToken=${REFRESH_TOKEN}`,
          referer: `https://heygrabit.com/booking/complete?paymentKey=${PAYMENT_KEY}`,
          'user-agent': 'vitest',
        },
      },
      contexts: {
        nextjs: {
          request_path: `/auth/reset-password?token=${RESET_TOKEN}`,
          router_kind: 'App Router',
        },
      },
    };

    const scrubbed = scrubSentryEvent(event);

    expect(scrubbed.request).toEqual({
      method: 'POST',
      url: 'https://heygrabit.com/auth/reset-password',
      headers: {
        authorization: SENTRY_FILTERED_VALUE,
        cookie: SENTRY_FILTERED_VALUE,
        referer: 'https://heygrabit.com/booking/complete',
        'user-agent': 'vitest',
      },
    });
    expect(scrubbed.contexts?.nextjs).toEqual({
      request_path: '/auth/reset-password',
      router_kind: 'App Router',
    });
    expectNoSecrets(scrubbed);
  });

  it('scrubs browser page URLs, navigation breadcrumbs and fetch spans', () => {
    const event: Event = {
      type: 'transaction',
      request: {
        url: `https://heygrabit.com/booking/complete?paymentKey=${PAYMENT_KEY}&orderId=o-1&amount=1000`,
        headers: { 'User-Agent': 'vitest' },
      },
      breadcrumbs: [
        {
          category: 'navigation',
          data: {
            from: `/auth/reset-password?token=${RESET_TOKEN}`,
            to: `/booking/complete?paymentKey=${PAYMENT_KEY}`,
          },
        },
      ],
      spans: [
        {
          span_id: 'c'.repeat(16),
          trace_id: 'a'.repeat(32),
          start_timestamp: 1,
          data: {
            url: `https://api.heygrabit.com/api/v1/auth/verify-email?token=${RESET_TOKEN}`,
            'http.query': `?token=${RESET_TOKEN}`,
          },
        },
      ],
    };

    const scrubbed = scrubSentryEvent(event);

    expect(scrubbed.request?.url).toBe('https://heygrabit.com/booking/complete');
    expect(scrubbed.breadcrumbs?.[0]?.data).toEqual({
      from: '/auth/reset-password',
      to: '/booking/complete',
    });
    expect(scrubbed.spans?.[0]?.data).toEqual({
      url: 'https://api.heygrabit.com/api/v1/auth/verify-email',
    });
    expectNoSecrets(scrubbed);
  });

  it('scrubs free text: exception values, transaction names, span names and console breadcrumbs', () => {
    const failedQuery = `Failed query: select "id" from "users" where "phone" = $1\nparams: ${PHONE}`;
    const event: Event = {
      exception: {
        values: [
          { type: 'Error', value: failedQuery },
          { type: 'TypeError', value: `Failed to fetch /auth/reset-password?token=${RESET_TOKEN}` },
        ],
      },
      transaction: `/booking/complete?paymentKey=${PAYMENT_KEY}`,
      spans: [
        {
          span_id: 'c'.repeat(16),
          trace_id: 'a'.repeat(32),
          start_timestamp: 1,
          description: `GET https://api.heygrabit.com/api/v1/auth/verify-email?token=${RESET_TOKEN}`,
          data: {},
        },
      ],
      breadcrumbs: [
        {
          category: 'console',
          message: `confirm failed ${failedQuery}`,
          data: { arguments: ['confirm failed', new Error(failedQuery)], logger: 'console' },
        },
      ],
    };

    const scrubbed = scrubSentryEvent(event);

    expect(scrubbed.exception?.values?.map((value) => value.value)).toEqual([
      `Failed query: select "id" from "users" where "phone" = $1\nparams: ${SENTRY_FILTERED_VALUE}`,
      'Failed to fetch /auth/reset-password',
    ]);
    expect(scrubbed.transaction).toBe('/booking/complete');
    expect(scrubbed.spans?.[0]?.description)
      .toBe('GET https://api.heygrabit.com/api/v1/auth/verify-email');
    expect(scrubbed.breadcrumbs?.[0]?.data?.['arguments']).toEqual([
      'confirm failed',
      `Error: Failed query: select "id" from "users" where "phone" = $1\nparams: ${SENTRY_FILTERED_VALUE}`,
    ]);
    expectNoSecrets(scrubbed);
  });

  it('masks phone numbers in Redis statements and error text and filters client addresses (audit D6)', () => {
    const clientIpv4 = '203.0.113.7';
    const clientIpv6 = '2001:db8::1';
    const event: Event = {
      type: 'transaction',
      transaction: '/auth/signup',
      exception: {
        values: [{ type: 'Error', value: `Twilio Verify API 400: Invalid parameter \`To\`: ${PHONE}` }],
      },
      contexts: {
        trace: {
          trace_id: 'a'.repeat(32),
          span_id: 'b'.repeat(16),
          data: {
            'http.client_ip': clientIpv4,
            'client.address': clientIpv6,
            'net.peer.ip': clientIpv4,
            'network.peer.address': clientIpv6,
            'http.method': 'POST',
          },
        },
      },
      spans: [
        {
          span_id: 'c'.repeat(16),
          trace_id: 'a'.repeat(32),
          start_timestamp: 1,
          description: `get {sms:${PHONE}}:verified`,
          data: { 'db.system': 'redis', 'db.statement': `get {sms:${PHONE}}:verified` },
        },
      ],
      breadcrumbs: [{ category: 'console', message: `verify failed for ${PHONE}` }],
    };

    const scrubbed = scrubSentryEvent(event);

    expect(scrubbed.exception?.values?.[0]?.value)
      .toBe('Twilio Verify API 400: Invalid parameter `To`: [redacted phone]');
    expect(scrubbed.spans?.[0]?.description).toBe('get {sms:[redacted phone]}:verified');
    expect(scrubbed.spans?.[0]?.data).toEqual({
      'db.system': 'redis',
      'db.statement': 'get {sms:[redacted phone]}:verified',
    });
    expect(scrubbed.contexts?.trace?.data).toEqual({
      'http.client_ip': SENTRY_FILTERED_VALUE,
      'client.address': SENTRY_FILTERED_VALUE,
      'net.peer.ip': SENTRY_FILTERED_VALUE,
      'network.peer.address': SENTRY_FILTERED_VALUE,
      'http.method': 'POST',
    });
    expect(scrubbed.breadcrumbs?.[0]?.message).toBe('verify failed for [redacted phone]');
    const serialized = JSON.stringify(scrubbed);
    expectNoSecrets(scrubbed);
    expect(serialized).not.toContain(clientIpv4);
    expect(serialized).not.toContain(clientIpv6);
  });

  it('scrubs a fetch breadcrumb before it is stored', () => {
    expect(
      scrubSentryBreadcrumb({
        category: 'fetch',
        data: { url: `/api/v1/x?token=${RESET_TOKEN}`, method: 'GET', status_code: 500 },
      }).data,
    ).toEqual({ url: '/api/v1/x', method: 'GET', status_code: 500 });
  });
});
