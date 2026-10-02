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

export const ASYNC_DONE_COMPENSATION_RECOVERY_INTERVAL_MS = 60_000;

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
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
      this.sweepInterval = null;
    }

    // Let an in-flight sweep finish its current order before connections close.
    await this.running;
  }

  runOnce(): Promise<void> {
    if (this.running) {
      return this.running;
    }

    this.running = this.sweep().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async sweep(): Promise<void> {
    try {
      const result = await this.paymentService.recoverAsyncDoneCompensations();
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
