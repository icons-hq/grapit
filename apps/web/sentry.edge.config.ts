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
    Sentry.requestDataIntegration({ include: SENTRY_REQUEST_DATA_INCLUDE }),
  ],
  beforeSend: scrubSentryEvent,
  beforeSendTransaction: scrubSentryEvent,
  beforeBreadcrumb: scrubSentryBreadcrumb,
});
