import { describe, expect, it } from 'vitest';
import {
  TICKET_SERVICE_FEE_KRW,
  ticketItemSchema,
  ticketItemCancellationSchema,
  ticketItemCancellationPreviewSchema,
  ticketItemQrCredentialSchema,
} from './ticket-item.schema';

describe('ticket item shared contracts', () => {
  it('defines fixed per-ticket service fee', () => {
    expect(TICKET_SERVICE_FEE_KRW).toBe(2000);
  });

  it('validates a seat-level ticket item with its own QR credential', () => {
    const parsed = ticketItemSchema.parse({
      id: '00000000-0000-4000-8000-000000000101',
      reservationId: '00000000-0000-4000-8000-000000000001',
      paymentId: '00000000-0000-4000-8000-000000000002',
      showtimeId: '00000000-0000-4000-8000-000000000003',
      seatId: 'A-1',
      seatKey: '1F:A-1',
      floorKey: '1F',
      floorLabel: '1층',
      row: 'A',
      number: '1',
      tierName: 'VIP',
      price: 100000,
      serviceFee: 2000,
      status: 'ACTIVE',
      admissionState: 'NOT_ENTERED',
      enteredAt: null,
      qrCredential: {
        id: '00000000-0000-4000-8000-000000000201',
        token: 'signed-token',
        jti: 'qr-jti-seat-a1',
        status: 'ACTIVE',
        issuedAt: '2026-07-01T00:00:00.000Z',
        rotatedAt: null,
        revokedAt: null,
      },
      cancellation: null,
    });

    expect(parsed.seatKey).toBe('1F:A-1');
    expect(parsed.qrCredential?.jti).toBe('qr-jti-seat-a1');
  });

  it('allows zero service fee for migrated legacy pre-policy ticket items', () => {
    const parsed = ticketItemSchema.parse({
      id: '00000000-0000-4000-8000-000000000102',
      reservationId: '00000000-0000-4000-8000-000000000001',
      paymentId: '00000000-0000-4000-8000-000000000002',
      showtimeId: '00000000-0000-4000-8000-000000000003',
      seatId: 'A-1',
      seatKey: '1F:A-1',
      floorKey: '1F',
      floorLabel: '1층',
      row: 'A',
      number: '1',
      tierName: 'VIP',
      price: 100000,
      serviceFee: 0,
      status: 'ACTIVE',
      admissionState: 'NOT_ENTERED',
      enteredAt: null,
      qrCredential: null,
      cancellation: null,
      isLegacyFallback: true,
    });

    expect(parsed.serviceFee).toBe(0);
    expect(parsed.isLegacyFallback).toBe(true);
  });

  it('accepts cancellation pending as a seat-level ticket item status', () => {
    const parsed = ticketItemSchema.parse({
      id: '00000000-0000-4000-8000-000000000103',
      reservationId: '00000000-0000-4000-8000-000000000001',
      paymentId: '00000000-0000-4000-8000-000000000002',
      showtimeId: '00000000-0000-4000-8000-000000000003',
      seatId: 'A-1',
      seatKey: '1F:A-1',
      floorKey: '1F',
      floorLabel: '1층',
      row: 'A',
      number: '1',
      tierName: 'VIP',
      price: 100000,
      serviceFee: 2000,
      status: 'CANCELLATION_PENDING',
      admissionState: 'NOT_ENTERED',
      enteredAt: null,
      qrCredential: null,
      cancellation: null,
    });

    expect(parsed.status).toBe('CANCELLATION_PENDING');
  });


  it('rejects ticket items without an explicit enteredAt field', () => {
    expect(() =>
      ticketItemSchema.parse({
        id: '00000000-0000-4000-8000-000000000101',
        reservationId: '00000000-0000-4000-8000-000000000001',
        paymentId: '00000000-0000-4000-8000-000000000002',
        showtimeId: '00000000-0000-4000-8000-000000000003',
        seatId: '1F:A-1',
        seatKey: '1F:A-1',
        floorKey: '1F',
        floorLabel: '1층',
        row: 'A',
        number: '1',
        tierName: 'VIP',
        price: 100000,
        serviceFee: 2000,
        status: 'ACTIVE',
        admissionState: 'NOT_ENTERED',
        qrCredential: null,
        cancellation: null,
      }),
    ).toThrow();
  });

  it('validates per-ticket cancellation preview with NOL-style fees', () => {
    const parsed = ticketItemCancellationPreviewSchema.parse({
      ticketItemId: '00000000-0000-4000-8000-000000000101',
      ticketPrice: 100000,
      serviceFee: 2000,
      cancellationFee: 4000,
      serviceFeeRefund: 0,
      refundableAmount: 96000,
      policyCode: 'BOOKING_DAY_8_TO_SHOW_DAY_10',
    });

    expect(parsed.refundableAmount).toBe(96000);
  });

  it('validates a non-null ticket item cancellation contract', () => {
    const parsed = ticketItemCancellationSchema.parse({
      cancelledAt: '2026-07-02T09:00:00.000Z',
      cancelReason: 'Customer requested cancellation',
      cancellationFee: 4000,
      serviceFeeRefund: 0,
      refundableAmount: 96000,
      refundStatus: 'PROCESSING_AT_PG',
      reopenState: 'HELD_CANCELLED',
      reopenAt: null,
    });

    expect(parsed.refundStatus).toBe('PROCESSING_AT_PG');
    expect(parsed.reopenState).toBe('HELD_CANCELLED');
  });

  it('rejects QR credentials without a token', () => {
    expect(() =>
      ticketItemQrCredentialSchema.parse({
        id: '00000000-0000-4000-8000-000000000201',
        token: '',
        jti: 'qr-jti-seat-a1',
        status: 'ACTIVE',
        issuedAt: '2026-07-01T00:00:00.000Z',
      }),
    ).toThrow();
  });
});
