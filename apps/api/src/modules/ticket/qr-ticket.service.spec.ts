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
    ...overrides,
  };
}

function createSeatIdentity(overrides: Record<string, unknown> = {}) {
  return {
    seatId: 'A-1',
    seatKey: '1F:A-1',
    floorKey: '1F',
    floorLabel: '1층',
    row: 'A',
    number: '1',
    tierName: 'VIP',
    ...overrides,
  };
}

function createTicketWithSeatRecord(overrides: Record<string, unknown> = {}) {
  const { seatIdentity, ...ticketOverrides } = overrides;

  return {
    ...createTicketRecord(ticketOverrides),
    ...createSeatIdentity(seatIdentity as Record<string, unknown> | undefined),
  };
}

function createTokenPayload(overrides: Record<string, unknown> = {}) {
  const { seatIdentity, ...payloadOverrides } = overrides;

  return {
    type: 'qr-ticket',
    jti: 'qr-jti-1',
    reservationId: 'reservation-1',
    paymentId: 'payment-1',
    showtimeId: 'showtime-1',
    ticketItemId: 'ticket-item-1',
    seatIdentity: createSeatIdentity(seatIdentity as Record<string, unknown> | undefined),
    secretVersion: '2026-07',
    issuedAt: '2026-07-10T09:00:00.000Z',
    ...payloadOverrides,
  };
}

function createVerifiableTicketRow(overrides: Record<string, unknown> = {}) {
  const { ticket, ...rowOverrides } = overrides;

  return {
    ticket: createTicketRecord(ticket as Record<string, unknown> | undefined),
    ticketItemStatus: 'active',
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

  it('issues one active QR per active ticket item with distinct seat-level payloads', async () => {
    const seatA1 = createSeatIdentity({
      seatId: 'A-1',
      seatKey: '1F:A-1',
      row: 'A',
      number: '1',
      tierName: 'VIP',
    });
    const seatA2 = createSeatIdentity({
      seatId: 'A-2',
      seatKey: '1F:A-2',
      row: 'A',
      number: '2',
      tierName: 'VIP',
    });
    const issuedTicketA1 = createTicketRecord({
      id: 'ticket-a1',
      ticketItemId: 'ticket-item-a1',
      qrTokenJti: 'qr-jti-a1',
    });
    const issuedTicketA2 = createTicketRecord({
      id: 'ticket-a2',
      ticketItemId: 'ticket-item-a2',
      qrTokenJti: 'qr-jti-a2',
    });
    const mockDb = {
      select: vi
        .fn()
        .mockReturnValueOnce(chainResult([
          {
            reservationId: 'reservation-1',
            paymentId: 'payment-1',
            paymentStatus: 'DONE',
            showtimeId: 'showtime-1',
            showtimeAt: new Date('2026-07-18T11:00:00.000Z'),
            ticketItem: { id: 'ticket-item-a1', ...seatA1 },
          },
          {
            reservationId: 'reservation-1',
            paymentId: 'payment-1',
            paymentStatus: 'DONE',
            showtimeId: 'showtime-1',
            showtimeAt: new Date('2026-07-18T11:00:00.000Z'),
            ticketItem: { id: 'ticket-item-a2', ...seatA2 },
          },
        ]))
        .mockReturnValueOnce(chainResult([]))
        .mockReturnValueOnce(chainResult([
          { ...issuedTicketA1, ...seatA1 },
          { ...issuedTicketA2, ...seatA2 },
        ])),
      insert: vi
        .fn()
        .mockReturnValueOnce(createInsertResult([issuedTicketA1]))
        .mockReturnValueOnce(createInsertResult([issuedTicketA2])),
      update: vi.fn(),
    };
    const jwtService = new JwtService();
    const service = new QrTicketService(
      mockDb as never,
      {
        get: vi.fn((key: string) => {
          if (key === 'QR_TICKET_SECRET') return 'current-secret';
          if (key === 'QR_TICKET_SECRET_VERSION') return '2026-07';
          return undefined;
        }),
      } as never,
      jwtService,
      { sendQrTicketReminderEmail: vi.fn() } as never,
      {
        isAvailable: false,
        send: vi.fn(),
        work: vi.fn(),
        stop: vi.fn(),
      } as never,
    );

    const issuedTickets = await service.ensureIssuedTicketsForReservation({
      reservationId: 'reservation-1',
      paymentId: 'payment-1',
    });

    expect(issuedTickets).toHaveLength(2);
    const payloads = issuedTickets.map((ticket) =>
      jwtService.decode(ticket.token) as Record<string, unknown>,
    );
    expect(payloads.map((payload) => payload['ticketItemId'])).toEqual([
      'ticket-item-a1',
      'ticket-item-a2',
    ]);
    expect(payloads.map((payload) => payload['seatIdentity'])).toEqual([
      seatA1,
      seatA2,
    ]);
    expect(new Set(issuedTickets.map((ticket) => ticket.jti))).toHaveProperty('size', 2);
    expect(mockDb.insert).toHaveBeenCalledTimes(2);
  });

  it('returns the first seat QR ticket through the single-ticket wrapper and schedules one D-1 email resend', async () => {
    const seatIdentity = createSeatIdentity();
    const ticketRecord = createTicketRecord();
    const mockDb = {
      select: vi
        .fn()
        .mockReturnValueOnce(
          chainResult([
            {
              reservationId: 'reservation-1',
              paymentId: 'payment-1',
              paymentStatus: 'DONE',
              showtimeId: 'showtime-1',
              showtimeAt: new Date('2026-07-18T11:00:00.000Z'),
              ticketItem: {
                id: 'ticket-item-1',
                ...seatIdentity,
              },
            },
          ]),
        )
        .mockReturnValueOnce(chainResult([]))
        .mockReturnValueOnce(chainResult([
          {
            ...ticketRecord,
            ...seatIdentity,
          },
        ]))
        .mockReturnValueOnce(chainResult([createVerifiableTicketRow()])),
      insert: vi.fn().mockReturnValue(
        createInsertResult([
          {
            id: 'ticket-1',
            reservationId: 'reservation-1',
            paymentId: 'payment-1',
            showtimeId: 'showtime-1',
            ticketItemId: 'ticket-item-1',
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
            ticketItemId: 'ticket-item-1',
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
    expect(verified.ticketItemId).toBe('ticket-item-1');
    expect(verified.seatIdentity).toEqual(seatIdentity);
  });

  it('returns every owned seat QR ticket for a reservation ticket read', async () => {
    const seatA1 = createSeatIdentity({
      seatId: 'A-1',
      seatKey: '1F:A-1',
      row: 'A',
      number: '1',
    });
    const seatA2 = createSeatIdentity({
      seatId: 'A-2',
      seatKey: '1F:A-2',
      row: 'A',
      number: '2',
    });
    const issuedTicketA1 = createTicketRecord({
      id: 'ticket-a1',
      ticketItemId: 'ticket-item-a1',
      qrTokenJti: 'qr-jti-a1',
    });
    const issuedTicketA2 = createTicketRecord({
      id: 'ticket-a2',
      ticketItemId: 'ticket-item-a2',
      qrTokenJti: 'qr-jti-a2',
    });
    const mockDb = {
      select: vi
        .fn()
        .mockReturnValueOnce(chainResult([
          {
            reservationId: 'reservation-1',
            paymentId: 'payment-1',
            paymentStatus: 'DONE',
          },
        ]))
        .mockReturnValueOnce(chainResult([
          {
            reservationId: 'reservation-1',
            paymentId: 'payment-1',
            paymentStatus: 'DONE',
            showtimeId: 'showtime-1',
            showtimeAt: new Date('2026-07-18T11:00:00.000Z'),
            ticketItem: { id: 'ticket-item-a1', ...seatA1 },
          },
          {
            reservationId: 'reservation-1',
            paymentId: 'payment-1',
            paymentStatus: 'DONE',
            showtimeId: 'showtime-1',
            showtimeAt: new Date('2026-07-18T11:00:00.000Z'),
            ticketItem: { id: 'ticket-item-a2', ...seatA2 },
          },
        ]))
        .mockReturnValueOnce(chainResult([]))
        .mockReturnValueOnce(chainResult([
          { ...issuedTicketA1, ...seatA1 },
          { ...issuedTicketA2, ...seatA2 },
        ])),
      insert: vi
        .fn()
        .mockReturnValueOnce(createInsertResult([issuedTicketA1]))
        .mockReturnValueOnce(createInsertResult([issuedTicketA2])),
      update: vi.fn(),
    };
    const jwtService = new JwtService();
    const service = new QrTicketService(
      mockDb as never,
      {
        get: vi.fn((key: string) => {
          if (key === 'QR_TICKET_SECRET') return 'current-secret';
          if (key === 'QR_TICKET_SECRET_VERSION') return '2026-07';
          return undefined;
        }),
      } as never,
      jwtService,
      { sendQrTicketReminderEmail: vi.fn() } as never,
      {
        isAvailable: false,
        send: vi.fn(),
        work: vi.fn(),
        stop: vi.fn(),
      } as never,
    );

    const tickets = await service.getOwnedTicketsForReservation('reservation-1', 'user-1');

    expect(tickets).toHaveLength(2);
    expect(tickets.map((ticket) => ticket.ticketItemId)).toEqual([
      'ticket-item-a1',
      'ticket-item-a2',
    ]);
    expect(tickets.map((ticket) => ticket.seatIdentity?.seatKey)).toEqual([
      '1F:A-1',
      '1F:A-2',
    ]);
    expect(tickets.map((ticket) =>
      (jwtService.decode(ticket.token) as Record<string, unknown>)['ticketItemId'],
    )).toEqual(['ticket-item-a1', 'ticket-item-a2']);
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
      createTokenPayload({
        jti: 'qr-jti-prior',
        reservationId: 'reservation-legacy',
        paymentId: 'payment-legacy',
        showtimeId: 'showtime-legacy',
        ticketItemId: 'ticket-item-legacy',
        secretVersion: '2026-05',
        issuedAt: '2026-05-01T00:00:00.000Z',
      }),
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
              ticketItemId: 'ticket-item-legacy',
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
    expect(verified.ticketItemId).toBe('ticket-item-legacy');
  });

  it('rejects legacy reservation-level QR payloads without ticketItemId or seatIdentity', async () => {
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
        jti: 'qr-jti-legacy-reservation',
        reservationId: 'reservation-legacy',
        paymentId: 'payment-legacy',
        showtimeId: 'showtime-legacy',
        secretVersion: '2026-07',
        issuedAt: now.toISOString(),
      },
      {
        secret: 'current-secret',
        algorithm: 'HS256',
        noTimestamp: true,
      },
    );
    const service = new QrTicketService(
      { select: vi.fn() } as never,
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
      '좌석별 QR 티켓을 다시 열어주세요',
    );
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
      createTokenPayload({
        issuedAt: now.toISOString(),
      }),
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
      createVerifiableTicketRow({ ticketItemStatus: 'cancelled' }),
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
      createTokenPayload({
        issuedAt: now.toISOString(),
      }),
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

  it('does not issue a cutover-ready QR ticket unless the linked payment is DONE', async () => {
    const mockDb = {
      select: vi
        .fn()
        .mockReturnValueOnce(chainResult([]))
        .mockReturnValueOnce(
          chainResult([
            {
              reservationId: 'reservation-1',
              paymentId: 'payment-1',
              paymentStatus: 'IN_PROGRESS',
              showtimeId: 'showtime-1',
              showtimeAt: new Date('2026-07-18T11:00:00.000Z'),
            },
          ]),
        ),
      insert: vi.fn().mockReturnValue(createInsertResult([createTicketRecord()])),
      update: vi.fn(),
    };
    const service = new QrTicketService(
      mockDb as never,
      {
        get: vi.fn((key: string) => {
          if (key === 'QR_TICKET_SECRET') return 'current-secret';
          if (key === 'QR_TICKET_SECRET_VERSION') return '2026-07';
          return undefined;
        }),
      } as never,
      new JwtService(),
      { sendQrTicketReminderEmail: vi.fn() } as never,
      {
        isAvailable: false,
        send: vi.fn(),
        work: vi.fn(),
        stop: vi.fn(),
      } as never,
    );

    await expect(service.ensureIssuedTicketForReservation({
      reservationId: 'reservation-1',
      paymentId: 'payment-1',
    })).rejects.toThrow('QR 티켓 발급 대상 예매를 찾을 수 없습니다');

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns an entered QR ticket snapshot without reissuing or hiding the reusable token', async () => {
    const mockDb = {
      select: vi
        .fn()
        .mockReturnValueOnce(chainResult([
          createTicketWithSeatRecord({
            status: 'used',
            usedAt: new Date('2026-07-10T09:05:00.000Z'),
          }),
        ]))
        .mockReturnValueOnce(chainResult([
          {
            reservationId: 'reservation-1',
            paymentId: 'payment-1',
            paymentStatus: 'DONE',
            showtimeId: 'showtime-1',
            showtimeAt: new Date('2026-07-18T11:00:00.000Z'),
          },
        ])),
      insert: vi.fn(),
      update: vi.fn(),
    };
    const service = new QrTicketService(
      mockDb as never,
      {
        get: vi.fn((key: string) => {
          if (key === 'QR_TICKET_SECRET') return 'current-secret';
          if (key === 'QR_TICKET_SECRET_VERSION') return '2026-07';
          return undefined;
        }),
      } as never,
      new JwtService(),
      { sendQrTicketReminderEmail: vi.fn() } as never,
      {
        isAvailable: false,
        send: vi.fn(),
        work: vi.fn(),
        stop: vi.fn(),
      } as never,
    );

    const ticket = await service.getOrIssueTicketForReservation({
      reservationId: 'reservation-1',
      paymentId: 'payment-1',
    });

    expect(ticket).toMatchObject({
      token: expect.any(String),
      jti: 'qr-jti-1',
      status: 'ACTIVE',
      entryStatus: 'ENTERED',
      enteredAt: '2026-07-10T09:05:00.000Z',
      issuedAt: '2026-07-10T09:00:00.000Z',
    });
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('verifies redacted Phase 27 scanner contract inputs without exposing the raw token or full JTI', async () => {
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
    const rawJti = 'qr-jti-phase26-scanner-contract-1234567890';
    const token = await jwtService.signAsync(
      createTokenPayload({
        jti: rawJti,
        issuedAt: now.toISOString(),
      }),
      {
        secret: 'current-secret',
        algorithm: 'HS256',
        noTimestamp: true,
      },
    );
    const service = new QrTicketService(
      {
        select: vi.fn().mockReturnValueOnce(
          chainResult([
            {
              status: 'active',
              expiresAt: null,
              usedAt: null,
              revokedAt: null,
              ticketId: 'ticket-1',
              ticketItemId: 'ticket-item-1',
              ticketItemStatus: 'active',
              ticketItemAdmissionState: 'not_entered',
              reservationNumber: 'GRP-27-SCAN-0001',
              reservationId: 'reservation-1',
              paymentId: 'payment-1',
              showtimeId: 'showtime-1',
              performanceId: 'performance-1',
              performanceTitle: 'Girl Rules FAN MEETING IN SEOUL',
              showtimeAt: new Date('2026-07-18T11:00:00.000Z'),
              venueName: '동해문화예술관 대극장',
              seatIdentity: createSeatIdentity(),
            },
          ]),
        ),
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

    const result = await service.verifyTicketForScannerContract(token);
    const serialized = JSON.stringify(result);

    expect(result).toMatchObject({
      tokenVersion: '2026-07',
      ticketStatus: 'ACTIVE',
      ticketItemId: 'ticket-item-1',
      seatIdentity: createSeatIdentity(),
      seatLabels: ['VIP A열 1번'],
      reservationId: 'reservation-1',
      paymentId: 'payment-1',
      showtimeId: 'showtime-1',
      performanceId: 'performance-1',
      performanceTitle: 'Girl Rules FAN MEETING IN SEOUL',
      venueName: '동해문화예술관 대극장',
      maskedJti: expect.stringMatching(/^qr-jti...7890$/),
    });
    expect(result.showtimeAt).toBe('2026-07-18T11:00:00.000Z');
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain(rawJti);
  });

  it('reports scanner contract as used when a migrated ticket item is already entered', async () => {
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
      createTokenPayload({
        issuedAt: now.toISOString(),
      }),
      {
        secret: 'current-secret',
        algorithm: 'HS256',
        noTimestamp: true,
      },
    );
    const service = new QrTicketService(
      {
        select: vi.fn().mockReturnValueOnce(
          chainResult([
            {
              status: 'active',
              expiresAt: null,
              usedAt: null,
              revokedAt: null,
              ticketId: 'ticket-1',
              ticketItemId: 'ticket-item-1',
              ticketItemStatus: 'active',
              ticketItemAdmissionState: 'entered',
              reservationNumber: 'GRP-27-SCAN-0001',
              reservationId: 'reservation-1',
              paymentId: 'payment-1',
              showtimeId: 'showtime-1',
              performanceId: 'performance-1',
              performanceTitle: 'Girl Rules FAN MEETING IN SEOUL',
              showtimeAt: new Date('2026-07-18T11:00:00.000Z'),
              venueName: '동해문화예술관 대극장',
              seatIdentity: createSeatIdentity(),
            },
          ]),
        ),
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

    await expect(service.verifyTicketForScannerContract(token)).resolves.toMatchObject({
      ticketStatus: 'USED',
      ticketItemId: 'ticket-item-1',
      seatIdentity: createSeatIdentity(),
    });
  });

  it('rejects scanner verification for a cancelled ticket item even when the ticket row is active', async () => {
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
      createTokenPayload({
        issuedAt: now.toISOString(),
      }),
      {
        secret: 'current-secret',
        algorithm: 'HS256',
        noTimestamp: true,
      },
    );
    const service = new QrTicketService(
      {
        select: vi.fn().mockReturnValueOnce(
          chainResult([
            {
              status: 'active',
              expiresAt: null,
              usedAt: null,
              revokedAt: null,
              ticketId: 'ticket-1',
              ticketItemId: 'ticket-item-1',
              ticketItemStatus: 'cancelled',
              reservationNumber: 'GRP-27-SCAN-0001',
              reservationId: 'reservation-1',
              paymentId: 'payment-1',
              showtimeId: 'showtime-1',
              performanceId: 'performance-1',
              performanceTitle: 'Girl Rules FAN MEETING IN SEOUL',
              showtimeAt: new Date('2026-07-18T11:00:00.000Z'),
              venueName: '동해문화예술관 대극장',
              seatIdentity: createSeatIdentity(),
            },
          ]),
        ),
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

    await expect(service.verifyTicketForScannerContract(token)).rejects.toThrow(
      '사용할 수 없는 QR 티켓입니다',
    );
  });

  it('reports used scanner contract state for a valid consumed QR token', async () => {
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
      createTokenPayload({
        jti: 'qr-jti-used-ticket-1234567890',
        issuedAt: now.toISOString(),
      }),
      {
        secret: 'current-secret',
        algorithm: 'HS256',
        noTimestamp: true,
      },
    );
    const service = new QrTicketService(
      {
        select: vi.fn().mockReturnValueOnce(chainResult([
          {
            status: 'used',
            expiresAt: null,
            usedAt: new Date('2026-07-10T09:05:00.000Z'),
            revokedAt: null,
            ticketId: 'ticket-1',
            ticketItemId: 'ticket-item-1',
            ticketItemStatus: 'active',
            reservationNumber: 'GRP-27-SCAN-0001',
            reservationId: 'reservation-1',
            paymentId: 'payment-1',
            showtimeId: 'showtime-1',
            performanceId: 'performance-1',
            performanceTitle: 'Girl Rules FAN MEETING IN SEOUL',
            showtimeAt: new Date('2026-07-18T11:00:00.000Z'),
            venueName: '동해문화예술관 대극장',
            seatIdentity: createSeatIdentity(),
          },
        ])),
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

    const result = await service.verifyTicketForScannerContract(token);

    expect(result).toMatchObject({
      ticketStatus: 'USED',
      reservationId: 'reservation-1',
      paymentId: 'payment-1',
      showtimeId: 'showtime-1',
    });
  });
});
