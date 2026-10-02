import { createRequire } from 'node:module';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_DATABASE_APPLICATION_NAME,
  parsePositiveIntegerEnv,
  resolveDatabaseApplicationName,
} from '../../database/pool-config.js';

export const PG_BOSS = Symbol('PG_BOSS');

export const PG_BOSS_JOB_NAMES = {
  releaseCancelledSeat: 'release-cancelled-seat',
  refundCancelRetry: 'refund-cancel-retry',
  qrTicketEmailResend: 'qr-ticket-email-resend',
} as const;

export const PG_BOSS_QUEUE_NAMES = Object.values(PG_BOSS_JOB_NAMES);

export interface SeatIdentityPayload {
  floorKey: string;
  seatId: string;
  seatKey: string;
}

export interface ReleaseCancelledSeatJobPayload {
  reservationId: string;
  showtimeId: string;
  releaseAt: string;
  seatIdentities: SeatIdentityPayload[];
}

export interface RefundCancelRetryJobPayload {
  refundId: string;
  attempt: number;
}

export interface PgBossJob<TData = unknown> {
  id?: string;
  data: TData;
}

export interface PgBossSendOptions {
  id?: string;
  startAfter?: Date | string;
  retryLimit?: number;
  retryDelay?: number;
  retryBackoff?: boolean;
  singletonKey?: string;
}

export interface PgBossStopOptions {
  graceful?: boolean;
  timeout?: number;
  close?: boolean;
}

export type PgBossWorkHandler<TData = unknown> = (
  jobs: PgBossJob<TData>[],
) => Promise<unknown>;

export interface PgBossContract {
  isAvailable: boolean;
  processesJobs?: boolean;
  createQueue(name: string, options?: Record<string, unknown>): Promise<void>;
  send<TData = unknown>(
    name: string,
    data?: TData,
    options?: PgBossSendOptions,
  ): Promise<string | null>;
  work<TData = unknown>(
    name: string,
    optionsOrHandler: Record<string, unknown> | PgBossWorkHandler<TData>,
    maybeHandler?: PgBossWorkHandler<TData>,
  ): Promise<unknown>;
  stop(options?: PgBossStopOptions): Promise<void>;
}

/**
 * pg-boss opens its own pg Pool outside DB_POOL_MAX. Without an explicit `max`
 * node-postgres defaults to 10 connections per process, so the per-instance
 * connection budget is DB_POOL_MAX + PGBOSS_POOL_MAX (see the ticket-opening
 * connection budget in docs/runbooks/managed-demo-cost-floor.md).
 */
export const DEFAULT_PGBOSS_POOL_MAX_PROCESSING = 3;
export const DEFAULT_PGBOSS_POOL_MAX_PRODUCER = 1;
export const DEFAULT_PGBOSS_START_MAX_ATTEMPTS = 3;
export const PGBOSS_START_RETRY_BASE_DELAY_MS = 1_000;
/** Cloud Run sends SIGKILL 10 seconds after SIGTERM. */
export const PGBOSS_SHUTDOWN_TIMEOUT_MS = 8_000;

const logger = new Logger('PgBossProvider');

function createUnavailableBoss(reason: string): PgBossContract {
  return {
    isAvailable: false,
    async send() {
      logger.warn(`pg-boss unavailable: ${reason}`);
      return null;
    },
    async work() {
      logger.warn(`pg-boss worker registration skipped: ${reason}`);
      return undefined;
    },
    async createQueue() {
      logger.warn(`pg-boss queue bootstrap skipped: ${reason}`);
      return undefined;
    },
    async stop() {
      return undefined;
    },
  };
}

export interface PgBossConstructorOptions {
  connectionString: string;
  max: number;
  application_name: string;
  schedule?: boolean;
  supervise?: boolean;
  migrate?: boolean;
  queueCacheIntervalSeconds?: number;
}

export type StartablePgBoss = PgBossContract & {
  start(): Promise<unknown>;
  on?(event: 'error' | 'warning', handler: (event: unknown) => void): unknown;
  getDb?(): { opened?: boolean; close?(): Promise<void> } | undefined;
};

type PgBossConstructor = new (options: PgBossConstructorOptions) => StartablePgBoss;

export function resolvePgBossConstructor(moduleExport: unknown): PgBossConstructor {
  const candidate =
    typeof moduleExport === 'object' && moduleExport !== null
      ? ((moduleExport as { PgBoss?: unknown; default?: unknown }).PgBoss ??
          (moduleExport as { default?: unknown }).default ??
          moduleExport)
      : moduleExport;

  if (typeof candidate !== 'function') {
    throw new TypeError('pg-boss constructor export was not found');
  }

  return candidate as PgBossConstructor;
}

export function loadPgBossConstructor(): PgBossConstructor {
  const require = createRequire(import.meta.url);
  const module = require('pg-boss');
  return resolvePgBossConstructor(module);
}

export function markBossAvailable(
  boss: PgBossContract & { start(): Promise<unknown> },
  processesJobs = true,
): PgBossContract {
  return Object.assign(boss, { isAvailable: true, processesJobs });
}

export function isBackgroundProcessingEnabled(
  configService: Pick<ConfigService, 'get'>,
): boolean {
  return configService
    .get<string>('BACKGROUND_PROCESSING_ENABLED')
    ?.trim()
    .toLowerCase() !== 'false';
}

export function resolvePgBossPoolMax(
  configService: Pick<ConfigService, 'get'>,
  processesJobs: boolean,
): number {
  return parsePositiveIntegerEnv(
    configService,
    'PGBOSS_POOL_MAX',
    processesJobs ? DEFAULT_PGBOSS_POOL_MAX_PROCESSING : DEFAULT_PGBOSS_POOL_MAX_PRODUCER,
  );
}

export function resolvePgBossStartMaxAttempts(
  configService: Pick<ConfigService, 'get'>,
): number {
  return parsePositiveIntegerEnv(
    configService,
    'PGBOSS_START_MAX_ATTEMPTS',
    DEFAULT_PGBOSS_START_MAX_ATTEMPTS,
  );
}

/**
 * Production processes must not keep serving without pg-boss: cancelled seat
 * releases, refund retries, and QR reminders would be silently dropped for the
 * whole process lifetime. Local/test runs keep the degraded fallback.
 */
export function isPgBossRequired(configService: Pick<ConfigService, 'get'>): boolean {
  return configService.get<string>('NODE_ENV') === 'production';
}

export function buildPgBossOptions(
  connectionString: string,
  processesJobs: boolean,
  pool: { max?: number; applicationName?: string } = {},
): PgBossConstructorOptions {
  const poolOptions = {
    max:
      pool.max
      ?? (processesJobs ? DEFAULT_PGBOSS_POOL_MAX_PROCESSING : DEFAULT_PGBOSS_POOL_MAX_PRODUCER),
    application_name:
      pool.applicationName ?? `${DEFAULT_DATABASE_APPLICATION_NAME}-pgboss`,
  };

  if (processesJobs) {
    return { connectionString, ...poolOptions };
  }

  return {
    connectionString,
    ...poolOptions,
    schedule: false,
    supervise: false,
    migrate: false,
    queueCacheIntervalSeconds: 86_400,
  };
}

export async function bootstrapPgBossQueues(
  boss: Pick<PgBossContract, 'createQueue'>,
  queueNames: readonly string[] = PG_BOSS_QUEUE_NAMES,
): Promise<void> {
  await Promise.all(queueNames.map((queueName) => boss.createQueue(queueName)));
}

function attachPgBossListeners(
  boss: PgBossContract & {
    on?(event: 'error' | 'warning', handler: (event: unknown) => void): unknown;
  },
): void {
  boss.on?.('error', (event) => {
    // Worker errors arrive as plain objects ({ message, stack, queue, worker }).
    const detail = event as { stack?: unknown; message?: unknown; queue?: unknown } | null;
    const stack = typeof detail?.stack === 'string'
      ? detail.stack
      : typeof detail?.message === 'string'
        ? detail.message
        : String(event);
    const queue = typeof detail?.queue === 'string' ? ` queue=${detail.queue}` : '';
    logger.error(`pg-boss runtime error${queue}`, stack);
  });
  boss.on?.('warning', (event) => {
    logger.warn(`pg-boss warning: ${event instanceof Error ? event.message : String(event)}`);
  });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? 'unknown error');
}

export class PgBossInitializationError extends Error {
  constructor(attempts: number, cause: unknown) {
    super(
      `pg-boss failed to initialize after ${attempts} attempt(s): ${describeError(cause)}`,
      { cause },
    );
    this.name = 'PgBossInitializationError';
  }
}

async function disposeFailedPgBoss(boss: StartablePgBoss): Promise<void> {
  // A started instance (queue bootstrap failed) stops and closes its pool.
  // pg-boss ignores stop() when start() threw, so close that pool directly
  // instead of leaking connections on every retry.
  try {
    await boss.stop({ graceful: false, close: true });
  } catch (error) {
    logger.warn(`pg-boss cleanup after failed start could not stop: ${describeError(error)}`);
  }

  try {
    const db = boss.getDb?.();
    if (db?.opened && typeof db.close === 'function') {
      await db.close();
    }
  } catch (error) {
    logger.warn(`pg-boss cleanup after failed start could not close its pool: ${describeError(error)}`);
  }
}

function defaultPgBossRetryDelayMs(failedAttempt: number): number {
  return PGBOSS_START_RETRY_BASE_DELAY_MS * 2 ** (failedAttempt - 1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface PgBossInitializationOptions {
  createBoss: () => StartablePgBoss;
  processesJobs: boolean;
  maxAttempts: number;
  required: boolean;
  queueNames?: readonly string[];
  retryDelayMs?: (failedAttempt: number) => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Starts pg-boss with bounded retries. Every attempt uses a fresh instance
 * because pg-boss keeps an internal "starting" flag after a failed start().
 * When pg-boss is required (production) and every attempt fails, the error is
 * rethrown so Nest aborts bootstrap and Cloud Run replaces the instance instead
 * of routing traffic to a process that can never enqueue background jobs.
 */
export async function initializePgBoss(
  options: PgBossInitializationOptions,
): Promise<PgBossContract> {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts));
  const retryDelayMs = options.retryDelayMs ?? defaultPgBossRetryDelayMs;
  const wait = options.sleep ?? sleep;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let boss: StartablePgBoss | undefined;
    try {
      boss = options.createBoss();
      attachPgBossListeners(boss);
      await boss.start();
      await bootstrapPgBossQueues(boss, options.queueNames);
      if (attempt > 1) {
        logger.log(`pg-boss initialized on attempt ${attempt}/${maxAttempts}`);
      }
      return markBossAvailable(boss, options.processesJobs);
    } catch (error) {
      lastError = error;
      logger.error(
        `pg-boss initialization attempt ${attempt}/${maxAttempts} failed`,
        error instanceof Error ? error.stack : String(error),
      );
      if (boss) {
        await disposeFailedPgBoss(boss);
      }
      if (attempt < maxAttempts) {
        await wait(retryDelayMs(attempt));
      }
    }
  }

  if (options.required) {
    throw new PgBossInitializationError(maxAttempts, lastError);
  }

  logger.error(
    'pg-boss is unavailable in this non-production process. Background refund/cancel/QR jobs will not be enqueued.',
  );
  return createUnavailableBoss(describeError(lastError));
}

/**
 * Graceful stop used on SIGTERM: stop fetching, let in-flight handlers finish
 * within Cloud Run's termination grace period, then fail any remaining active
 * job (pg-boss failWip) so it retries immediately instead of waiting for the
 * 15-minute expiration.
 */
export async function stopPgBossForShutdown(
  boss: PgBossContract,
  timeoutMs = PGBOSS_SHUTDOWN_TIMEOUT_MS,
): Promise<void> {
  if (!boss.isAvailable) {
    return;
  }

  try {
    await boss.stop({ graceful: true, timeout: timeoutMs });
  } catch (error) {
    logger.error(
      'pg-boss graceful shutdown failed',
      error instanceof Error ? error.stack : String(error),
    );
  } finally {
    // The pool is closed after stop(); report unavailable so late producers
    // take their existing "not enqueued" path instead of throwing.
    boss.isAvailable = false;
  }
}

export const pgbossProvider = {
  provide: PG_BOSS,
  inject: [ConfigService],
  useFactory: async (configService: ConfigService): Promise<PgBossContract> => {
    const required = isPgBossRequired(configService);
    const connectionString = configService.get<string>('DATABASE_URL');
    if (!connectionString) {
      if (required) {
        throw new Error('pg-boss requires DATABASE_URL in production');
      }
      return createUnavailableBoss('DATABASE_URL is not configured');
    }

    const processesJobs = isBackgroundProcessingEnabled(configService);
    const bossOptions = buildPgBossOptions(connectionString, processesJobs, {
      max: resolvePgBossPoolMax(configService, processesJobs),
      applicationName: `${resolveDatabaseApplicationName(configService)}-pgboss`,
    });

    return initializePgBoss({
      createBoss: () => {
        const PgBoss = loadPgBossConstructor();
        return new PgBoss(bossOptions);
      },
      processesJobs,
      maxAttempts: resolvePgBossStartMaxAttempts(configService),
      required,
    });
  },
};
