import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { QrTicketService } from './qr-ticket.service.js';

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

function createInsertResult<T>(rows: T[]) {
  return {
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue(rows),
    }),
  };
}

function createUpdateResult<T>(rows: T[]) {
  return {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(rows),
      }),
    }),
  };
}

function createTicketRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ticket-1',
    reservationId: 'reservation-1',
    paymentId: 'payment-1',
    showtimeId: 'showtime-1',
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
    ...overrides,
  };
}

function createVerifiableTicketRow(overrides: Record<string, unknown> = {}) {
  const { ticket, ...rowOverrides } = overrides;

  return {
    ticket: createTicketRecord(ticket as Record<string, unknown> | undefined),
    reservationStatus: 'CONFIRMED',
    paymentStatus: 'DONE',
    ...rowOverrides,
  };
}

describe('QrTicketService', () => {
  const now = new Date('2026-07-10T09:00:00.000Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('issues a QR ticket with the latest secretVersion and schedules the D-1 email resend', async () => {
    const mockDb = {
      select: vi
        .fn()
        .mockReturnValueOnce(chainResult([]))
        .mockReturnValueOnce(
          chainResult([
            {
              reservationId: 'reservation-1',
              paymentId: 'payment-1',
              showtimeId: 'showtime-1',
              showtimeAt: new Date('2026-07-18T11:00:00.000Z'),
            },
          ]),
        )
        .mockReturnValueOnce(chainResult([createVerifiableTicketRow()])),
      insert: vi.fn().mockReturnValue(
        createInsertResult([
          {
            id: 'ticket-1',
            reservationId: 'reservation-1',
            paymentId: 'payment-1',
            showtimeId: 'showtime-1',
            qrTokenJti: 'qr-jti-1',
            secretVersion: '2026-07',
            status: 'active',
            issuedAt: now,
            emailScheduledAt: new Date('2026-07-17T11:00:00.000Z'),
            emailSentAt: null,
            emailJobId: null,
          },
        ]),
      ),
      update: vi.fn().mockReturnValue(
        createUpdateResult([
          {
            id: 'ticket-1',
            reservationId: 'reservation-1',
            paymentId: 'payment-1',
            showtimeId: 'showtime-1',
            qrTokenJti: 'qr-jti-1',
            secretVersion: '2026-07',
            status: 'active',
            issuedAt: now,
            emailScheduledAt: new Date('2026-07-17T11:00:00.000Z'),
            emailSentAt: null,
            emailJobId: 'qr-email-job-1',
          },
        ]),
      ),
    };
    const configService = {
      get: vi.fn((key: string) => {
        if (key === 'QR_TICKET_SECRET') return 'current-secret';
        if (key === 'QR_TICKET_SECRET_VERSION') return '2026-07';
        if (key === 'QR_TICKET_SECRET_KEYRING_JSON') {
          return JSON.stringify({
            '2026-05': 'prior-secret',
            '2026-07': 'current-secret',
          });
        }

        return undefined;
      }),
    };
    const pgBoss = {
      isAvailable: true,
      send: vi.fn().mockResolvedValue('qr-email-job-1'),
      work: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };

    const service = new QrTicketService(
      mockDb as never,
      configService as never,
      new JwtService(),
      { sendQrTicketReminderEmail: vi.fn() } as never,
      pgBoss as never,
    );

    const ticket = await service.ensureIssuedTicketForReservation({
      reservationId: 'reservation-1',
      paymentId: 'payment-1',
    });

    expect(ticket.status).toBe('ACTIVE');
    expect(ticket.emailScheduledAt).toBe('2026-07-17T11:00:00.000Z');
    expect(pgBoss.send).toHaveBeenCalledWith(
      'qr-ticket-email-resend',
      {
        ticketId: 'ticket-1',
        reservationId: 'reservation-1',
      },
      expect.objectContaining({
        singletonKey: 'ticket-1',
        startAfter: new Date('2026-07-17T11:00:00.000Z'),
      }),
    );

    const verified = await service.verifyTicketToken(ticket.token);
    expect(verified.secretVersion).toBe('2026-07');
    expect(verified.jti).toBe('qr-jti-1');
    expect(verified.reservationId).toBe('reservation-1');
  });

  it('consumes pg-boss batch payloads when the QR email worker runs', async () => {
    const pgBoss = {
      isAvailable: true,
      send: vi.fn(),
      work: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
    };
    const service = new QrTicketService(
      {} as never,
      { get: vi.fn() } as never,
      new JwtService(),
      { sendQrTicketReminderEmail: vi.fn() } as never,
      pgBoss as never,
    );
    const handleReminderSpy = vi
      .spyOn(service as never, 'handleReminderEmailJob')
      .mockResolvedValue(undefined as never);
    const payload = {
      ticketId: 'ticket-1',
      reservationId: 'reservation-1',
    };

    await service.onModuleInit();
    const handler = pgBoss.work.mock.calls[0]?.[1] as (
      jobs: Array<{ data: typeof payload }>,
    ) => Promise<void>;
    await handler([{ data: payload }]);

    expect(pgBoss.work).toHaveBeenCalledWith('qr-ticket-email-resend', expect.any(Function));
    expect(handleReminderSpy).toHaveBeenCalledWith(payload);
  });

  it('verifies a previously issued token via QR_TICKET_SECRET_KEYRING_JSON lookup', async () => {
    const configService = {
      get: vi.fn((key: string) => {
        if (key === 'QR_TICKET_SECRET') return 'current-secret';
        if (key === 'QR_TICKET_SECRET_VERSION') return '2026-07';
        if (key === 'QR_TICKET_SECRET_KEYRING_JSON') {
          return JSON.stringify({
            '2026-05': 'prior-secret',
            '2026-07': 'current-secret',
          });
        }

        return undefined;
      }),
    };
    const jwtService = new JwtService();
    const token = await jwtService.signAsync(
      {
        type: 'qr-ticket',
        jti: 'qr-jti-prior',
        reservationId: 'reservation-legacy',
        paymentId: 'payment-legacy',
        showtimeId: 'showtime-legacy',
        secretVersion: '2026-05',
        issuedAt: '2026-05-01T00:00:00.000Z',
      },
      {
        secret: 'prior-secret',
        algorithm: 'HS256',
        noTimestamp: true,
      },
    );

    const service = new QrTicketService(
      {
        select: vi.fn().mockReturnValue(chainResult([
          createVerifiableTicketRow({
            ticket: {
              id: 'ticket-legacy',
              reservationId: 'reservation-legacy',
              paymentId: 'payment-legacy',
              showtimeId: 'showtime-legacy',
              qrTokenJti: 'qr-jti-prior',
              secretVersion: '2026-05',
              issuedAt: new Date('2026-05-01T00:00:00.000Z'),
            },
          }),
        ])),
        insert: vi.fn(),
        update: vi.fn(),
      } as never,
      configService as never,
      jwtService,
      { sendQrTicketReminderEmail: vi.fn() } as never,
      {
        isAvailable: false,
        send: vi.fn(),
        work: vi.fn(),
        stop: vi.fn(),
      } as never,
    );

    const verified = await service.verifyTicketToken(token);

    expect(verified.secretVersion).toBe('2026-05');
    expect(verified.jti).toBe('qr-jti-prior');
    expect(verified.paymentId).toBe('payment-legacy');
  });

  it('rejects signed QR tokens when the persisted ticket is used, revoked, or expired', async () => {
    const configService = {
      get: vi.fn((key: string) => {
        if (key === 'QR_TICKET_SECRET') return 'current-secret';
        if (key === 'QR_TICKET_SECRET_VERSION') return '2026-07';
        if (key === 'QR_TICKET_SECRET_KEYRING_JSON') {
          return JSON.stringify({ '2026-07': 'current-secret' });
        }

        return undefined;
      }),
    };
    const jwtService = new JwtService();
    const token = await jwtService.signAsync(
      {
        type: 'qr-ticket',
        jti: 'qr-jti-1',
        reservationId: 'reservation-1',
        paymentId: 'payment-1',
        showtimeId: 'showtime-1',
        secretVersion: '2026-07',
        issuedAt: now.toISOString(),
      },
      {
        secret: 'current-secret',
        algorithm: 'HS256',
        noTimestamp: true,
      },
    );

    const invalidRows = [
      createVerifiableTicketRow({ ticket: { status: 'revoked' } }),
      createVerifiableTicketRow({ ticket: { usedAt: new Date('2026-07-10T09:00:00.000Z') } }),
      createVerifiableTicketRow({ ticket: { expiresAt: new Date('2026-07-10T08:59:59.000Z') } }),
    ];

    for (const ticketRecord of invalidRows) {
      const service = new QrTicketService(
        { select: vi.fn().mockReturnValue(chainResult([ticketRecord])) } as never,
        configService as never,
        jwtService,
        { sendQrTicketReminderEmail: vi.fn() } as never,
        {
          isAvailable: false,
          send: vi.fn(),
          work: vi.fn(),
          stop: vi.fn(),
        } as never,
      );

      await expect(service.verifyTicketToken(token)).rejects.toThrow(
        '사용할 수 없는 QR 티켓입니다',
      );
    }
  });

  it('rejects active QR tokens after reservation cancellation or payment cancellation', async () => {
    const configService = {
      get: vi.fn((key: string) => {
        if (key === 'QR_TICKET_SECRET') return 'current-secret';
        if (key === 'QR_TICKET_SECRET_VERSION') return '2026-07';
        if (key === 'QR_TICKET_SECRET_KEYRING_JSON') {
          return JSON.stringify({ '2026-07': 'current-secret' });
        }

        return undefined;
      }),
    };
    const jwtService = new JwtService();
    const token = await jwtService.signAsync(
      {
        type: 'qr-ticket',
        jti: 'qr-jti-1',
        reservationId: 'reservation-1',
        paymentId: 'payment-1',
        showtimeId: 'showtime-1',
        secretVersion: '2026-07',
        issuedAt: now.toISOString(),
      },
      {
        secret: 'current-secret',
        algorithm: 'HS256',
        noTimestamp: true,
      },
    );

    const invalidRows = [
      createVerifiableTicketRow({ reservationStatus: 'CANCELLED' }),
      createVerifiableTicketRow({ paymentStatus: 'CANCELED' }),
    ];

    for (const row of invalidRows) {
      const service = new QrTicketService(
        { select: vi.fn().mockReturnValue(chainResult([row])) } as never,
        configService as never,
        jwtService,
        { sendQrTicketReminderEmail: vi.fn() } as never,
        {
          isAvailable: false,
          send: vi.fn(),
          work: vi.fn(),
          stop: vi.fn(),
        } as never,
      );

      await expect(service.verifyTicketToken(token)).rejects.toThrow(
        '사용할 수 없는 QR 티켓입니다',
      );
    }
  });
});
