import { describe, expect, it, vi } from 'vitest';

const sentry = vi.hoisted(() => ({ init: vi.fn(), captureRouterTransitionStart: vi.fn() }));
vi.mock('@sentry/nextjs', () => sentry);

const RAW = 'raw-ticket-credential-for-sentry';

describe('client Sentry init', () => {
  it('masks the field QR credential in events, transactions, spans and breadcrumbs', async () => {
    await import('../../../instrumentation-client');
    const options = sentry.init.mock.calls[0]?.[0] as {
      beforeSend: (event: unknown) => unknown;
      beforeSendTransaction: (event: unknown) => unknown;
      beforeSendSpan: (span: unknown) => unknown;
      beforeBreadcrumb: (breadcrumb: unknown) => unknown;
    };

    const breadcrumb = options.beforeBreadcrumb({
      category: 'navigation',
      data: { from: `/field/check-in?ticket=${RAW}&showtimeId=st-1`, to: '/field/check-in?showtimeId=st-1' },
    });
    const error = options.beforeSend({ request: { url: `https://heygrabit.com/field/check-in?ticket=${RAW}` } });
    const transaction = options.beforeSendTransaction({
      transaction: '/field/check-in',
      request: { url: `https://heygrabit.com/field/check-in?token=${RAW}` },
      spans: [{ description: `/auth?returnTo=%2Ffield%2Fcheck-in%3Fticket%3D${RAW}` }],
    });
    const span = options.beforeSendSpan({ data: { 'url.full': `https://heygrabit.com/field/check-in?ticket=${RAW}` } });

    for (const payload of [breadcrumb, error, transaction, span]) {
      expect(JSON.stringify(payload)).not.toContain(RAW);
    }
  });

  it('masks console breadcrumb strings without rewriting the live console arguments', async () => {
    await import('../../../instrumentation-client');
    const options = sentry.init.mock.calls[0]?.[0] as {
      beforeBreadcrumb: (breadcrumb: unknown) => { message?: string; data?: { arguments?: unknown[] } };
    };
    const loggedObject = { ticket: RAW };
    const liveArgs: unknown[] = [`ticket=${RAW}`, loggedObject];

    const breadcrumb = options.beforeBreadcrumb({
      category: 'console',
      message: `ticket=${RAW}`,
      data: { arguments: liveArgs, logger: 'console' },
    });

    expect(breadcrumb.message).not.toContain(RAW);
    expect(breadcrumb.data?.arguments?.[0]).not.toContain(RAW);
    expect(liveArgs[0]).toBe(`ticket=${RAW}`);
    expect(loggedObject.ticket).toBe(RAW);
  });
});
