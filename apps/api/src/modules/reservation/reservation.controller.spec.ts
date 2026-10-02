import { describe, expect, it, vi } from 'vitest';
import { ReservationController } from './reservation.controller.js';

describe('ReservationController cancellation routes', () => {
  it('passes selected-seat ownership and reviewed amounts to the cancellation service', async () => {
    const service = { cancelTicketItem: vi.fn().mockResolvedValue({ status: 'CONFIRMED' }) };
    const controller = new ReservationController(service as never, {} as never);
    const body = { reason: '일정 변경', expectedRefundableAmount: 52000, expectedProviderRefundAmountMinor: 3536 };
    await expect(controller.cancelTicketItem('reservation-1', 'ticket-item-1', body, { user: { id: 'user-1' } }))
      .resolves.toEqual({ status: 'CONFIRMED' });
    expect(service.cancelTicketItem).toHaveBeenCalledWith('reservation-1', 'ticket-item-1', 'user-1', body.reason, body);
  });

  it('returns the queue slot right after a confirmed payment', async () => {
    const detail = { id: 'reservation-1', status: 'CONFIRMED' };
    const service = { confirmAndCreateReservation: vi.fn().mockResolvedValue(detail) };
    const queue = { releaseAdmissionAfterPurchase: vi.fn().mockResolvedValue(true) };
    const controller = new ReservationController(service as never, {} as never, queue as never);

    await expect(controller.confirmPayment(
      { orderId: 'ORDER-1', paymentKey: 'pk', amount: 1000 } as never,
      { user: { id: 'user-1' }, queueAdmission: { queueSessionId: 'queue-session-1' } },
    )).resolves.toBe(detail);

    expect(queue.releaseAdmissionAfterPurchase).toHaveBeenCalledWith('queue-session-1');
    expect(service.confirmAndCreateReservation.mock.invocationCallOrder[0])
      .toBeLessThan(queue.releaseAdmissionAfterPurchase.mock.invocationCallOrder[0]!);
  });

  it('keeps the queue slot when the confirm result is not a confirmed reservation', async () => {
    const detail = { id: 'reservation-1', status: 'PENDING_PAYMENT' };
    const service = { confirmAndCreateReservation: vi.fn().mockResolvedValue(detail) };
    const queue = { releaseAdmissionAfterPurchase: vi.fn().mockResolvedValue(true) };
    const controller = new ReservationController(service as never, {} as never, queue as never);

    await expect(controller.confirmPayment(
      { orderId: 'ORDER-1', paymentKey: 'pk', amount: 1000 } as never,
      { user: { id: 'user-1' }, queueAdmission: { queueSessionId: 'queue-session-1' } },
    )).resolves.toBe(detail);
    expect(queue.releaseAdmissionAfterPurchase).not.toHaveBeenCalled();
  });

  it('keeps the queue slot when payment confirm fails', async () => {
    const service = {
      confirmAndCreateReservation: vi.fn().mockRejectedValue(new Error('좌석 점유 시간이 만료되었습니다')),
    };
    const queue = { releaseAdmissionAfterPurchase: vi.fn().mockResolvedValue(true) };
    const controller = new ReservationController(service as never, {} as never, queue as never);

    await expect(controller.confirmPayment(
      { orderId: 'ORDER-1', paymentKey: 'pk', amount: 1000 } as never,
      { user: { id: 'user-1' }, queueAdmission: { queueSessionId: 'queue-session-1' } },
    )).rejects.toThrow('좌석 점유 시간이 만료되었습니다');
    expect(queue.releaseAdmissionAfterPurchase).not.toHaveBeenCalled();
  });

  it('never turns a confirmed purchase into an error when the slot release fails', async () => {
    const detail = { id: 'reservation-1', status: 'CONFIRMED' };
    const service = { confirmAndCreateReservation: vi.fn().mockResolvedValue(detail) };
    const queue = { releaseAdmissionAfterPurchase: vi.fn().mockRejectedValue(new Error('valkey down')) };
    const controller = new ReservationController(service as never, {} as never, queue as never);

    await expect(controller.confirmPayment(
      { orderId: 'ORDER-1', paymentKey: 'pk', amount: 1000 } as never,
      { user: { id: 'user-1' }, queueAdmission: { queueSessionId: 'queue-session-1' } },
    )).resolves.toBe(detail);
  });

  it('routes whole-booking cancellation through the durable refund state machine', async () => {
    const refunds = { requestRefund: vi.fn().mockResolvedValue({ refundTimeline: { currentState: 'REQUESTED' } }) };
    const controller = new ReservationController({} as never, refunds as never);
    const body = { reason: '일정 변경', expectedRefundableAmount: 104000 };
    await controller.cancelReservation('reservation-1', body, { user: { id: 'user-1' } });
    expect(refunds.requestRefund).toHaveBeenCalledWith('reservation-1', 'user-1', body.reason, body);
  });
});
