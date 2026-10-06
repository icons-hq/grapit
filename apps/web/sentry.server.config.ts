import * as Sentry from '@sentry/nextjs';
import {
  SENTRY_REQUEST_DATA_INCLUDE,
  scrubSentryBreadcrumb,
  scrubSentryEvent,
} from './lib/sentry-redaction';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  environment: process.env.NODE_ENV,
  sendDefaultPii: false,
  integrations: [
    // Next.js instruments incoming requests itself (the SDK default keeps
    // incoming request spans off); never buffer request bodies for Sentry.
    Sentry.httpIntegration({
      disableIncomingRequestSpans: true,
      maxIncomingRequestBodySize: 'none',
    }),
    Sentry.requestDataIntegration({ include: SENTRY_REQUEST_DATA_INCLUDE }),
  ],
  beforeSend: scrubSentryEvent,
  beforeSendTransaction: scrubSentryEvent,
  beforeBreadcrumb: scrubSentryBreadcrumb,
});
