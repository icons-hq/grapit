import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isBackgroundProcessingEnabled } from '../jobs/pgboss.provider.js';
import { boundedByRunDeadline, waitWithinRunDeadline } from '../../common/run-deadline.js';
import { QrTicketService } from './qr-ticket.service.js';

@Injectable()
export class QrReminderRecoveryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QrReminderRecoveryWorker.name);
  private interval: ReturnType<typeof setInterval> | undefined;
  private running: Promise<unknown> | undefined;
  private stopping = false;

  constructor(private readonly qrTickets: QrTicketService, private readonly config: ConfigService) {}

  onModuleInit(): void {
    if (!isBackgroundProcessingEnabled(this.config)) return;
    const run = () => {
      if (this.stopping || this.running) return;
      this.running = this.qrTickets.recoverDueReminderEmails(
        () => !this.stopping && boundedByRunDeadline(30_000, { reserveMs: 5_000 }) > 0,
      ).catch(() => { this.logger.error('QR reminder recovery sweep failed; next worker run retries'); })
        .finally(() => { this.running = undefined; });
    };
    run();
    this.interval = setInterval(run, 5 * 60 * 1000);
    this.interval.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.interval) clearInterval(this.interval);
    if (this.running) await waitWithinRunDeadline(this.running, 30_000);
  }

  /** A bounded worker with no queue window must still let its startup sweep make progress. */
  async waitForInitialSweep(): Promise<void> {
    if (this.running) await waitWithinRunDeadline(this.running, 30_000);
  }
}
