// Imported from `instrument.ts` before any `@nestjs/*` module is loaded.
// Do not import Nest or application modules here.
import * as Sentry from '@sentry/nestjs';
import type { NodeOptions } from '@sentry/nestjs';
import { scrubSentryBreadcrumb, scrubSentryEvent } from './sentry-redaction.js';

/**
 * Sentry options for the API and the background worker.
 *
 * Request bodies, cookies and query strings are never attached to events,
 * and credential headers (Authorization, Cookie, Toss webhook secrets) are
 * replaced before an event or transaction leaves the process.
 */
export function buildSentryInitOptions(
  env: NodeJS.ProcessEnv = process.env,
): NodeOptions {
  return {
    dsn: env['SENTRY_DSN'],
    tracesSampleRate: 0.1,
    environment: env['NODE_ENV'],
    sendDefaultPii: false,
    integrations: [
      // Do not buffer incoming request bodies for Sentry at all.
      Sentry.httpIntegration({ maxIncomingRequestBodySize: 'none' }),
      Sentry.requestDataIntegration({
        include: {
          cookies: false,
          data: false,
          query_string: false,
          ip: false,
        },
      }),
    ],
    beforeSend: (event) => scrubSentryEvent(event),
    beforeSendTransaction: (event) => scrubSentryEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubSentryBreadcrumb(breadcrumb),
  };
}
