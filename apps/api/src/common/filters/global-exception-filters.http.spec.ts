import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  ServiceUnavailableException,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/nestjs', () => ({ captureException: vi.fn() }));

import * as Sentry from '@sentry/nestjs';
import { TossPaymentError } from '../../modules/payment/toss-payments.client.js';
import { createGlobalExceptionFilters } from './global-exception-filters.js';

const captureException = vi.mocked(Sentry.captureException);

const USER_DELETE_BLOCKERS = [
  { key: 'activeReservations', label: '진행 중인 예매', count: 2 },
];

@Controller('probe')
class ProbeController {
  @Delete('user')
  deleteUser(): never {
    throw new ConflictException({
      code: 'USER_HARD_DELETE_BLOCKED',
      message: '연결된 이력 때문에 회원을 DB에서 삭제할 수 없습니다',
      blockers: USER_DELETE_BLOCKERS,
    });
  }

  @Post('sms')
  sendSms(): never {
    throw new HttpException(
      { statusCode: 429, message: '잠시 후 다시 시도해주세요', retryAfterMs: 42_000 },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  @Get('validation')
  validation(): never {
    throw new BadRequestException({
      message: 'Validation failed',
      errors: { phone: ['Required'] },
    });
  }

  @Get('plain-message')
  plainMessage(): never {
    throw new NotFoundException('공연을 찾을 수 없습니다');
  }

  @Get('redis-down')
  redisDown(): never {
    throw new Error('Connection is closed.');
  }

  @Get('pg-timeout')
  async pgTimeout(): Promise<never> {
    await Promise.resolve();
    throw new Error('timeout exceeded when trying to connect');
  }

  @Get('unavailable')
  unavailable(): never {
    throw new ServiceUnavailableException('잠시 후 다시 시도해주세요');
  }

  @Get('toss/:code')
  toss(@Param('code') code: string): never {
    throw new TossPaymentError(code, '결제사 응답을 확인할 수 없습니다');
  }

  @Post('echo')
  echo(@Body() body: unknown): { received: boolean } {
    return { received: body !== undefined };
  }
}

describe('global exception filters (as registered by main.ts)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalFilters(...createGlobalExceptionFilters());
    await app.init();
  });

  beforeEach(() => {
    captureException.mockReset();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('HttpException response fields (#157)', () => {
    it('keeps code and blockers on the 409 the admin user deletion screen reads', async () => {
      const response = await request(app.getHttpServer()).delete('/probe/user');

      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({
        statusCode: 409,
        code: 'USER_HARD_DELETE_BLOCKED',
        message: '연결된 이력 때문에 회원을 DB에서 삭제할 수 없습니다',
        blockers: USER_DELETE_BLOCKERS,
      });
      expect(typeof response.body.timestamp).toBe('string');
      expect(captureException).not.toHaveBeenCalled();
    });

    it('keeps retryAfterMs on SMS rate limit responses', async () => {
      const response = await request(app.getHttpServer()).post('/probe/sms');

      expect(response.status).toBe(429);
      expect(response.body).toMatchObject({
        statusCode: 429,
        message: '잠시 후 다시 시도해주세요',
        retryAfterMs: 42_000,
      });
    });

    it('keeps validation errors and the plain message contract', async () => {
      const validation = await request(app.getHttpServer()).get('/probe/validation');
      expect(validation.status).toBe(400);
      expect(validation.body).toMatchObject({
        statusCode: 400,
        message: 'Validation failed',
        errors: { phone: ['Required'] },
      });

      const notFound = await request(app.getHttpServer()).get('/probe/plain-message');
      expect(notFound.status).toBe(404);
      expect(notFound.body).toMatchObject({
        statusCode: 404,
        message: '공연을 찾을 수 없습니다',
      });
      expect(captureException).not.toHaveBeenCalled();
    });
  });

  describe('unexpected 500 and gateway failures reach Sentry (#156)', () => {
    it('reports a synchronous non-HTTP error and hides its message', async () => {
      const response = await request(app.getHttpServer()).get('/probe/redis-down');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        statusCode: 500,
        message: 'Internal server error',
        timestamp: expect.any(String),
      });
      expect(JSON.stringify(response.body)).not.toContain('Connection is closed');
      expect(captureException).toHaveBeenCalledTimes(1);
      const [captured, context] = captureException.mock.calls[0] ?? [];
      expect(captured).toBeInstanceOf(Error);
      expect((captured as Error).message).toBe('Connection is closed.');
      expect(context).toMatchObject({ tags: { 'http.status_code': '500' } });
    });

    it('reports a rejected async handler (pg pool timeout)', async () => {
      const response = await request(app.getHttpServer()).get('/probe/pg-timeout');

      expect(response.status).toBe(500);
      expect(response.body.message).toBe('Internal server error');
      expect(captureException).toHaveBeenCalledTimes(1);
      expect((captureException.mock.calls[0]?.[0] as Error).message)
        .toBe('timeout exceeded when trying to connect');
    });

    it('reports a 5xx HttpException but not a 4xx one', async () => {
      const response = await request(app.getHttpServer()).get('/probe/unavailable');

      expect(response.status).toBe(503);
      expect(response.body.message).toBe('잠시 후 다시 시도해주세요');
      expect(captureException).toHaveBeenCalledTimes(1);
      expect(captureException.mock.calls[0]?.[1]).toMatchObject({
        tags: { 'http.status_code': '503' },
      });
    });

    it('reports a Toss provider failure answered with 502', async () => {
      const response = await request(app.getHttpServer()).get('/probe/toss/PROVIDER_ERROR');

      expect(response.status).toBe(502);
      expect(response.body).toMatchObject({
        statusCode: 502,
        code: 'PROVIDER_ERROR',
        message: '결제사 응답을 확인할 수 없습니다',
      });
      expect(captureException).toHaveBeenCalledTimes(1);
      const [captured, context] = captureException.mock.calls[0] ?? [];
      expect(captured).toBeInstanceOf(TossPaymentError);
      expect(context).toMatchObject({
        tags: { 'toss.code': 'PROVIDER_ERROR', 'http.status_code': '502' },
        fingerprint: ['toss-payment-error', 'PROVIDER_ERROR'],
      });
    });

    it('lets the Toss filter win over the catch-all for client and conflict codes', async () => {
      const rejected = await request(app.getHttpServer()).get('/probe/toss/REJECT_CARD_PAYMENT');
      expect(rejected.status).toBe(400);
      expect(rejected.body.code).toBe('REJECT_CARD_PAYMENT');

      const duplicated = await request(app.getHttpServer())
        .get('/probe/toss/ALREADY_PROCESSED_PAYMENT');
      expect(duplicated.status).toBe(409);
      expect(duplicated.body.code).toBe('ALREADY_PROCESSED_PAYMENT');

      expect(captureException).not.toHaveBeenCalled();
    });

    it('keeps body-parser client errors as 4xx without reporting them', async () => {
      const tooLarge = await request(app.getHttpServer())
        .post('/probe/echo')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ filler: 'x'.repeat(200 * 1024) }));
      expect(tooLarge.status).toBe(413);
      expect(tooLarge.body).toMatchObject({ statusCode: 413 });

      const malformed = await request(app.getHttpServer())
        .post('/probe/echo')
        .set('Content-Type', 'application/json')
        .send('{"broken":');
      expect(malformed.status).toBe(400);

      expect(captureException).not.toHaveBeenCalled();
    });
  });
});
