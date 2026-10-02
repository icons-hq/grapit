import * as Sentry from '@sentry/nextjs';
import type { Breadcrumb } from '@sentry/nextjs';
import { scrubSentryBreadcrumb, scrubSentryEvent } from './lib/sentry-redaction';
import { redactSensitiveUrlParams, scrubSensitiveUrlParams } from '@/lib/field/ticket-url-redaction';

// Console breadcrumbs hold the live `console.*` arguments, so a deep walk would
// rewrite the caller's objects. They get string-only redaction; every other
// breadcrumb is SDK-built data and is deep-scrubbed for the field QR credential.
function scrubClientBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  const scrubbed = scrubSentryBreadcrumb(breadcrumb);
  if (scrubbed.category !== 'console') return scrubSensitiveUrlParams(scrubbed);

  if (typeof scrubbed.message === 'string') {
    scrubbed.message = redactSensitiveUrlParams(scrubbed.message);
  }
  const args: unknown = scrubbed.data?.['arguments'];
  if (scrubbed.data && Array.isArray(args)) {
    scrubbed.data['arguments'] = args.map((arg: unknown) =>
      typeof arg === 'string' ? redactSensitiveUrlParams(arg) : arg,
    );
  }
  return scrubbed;
}

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
  environment: process.env.NODE_ENV,
  sendDefaultPii: false,
  // Page URLs carry password-reset tokens and Toss return parameters in the
  // query string; drop them from events, spans and breadcrumbs.
  // Field QR links also carry the raw ticket credential in `?ticket=` (legacy
  // `?token=`); mask it wherever else the SDK reports it, including standalone
  // spans and the navigation breadcrumb of the history.replaceState that
  // removes it from the address bar.
  beforeSend: (event) => scrubSensitiveUrlParams(scrubSentryEvent(event)),
  beforeSendTransaction: (event) => scrubSensitiveUrlParams(scrubSentryEvent(event)),
  beforeSendSpan: (span) => scrubSensitiveUrlParams(span),
  beforeBreadcrumb: scrubClientBreadcrumb,
});

// Required for route navigation instrumentation (SDK 9.12.0+)
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
