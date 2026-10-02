import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';

import { PG_BOSS, type PgBossContract } from '../jobs/pgboss.provider.js';
import {
  PAYMENT_CONFIRM_RECONCILE_JOB,
  ReservationFinalizationService,
  type PaymentConfirmReconcileJobPayload,
} from './reservation-finalization.service.js';

/**
 * Processes payment confirm reconcile jobs wherever pg-boss processes jobs:
 * the API when BACKGROUND_PROCESSING_ENABLED is true, and the bounded
 * background worker otherwise. Every process creates the queue so that the
 * request path can enqueue into it.
 */
@Injectable()
export class PaymentConfirmReconcileWorker implements OnModuleInit {
  private readonly logger = new Logger(PaymentConfirmReconcileWorker.name);

  constructor(
    private readonly finalizationService: ReservationFinalizationService,
    @Optional() @Inject(PG_BOSS) private readonly pgBoss?: PgBossContract,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.pgBoss?.isAvailable) {
      return;
    }

    try {
      await this.finalizationService.ensurePaymentConfirmReconcileQueue();
    } catch (error) {
      // The request path retries the queue creation before each enqueue.
      this.logger.error(
        'Payment confirm reconcile queue bootstrap failed',
        error instanceof Error ? error.stack : String(error),
      );
      return;
    }

    if (this.pgBoss.processesJobs === false) {
      return;
    }

    await this.pgBoss.work<PaymentConfirmReconcileJobPayload>(
      PAYMENT_CONFIRM_RECONCILE_JOB,
      async ([job]) => {
        if (!job) {
          return;
        }

        await this.finalizationService.runPaymentConfirmReconcileJob(job.data);
      },
    );
  }
}
