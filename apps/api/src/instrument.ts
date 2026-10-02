import * as Sentry from '@sentry/nestjs';
import { buildSentryInitOptions } from './common/observability/sentry-options.js';

Sentry.init(buildSentryInitOptions());
