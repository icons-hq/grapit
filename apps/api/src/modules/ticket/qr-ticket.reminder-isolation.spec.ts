import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { QrTicketService } from './qr-ticket.service.js';

/**
 * Audit #19: scheduling the D-1 reminder is a side effect of issuance. A
 * pg-boss failure must not fail QR issuance or the buyer's QR lookup.
 */

function chainResult<T>(rows: T[]) {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (value: T[]) => void) => resolve(rows);
      }
      return () => new Proxy({}, handler);
    },
  };
  return new Proxy({}, handler);
}

const seatIdentity = {
  seatId: 'A-1',
  seatKey: '1F:A-1',
  floorKey: '1F',
  floorLabel: '1층',
  row: 'A',
  number: '1',
  tierName: 'VIP',
};

function ticketRecord() {
  return {
    id: 'ticket-1',
    reservationId: 'reservation-1',
    paymentId: 'payment-1',
    showtimeId: 'showtime-1',
    ticketItemId: 'ticket-item-1',
    qrTokenJti: 'qr-jti-1',
    secretVersion: '2026-07',
    status: 'active',
    issuedAt: new Date('2026-07-10T09:00:00.000Z'),
    expiresAt: null,
    usedAt: null,
    revokedAt: null,
    emailScheduledAt: new Date('2026-07-17T11:00:00.000Z'),
    emailSentAt: null,
    emailJobId: null,
  };
}

describe('QrTicketService reminder scheduling isolation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T09:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns issued QR tickets when the reminder job cannot be scheduled', async () => {
    const db = {
      select: vi.fn()
        .mockReturnValueOnce(chainResult([{
          reservationId: 'reservation-1',
          paymentId: 'payment-1',
          paymentStatus: 'DONE',
          showtimeId: 'showtime-1',
          showtimeAt: new Date('2026-07-18T11:00:00.000Z'),
          ticketItem: { id: 'ticket-item-1', ...seatIdentity },
        }]))
        .mockReturnValueOnce(chainResult([]))
        .mockReturnValueOnce(chainResult([{ ...ticketRecord(), ...seatIdentity }])),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([ticketRecord()]),
        }),
      }),
      update: vi.fn(),
    };
    const pgBoss = {
      isAvailable: true,
      send: vi.fn().mockRejectedValue(new Error('timeout exceeded when trying to connect')),
      work: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const service = new QrTicketService(
      db as never,
      {
        get: vi.fn((key: string) => {
          if (key === 'QR_TICKET_SECRET') return 'current-secret';
          if (key === 'QR_TICKET_SECRET_VERSION') return '2026-07';
          return undefined;
        }),
      } as never,
      new JwtService(),
      { sendQrTicketReminderEmail: vi.fn() } as never,
      pgBoss as never,
    );

    const tickets = await service.ensureIssuedTicketsForReservation({
      reservationId: 'reservation-1',
      paymentId: 'payment-1',
    });

    expect(tickets).toHaveLength(1);
    expect(tickets[0]?.ticketItemId).toBe('ticket-item-1');
    expect(pgBoss.send).toHaveBeenCalledOnce();
    // No emailJobId was stored, so the next lookup schedules it again.
    expect(db.update).not.toHaveBeenCalled();
  });
});
