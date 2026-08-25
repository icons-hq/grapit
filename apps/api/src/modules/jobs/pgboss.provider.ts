import { createRequire } from 'node:module';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
  stop(): Promise<void>;
}

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

type PgBossConstructor = new (options: {
  connectionString: string;
  schedule?: boolean;
  supervise?: boolean;
  migrate?: boolean;
  queueCacheIntervalSeconds?: number;
}) => PgBossContract & {
  start(): Promise<void>;
  on?(event: 'error' | 'warning', handler: (event: unknown) => void): unknown;
};

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
  boss: PgBossContract & { start(): Promise<void> },
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

export function buildPgBossOptions(
  connectionString: string,
  processesJobs: boolean,
): ConstructorParameters<PgBossConstructor>[0] {
  if (processesJobs) {
    return { connectionString };
  }

  return {
    connectionString,
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
    logger.error(
      'pg-boss runtime error',
      event instanceof Error ? event.stack : String(event),
    );
  });
  boss.on?.('warning', (event) => {
    logger.warn(`pg-boss warning: ${event instanceof Error ? event.message : String(event)}`);
  });
}

export const pgbossProvider = {
  provide: PG_BOSS,
  inject: [ConfigService],
  useFactory: async (configService: ConfigService): Promise<PgBossContract> => {
    const connectionString = configService.get<string>('DATABASE_URL');
    if (!connectionString) {
      return createUnavailableBoss('DATABASE_URL is not configured');
    }

    try {
      const PgBoss = loadPgBossConstructor();
      const processesJobs = isBackgroundProcessingEnabled(configService);
      const boss = new PgBoss(buildPgBossOptions(connectionString, processesJobs));
      attachPgBossListeners(boss);
      await boss.start();
      await bootstrapPgBossQueues(boss);

      return markBossAvailable(boss, processesJobs);
    } catch (error) {
      logger.error(
        'Failed to initialize pg-boss. Background refund/cancel jobs are unavailable until dependency/runtime is fixed.',
        error instanceof Error ? error.stack : String(error),
      );
      return createUnavailableBoss(
        error instanceof Error ? error.message : 'unknown pg-boss initialization error',
      );
    }
  },
};
