import * as Sentry from '@sentry/nextjs';
import { scrubSentryBreadcrumb, scrubSentryEvent } from './lib/sentry-redaction';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
  environment: process.env.NODE_ENV,
  sendDefaultPii: false,
  // Page URLs carry password-reset tokens and Toss return parameters in the
  // query string; drop them from events, spans and breadcrumbs.
  beforeSend: scrubSentryEvent,
  beforeSendTransaction: scrubSentryEvent,
  beforeBreadcrumb: scrubSentryBreadcrumb,
});

// Required for route navigation instrumentation (SDK 9.12.0+)
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
