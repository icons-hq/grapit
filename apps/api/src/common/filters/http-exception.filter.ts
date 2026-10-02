import {
  ExceptionFilter,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import type { Response } from 'express';
import { redactSensitiveText } from '../observability/sentry-redaction.js';

const RESERVED_BODY_KEYS = new Set(['statusCode', 'message', 'timestamp']);
const INTERNAL_SERVER_ERROR_MESSAGE = 'Internal server error';
const MAX_LOGGED_CAUSES = 3;

interface ErrorResponse {
  status: number;
  body: Record<string, unknown>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

/**
 * Keeps every field a handler deliberately put on the exception response
 * (`code`, `blockers`, `retryAfterMs`, `errors`, `errorCode`, ...). Only
 * plain object literals are spread so an Error or class instance passed as
 * the response cannot leak internal properties.
 */
function extraResponseFields(response: unknown): Record<string, unknown> {
  if (!isPlainObject(response)) return {};

  const extras: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(response)) {
    if (!RESERVED_BODY_KEYS.has(key)) extras[key] = value;
  }
  return extras;
}

function fromHttpException(exception: HttpException): ErrorResponse {
  const status = exception.getStatus();
  return {
    status,
    body: {
      statusCode: status,
      message: exception.message,
      ...extraResponseFields(exception.getResponse()),
    },
  };
}

/**
 * Errors that are not `HttpException` but carry an HTTP client status, such as
 * body-parser's `PayloadTooLargeError` (413). Nest's default filter answers
 * these with their own status and message, so keep that behavior for 4xx.
 */
function clientHttpErrorStatus(exception: unknown): number | null {
  if (!(exception instanceof Error)) return null;
  const statusCode = (exception as { statusCode?: unknown }).statusCode;
  return typeof statusCode === 'number'
    && Number.isInteger(statusCode)
    && statusCode >= 400
    && statusCode < 500
    ? statusCode
    : null;
}

function fromUnknownError(exception: unknown): ErrorResponse {
  const clientStatus = clientHttpErrorStatus(exception);
  if (clientStatus !== null) {
    return {
      status: clientStatus,
      body: { statusCode: clientStatus, message: (exception as Error).message },
    };
  }

  // Unexpected failures (Redis "Connection is closed", pg pool timeouts,
  // TypeError, ...) never expose their internal message to clients.
  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    body: {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: INTERNAL_SERVER_ERROR_MESSAGE,
    },
  };
}

/**
 * Log line for an unexpected error. Bound SQL parameters in a
 * `DrizzleQueryError` message (and its stack header) are redacted, and the
 * cause chain is appended because the wrapper hides the real reason
 * (pool timeout, deadlock, connection reset).
 */
function describeUnexpectedError(exception: unknown): { message: string; stack?: string } {
  if (!(exception instanceof Error)) {
    return { message: redactSensitiveText(String(exception)) };
  }

  const message = redactSensitiveText(exception.message);
  const lines = [
    exception.stack
      ? exception.stack.replace(exception.message, () => message)
      : `${exception.name}: ${message}`,
  ];

  let cause: unknown = exception.cause;
  for (let depth = 0; cause instanceof Error && depth < MAX_LOGGED_CAUSES; depth += 1) {
    lines.push(`Caused by: ${cause.name}: ${redactSensitiveText(cause.message)}`);
    cause = cause.cause;
  }

  return { message, stack: lines.join('\n') };
}

/**
 * Global HTTP exception filter and catch-all.
 *
 * - `HttpException`: responds with its status and every extra response field.
 * - Any other error: reported to Sentry and logged, then answered with a
 *   generic 500 body (4xx errors with an HTTP status keep their status).
 *
 * Because it catches everything, it must be registered first in
 * `useGlobalFilters` so more specific filters (Toss) are matched before it;
 * use `createGlobalExceptionFilters()`.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionsHandler');

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const isHttpException = exception instanceof HttpException;
    const { status, body } = isHttpException
      ? fromHttpException(exception)
      : fromUnknownError(exception);

    if (status >= 500) {
      Sentry.captureException(exception, {
        tags: { 'http.status_code': String(status) },
      });
      if (!isHttpException) {
        const { message, stack } = describeUnexpectedError(exception);
        this.logger.error(message, stack);
      }
    }

    if (response.headersSent) {
      // A streamed response already started; the status can no longer change.
      response.end();
      return;
    }

    response.status(status).json({
      ...body,
      timestamp: new Date().toISOString(),
    });
  }
}
