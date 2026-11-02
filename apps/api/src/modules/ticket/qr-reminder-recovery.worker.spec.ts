import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { QrReminderRecoveryWorker } from './qr-reminder-recovery.worker.js';
import { setRunDeadline } from '../../common/run-deadline.js';

afterEach(() => { vi.useRealTimers(); setRunDeadline(null); });

describe('QrReminderRecoveryWorker', () => {
  it('does not sweep in request-only API processes', () => {
    const recoverDueReminderEmails = vi.fn();
    new QrReminderRecoveryWorker({ recoverDueReminderEmails } as never,
      new ConfigService({ BACKGROUND_PROCESSING_ENABLED: 'false' })).onModuleInit();
    expect(recoverDueReminderEmails).not.toHaveBeenCalled();
  });

  it('sweeps on worker startup without pg-boss, never overlaps and drains on shutdown', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const recoverDueReminderEmails = vi.fn().mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    const worker = new QrReminderRecoveryWorker({ recoverDueReminderEmails } as never,
      new ConfigService({ BACKGROUND_PROCESSING_ENABLED: 'true' }));
    worker.onModuleInit();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(recoverDueReminderEmails).toHaveBeenCalledOnce();
    const shouldContinue = recoverDueReminderEmails.mock.calls[0]![0] as () => boolean;
    expect(shouldContinue()).toBe(true);
    const stopped = worker.onModuleDestroy();
    expect(shouldContinue()).toBe(false);
    finish(); await stopped;
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(recoverDueReminderEmails).toHaveBeenCalledOnce();
  });

  it('retries a failed sweep on the next interval and stops selecting work at the run deadline', async () => {
    vi.useFakeTimers();
    const recoverDueReminderEmails = vi.fn().mockRejectedValueOnce(new Error('database down')).mockResolvedValue(0);
    const worker = new QrReminderRecoveryWorker({ recoverDueReminderEmails } as never, new ConfigService());
    worker.onModuleInit();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(recoverDueReminderEmails).toHaveBeenCalledTimes(2);
    setRunDeadline(Date.now() + 1_000);
    expect((recoverDueReminderEmails.mock.calls[1]![0] as () => boolean)()).toBe(false);
    await worker.onModuleDestroy();
  });

  it('lets the initial sweep finish before a queue-unavailable worker starts shutdown', async () => {
    let finish!: () => void;
    const recoverDueReminderEmails = vi.fn().mockImplementation(async (shouldContinue: () => boolean) => {
      await new Promise<void>((resolve) => { finish = resolve; });
      expect(shouldContinue()).toBe(true);
    });
    const worker = new QrReminderRecoveryWorker({ recoverDueReminderEmails } as never, new ConfigService());
    worker.onModuleInit();
    let drained = false;
    const initial = worker.waitForInitialSweep().then(() => { drained = true; });
    await Promise.resolve(); expect(drained).toBe(false);
    finish(); await initial;
    expect(drained).toBe(true);
    await worker.onModuleDestroy();
  });
});
