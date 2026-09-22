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

  it('routes whole-booking cancellation through the durable refund state machine', async () => {
    const refunds = { requestRefund: vi.fn().mockResolvedValue({ refundTimeline: { currentState: 'REQUESTED' } }) };
    const controller = new ReservationController({} as never, refunds as never);
    const body = { reason: '일정 변경', expectedRefundableAmount: 104000 };
    await controller.cancelReservation('reservation-1', body, { user: { id: 'user-1' } });
    expect(refunds.requestRefund).toHaveBeenCalledWith('reservation-1', 'user-1', body.reason, body);
  });
});
