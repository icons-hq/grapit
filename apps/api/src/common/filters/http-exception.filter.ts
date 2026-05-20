import {
  ExceptionFilter,
  Catch,
  HttpException,
} from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import type { Response } from 'express';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    if (status >= 500) {
      Sentry.captureException(exception);
    }

    const errorBody = {
      statusCode: status,
      message: exception.message,
      ...(typeof exceptionResponse === 'object' && exceptionResponse !== null
        ? {
            errors: (exceptionResponse as Record<string, unknown>)['errors'],
            errorCode: (exceptionResponse as Record<string, unknown>)['errorCode'],
            providerCode: (exceptionResponse as Record<string, unknown>)['providerCode'],
          }
        : {}),
      timestamp: new Date().toISOString(),
    };

    response.status(status).json(errorBody);
  }
}
