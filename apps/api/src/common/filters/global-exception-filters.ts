import type { ExceptionFilter } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter.js';
import { TossPaymentExceptionFilter } from './toss-payment-exception.filter.js';

/**
 * Global exception filters in registration order for `app.useGlobalFilters`.
 *
 * Nest matches global filters from the last registered to the first, so the
 * catch-all `HttpExceptionFilter` comes first and specific filters follow it.
 */
export function createGlobalExceptionFilters(): ExceptionFilter[] {
  return [new HttpExceptionFilter(), new TossPaymentExceptionFilter()];
}
