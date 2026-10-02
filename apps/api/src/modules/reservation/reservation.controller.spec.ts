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

describe('ReservationController booking actor forwarding', () => {
  const scannerUser = {
    id: 'scanner-1',
    role: 'admin',
    adminCapabilityBundle: 'scanner',
    adminCapabilities: [],
    isEmailVerified: true,
    isPhoneVerified: true,
  };

  it('forwards capability claims and the display locale to payment confirm (audit #25, #88)', async () => {
    const service = { confirmAndCreateReservation: vi.fn().mockResolvedValue({ id: 'reservation-1' }) };
    const controller = new ReservationController(service as never, {} as never);
    const body = { paymentKey: 'pk', orderId: 'GRP-1', amount: 52000 };

    await controller.confirmPayment(body, { user: scannerUser }, 'th');

    expect(service.confirmAndCreateReservation).toHaveBeenCalledWith(body, scannerUser, 'th');
  });

  it('forwards capability claims to reservation prepare so restricted admins cannot bypass sales gates (audit #25)', async () => {
    const service = {
      prepareReservation: vi.fn().mockResolvedValue({ queueAdmission: { admissionToken: 'raw' } }),
    };
    const controller = new ReservationController(service as never, {} as never);
    const queueAdmission = {
      queueSessionId: 'queue-session-1',
      admissionToken: 'raw-admission-token',
      refreshFamilyId: 'family-1',
      deviceSlotKey: 'device-1',
      admittedAt: '2026-10-02T00:00:00.000Z',
      activeUntilAt: '2026-10-02T00:10:00.000Z',
      reentryGraceUntilAt: '2026-10-02T00:13:00.000Z',
    };
    const request = {
      user: scannerUser, queueAdmission, headers: {}, ip: '203.0.113.1', socket: {}, get: () => undefined,
    };

    const result = await controller.prepareReservation({} as never, request as never);

    expect(service.prepareReservation.mock.calls[0]?.[1]).toEqual(scannerUser);
    expect(result.queueAdmission.admissionToken).toBe('cookie-bound');
  });
});
