import { describe, expect, it, vi } from 'vitest';

import {
  payments,
  reservationPaymentFailureDiagnostics,
  reservations,
} from '../../database/schema/index.js';
import { TossPaymentError } from '../payment/toss-payments.client.js';
import { PaymentConfirmReconcileWorker } from './payment-confirm-reconcile.worker.js';
import {
  PAYMENT_CONFIRM_RECONCILE_JOB,
  PAYMENT_CONFIRM_RECONCILE_MAX_ATTEMPTS,
  ReservationFinalizationService,
  type PaymentConfirmReconcileJobPayload,
} from './reservation-finalization.service.js';

/**
 * Audit #18: a confirm that ended in a 503 after a possible provider approval
 * converges without any client retry. The fake database keeps one order
 * (reservation + its single payment row, like payments.reservation_id unique)
 * so each step sees what the previous one wrote.
 */

type PaymentRow = Record<string, unknown> & {
  id: string;
  reservationId: string;
  paymentKey: string;
  status: string;
  asyncStatus: string;
};
type ReservationState = {
  id: string;
  status: string;
  totalAmount: number;
  admissionActiveUntilAt: Date | null;
  paymentDeadlineAt: Date | null;
};

const NOW = new Date('2026-10-02T10:00:00.000Z');
const MINUTE = 60_000;

function paypalPayload(overrides: Partial<PaymentConfirmReconcileJobPayload> = {}): PaymentConfirmReconcileJobPayload {
  return {
    orderId: 'order-1',
    paymentKey: 'payment-key-1',
    expectation: { route: 'PAYPAL', currency: 'USD', amountMinor: 10800 },
    providerCharge: {
      currency: 'USD',
      amountMinor: 10800,
      amountDecimal: '108.00',
      rate: '0.00072',
      quotedAt: '2026-10-02T09:40:00.000Z',
    },
    reason: 'provider_confirm_unresolved',
    attempt: 1,
    ...overrides,
  };
}

function paypalApproval(overrides: Record<string, unknown> = {}) {
  return {
    paymentKey: 'payment-key-1',
    orderId: 'order-1',
    status: 'DONE',
    currency: 'USD',
    method: '해외간편결제',
    totalAmount: 108,
    approvedAt: '2026-10-02T09:45:00.000Z',
    ...overrides,
  };
}

function createReconcile(options: {
  reservation?: Partial<ReservationState> | null;
  payment?: PaymentRow | null;
  /** Runs instead of the claim insert, e.g. another finalizer writing first. */
  onClaim?: (state: { payment: PaymentRow | null; reservation: ReservationState | null }) => void;
} = {}) {
  const state: {
    reservation: ReservationState | null;
    payment: PaymentRow | null;
    diagnostics: Array<Record<string, unknown>>;
  } = {
    reservation: options.reservation === null
      ? null
      : {
          id: 'reservation-1',
          status: 'PENDING_PAYMENT',
          totalAmount: 150000,
          // Both client windows ended before NOW.
          admissionActiveUntilAt: new Date(NOW.getTime() - 5 * MINUTE),
          paymentDeadlineAt: new Date(NOW.getTime() - 5 * MINUTE),
          ...options.reservation,
        },
    payment: options.payment ?? null,
    diagnostics: [],
  };
  const calls: string[] = [];

  const insertInto = (table: unknown, values: Record<string, unknown>) => {
    if (table === payments) {
      return {
        onConflictDoNothing: () => ({
          returning: async () => {
            calls.push(`claim:${String(values.status)}`);
            options.onClaim?.(state);
            if (state.payment) {
              return [];
            }
            state.payment = { id: 'claim-1', ...values } as PaymentRow;
            return [{ id: 'claim-1' }];
          },
        }),
      };
    }
    if (table === reservationPaymentFailureDiagnostics) {
      return {
        onConflictDoUpdate: async () => {
          state.diagnostics.push(values);
        },
      };
    }
    throw new Error('unexpected insert');
  };
  const rowsOf = (table: unknown) => {
    if (table === reservations) {
      return state.reservation ? [{ ...state.reservation }] : [];
    }
    if (table === payments) {
      return state.payment ? [{ tossOrderId: 'order-1', ...state.payment }] : [];
    }
    return [];
  };
  const tx = {
    insert: (table: unknown) => ({ values: (values: Record<string, unknown>) => insertInto(table, values) }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        // Mirrors the conditional updates: only a DONE/cancel_pending row this
        // confirm flow still owns (claim marker, no async DONE record) and a
        // PENDING_PAYMENT reservation change.
        where: () => {
          const apply = (): Array<{ id: string }> => {
            if (table === payments) {
              const metadata = (state.payment?.providerMetadata ?? {}) as Record<string, unknown>;
              if (
                state.payment?.status === 'DONE'
                && state.payment.asyncStatus === 'cancel_pending'
                && metadata.confirmCompensationClaim === true
                && metadata.asyncDoneCompensation === undefined
              ) {
                state.payment = { ...state.payment, ...values } as PaymentRow;
                return [{ id: state.payment.id }];
              }
              return [];
            }
            if (table === reservations && state.reservation?.status === 'PENDING_PAYMENT') {
              state.reservation = { ...state.reservation, ...values } as ReservationState;
              return [{ id: state.reservation.id }];
            }
            return [];
          };
          return {
            then: (resolve: (value: unknown) => void, reject: (reason: unknown) => void) =>
              Promise.resolve().then(apply).then(resolve, reject),
            returning: async () => apply(),
          };
        },
      }),
    }),
  };
  const db = {
    select: vi.fn(() => ({
      from: (table: unknown) => ({ where: async () => rowsOf(table) }),
    })),
    insert: vi.fn(tx.insert),
    update: vi.fn(tx.update),
    transaction: vi.fn(async (cb: (value: typeof tx) => Promise<unknown>) => cb(tx)),
  };

  const tossClient = {
    confirmPayment: vi.fn(),
    queryPayment: vi.fn().mockResolvedValue(paypalApproval()),
    cancelPayment: vi.fn(async () => {
      calls.push('cancel');
      return paypalApproval({ status: 'CANCELED', cancels: [{ cancelStatus: 'DONE' }] });
    }),
  };
  const bookingService = {
    acquirePaymentConfirmLock: vi.fn().mockResolvedValue(true),
    refreshPaymentConfirmLock: vi.fn().mockResolvedValue(true),
    releasePaymentConfirmLock: vi.fn().mockResolvedValue(undefined),
  };
  const pgBoss = {
    isAvailable: true,
    processesJobs: true,
    createQueue: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue('job-2'),
    work: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  };

  const service = new ReservationFinalizationService(
    db as never,
    tossClient as never,
    bookingService as never,
    { broadcastSeatUpdate: vi.fn() } as never,
    undefined,
    undefined,
    pgBoss as never,
  );

  return { service, state, calls, db, tossClient, bookingService, pgBoss };
}

describe('Payment confirm reconcile (#18)', () => {
  it('compensates an unrecorded PayPal approval once no client can finalize it, claiming the order first', async () => {
    const deps = createReconcile();

    await expect(deps.service.reconcileUnresolvedConfirm(paypalPayload(), NOW))
      .resolves.toEqual({ status: 'resolved', resolution: 'compensated' });

    expect(deps.tossClient.queryPayment).toHaveBeenCalledWith('payment-key-1', {});
    // The DONE/cancel_pending claim is written before the provider cancel.
    expect(deps.calls).toEqual(['claim:DONE', 'cancel']);
    expect(deps.tossClient.cancelPayment).toHaveBeenCalledWith(
      'payment-key-1',
      '결제 유효 시간 초과로 인한 자동 취소',
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(/^payment-confirm-reconcile-cancel:payment-key-1:/),
      }),
    );
    expect(deps.state.payment).toMatchObject({
      reservationId: 'reservation-1',
      paymentKey: 'payment-key-1',
      provider: 'PAYPAL',
      status: 'CANCELED',
      asyncStatus: 'compensation_cancelled',
      providerChargeCurrency: 'USD',
      providerChargeAmountMinor: 10800,
    });
    expect(deps.state.reservation?.status).toBe('FAILED');
    expect(deps.state.diagnostics).toEqual([expect.objectContaining({
      paymentId: 'claim-1',
      diagnosticCode: 'CONFIRM_APPROVAL_COMPENSATED',
      diagnosticSource: 'payment_confirm_reconcile',
    })]);
    expect(deps.bookingService.acquirePaymentConfirmLock).toHaveBeenCalledWith('order-1', expect.any(String));
    expect(deps.bookingService.releasePaymentConfirmLock).toHaveBeenCalledOnce();
  });

  it('only waits, without a provider call, while a client confirm can still finalize the order', async () => {
    const admissionEnd = new Date(NOW.getTime() + 4 * MINUTE);
    const paymentDeadline = new Date(NOW.getTime() + 5 * MINUTE);
    const deps = createReconcile({
      reservation: { admissionActiveUntilAt: admissionEnd, paymentDeadlineAt: paymentDeadline },
    });

    await expect(deps.service.reconcileUnresolvedConfirm(paypalPayload(), NOW)).resolves.toEqual({
      status: 'retry',
      reason: 'awaiting_client_window',
      // The later of both windows (deadline + one confirm lock TTL) + margin.
      retryAt: new Date(paymentDeadline.getTime() + 60_000 + 30_000),
    });
    expect(deps.tossClient.queryPayment).not.toHaveBeenCalled();
    expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
    expect(deps.state.payment).toBeNull();
  });

  it('never cancels a payment the order is already recorded with', async () => {
    const deps = createReconcile({
      reservation: { status: 'CONFIRMED' },
      payment: {
        id: 'payment-1',
        reservationId: 'reservation-1',
        paymentKey: 'payment-key-1',
        status: 'DONE',
        asyncStatus: 'sync',
      },
    });

    await expect(deps.service.reconcileUnresolvedConfirm(paypalPayload(), NOW))
      .resolves.toEqual({ status: 'resolved', resolution: 'recorded' });
    expect(deps.tossClient.queryPayment).not.toHaveBeenCalled();
    expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
  });

  it('does not cancel when another finalizer recorded the order between the read and the claim', async () => {
    const deps = createReconcile({
      onClaim: (state) => {
        // A stale confirm commits the same approval first (payments.reservation_id is unique).
        state.payment ??= {
          id: 'payment-1',
          reservationId: 'reservation-1',
          paymentKey: 'payment-key-1',
          status: 'DONE',
          asyncStatus: 'sync',
        };
        state.reservation = { ...state.reservation!, status: 'CONFIRMED' };
      },
    });

    await expect(deps.service.reconcileUnresolvedConfirm(paypalPayload(), NOW))
      .resolves.toEqual({ status: 'resolved', resolution: 'recorded' });
    expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
    expect(deps.state.payment).toMatchObject({ id: 'payment-1', status: 'DONE', asyncStatus: 'sync' });
  });

  it('cancels only this approval when the order is committed with another paymentKey', async () => {
    const committed: PaymentRow = {
      id: 'payment-other',
      reservationId: 'reservation-1',
      paymentKey: 'payment-key-other',
      status: 'DONE',
      asyncStatus: 'sync',
    };
    const deps = createReconcile({ reservation: { status: 'CONFIRMED' }, payment: { ...committed } });

    await expect(deps.service.reconcileUnresolvedConfirm(paypalPayload(), NOW))
      .resolves.toEqual({ status: 'resolved', resolution: 'duplicate_cancelled' });
    expect(deps.tossClient.cancelPayment).toHaveBeenCalledOnce();
    expect(deps.tossClient.cancelPayment).toHaveBeenCalledWith(
      'payment-key-1',
      '중복 결제로 인한 자동 취소',
      expect.anything(),
    );
    expect(deps.state.payment).toEqual(committed);
    expect(deps.db.transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['a network failure', () => Promise.reject(new TossPaymentError('NETWORK_ERROR', 'down'))],
    ['a malformed body', () => Promise.resolve({ status: 'DONE' })],
  ])('retries with backoff and never cancels after %s on lookup', async (_label, lookup) => {
    const deps = createReconcile();
    deps.tossClient.queryPayment.mockImplementation(lookup);

    await expect(deps.service.reconcileUnresolvedConfirm(paypalPayload({ attempt: 2 }), NOW))
      .resolves.toEqual({
        status: 'retry',
        reason: 'provider_lookup_failed',
        retryAt: new Date(NOW.getTime() + 4 * MINUTE),
      });
    expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
    expect(deps.state.payment).toBeNull();
  });

  it('waits for a cancel already in progress instead of sending another', async () => {
    const deps = createReconcile();
    deps.tossClient.queryPayment.mockResolvedValue(paypalApproval({
      cancels: [{ cancelStatus: 'IN_PROGRESS', cancelAmount: 108 }],
    }));

    await expect(deps.service.reconcileUnresolvedConfirm(paypalPayload(), NOW))
      .resolves.toMatchObject({ status: 'retry', reason: 'provider_cancel_in_progress' });
    expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
  });

  it('retries without any provider call while the confirm lease is busy', async () => {
    const deps = createReconcile();
    deps.bookingService.acquirePaymentConfirmLock.mockResolvedValue(false);

    await expect(deps.service.reconcileUnresolvedConfirm(paypalPayload(), NOW)).resolves.toEqual({
      status: 'retry',
      reason: 'confirm_lease_busy',
      retryAt: new Date(NOW.getTime() + 30_000),
    });
    expect(deps.tossClient.queryPayment).not.toHaveBeenCalled();
    expect(deps.bookingService.releasePaymentConfirmLock).not.toHaveBeenCalled();
  });

  it('stops before the claim and the cancel when the lease is lost', async () => {
    const deps = createReconcile();
    deps.bookingService.refreshPaymentConfirmLock.mockResolvedValue(false);

    await expect(deps.service.reconcileUnresolvedConfirm(paypalPayload(), NOW))
      .resolves.toMatchObject({ status: 'retry', reason: 'confirm_lease_lost' });
    expect(deps.calls).toEqual([]);
    expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
  });

  it('records a provider-proven EXPIRED payment like the terminal webhook', async () => {
    const deps = createReconcile();
    deps.tossClient.queryPayment.mockResolvedValue(paypalApproval({ status: 'EXPIRED' }));

    await expect(deps.service.reconcileUnresolvedConfirm(paypalPayload(), NOW))
      .resolves.toEqual({ status: 'resolved', resolution: 'not_approved' });
    expect(deps.state.payment).toMatchObject({ status: 'EXPIRED', asyncStatus: 'confirm_rejected' });
    expect(deps.state.reservation?.status).toBe('FAILED');
    expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
  });

  it('keeps retrying while the provider payment is still in progress', async () => {
    const deps = createReconcile();
    deps.tossClient.queryPayment.mockResolvedValue(paypalApproval({ status: 'IN_PROGRESS' }));

    await expect(deps.service.reconcileUnresolvedConfirm(paypalPayload(), NOW))
      .resolves.toMatchObject({ status: 'retry', reason: 'provider_in_progress' });
    expect(deps.state.payment).toBeNull();
  });

  it('keeps the claim cancel_pending when the provider accepts the cancel asynchronously', async () => {
    const deps = createReconcile();
    deps.tossClient.cancelPayment.mockResolvedValue(paypalApproval({
      cancels: [{ cancelStatus: 'IN_PROGRESS' }],
    }));

    await expect(deps.service.reconcileUnresolvedConfirm(paypalPayload(), NOW))
      .resolves.toMatchObject({ status: 'retry', reason: 'compensation_cancel_pending' });
    expect(deps.state.payment).toMatchObject({ status: 'DONE', asyncStatus: 'cancel_pending' });
    expect(deps.state.reservation?.status).toBe('PENDING_PAYMENT');
  });

  describe('a claimed compensation (DONE/cancel_pending row)', () => {
    const claimed = (): PaymentRow => ({
      id: 'claim-1',
      reservationId: 'reservation-1',
      paymentKey: 'payment-key-1',
      tossOrderId: 'order-1',
      method: '해외간편결제',
      provider: 'PAYPAL',
      currency: 'KRW',
      amount: 150000,
      status: 'DONE',
      asyncStatus: 'cancel_pending',
      cancelReason: '좌석 점유 만료로 인한 자동 취소',
      providerChargeCurrency: 'USD',
      providerChargeAmountMinor: 10800,
      providerMetadata: { confirmCompensationClaim: true },
    });

    it('records the cancel the provider already completed without cancelling again', async () => {
      const deps = createReconcile({ payment: claimed() });
      deps.tossClient.queryPayment.mockResolvedValue(paypalApproval({ status: 'CANCELED' }));

      await expect(deps.service.reconcileUnresolvedConfirm(paypalPayload(), NOW))
        .resolves.toEqual({ status: 'resolved', resolution: 'compensated' });
      expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
      expect(deps.state.payment).toMatchObject({ status: 'CANCELED', asyncStatus: 'compensation_cancelled' });
      expect(deps.state.reservation?.status).toBe('FAILED');
    });

    it('cancels a still approved payment with the claimed reason and records it', async () => {
      const deps = createReconcile({ payment: claimed() });

      await expect(deps.service.reconcileUnresolvedConfirm(paypalPayload(), NOW))
        .resolves.toEqual({ status: 'resolved', resolution: 'compensated' });
      expect(deps.tossClient.cancelPayment).toHaveBeenCalledWith(
        'payment-key-1',
        '좌석 점유 만료로 인한 자동 취소',
        expect.anything(),
      );
      expect(deps.state.payment).toMatchObject({ status: 'CANCELED', asyncStatus: 'compensation_cancelled' });
    });

    it('never touches a claimed row of a confirmed reservation', async () => {
      const deps = createReconcile({ reservation: { status: 'CONFIRMED' }, payment: claimed() });

      await expect(deps.service.reconcileUnresolvedConfirm(paypalPayload(), NOW))
        .resolves.toEqual({ status: 'resolved', resolution: 'recorded' });
      expect(deps.tossClient.queryPayment).not.toHaveBeenCalled();
      expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
    });
  });

  describe('compensation ownership (pay-server-3, D9)', () => {
    const asyncDoneRecord = {
      version: 1,
      kind: 'seat_conflict',
      paymentKey: 'payment-key-1',
      reason: '판매 불가능 좌석으로 인한 자동 취소',
      payment: { method: 'FOREIGN_EASY_PAY', provider: 'ALIPAY_PLUS', currency: 'KRW', amount: 150000, secretKeyScope: 'foreign-easy-pay' },
      cancelRequest: { paymentKey: 'payment-key-1', reason: 'x', options: { cancelRequestId: 'cancel_reservation-1' } },
      cancelRequestIds: ['cancel_reservation-1'],
      attempts: 1,
      state: 'pending',
      requestedAt: '2026-10-02T09:00:00.000Z',
      lastAttemptAt: '2026-10-02T09:00:00.000Z',
    };
    const asyncDoneOwned = (providerMetadata: Record<string, unknown> | null): PaymentRow => ({
      id: 'payment-async-1',
      reservationId: 'reservation-1',
      paymentKey: 'payment-key-1',
      tossOrderId: 'order-1',
      method: 'FOREIGN_EASY_PAY',
      provider: 'ALIPAY_PLUS',
      currency: 'KRW',
      amount: 150000,
      status: 'DONE',
      asyncStatus: 'cancel_pending',
      cancelReason: '판매 불가능 좌석으로 인한 자동 취소',
      providerMetadata,
    });

    it.each([
      ['its own async DONE compensation record', { asyncDoneCompensation: asyncDoneRecord, asyncDoneCompensationOpen: true }],
      ['a claim marker next to an async DONE record', { confirmCompensationClaim: true, asyncDoneCompensation: asyncDoneRecord }],
      ['no ownership marker (legacy)', null],
    ])('leaves a cancel_pending row with %s to the async DONE recovery', async (_label, metadata) => {
      const deps = createReconcile({ payment: asyncDoneOwned(metadata) });

      await expect(deps.service.reconcileUnresolvedConfirm(paypalPayload(), NOW))
        .resolves.toEqual({ status: 'resolved', resolution: 'async_compensation_owned' });
      expect(deps.tossClient.queryPayment).not.toHaveBeenCalled();
      expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
      expect(deps.state.diagnostics).toEqual([]);
      expect(deps.state.payment).toMatchObject({ status: 'DONE', asyncStatus: 'cancel_pending' });
    });

    it('keeps the diagnostic the async DONE recovery recorded after it converged the row first', async () => {
      const deps = createReconcile({
        reservation: { status: 'FAILED' },
        payment: {
          ...asyncDoneOwned({ asyncDoneCompensation: { ...asyncDoneRecord, state: 'cancelled' } }),
          status: 'CANCELED',
          asyncStatus: 'compensation_cancelled',
        },
      });

      await expect(deps.service.reconcileUnresolvedConfirm(paypalPayload(), NOW))
        .resolves.toEqual({ status: 'resolved', resolution: 'recorded' });
      expect(deps.tossClient.queryPayment).not.toHaveBeenCalled();
      expect(deps.tossClient.cancelPayment).not.toHaveBeenCalled();
      expect(deps.state.diagnostics).toEqual([]);
    });

    it('records nothing when a provider-completed cancel finds its claim already adopted elsewhere', async () => {
      const deps = createReconcile({
        payment: { ...asyncDoneOwned({ confirmCompensationClaim: true }), id: 'claim-1' },
      });
      deps.tossClient.queryPayment.mockImplementation(async () => {
        // Between the read and the record the row gains an async DONE record.
        deps.state.payment = {
          ...deps.state.payment!,
          providerMetadata: { confirmCompensationClaim: true, asyncDoneCompensation: asyncDoneRecord },
        };
        return paypalApproval({ status: 'CANCELED' });
      });

      await deps.service.reconcileUnresolvedConfirm(paypalPayload(), NOW);

      expect(deps.state.payment).toMatchObject({ status: 'DONE', asyncStatus: 'cancel_pending' });
      expect(deps.state.reservation?.status).toBe('PENDING_PAYMENT');
      expect(deps.state.diagnostics).toEqual([]);
    });
  });

  describe('job runner', () => {
    // The runner uses the real clock.
    const endedWindows = () => ({
      admissionActiveUntilAt: new Date(Date.now() - 5 * MINUTE),
      paymentDeadlineAt: new Date(Date.now() - 5 * MINUTE),
    });

    it('reschedules itself with the next attempt at the retry time', async () => {
      const deps = createReconcile({
        reservation: { admissionActiveUntilAt: new Date(Date.now() + 5 * MINUTE) },
      });

      const outcome = await deps.service.runPaymentConfirmReconcileJob(paypalPayload({ attempt: 0 }));

      expect(outcome).toMatchObject({ status: 'retry', reason: 'awaiting_client_window' });
      expect(deps.pgBoss.createQueue).toHaveBeenCalledWith(PAYMENT_CONFIRM_RECONCILE_JOB, { policy: 'short' });
      expect(deps.pgBoss.send).toHaveBeenCalledWith(
        PAYMENT_CONFIRM_RECONCILE_JOB,
        expect.objectContaining({ attempt: 1, orderId: 'order-1', paymentKey: 'payment-key-1' }),
        expect.objectContaining({
          singletonKey: 'order-1:payment-key-1',
          startAfter: outcome.status === 'retry' ? outcome.retryAt : undefined,
        }),
      );
    });

    it('stops at the attempt limit for manual reconciliation', async () => {
      const deps = createReconcile({ reservation: endedWindows() });
      deps.tossClient.queryPayment.mockRejectedValue(new TossPaymentError('NETWORK_ERROR', 'down'));

      await expect(deps.service.runPaymentConfirmReconcileJob(
        paypalPayload({ attempt: PAYMENT_CONFIRM_RECONCILE_MAX_ATTEMPTS - 1 }),
      )).resolves.toMatchObject({ status: 'retry', reason: 'provider_lookup_failed' });
      expect(deps.pgBoss.send).not.toHaveBeenCalled();
    });

    it('fails the job so pg-boss retries it when the next attempt cannot be scheduled', async () => {
      const deps = createReconcile({ reservation: endedWindows() });
      deps.tossClient.queryPayment.mockRejectedValue(new TossPaymentError('NETWORK_ERROR', 'down'));
      deps.pgBoss.send.mockRejectedValue(new Error('pg-boss down'));

      await expect(deps.service.runPaymentConfirmReconcileJob(paypalPayload()))
        .rejects.toThrow('could not be rescheduled');
    });

    it('does not reschedule a resolved order', async () => {
      const deps = createReconcile({ reservation: endedWindows() });

      await expect(deps.service.runPaymentConfirmReconcileJob(paypalPayload()))
        .resolves.toEqual({ status: 'resolved', resolution: 'compensated' });
      expect(deps.pgBoss.send).not.toHaveBeenCalled();
    });
  });
});

describe('PaymentConfirmReconcileWorker', () => {
  function worker(processesJobs: boolean) {
    const finalizationService = {
      ensurePaymentConfirmReconcileQueue: vi.fn().mockResolvedValue(undefined),
      runPaymentConfirmReconcileJob: vi.fn().mockResolvedValue({ status: 'resolved', resolution: 'recorded' }),
    };
    const pgBoss = {
      isAvailable: true,
      processesJobs,
      work: vi.fn().mockResolvedValue('worker-1'),
    };
    return {
      finalizationService,
      pgBoss,
      worker: new PaymentConfirmReconcileWorker(finalizationService as never, pgBoss as never),
    };
  }

  it('creates the queue and processes jobs where pg-boss processes jobs', async () => {
    const { worker: instance, finalizationService, pgBoss } = worker(true);

    await instance.onModuleInit();

    expect(finalizationService.ensurePaymentConfirmReconcileQueue).toHaveBeenCalledOnce();
    expect(pgBoss.work).toHaveBeenCalledWith(PAYMENT_CONFIRM_RECONCILE_JOB, expect.any(Function));
    const handler = pgBoss.work.mock.calls[0]![1] as (jobs: Array<{ data: unknown }>) => Promise<void>;
    await handler([{ data: paypalPayload() }]);
    expect(finalizationService.runPaymentConfirmReconcileJob).toHaveBeenCalledWith(paypalPayload());
  });

  it('only creates the queue in a producer-only API (BACKGROUND_PROCESSING_ENABLED=false)', async () => {
    const { worker: instance, finalizationService, pgBoss } = worker(false);

    await instance.onModuleInit();

    expect(finalizationService.ensurePaymentConfirmReconcileQueue).toHaveBeenCalledOnce();
    expect(pgBoss.work).not.toHaveBeenCalled();
  });
});
