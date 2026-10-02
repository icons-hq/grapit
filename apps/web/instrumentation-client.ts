import * as Sentry from '@sentry/nextjs';
import { scrubSensitiveUrlParams } from '@/lib/field/ticket-url-redaction';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
  environment: process.env.NODE_ENV,
  // Field QR links carry the raw ticket credential in `?ticket=` (legacy `?token=`).
  // Mask it in every URL the SDK reports: request URLs, navigation breadcrumbs
  // (including the history.replaceState that removes it) and transaction spans.
  beforeSend: (event) => scrubSensitiveUrlParams(event),
  beforeSendTransaction: (event) => scrubSensitiveUrlParams(event),
  beforeSendSpan: (span) => scrubSensitiveUrlParams(span),
  beforeBreadcrumb: (breadcrumb) => scrubSensitiveUrlParams(breadcrumb),
});

// Required for route navigation instrumentation (SDK 9.12.0+)
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
