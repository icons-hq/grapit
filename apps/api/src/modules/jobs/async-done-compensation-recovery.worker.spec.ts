import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { PaymentService } from '../payment/payment.service.js';
import { AsyncDoneCompensationRecoveryWorker } from './async-done-compensation-recovery.worker.js';

function createConfig(values: Record<string, string | undefined>): ConfigService {
  return { get: vi.fn((key: string) => values[key]) } as unknown as ConfigService;
}

function createPaymentService(
  recover = vi.fn().mockResolvedValue({ checked: 0, cancelled: 0, retried: 0, waiting: 0, attention: 0, skipped: 0 }),
) {
  return { recoverAsyncDoneCompensations: recover } as unknown as PaymentService & {
    recoverAsyncDoneCompensations: typeof recover;
  };
}

describe('AsyncDoneCompensationRecoveryWorker', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sweeps once at start so a bounded worker window also recovers compensations', async () => {
    vi.useFakeTimers();
    const paymentService = createPaymentService();
    const worker = new AsyncDoneCompensationRecoveryWorker(paymentService, createConfig({}));

    worker.onModuleInit();
    await worker.onModuleDestroy();

    expect(paymentService.recoverAsyncDoneCompensations).toHaveBeenCalledOnce();
  });

  it('keeps sweeping on the configured interval', async () => {
    vi.useFakeTimers();
    const paymentService = createPaymentService();
    const worker = new AsyncDoneCompensationRecoveryWorker(
      paymentService,
      createConfig({ ASYNC_DONE_COMPENSATION_RECOVERY_INTERVAL_MS: '1000' }),
    );

    worker.onModuleInit();
    await vi.advanceTimersByTimeAsync(2_100);
    await worker.onModuleDestroy();

    expect(paymentService.recoverAsyncDoneCompensations).toHaveBeenCalledTimes(3);
  });

  it('does not run where background processing is disabled', async () => {
    const paymentService = createPaymentService();
    const worker = new AsyncDoneCompensationRecoveryWorker(
      paymentService,
      createConfig({ BACKGROUND_PROCESSING_ENABLED: 'false' }),
    );

    worker.onModuleInit();
    await worker.onModuleDestroy();

    expect(paymentService.recoverAsyncDoneCompensations).not.toHaveBeenCalled();
  });

  it('can be disabled with a zero interval', async () => {
    const paymentService = createPaymentService();
    const worker = new AsyncDoneCompensationRecoveryWorker(
      paymentService,
      createConfig({ ASYNC_DONE_COMPENSATION_RECOVERY_INTERVAL_MS: '0' }),
    );

    worker.onModuleInit();
    await worker.onModuleDestroy();

    expect(paymentService.recoverAsyncDoneCompensations).not.toHaveBeenCalled();
  });

  it('does not overlap sweeps and survives a failed sweep', async () => {
    let release!: () => void;
    const recover = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; })
        .then(() => { throw new Error('database unavailable'); }))
      .mockResolvedValue({ checked: 0, cancelled: 0, retried: 0, waiting: 0, attention: 0, skipped: 0 });
    const paymentService = createPaymentService(recover);
    const worker = new AsyncDoneCompensationRecoveryWorker(paymentService);

    const first = worker.runOnce();
    const overlapping = worker.runOnce();
    expect(overlapping).toBe(first);
    release();
    await expect(first).resolves.toBeUndefined();

    await worker.runOnce();
    expect(recover).toHaveBeenCalledTimes(2);
  });
});
