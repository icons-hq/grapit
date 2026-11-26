import { describe, expect, it, vi } from 'vitest';
import { ReservationController } from './reservation.controller.js';

describe('ReservationController cancellation routes', () => {
  it('retires both individual-seat routes without starting any refund', () => {
    const controller = new ReservationController({} as never, {} as never);
    for (const call of [() => controller.cancelTicketItem(), () => controller.getTicketItemRefundPreview()]) {
      expect(call).toThrow(expect.objectContaining({ status: 410, message: expect.stringContaining('예매 전체') }));
    }
  });

  it('forwards a full cancellation with its reviewed amount to the refund service', async () => {
    const requestRefund = vi.fn().mockResolvedValue({ status: 'CANCELLED' });
    const controller = new ReservationController({} as never, { requestRefund } as never);
    const body = { reason: '일정 변경', expectedRefundableAmount: 52000 };
    await controller.cancelReservation('booking', body, { user: { id: 'owner' } });
    expect(requestRefund).toHaveBeenCalledWith('booking', 'owner', body.reason, body);
  });

  it('confirms the authenticated buyer’s order even when the admission guard used another browser session', async () => {
    const receipt = { id: 'reservation-1', status: 'CONFIRMED' };
    const service = { confirmAndCreateReservation: vi.fn().mockResolvedValue(receipt) };
    const controller = new ReservationController(service as never, {} as never);
    const order = { orderId: 'ORDER-1', paymentKey: 'pk', amount: 1000 };
    const req = { user: { id: 'user-1' }, queueAdmission: { queueSessionId: 'browser-session' } };
    await expect(controller.confirmPayment(order, req)).resolves.toBe(receipt);
    expect(service.confirmAndCreateReservation).toHaveBeenCalledWith(order, expect.objectContaining({ id: 'user-1' }), undefined);
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

  it('binds a holder order to the server-resolved browser and the route ticket', async () => {
    const service = { prepareReservation: vi.fn().mockImplementation(async dto => dto) };
    const queue = { resolveBrowserIdentity: vi.fn().mockResolvedValue({ userId: scannerUser.id, refreshTokenFamilyId: 'verified-family', deviceSlotId: 'verified-device' }) };
    const controller = new ReservationController(service as never, {} as never, queue as never);
    const request = { user: scannerUser, cookies: {}, headers: {}, ip: '203.0.113.1', socket: {}, get: () => undefined };
    await controller.prepareTicketAddons('owned-ticket', { seats: [], queueAdmission: { deviceSlotKey: 'client-value' } } as never, request as never);
    expect(service.prepareReservation).toHaveBeenCalledWith(expect.objectContaining({
      addonTicketItemId: 'owned-ticket', seats: [], queueAdmission: expect.objectContaining({
        deviceSlotKey: 'verified-device', refreshFamilyId: 'verified-family', admissionToken: 'cookie-bound' }),
    }), scannerUser, expect.anything());
  });

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
