import './instrument.js';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { BackgroundWorkerModule } from './background-worker.module.js';
import {
  resolveBackgroundWorkerRunDeadline,
  resolveBackgroundWorkerWindowMs,
  runBackgroundWorkerWindow,
  scheduleForcedWorkerExit,
} from './background-worker-runtime.js';
import { boundedByRunDeadline, setRunDeadline } from './common/run-deadline.js';
import { PendingPaymentExpirationWorker } from './modules/jobs/pending-payment-expiration.worker.js';
import { DRIZZLE, type DrizzleDB } from './database/drizzle.provider.js';
import { REDIS_CLIENT } from './modules/booking/providers/redis.provider.js';
import {
  PG_BOSS,
  stopPgBossForShutdown,
  type PgBossContract,
} from './modules/jobs/pgboss.provider.js';

const logger = new Logger('BackgroundWorkerMain');

function wait(windowMs: number): Promise<void> {
  // A slow startup must not push the window past the run deadline.
  return new Promise((resolve) => setTimeout(resolve, boundedByRunDeadline(windowMs)));
}

async function bootstrap(): Promise<void> {
  // Every step of this run ends inside the Cloud Run Job timeout.
  setRunDeadline(resolveBackgroundWorkerRunDeadline(Date.now() - process.uptime() * 1000));
  process.env['PENDING_PAYMENT_EXPIRATION_SWEEP_INTERVAL_MS'] ??= '0';
  process.env['DB_APPLICATION_NAME'] ??= 'grabit-background-worker';

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
      onSweepFailure: (error) => {
        logger.error(
          'Pending payment expiration sweep failed; continuing the queue processing window',
          error instanceof Error ? error.stack : String(error),
        );
      },
      isQueueProcessing: () => pgBoss.isAvailable && pgBoss.processesJobs !== false,
      wait,
      // No-op once PgBossShutdownService stopped it during closeApplication.
      stopQueue: () => stopPgBossForShutdown(pgBoss),
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

void bootstrap()
  .catch((error: unknown) => {
    logger.error(
      'Background worker run failed',
      error instanceof Error ? error.stack : String(error),
    );
    process.exitCode = 1;
  })
  .finally(() => {
    scheduleForcedWorkerExit({
      onForcedExit: () => {
        logger.warn('Background worker still had open handles after cleanup; forcing exit');
      },
    });
  });
