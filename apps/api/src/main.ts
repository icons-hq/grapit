import './instrument.js';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import type IORedis from 'ioredis';
import { AppModule } from './app.module.js';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import { TossPaymentExceptionFilter } from './common/filters/toss-payment-exception.filter.js';
import { ZodValidationPipe } from './common/pipes/zod-validation.pipe.js';
import { RedisIoAdapter } from './modules/booking/providers/redis-io.adapter.js';
import { REDIS_CLIENT } from './modules/booking/providers/redis.provider.js';

async function bootstrap() {
  // REVIEWS.md MED: FRONTEND_URL production hard-fail.
  // Password reset email links embed FRONTEND_URL; a missing or non-https value
  // breaks password recovery and phishing-protection guarantees.
  //
  // WR-06: split(',') 결과 각 origin 이 모두 https 여야 한다(일부가 http 면 mixed-content
  // 조용히 허용되는 현상을 차단). 빈 문자열은 필터링한다.
  const rawFrontend = process.env['FRONTEND_URL']?.trim() ?? '';
  const frontendOrigins = rawFrontend
    ? rawFrontend
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean)
    : [];

  if (process.env['NODE_ENV'] === 'production') {
    if (frontendOrigins.length === 0) {
      console.error(
        `[bootstrap] FRONTEND_URL must be set in production. ` +
          `Reset links and email deliverability depend on this. Aborting startup.`,
      );
      process.exit(1);
    }
    const nonHttps = frontendOrigins.filter((o) => !o.startsWith('https://'));
    if (nonHttps.length > 0) {
      console.error(
        `[bootstrap] All FRONTEND_URL origins must be https in production. ` +
          `Received non-https: ${nonHttps.join(', ')}. Aborting startup.`,
      );
      process.exit(1);
    }
  }

  const app = await NestFactory.create(AppModule);

  // Wire Socket.IO to the shared ioredis REDIS_CLIENT so seat-update events
  // broadcast across Cloud Run instances via Valkey pub/sub (VALK-04).
  // Falls back to the default in-process adapter when REDIS_URL is not set.
  const redisClient = app.get<IORedis>(REDIS_CLIENT);
  if (process.env['NODE_ENV'] === 'production') {
    const pong = await redisClient.ping();
    if (pong !== 'PONG') {
      throw new Error(`[bootstrap] Redis ping returned ${String(pong)}`);
    }
  }
  const redisIoAdapter = new RedisIoAdapter(app, redisClient);
  const redisPubSubReady = redisIoAdapter.connectToRedis();
  if (process.env['NODE_ENV'] === 'production' && !redisPubSubReady) {
    console.error(
      '[bootstrap] Socket.IO Redis adapter failed to wire in production. ' +
        'Redis-backed Socket.IO pub/sub is required. Aborting startup.',
    );
    process.exit(1);
  }
  app.useWebSocketAdapter(redisIoAdapter);

  // WR-06: origin 은 항상 배열로 통일(dev default 포함) — express-cors 는 배열마다
  //        요청 origin 을 echo 하므로 cookie + credentials 시 일관된 동작이 보장된다.
  const corsOrigins =
    frontendOrigins.length > 0 ? frontendOrigins : ['http://localhost:3000'];

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));
  app.use(cookieParser());

  app.useGlobalFilters(new HttpExceptionFilter(), new TossPaymentExceptionFilter());
  app.useGlobalPipes(new ZodValidationPipe());

  app.setGlobalPrefix('api/v1');

  const port = process.env['PORT'] ?? 8080;
  await app.listen(port);
  console.log(`API server running on http://localhost:${port}`);
}

bootstrap().catch((err) => {
  // Logger 초기화 실패 가능성을 고려해 raw console.error 사용.
  // 초기화 단계 에러(DB/Redis/helmet)는 unhandled rejection 으로 새어나가면
  // Cloud Run stdout 에 흔적이 남지 않을 수 있어 명시적으로 exit(1) 한다.
  console.error('[bootstrap] Fatal startup error:', err);
  process.exit(1);
});
