import { beforeEach, describe, expect, it, vi } from 'vitest';

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  httpIntegration: vi.fn((options: unknown) => ({ name: 'Http', options })),
  requestDataIntegration: vi.fn((options: unknown) => ({ name: 'RequestData', options })),
  captureRouterTransitionStart: vi.fn(),
}));

vi.mock('@sentry/nextjs', () => sentry);

const REQUEST_DATA_INCLUDE = {
  cookies: false,
  data: false,
  query_string: false,
  ip: false,
};

const RESET_TOKEN = 'password-reset-token-value';
const ACCESS_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.access-token-value';

interface InitOptions {
  sendDefaultPii?: boolean;
  beforeSend?: (event: Record<string, unknown>, hint: unknown) => unknown;
  beforeSendTransaction?: (event: Record<string, unknown>, hint: unknown) => unknown;
  beforeBreadcrumb?: (breadcrumb: Record<string, unknown>, hint?: unknown) => unknown;
}

function lastInitOptions(): InitOptions {
  const options = sentry.init.mock.calls.at(-1)?.[0] as InitOptions | undefined;
  if (!options) throw new Error('Sentry.init was not called');
  return options;
}

function leakyEvent(): Record<string, unknown> {
  return {
    request: {
      url: `https://heygrabit.com/auth/reset-password?token=${RESET_TOKEN}`,
      headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
    },
  };
}

function expectScrubbingHooks(options: InitOptions): void {
  expect(options.sendDefaultPii).toBe(false);
  for (const hook of [options.beforeSend, options.beforeSendTransaction]) {
    expect(hook).toBeTypeOf('function');
    const sent = JSON.stringify(hook!(leakyEvent(), {}));
    expect(sent).not.toContain(RESET_TOKEN);
    expect(sent).not.toContain(ACCESS_TOKEN);
  }
  const breadcrumb = options.beforeBreadcrumb!({
    category: 'navigation',
    data: { to: `/auth/reset-password?token=${RESET_TOKEN}` },
  });
  expect(JSON.stringify(breadcrumb)).not.toContain(RESET_TOKEN);
}

describe('web Sentry init options (#155)', () => {
  beforeEach(() => {
    vi.resetModules();
    sentry.init.mockClear();
    sentry.httpIntegration.mockClear();
    sentry.requestDataIntegration.mockClear();
  });

  it('Node.js server: no request bodies, cookies or query strings, plus event scrubbing', async () => {
    await import('../../sentry.server.config');

    expect(sentry.httpIntegration).toHaveBeenCalledWith({
      disableIncomingRequestSpans: true,
      maxIncomingRequestBodySize: 'none',
    });
    expect(sentry.requestDataIntegration).toHaveBeenCalledWith({
      include: REQUEST_DATA_INCLUDE,
    });
    expectScrubbingHooks(lastInitOptions());
  });

  it('edge runtime: request data integration and event scrubbing', async () => {
    await import('../../sentry.edge.config');

    expect(sentry.requestDataIntegration).toHaveBeenCalledWith({
      include: REQUEST_DATA_INCLUDE,
    });
    expectScrubbingHooks(lastInitOptions());
  });

  it('browser: page URL query strings are scrubbed', async () => {
    await import('../../instrumentation-client');

    expectScrubbingHooks(lastInitOptions());
  });
});
