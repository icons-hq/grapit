import type { Breadcrumb, Event } from '@sentry/nestjs';
import { DrizzleQueryError } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  SENTRY_FILTERED_VALUE,
  isSensitiveHeaderName,
  redactSensitiveText,
  scrubSentryBreadcrumb,
  scrubSentryEvent,
  stripUrlQuery,
} from './sentry-redaction.js';

const ACCESS_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.access-token-value';
const REFRESH_TOKEN = 'refresh-token-value-7d';
const WEBHOOK_SECRET = 'toss-webhook-shared-secret';
const PHONE = '+821012345678';
const RESET_TOKEN = 'password-reset-token-value';
const PAYMENT_KEY = 'tgen_payment_key_value';
const EMAIL = 'buyer@example.test';
const PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA';

const SECRETS = [
  ACCESS_TOKEN,
  REFRESH_TOKEN,
  WEBHOOK_SECRET,
  PHONE,
  RESET_TOKEN,
  PAYMENT_KEY,
  EMAIL,
  PASSWORD_HASH,
];

// The query a sign-up or payment confirm runs, as drizzle-orm renders it.
const SIGNUP_SQL = [
  'insert into "users" ("email", "phone", "password_hash")',
  'values ($1, $2, $3) returning "id"',
].join('\n');

function signupQueryError(): DrizzleQueryError {
  return new DrizzleQueryError(
    SIGNUP_SQL,
    [EMAIL, PHONE, PASSWORD_HASH],
    new Error('timeout exceeded when trying to connect'),
  );
}

function expectNoSecrets(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const secret of SECRETS) {
    expect(serialized).not.toContain(secret);
  }
}

describe('scrubSentryEvent (#155)', () => {
  it('removes credentials, cookies, body and query from an error event request', () => {
    const event: Event = {
      exception: { values: [{ type: 'ServiceUnavailableException', value: 'down' }] },
      request: {
        method: 'POST',
        url: `https://api.heygrabit.com/api/v1/payments/toss/webhook?tossWebhookSecret=${WEBHOOK_SECRET}#frag`,
        query_string: { tossWebhookSecret: WEBHOOK_SECRET },
        cookies: { refreshToken: REFRESH_TOKEN },
        data: { phone: PHONE, newPassword: 'pw', token: RESET_TOKEN, paymentKey: PAYMENT_KEY },
        headers: {
          authorization: `Bearer ${ACCESS_TOKEN}`,
          cookie: `refreshToken=${REFRESH_TOKEN}`,
          'x-toss-webhook-secret': WEBHOOK_SECRET,
          'X-Grabit-Toss-Webhook-Secret': WEBHOOK_SECRET,
          'content-type': 'application/json',
          'user-agent': 'vitest',
          referer: `https://heygrabit.com/auth/reset-password?token=${RESET_TOKEN}`,
        },
      },
    };

    const scrubbed = scrubSentryEvent(event);

    expect(scrubbed.request).toEqual({
      method: 'POST',
      url: 'https://api.heygrabit.com/api/v1/payments/toss/webhook',
      headers: {
        authorization: SENTRY_FILTERED_VALUE,
        cookie: SENTRY_FILTERED_VALUE,
        'x-toss-webhook-secret': SENTRY_FILTERED_VALUE,
        'X-Grabit-Toss-Webhook-Secret': SENTRY_FILTERED_VALUE,
        'content-type': 'application/json',
        'user-agent': 'vitest',
        referer: 'https://heygrabit.com/auth/reset-password',
      },
    });
    expectNoSecrets(scrubbed);
  });

  it('removes query strings and credential headers from transaction spans', () => {
    const event: Event = {
      type: 'transaction',
      transaction: 'POST /api/v1/payments/toss/webhook',
      request: {
        url: `https://api.heygrabit.com/api/v1/payments/toss/webhook?tossWebhookSecret=${WEBHOOK_SECRET}`,
        headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
      },
      contexts: {
        trace: {
          trace_id: 'a'.repeat(32),
          span_id: 'b'.repeat(16),
          data: {
            'http.url': `https://api.heygrabit.com/api/v1/payments/toss/webhook?tossWebhookSecret=${WEBHOOK_SECRET}`,
            'http.target': `/api/v1/payments/toss/webhook?tossWebhookSecret=${WEBHOOK_SECRET}`,
            'http.request.header.authorization': `Bearer ${ACCESS_TOKEN}`,
            'http.request.header.cookie.refreshtoken': REFRESH_TOKEN,
            'http.request.header.user_agent': 'vitest',
            'http.request.header.referer': `https://heygrabit.com/booking/complete?paymentKey=${PAYMENT_KEY}`,
            'http.method': 'POST',
          },
        },
      },
      spans: [
        {
          span_id: 'c'.repeat(16),
          trace_id: 'a'.repeat(32),
          start_timestamp: 1,
          data: {
            'url.full': `https://api.example.test/reset?token=${RESET_TOKEN}`,
            'url.query': `?token=${RESET_TOKEN}`,
            'http.query': `token=${RESET_TOKEN}`,
            'http.response.header.set_cookie': `refreshToken=${REFRESH_TOKEN}`,
          },
        },
      ],
    };

    const scrubbed = scrubSentryEvent(event);

    expect(scrubbed.contexts?.trace?.data).toEqual({
      'http.url': 'https://api.heygrabit.com/api/v1/payments/toss/webhook',
      'http.target': '/api/v1/payments/toss/webhook',
      'http.request.header.authorization': SENTRY_FILTERED_VALUE,
      'http.request.header.cookie.refreshtoken': SENTRY_FILTERED_VALUE,
      'http.request.header.user_agent': 'vitest',
      'http.request.header.referer': 'https://heygrabit.com/booking/complete',
      'http.method': 'POST',
    });
    expect(scrubbed.spans?.[0]?.data).toEqual({
      'url.full': 'https://api.example.test/reset',
      'http.response.header.set_cookie': SENTRY_FILTERED_VALUE,
    });
    expectNoSecrets(scrubbed);
  });

  it('removes query strings from attached breadcrumbs', () => {
    const event: Event = {
      breadcrumbs: [
        {
          category: 'http',
          data: {
            url: `https://api.example.test/v1/hook?tossWebhookSecret=${WEBHOOK_SECRET}`,
            'http.query': `tossWebhookSecret=${WEBHOOK_SECRET}`,
            method: 'GET',
            status_code: 500,
          },
        },
      ],
    };

    const scrubbed = scrubSentryEvent(event);

    expect(scrubbed.breadcrumbs?.[0]?.data).toEqual({
      url: 'https://api.example.test/v1/hook',
      method: 'GET',
      status_code: 500,
    });
    expectNoSecrets(scrubbed);
  });
});

describe('scrubSentryEvent free text (#155 via #156 catch-all)', () => {
  it('drops bound SQL parameters from a DrizzleQueryError exception value', () => {
    const error = signupQueryError();
    // Precondition: drizzle-orm puts the bound values in the message itself.
    expect(error.message).toContain(PHONE);

    const event: Event = {
      exception: {
        values: [
          { type: 'Error', value: 'timeout exceeded when trying to connect' },
          { type: 'Error', value: error.message },
        ],
      },
    };

    const scrubbed = scrubSentryEvent(event);

    expect(scrubbed.exception?.values?.[0]?.value)
      .toBe('timeout exceeded when trying to connect');
    expect(scrubbed.exception?.values?.[1]?.value)
      .toBe(`Failed query: ${SIGNUP_SQL}\nparams: ${SENTRY_FILTERED_VALUE}`);
    expectNoSecrets(scrubbed);
  });

  it('redacts messages, transaction names, span descriptions and attributes', () => {
    const event: Event = {
      type: 'transaction',
      message: signupQueryError().message,
      logentry: { message: `GET /api/v1/auth/reset?token=${RESET_TOKEN}` },
      transaction: `GET /api/v1/payments/toss/webhook?tossWebhookSecret=${WEBHOOK_SECRET}`,
      spans: [
        {
          span_id: 'c'.repeat(16),
          trace_id: 'a'.repeat(32),
          start_timestamp: 1,
          description: `GET https://api.example.test/v1/payments?paymentKey=${PAYMENT_KEY}`,
          data: {
            'db.statement': 'select "id" from "users" where "phone" = $1',
            'drizzle.query.params': JSON.stringify([PHONE]),
            'db.query.parameter.0': PHONE,
          },
        },
      ],
    };

    const scrubbed = scrubSentryEvent(event);

    expect(scrubbed.message).toBe(`Failed query: ${SIGNUP_SQL}\nparams: ${SENTRY_FILTERED_VALUE}`);
    expect(scrubbed.logentry?.message).toBe('GET /api/v1/auth/reset');
    expect(scrubbed.transaction).toBe('GET /api/v1/payments/toss/webhook');
    expect(scrubbed.spans?.[0]?.description).toBe('GET https://api.example.test/v1/payments');
    expect(scrubbed.spans?.[0]?.data).toEqual({
      'db.statement': 'select "id" from "users" where "phone" = $1',
      'drizzle.query.params': SENTRY_FILTERED_VALUE,
      'db.query.parameter.0': SENTRY_FILTERED_VALUE,
    });
    expectNoSecrets(scrubbed);
  });

  it('redacts console breadcrumbs carrying a DrizzleQueryError', () => {
    const error = signupQueryError();
    const breadcrumb: Breadcrumb = {
      category: 'console',
      level: 'error',
      message: `query failed ${error.message}`,
      data: { arguments: ['query failed', error, { attempt: 1 }], logger: 'console' },
    };

    const scrubbed = scrubSentryBreadcrumb(breadcrumb);

    expect(scrubbed.message)
      .toBe(`query failed Failed query: ${SIGNUP_SQL}\nparams: ${SENTRY_FILTERED_VALUE}`);
    expect(scrubbed.data).toEqual({
      arguments: [
        'query failed',
        `Error: Failed query: ${SIGNUP_SQL}\nparams: ${SENTRY_FILTERED_VALUE}`,
        { attempt: 1 },
      ],
      logger: 'console',
    });
    expectNoSecrets(scrubbed);
  });
});

describe('redactSensitiveText', () => {
  it('keeps ordinary error text unchanged', () => {
    for (const text of [
      'Connection is closed.',
      'timeout exceeded when trying to connect',
      'Are you sure? Retry #2 failed',
      'GET /api/v1/health',
      'select "id" from "users" where "phone" = $1',
    ]) {
      expect(redactSensitiveText(text)).toBe(text);
    }
  });

  it('strips query strings from URLs and paths inside text', () => {
    expect(redactSensitiveText(
      `fetch https://h.test/cb?token=${RESET_TOKEN} then /p?x=1#f done`,
    )).toBe('fetch https://h.test/cb then /p done');
    // Same cut points as the previous regex: only after the first slash of a run.
    expect(redactSensitiveText('?a/b x?y/z a/b?c/d?e')).toBe('?a/b x?y/z a/b');
  });

  it('stays linear on long slash-only text (u18b review: no quadratic backtracking)', () => {
    const hostile = `${'/'.repeat(200_000)} ${'/a'.repeat(100_000)}`;
    const startedAt = performance.now();

    expect(redactSensitiveText(hostile)).toBe(hostile);
    // The backtracking pattern took minutes on this input.
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });
});

describe('scrubSentryBreadcrumb', () => {
  it('strips the query from an outgoing request breadcrumb before it is stored', () => {
    const breadcrumb: Breadcrumb = {
      category: 'http',
      data: { url: `https://example.test/cb?token=${RESET_TOKEN}`, method: 'GET' },
    };

    expect(scrubSentryBreadcrumb(breadcrumb).data).toEqual({
      url: 'https://example.test/cb',
      method: 'GET',
    });
  });
});

describe('redaction helpers', () => {
  it.each([
    'Authorization',
    'cookie',
    'Set-Cookie',
    'x-toss-webhook-secret',
    'x-grabit-toss-webhook-secret',
    'x-api-key',
    'x-csrf-token',
    // Visitor IP forwarded by Cloudflare, the edge proxy and Cloud Run.
    'X-Forwarded-For',
    'x-real-ip',
    'cf-connecting-ip',
    'true-client-ip',
    'x-grabit-client-ip',
    'forwarded',
  ])('treats %s as sensitive', (name) => {
    expect(isSensitiveHeaderName(name)).toBe(true);
  });

  it.each(['content-type', 'user-agent', 'accept', 'x-request-id'])(
    'keeps %s',
    (name) => {
      expect(isSensitiveHeaderName(name)).toBe(false);
    },
  );

  it('strips only the query string and fragment', () => {
    expect(stripUrlQuery('/api/v1/health')).toBe('/api/v1/health');
    expect(stripUrlQuery('/a/b?x=1#y')).toBe('/a/b');
    expect(stripUrlQuery('https://h.test/p#frag')).toBe('https://h.test/p');
  });
});
