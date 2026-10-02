import './instrument.js';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import type IORedis from 'ioredis';
import { AppModule } from './app.module.js';
import { getFrontendOrigins, parseFrontendUrlList } from './config/frontend-origins.js';
import { createGlobalExceptionFilters } from './common/filters/global-exception-filters.js';
import {
  API_SHUTDOWN_DRAIN_BUDGET_MS,
  installShutdownRunDeadline,
} from './common/run-deadline.js';
import { ZodValidationPipe } from './common/pipes/zod-validation.pipe.js';
import { checkEdgeProxySecretAtStartup } from './common/request-ip.js';
import { RedisIoAdapter } from './modules/booking/providers/redis-io.adapter.js';
import { REDIS_CLIENT } from './modules/booking/providers/redis.provider.js';

async function bootstrap() {
  // REVIEWS.md MED: FRONTEND_URL production hard-fail.
  // Password reset email links embed FRONTEND_URL; a missing or non-https value
  // breaks password recovery and phishing-protection guarantees.
  //
  // WR-06: split(',') 결과 각 origin 이 모두 https 여야 한다(일부가 http 면 mixed-content
  // 조용히 허용되는 현상을 차단). 빈 문자열은 필터링한다.
  const frontendOrigins = parseFrontendUrlList(process.env['FRONTEND_URL']);

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

  // Without the edge secret, IP-based rate limits can collapse into one bucket
  // behind the edge Worker (Architecture 8.4, 10.1). Warns by default; throws with
  // EDGE_PROXY_SHARED_SECRET_REQUIRED=true.
  checkEdgeProxySecretAtStartup();

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.set('trust proxy', 1);

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
  const redisPubSubReady = await redisIoAdapter.connectToRedis();
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
  //        Socket.IO gateway 도 같은 getFrontendOrigins() 목록으로 origin 을 검사한다.
  const corsOrigins = getFrontendOrigins(process.env['FRONTEND_URL']);

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));
  app.use(cookieParser());

  app.useGlobalFilters(...createGlobalExceptionFilters());
  app.useGlobalPipes(new ZodValidationPipe());

  app.setGlobalPrefix('api/v1');

  // SIGTERM (Cloud Run scale-in/revision replacement) runs Nest shutdown hooks
  // in this order, inside Cloud Run's 10 seconds before SIGKILL:
  // 1. onModuleDestroy: worker intervals and the view counter's flush timer
  //    stop, and in-flight recovery sweeps get at most
  //    API_SHUTDOWN_DRAIN_BUDGET_MS (the run deadline set by the listener
  //    installed first below); a cut-off row converges on its lease. No other
  //    DB I/O runs here: every later step waits for this one.
  // 2. beforeApplicationShutdown: pg-boss stops gracefully (7s) and fails
  //    unfinished jobs back for retry, still accepting new jobs.
  // 3. the HTTP/WebSocket servers close; requests in flight can still enqueue.
  // 4. onApplicationShutdown: pg-boss is marked unavailable and its pool
  //    closes; the view counter's final flush waits at most
  //    VIEW_COUNT_SHUTDOWN_FLUSH_CAP_MS within the run deadline (view counts
  //    are approximate, so views it cannot write in time are dropped).
  // Only the termination signals are subscribed; Nest's default list also
  // includes SIGSEGV/SIGBUS/SIGFPE/SIGILL, where running JS listeners is unsafe.
  installShutdownRunDeadline(process, API_SHUTDOWN_DRAIN_BUDGET_MS);
  app.enableShutdownHooks(['SIGTERM', 'SIGINT']);

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
