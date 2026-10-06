import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentService } from '../payment/payment.service.js';
import { isBackgroundProcessingEnabled } from './pgboss.provider.js';
import { waitWithinRunDeadline } from '../../common/run-deadline.js';

export const ASYNC_DONE_COMPENSATION_RECOVERY_INTERVAL_MS = 60_000;
/** One order's provider cancel can take the full Toss cancel timeout (60s). */
export const ASYNC_DONE_COMPENSATION_SHUTDOWN_WAIT_MS = 60_000;

function resolveRecoveryIntervalMs(configService?: ConfigService): number {
  const configured = configService?.get<string>('ASYNC_DONE_COMPENSATION_RECOVERY_INTERVAL_MS');
  if (!configured) {
    return ASYNC_DONE_COMPENSATION_RECOVERY_INTERVAL_MS;
  }

  const intervalMs = Number(configured);
  return Number.isFinite(intervalMs)
    ? intervalMs
    : ASYNC_DONE_COMPENSATION_RECOVERY_INTERVAL_MS;
}

/**
 * Resumes compensation cancels for async DONE payments that were never issued
 * (seat conflict, ticket limit, amount mismatch, unsupported provider,
 * duplicate payment key) when the provider cancel stayed IN_PROGRESS, was
 * ABORTED, or its request outcome was unknown.
 *
 * Runs wherever background processing is enabled: the always-on API interval
 * and, through the initial sweep, every bounded background-worker window.
 */
@Injectable()
export class AsyncDoneCompensationRecoveryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AsyncDoneCompensationRecoveryWorker.name);
  private sweepInterval: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;
  private stopping = false;

  constructor(
    private readonly paymentService: PaymentService,
    @Optional() private readonly configService?: ConfigService,
  ) {}

  onModuleInit(): void {
    if (
      this.configService
      && !isBackgroundProcessingEnabled(this.configService)
    ) {
      return;
    }

    const intervalMs = resolveRecoveryIntervalMs(this.configService);
    if (intervalMs <= 0) {
      return;
    }

    void this.runOnce();
    this.sweepInterval = setInterval(() => {
      void this.runOnce();
    }, intervalMs);
    this.sweepInterval.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
      this.sweepInterval = null;
    }

    // Let an in-flight sweep finish its current order before connections close;
    // it starts no further order. Bounded like the other recovery sweeps, and
    // shortened to the bounded worker's run deadline. An order cut off here is
    // retried by the next sweep under its order lease.
    const inFlight = this.running;
    if (!inFlight) {
      return;
    }
    const timedOut = await waitWithinRunDeadline(inFlight, ASYNC_DONE_COMPENSATION_SHUTDOWN_WAIT_MS);
    if (timedOut) {
      this.logger.warn(
        'Async DONE compensation recovery was still running at shutdown. The unfinished order is retried by the next sweep.',
      );
    }
  }

  runOnce(): Promise<void> {
    if (this.running) {
      return this.running;
    }
    if (this.stopping) {
      return Promise.resolve();
    }

    this.running = this.sweep().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async sweep(): Promise<void> {
    try {
      const result = await this.paymentService.recoverAsyncDoneCompensations(new Date(), undefined, {
        shouldStop: () => this.stopping,
      });
      if (result.cancelled + result.retried + result.attention > 0) {
        this.logger.log(
          `Async DONE compensation recovery: checked=${result.checked}, cancelled=${result.cancelled}, retried=${result.retried}, waiting=${result.waiting}, attention=${result.attention}, skipped=${result.skipped}`,
        );
      }
    } catch (error) {
      this.logger.error(
        'Async DONE compensation recovery sweep failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
