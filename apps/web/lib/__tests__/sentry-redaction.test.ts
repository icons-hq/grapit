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

  it('scrubs a fetch breadcrumb before it is stored', () => {
    expect(
      scrubSentryBreadcrumb({
        category: 'fetch',
        data: { url: `/api/v1/x?token=${RESET_TOKEN}`, method: 'GET', status_code: 500 },
      }).data,
    ).toEqual({ url: '/api/v1/x', method: 'GET', status_code: 500 });
  });
});
