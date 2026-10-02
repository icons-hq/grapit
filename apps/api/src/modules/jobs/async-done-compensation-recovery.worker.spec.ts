import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { PaymentService } from '../payment/payment.service.js';
import {
  ASYNC_DONE_COMPENSATION_SHUTDOWN_WAIT_MS,
  AsyncDoneCompensationRecoveryWorker,
} from './async-done-compensation-recovery.worker.js';
import { setRunDeadline } from '../../common/run-deadline.js';

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
    setRunDeadline(null);
    vi.useRealTimers();
  });

  it('stops after the current order on shutdown and bounds the wait (bounded worker budget)', async () => {
    vi.useFakeTimers();
    let shouldStop: (() => boolean) | undefined;
    const recover = vi.fn((_now: Date, _limit: unknown, options?: { shouldStop?: () => boolean }) => {
      shouldStop = options?.shouldStop;
      return new Promise(() => undefined);
    });
    const worker = new AsyncDoneCompensationRecoveryWorker(
      createPaymentService(recover as never),
      createConfig({}),
    );

    worker.onModuleInit();
    expect(shouldStop?.()).toBe(false);

    let destroyed = false;
    const destroy = worker.onModuleDestroy().then(() => { destroyed = true; });
    // The sweep loop sees the stop request before its next order.
    expect(shouldStop?.()).toBe(true);

    await vi.advanceTimersByTimeAsync(ASYNC_DONE_COMPENSATION_SHUTDOWN_WAIT_MS - 1);
    expect(destroyed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await destroy;
    expect(destroyed).toBe(true);
    // The interval is cleared, so no further sweep starts after shutdown.
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(recover).toHaveBeenCalledOnce();
  });

  it('gives up the drain at the bounded worker run deadline', async () => {
    vi.useFakeTimers();
    setRunDeadline(Date.now() + 2_000);
    const worker = new AsyncDoneCompensationRecoveryWorker(
      createPaymentService(vi.fn(() => new Promise(() => undefined)) as never),
      createConfig({}),
    );

    worker.onModuleInit();
    let destroyed = false;
    const destroy = worker.onModuleDestroy().then(() => { destroyed = true; });
    await vi.advanceTimersByTimeAsync(2_000);
    await destroy;
    expect(destroyed).toBe(true);
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
