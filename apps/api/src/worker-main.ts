import './instrument.js';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { BackgroundWorkerModule } from './background-worker.module.js';
import {
  resolveBackgroundWorkerWindowMs,
  runBackgroundWorkerWindow,
} from './background-worker-runtime.js';
import { PendingPaymentExpirationWorker } from './modules/jobs/pending-payment-expiration.worker.js';
import { DRIZZLE, type DrizzleDB } from './database/drizzle.provider.js';
import { REDIS_CLIENT } from './modules/booking/providers/redis.provider.js';
import {
  PG_BOSS,
  type PgBossContract,
} from './modules/jobs/pgboss.provider.js';

const logger = new Logger('BackgroundWorkerMain');

function wait(windowMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, windowMs));
}

async function bootstrap(): Promise<void> {
  process.env['PENDING_PAYMENT_EXPIRATION_SWEEP_INTERVAL_MS'] ??= '0';

  const app = await NestFactory.createApplicationContext(BackgroundWorkerModule);
  const pendingPaymentWorker = app.get(PendingPaymentExpirationWorker);
  const pgBoss = app.get<PgBossContract>(PG_BOSS);
  const redis = app.get<{ quit?(): Promise<unknown> }>(REDIS_CLIENT);
  const database = app.get<DrizzleDB & { $client: { end(): Promise<void> } }>(DRIZZLE);
  const windowMs = resolveBackgroundWorkerWindowMs(
    process.env['BACKGROUND_WORKER_WINDOW_MS'],
  );

  const result = await runBackgroundWorkerWindow(
    {
      sweepPendingPayments: () => pendingPaymentWorker.sweepExpiredPendingPayments(),
      wait,
      stopQueue: () => pgBoss.stop(),
      closeApplication: () => app.close(),
      closeRedis: () => redis.quit?.() ?? Promise.resolve(),
      closeDatabase: () => database.$client.end(),
    },
    windowMs,
  );

  logger.log(
    `Worker window completed. windowMs=${windowMs}, expiredReservations=${result.expiredReservations}, unlockedSeats=${result.unlockedSeats}`,
  );
}

void bootstrap().catch((error: unknown) => {
  logger.error(
    'Background worker run failed',
    error instanceof Error ? error.stack : String(error),
  );
  process.exitCode = 1;
});
