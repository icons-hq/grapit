import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/nestjs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sentry/nestjs')>();
  return { ...actual, httpIntegration: vi.fn(actual.httpIntegration) };
});

import * as Sentry from '@sentry/nestjs';
import { buildSentryInitOptions } from './sentry-options.js';

const ACCESS_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.access-token-value';
const REFRESH_TOKEN = 'refresh-token-value-7d';
const WEBHOOK_SECRET = 'toss-webhook-shared-secret';
const PHONE = '+821012345678';
const PAYMENT_KEY = 'tgen_payment_key_value';

type IntegrationList = Array<{ name: string }>;

function sentEnvelopeText(body: string | Uint8Array): string {
  return typeof body === 'string' ? body : new TextDecoder().decode(body);
}

describe('buildSentryInitOptions (#155)', () => {
  const clients: Sentry.NodeClient[] = [];

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close(100)));
  });

  it('keeps the existing DSN, environment and sampling settings', () => {
    const options = buildSentryInitOptions({
      SENTRY_DSN: 'https://public@o0.ingest.sentry.io/1',
      NODE_ENV: 'production',
    });

    expect(options).toMatchObject({
      dsn: 'https://public@o0.ingest.sentry.io/1',
      environment: 'production',
      tracesSampleRate: 0.1,
      sendDefaultPii: false,
    });
  });

  it('disables incoming request body capture and overrides the default request data integration', () => {
    const options = buildSentryInitOptions({});

    expect(Sentry.httpIntegration).toHaveBeenCalledWith({
      maxIncomingRequestBodySize: 'none',
    });
    const names = (options.integrations as IntegrationList).map((integration) => integration.name);
    expect(names).toEqual(expect.arrayContaining(['Http', 'RequestData']));
  });

  it('sends an event for a failed request without tokens, cookies, body or query secrets', async () => {
    const options = buildSentryInitOptions({ NODE_ENV: 'test' });
    const envelopes: string[] = [];
    if (!Array.isArray(options.integrations)) {
      throw new Error('expected an integration array');
    }
    const requestDataOnly = options.integrations
      .filter((integration) => integration.name === 'RequestData');

    const client = new Sentry.NodeClient({
      ...options,
      dsn: 'https://public@o0.ingest.sentry.io/1',
      // Only the request data integration: the HTTP integration would patch
      // node:http for the whole test process.
      integrations: requestDataOnly,
      stackParser: Sentry.defaultStackParser,
      transport: (transportOptions) => Sentry.createTransport(transportOptions, (request) => {
        envelopes.push(sentEnvelopeText(request.body));
        return Promise.resolve({ statusCode: 200 });
      }),
    });
    clients.push(client);
    client.init();

    const scope = new Sentry.Scope();
    scope.setClient(client);
    // What the HTTP integration records for an incoming request.
    scope.setSDKProcessingMetadata({
      normalizedRequest: {
        method: 'POST',
        url: `https://api.heygrabit.com/api/v1/payments/toss/webhook?tossWebhookSecret=${WEBHOOK_SECRET}`,
        query_string: `tossWebhookSecret=${WEBHOOK_SECRET}`,
        cookies: { refreshToken: REFRESH_TOKEN },
        data: JSON.stringify({ phone: PHONE, paymentKey: PAYMENT_KEY }),
        headers: {
          authorization: `Bearer ${ACCESS_TOKEN}`,
          cookie: `refreshToken=${REFRESH_TOKEN}`,
          'x-toss-webhook-secret': WEBHOOK_SECRET,
          'content-type': 'application/json',
        },
      },
    });

    client.captureException(new Error('Connection is closed.'), undefined, scope);
    await client.flush(1000);

    expect(envelopes).toHaveLength(1);
    const envelope = envelopes[0]!;
    expect(envelope).toContain('Connection is closed.');
    expect(envelope).toContain('https://api.heygrabit.com/api/v1/payments/toss/webhook');
    for (const secret of [ACCESS_TOKEN, REFRESH_TOKEN, WEBHOOK_SECRET, PHONE, PAYMENT_KEY]) {
      expect(envelope).not.toContain(secret);
    }
  });
});
