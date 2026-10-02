import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
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

function createConflictSafeInsert() {
  const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoNothing });
  return { values, onConflictDoNothing };
}

/**
 * Transaction used by the missing-credential issuance path. `lockedRows` is the
 * result of the reservation share lock; `selects` are the re-reads made while
 * the lock is held (issue context, existing credentials, issued credentials).
 */
function createIssueTransaction(input: {
  lockedRows?: Array<Record<string, unknown>>;
  selects: unknown[][];
}) {
  const insert = createConflictSafeInsert();
  const tx = {
    execute: vi.fn().mockResolvedValue({ rows: input.lockedRows ?? [{ id: 'reservation-1' }] }),
    select: vi.fn(),
    insert: vi.fn().mockReturnValue({ values: insert.values }),
  };
  for (const rows of input.selects) {
    tx.select.mockReturnValueOnce(chainResult(rows));
  }

  return {
    tx,
    insertValues: insert.values,
    onConflictDoNothing: insert.onConflictDoNothing,
    transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
  };
}

function sqlText(query: unknown): string {
  const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
  return chunks
    .map((chunk) => {
      const value = (chunk as { value?: unknown }).value;
      return Array.isArray(value) ? value.join('') : '';
    })
    .join('');
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
    const contextRows = [
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
    ];
    const issue = createIssueTransaction({
      selects: [
        contextRows,
        [],
        [
          { ...issuedTicketA1, ...seatA1 },
          { ...issuedTicketA2, ...seatA2 },
        ],
      ],
    });
    const mockDb = {
      select: vi
        .fn()
        .mockReturnValueOnce(chainResult(contextRows))
        .mockReturnValueOnce(chainResult([])),
      insert: vi.fn(),
      update: vi.fn(),
      transaction: issue.transaction,
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
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(issue.insertValues).toHaveBeenCalledTimes(1);
    expect(issue.insertValues.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ ticketItemId: 'ticket-item-a1', status: 'active' }),
      expect.objectContaining({ ticketItemId: 'ticket-item-a2', status: 'active' }),
    ]);
    expect(issue.onConflictDoNothing).toHaveBeenCalledTimes(1);
  });

  it('issues a missing credential only after re-reading Ticket Item status under the reservation share lock', async () => {
    // Audit #110: the unlocked reads saw seat A-1 active, but its cancellation
    // prepare committed before the issue. The locked re-read no longer returns
    // A-1, so no new active credential may be inserted for it.
    const seatA1 = createSeatIdentity({ seatId: 'A-1', seatKey: '1F:A-1', number: '1' });
    const seatA2 = createSeatIdentity({ seatId: 'A-2', seatKey: '1F:A-2', number: '2' });
    const contextRow = (id: string, seat: Record<string, unknown>) => ({
      reservationId: 'reservation-1',
      paymentId: 'payment-1',
      paymentStatus: 'DONE',
      showtimeId: 'showtime-1',
      showtimeAt: new Date('2026-07-18T11:00:00.000Z'),
      ticketItem: { id, ...seat },
    });
    const ticketA2 = createTicketRecord({ id: 'ticket-a2', ticketItemId: 'ticket-item-a2', qrTokenJti: 'qr-jti-a2' });
    const issue = createIssueTransaction({
      selects: [
        [contextRow('ticket-item-a2', seatA2)],
        [{ ...ticketA2, ...seatA2 }],
      ],
    });
    const mockDb = {
      select: vi
        .fn()
        .mockReturnValueOnce(chainResult([
          contextRow('ticket-item-a1', seatA1),
          contextRow('ticket-item-a2', seatA2),
        ]))
        .mockReturnValueOnce(chainResult([{ ...ticketA2, ...seatA2 }])),
      insert: vi.fn(),
      update: vi.fn(),
      transaction: issue.transaction,
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
      { isAvailable: false, send: vi.fn(), work: vi.fn(), stop: vi.fn() } as never,
    );

    const issuedTickets = await service.ensureIssuedTicketsForReservation({
      reservationId: 'reservation-1',
      paymentId: 'payment-1',
    });

    expect(issue.tx.execute).toHaveBeenCalledTimes(1);
    expect(sqlText(issue.tx.execute.mock.calls[0]?.[0])).toMatch(/FOR SHARE OF r/);
    expect(issue.insertValues).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(issuedTickets.map((ticket) => ticket.ticketItemId)).toEqual(['ticket-item-a2']);
  });

  it('does not issue anything when the reservation is no longer confirmed under the lock', async () => {
    const seatA1 = createSeatIdentity();
    const issue = createIssueTransaction({ lockedRows: [], selects: [] });
    const mockDb = {
      select: vi
        .fn()
        .mockReturnValueOnce(chainResult([{
          reservationId: 'reservation-1',
          paymentId: 'payment-1',
          paymentStatus: 'DONE',
          showtimeId: 'showtime-1',
          showtimeAt: new Date('2026-07-18T11:00:00.000Z'),
          ticketItem: { id: 'ticket-item-1', ...seatA1 },
        }]))
        .mockReturnValueOnce(chainResult([])),
      insert: vi.fn(),
      update: vi.fn(),
      transaction: issue.transaction,
    };
    const service = new QrTicketService(
      mockDb as never,
      { get: vi.fn((key: string) => (key === 'QR_TICKET_SECRET_VERSION' ? '2026-07' : key === 'QR_TICKET_SECRET' ? 'current-secret' : undefined)) } as never,
      new JwtService(),
      { sendQrTicketReminderEmail: vi.fn() } as never,
      { isAvailable: false, send: vi.fn(), work: vi.fn(), stop: vi.fn() } as never,
    );

    await expect(service.ensureIssuedTicketsForReservation({
      reservationId: 'reservation-1',
      paymentId: 'payment-1',
    })).resolves.toEqual([]);
    expect(issue.tx.select).not.toHaveBeenCalled();
    expect(issue.insertValues).not.toHaveBeenCalled();
  });

  it('returns the first seat QR ticket through the single-ticket wrapper and schedules one D-1 email resend', async () => {
    const seatIdentity = createSeatIdentity();
    const ticketRecord = createTicketRecord();
    const contextRows = [
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
    ];
    const issue = createIssueTransaction({
      selects: [contextRows, [], [{ ...ticketRecord, ...seatIdentity }]],
    });
    const mockDb = {
      select: vi
        .fn()
        .mockReturnValueOnce(chainResult(contextRows))
        .mockReturnValueOnce(chainResult([]))
        .mockReturnValueOnce(chainResult([createVerifiableTicketRow()])),
      insert: vi.fn(),
      transaction: issue.transaction,
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
    const contextRows = [
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
    ];
    const issue = createIssueTransaction({
      selects: [
        contextRows,
        [],
        [
          { ...issuedTicketA1, ...seatA1 },
          { ...issuedTicketA2, ...seatA2 },
        ],
      ],
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
        .mockReturnValueOnce(chainResult(contextRows))
        .mockReturnValueOnce(chainResult([])),
      insert: vi.fn(),
      update: vi.fn(),
      transaction: issue.transaction,
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
      jobs: Array<{ id?: string; data: typeof payload }>,
    ) => Promise<void>;
    await handler([{ id: 'qr-email-job-1', data: payload }]);

    expect(pgBoss.work).toHaveBeenCalledWith('qr-ticket-email-resend', expect.any(Function));
    expect(handleReminderSpy).toHaveBeenCalledWith(payload, 'qr-email-job-1');
  });

  it('does not register the QR email worker in producer-only mode', async () => {
    const pgBoss = {
      isAvailable: true,
      processesJobs: false,
      send: vi.fn(),
      work: vi.fn(),
      stop: vi.fn(),
    };
    const service = new QrTicketService(
      {} as never,
      { get: vi.fn() } as never,
      new JwtService(),
      {} as never,
      pgBoss as never,
    );

    await service.onModuleInit();

    expect(pgBoss.work).not.toHaveBeenCalled();
  });

  it('rejects manual ticket email sends for social placeholder emails', async () => {
    const emailService = { sendQrTicketReminderEmail: vi.fn() };
    const service = new QrTicketService(
      {
        select: vi.fn().mockReturnValue(chainResult([
          {
            ticket: createTicketWithSeatRecord(),
            reservation: {
              id: 'reservation-1',
              reservationNumber: 'GRP-24001',
            },
            user: {
              email: 'kakao_123@social.grabit.com',
              isEmailVerified: true,
              preferredLocale: 'ko',
            },
            showtime: {
              dateTime: new Date('2026-07-18T11:00:00.000Z'),
            },
            performance: {
              title: 'Girl Rules Fanmeet',
            },
            venue: {
              name: 'Donghae Arts Center',
            },
          },
        ])),
        update: vi.fn(),
      } as never,
      {
        get: vi.fn((key: string) => {
          if (key === 'QR_TICKET_SECRET') return 'current-secret';
          if (key === 'QR_TICKET_SECRET_VERSION') return '2026-07';
          if (key === 'FRONTEND_URL') return 'https://heygrabit.com';
          return undefined;
        }),
      } as never,
      new JwtService(),
      emailService as never,
      {
        isAvailable: false,
        send: vi.fn(),
        work: vi.fn(),
        stop: vi.fn(),
      } as never,
    );

    await expect(service.sendOwnedTicketsForReservationEmail('reservation-1', 'user-1'))
      .rejects
      .toThrow('티켓을 받을 이메일 인증이 필요합니다');
    expect(emailService.sendQrTicketReminderEmail).not.toHaveBeenCalled();
  });

  it('sends manual ticket email to a verified real email and marks the ticket emailed', async () => {
    const mockDb = {
      select: vi.fn().mockReturnValue(chainResult([
        {
          ticket: createTicketWithSeatRecord(),
          reservation: {
            id: 'reservation-1',
            reservationNumber: 'GRP-24001',
          },
          user: {
            email: 'buyer@example.com',
            isEmailVerified: true,
            preferredLocale: 'ko',
          },
          showtime: {
            dateTime: new Date('2026-07-18T11:00:00.000Z'),
          },
          performance: {
            title: 'Girl Rules Fanmeet',
          },
          venue: {
            name: 'Donghae Arts Center',
          },
        },
      ])),
      update: vi.fn().mockReturnValue(createUpdateResult([
        createTicketRecord({ emailSentAt: new Date('2026-07-10T09:00:00.000Z') }),
      ])),
    };
    const emailService = {
      sendQrTicketReminderEmail: vi.fn().mockResolvedValue({ success: true }),
    };
    const service = new QrTicketService(
      mockDb as never,
      {
        get: vi.fn((key: string) => {
          if (key === 'QR_TICKET_SECRET') return 'current-secret';
          if (key === 'QR_TICKET_SECRET_VERSION') return '2026-07';
          if (key === 'FRONTEND_URL') return 'https://heygrabit.com';
          return undefined;
        }),
      } as never,
      new JwtService(),
      emailService as never,
      {
        isAvailable: false,
        send: vi.fn(),
        work: vi.fn(),
        stop: vi.fn(),
      } as never,
    );

    await expect(service.sendOwnedTicketsForReservationEmail('reservation-1', 'user-1'))
      .resolves
      .toMatchObject({
        ticketEmailDelivery: {
          email: 'buyer@example.com',
          canSend: true,
          status: 'sent',
        },
      });
    expect(emailService.sendQrTicketReminderEmail).toHaveBeenCalledWith(
      'buyer@example.com',
      expect.objectContaining({
        reservationNumber: 'GRP-24001',
        performanceTitle: 'Girl Rules Fanmeet',
        ticketUrl: 'https://heygrabit.com/mypage/reservations/reservation-1',
        tickets: [
          { seatLabel: '1층 · VIP A열 1번', token: expect.any(String) },
        ],
      }),
    );
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('keeps the owner filter on manual ticket email and refuses a send without a user id', async () => {
    const rows = [{
      ticket: createTicketWithSeatRecord(),
      reservation: { id: 'reservation-1', reservationNumber: 'GRP-24001' },
      user: { email: 'buyer@example.com', isEmailVerified: true, preferredLocale: 'ko' },
      showtime: { dateTime: new Date('2026-07-18T11:00:00.000Z') },
      performance: { title: 'Girl Rules Fanmeet' },
      venue: { name: 'Donghae Arts Center' },
    }];
    const whereConditions: unknown[] = [];
    const capturingChain = (): object => new Proxy({}, {
      get(_target, prop) {
        if (prop === 'then') {
          return (resolve: (value: unknown) => void) => resolve(rows);
        }
        return (...args: unknown[]) => {
          if (prop === 'where') whereConditions.push(args[0]);
          return capturingChain();
        };
      },
    });
    const mockDb = {
      select: vi.fn(() => capturingChain()),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
      }),
    };
    const emailService = {
      sendQrTicketReminderEmail: vi.fn().mockResolvedValue({ success: true }),
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
      emailService as never,
      { isAvailable: false, send: vi.fn(), work: vi.fn(), stop: vi.fn() } as never,
    );

    await service.sendOwnedTicketsForReservationEmail('reservation-1', 'user-1');
    const rendered = new PgDialect().sqlToQuery(whereConditions[0] as SQL);
    expect(rendered.sql).toContain('"reservations"."user_id" = ');
    expect(rendered.params).toContain('user-1');

    mockDb.select.mockClear();
    emailService.sendQrTicketReminderEmail.mockClear();
    await expect(service.sendOwnedTicketsForReservationEmail('reservation-1', ''))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(mockDb.select).not.toHaveBeenCalled();
    expect(emailService.sendQrTicketReminderEmail).not.toHaveBeenCalled();
  });

  it('emails every active seat of a multi-seat reservation with its own seat label and token', async () => {
    // Audit #108: a 4-seat reservation used to email one arbitrary seat's token.
    const seats = ['1', '2', '3', '4'].map((number) => createSeatIdentity({
      seatId: `A-${number}`,
      seatKey: `1F:A-${number}`,
      number,
    }));
    const rows = seats.map((seat, index) => ({
      ticket: createTicketWithSeatRecord({
        id: `ticket-a${index + 1}`,
        ticketItemId: `ticket-item-a${index + 1}`,
        qrTokenJti: `qr-jti-a${index + 1}`,
        seatIdentity: seat,
      }),
      reservation: { id: 'reservation-1', reservationNumber: 'GRP-24001' },
      user: { email: 'buyer@example.com', isEmailVerified: true, preferredLocale: 'ko' },
      showtime: { dateTime: new Date('2026-07-18T11:00:00.000Z') },
      performance: { title: 'Girl Rules Fanmeet' },
      venue: { name: 'Donghae Arts Center' },
    }));
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const mockDb = {
      select: vi.fn().mockReturnValue(chainResult(rows)),
      update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: updateWhere }) }),
    };
    const emailService = {
      sendQrTicketReminderEmail: vi.fn().mockResolvedValue({ success: true }),
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
      emailService as never,
      { isAvailable: false, send: vi.fn(), work: vi.fn(), stop: vi.fn() } as never,
    );

    await service.sendOwnedTicketsForReservationEmail('reservation-1', 'user-1');

    expect(emailService.sendQrTicketReminderEmail).toHaveBeenCalledTimes(1);
    const emailInput = emailService.sendQrTicketReminderEmail.mock.calls[0]?.[1] as {
      tickets: Array<{ seatLabel: string; token: string }>;
    };
    expect(emailInput.tickets.map((ticket) => ticket.seatLabel)).toEqual([
      '1층 · VIP A열 1번',
      '1층 · VIP A열 2번',
      '1층 · VIP A열 3번',
      '1층 · VIP A열 4번',
    ]);
    expect(emailInput.tickets.map((ticket) =>
      (jwtService.decode(ticket.token) as Record<string, unknown>)['ticketItemId'],
    )).toEqual(['ticket-item-a1', 'ticket-item-a2', 'ticket-item-a3', 'ticket-item-a4']);
    expect(mockDb.update).toHaveBeenCalledTimes(1);
    expect(updateWhere).toHaveBeenCalledTimes(1);
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
              reservationStatus: 'CONFIRMED', paymentStatus: 'DONE',
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
      seatLabels: ['1층 · VIP A열 1번'],
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
              reservationStatus: 'CONFIRMED', paymentStatus: 'DONE',
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

  it('classifies a signed cancelled ticket as revoked even when its credential row is active', async () => {
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

    await expect(service.verifyTicketForScannerContract(token)).resolves.toMatchObject({ ticketStatus: 'REVOKED' });
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
            reservationStatus: 'CONFIRMED', paymentStatus: 'DONE',
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
  describe('QR reminder email job (audit #107, #108)', () => {
    function reminderRows(count: number) {
      return Array.from({ length: count }, (_, index) => ({
        ticket: createTicketWithSeatRecord({
          id: `ticket-a${index + 1}`,
          ticketItemId: `ticket-item-a${index + 1}`,
          qrTokenJti: `qr-jti-a${index + 1}`,
          emailJobId: index === 0 ? 'qr-email-job-1' : null,
          seatIdentity: {
            seatId: `A-${index + 1}`,
            seatKey: `1F:A-${index + 1}`,
            number: String(index + 1),
          },
        }),
        reservation: { id: 'reservation-1', reservationNumber: 'GRP-24001' },
        user: { email: 'buyer@example.com', isEmailVerified: true, preferredLocale: 'ko' },
        showtime: { dateTime: new Date('2026-07-18T11:00:00.000Z') },
        performance: { title: 'Girl Rules Fanmeet' },
        venue: { name: 'Donghae Arts Center' },
      }));
    }

    function createReminderService(input: {
      anchorEmailJobId?: string | null;
      rows?: ReturnType<typeof reminderRows>;
      claimedIds?: string[];
      emailResult?: { success: boolean; error?: string };
    }) {
      const claimReturning = vi.fn().mockResolvedValue(
        (input.claimedIds ?? []).map((id) => ({ id })),
      );
      const claimSet = vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ returning: claimReturning }),
      });
      const releaseWhere = vi.fn().mockResolvedValue(undefined);
      const releaseSet = vi.fn().mockReturnValue({ where: releaseWhere });
      const mockDb = {
        select: vi
          .fn()
          .mockReturnValueOnce(chainResult([{
            id: 'ticket-a1',
            reservationId: 'reservation-1',
            emailJobId: input.anchorEmailJobId === undefined ? 'qr-email-job-1' : input.anchorEmailJobId,
          }]))
          .mockReturnValueOnce(chainResult(input.rows ?? reminderRows(2))),
        update: vi
          .fn()
          .mockReturnValueOnce({ set: claimSet })
          .mockReturnValueOnce({ set: releaseSet }),
      };
      const emailService = {
        sendQrTicketReminderEmail: vi.fn().mockResolvedValue(input.emailResult ?? { success: true }),
      };
      const jwtService = new JwtService();
      const service = new QrTicketService(
        mockDb as never,
        {
          get: vi.fn((key: string) => {
            if (key === 'QR_TICKET_SECRET') return 'current-secret';
            if (key === 'QR_TICKET_SECRET_VERSION') return '2026-07';
            if (key === 'FRONTEND_URL') return 'https://heygrabit.com';
            return undefined;
          }),
        } as never,
        jwtService,
        emailService as never,
        { isAvailable: true, send: vi.fn(), work: vi.fn(), stop: vi.fn() } as never,
      );
      const handle = (jobId?: string) => (service as unknown as {
        handleReminderEmailJob(payload: { ticketId: string; reservationId: string }, jobId?: string): Promise<void>;
      }).handleReminderEmailJob({ ticketId: 'ticket-a1', reservationId: 'reservation-1' }, jobId);

      return { mockDb, emailService, jwtService, claimSet, claimReturning, releaseSet, releaseWhere, handle };
    }

    it('claims every active seat before sending one reminder that covers the whole reservation', async () => {
      const harness = createReminderService({ claimedIds: ['ticket-a1', 'ticket-a2'] });

      await harness.handle('qr-email-job-1');

      expect(harness.claimSet).toHaveBeenCalledWith(expect.objectContaining({ emailSentAt: now }));
      expect(harness.claimReturning.mock.invocationCallOrder[0]).toBeLessThan(
        harness.emailService.sendQrTicketReminderEmail.mock.invocationCallOrder[0]!,
      );
      expect(harness.emailService.sendQrTicketReminderEmail).toHaveBeenCalledTimes(1);
      const emailInput = harness.emailService.sendQrTicketReminderEmail.mock.calls[0]?.[1] as {
        tickets: Array<{ seatLabel: string; token: string }>;
      };
      expect(emailInput.tickets.map((ticket) => ticket.seatLabel)).toEqual([
        '1층 · VIP A열 1번',
        '1층 · VIP A열 2번',
      ]);
      expect(emailInput.tickets.map((ticket) =>
        (harness.jwtService.decode(ticket.token) as Record<string, unknown>)['ticketItemId'],
      )).toEqual(['ticket-item-a1', 'ticket-item-a2']);
      expect(harness.releaseSet).not.toHaveBeenCalled();
    });

    it('does not send when another worker already claimed the reservation reminder', async () => {
      const harness = createReminderService({ claimedIds: [] });

      await harness.handle('qr-email-job-1');

      expect(harness.claimSet).toHaveBeenCalledTimes(1);
      expect(harness.emailService.sendQrTicketReminderEmail).not.toHaveBeenCalled();
    });

    it('skips a duplicate job that lost the email_job_id compare-and-set', async () => {
      const harness = createReminderService({ claimedIds: ['ticket-a1', 'ticket-a2'] });

      await harness.handle('qr-email-job-duplicate');

      expect(harness.mockDb.select).toHaveBeenCalledTimes(1);
      expect(harness.mockDb.update).not.toHaveBeenCalled();
      expect(harness.emailService.sendQrTicketReminderEmail).not.toHaveBeenCalled();
    });

    it('skips the reminder when the reservation was already emailed', async () => {
      const rows = reminderRows(2);
      rows[1]!.ticket.emailSentAt = new Date('2026-07-12T00:00:00.000Z');
      const harness = createReminderService({ rows, claimedIds: ['ticket-a1'] });

      await harness.handle('qr-email-job-1');

      expect(harness.mockDb.update).not.toHaveBeenCalled();
      expect(harness.emailService.sendQrTicketReminderEmail).not.toHaveBeenCalled();
    });

    it('releases its claim and rethrows when the send fails so the pg-boss retry can deliver', async () => {
      const harness = createReminderService({
        claimedIds: ['ticket-a1', 'ticket-a2'],
        emailResult: { success: false, error: 'resend 503' },
      });

      await expect(harness.handle('qr-email-job-1')).rejects.toThrow('resend 503');

      expect(harness.releaseSet).toHaveBeenCalledWith(expect.objectContaining({ emailSentAt: null }));
      expect(harness.releaseWhere).toHaveBeenCalledTimes(1);
    });

    describe('claim trail logs (email_sent_at doubles as the send claim)', () => {
      function captureLogs() {
        const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
        const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        return {
          lines: () => [...log.mock.calls, ...warn.mock.calls].map(([message]) => String(message)),
          restore: () => {
            log.mockRestore();
            warn.mockRestore();
          },
        };
      }

      it('logs claimed then sent with the job id for a delivered reminder', async () => {
        const logs = captureLogs();
        const harness = createReminderService({ claimedIds: ['ticket-a1', 'ticket-a2'] });

        await harness.handle('qr-email-job-1');
        const lines = logs.lines();
        logs.restore();

        const claimed = lines.find((line) => line.startsWith('QR reminder claimed.'));
        expect(claimed).toContain('reservationId=reservation-1, jobId=qr-email-job-1');
        expect(claimed).toContain('ticketCount=2');
        expect(lines).toContainEqual(expect.stringMatching(/^QR reminder sent\. reservationId=reservation-1, jobId=qr-email-job-1/));
      });

      it('logs a released claim and no sent line when delivery fails', async () => {
        const logs = captureLogs();
        const harness = createReminderService({
          claimedIds: ['ticket-a1'],
          emailResult: { success: false, error: 'resend 503' },
        });

        await expect(harness.handle('qr-email-job-1')).rejects.toThrow('resend 503');
        const lines = logs.lines();
        logs.restore();

        expect(lines).toContainEqual(expect.stringMatching(/^QR reminder claimed\. .*jobId=qr-email-job-1/));
        expect(lines).toContainEqual(expect.stringMatching(/^QR reminder claim released after send failure\. .*jobId=qr-email-job-1/));
        expect(lines.some((line) => line.startsWith('QR reminder sent.'))).toBe(false);
      });

      it('logs the job id when a retry finds the claim already taken', async () => {
        const logs = captureLogs();
        const rows = reminderRows(2);
        rows[0]!.ticket.emailSentAt = now;
        rows[1]!.ticket.emailSentAt = now;
        const harness = createReminderService({ rows });

        await harness.handle('qr-email-job-1');
        const lines = logs.lines();
        logs.restore();

        expect(harness.emailService.sendQrTicketReminderEmail).not.toHaveBeenCalled();
        expect(lines).toContainEqual(
          'QR reminder skipped: already sent or claimed. reservationId=reservation-1, jobId=qr-email-job-1',
        );
      });
    });
  });

  it('keeps the first recorded reminder job when a concurrent read schedules another (audit #107)', async () => {
    const seatIdentity = createSeatIdentity();
    const unscheduled = { ...createTicketRecord(), ...seatIdentity };
    const recordedByOtherRequest = createTicketRecord({ emailJobId: 'qr-email-job-first' });
    const casWhere = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) });
    const mockDb = {
      select: vi
        .fn()
        .mockReturnValueOnce(chainResult([{
          reservationId: 'reservation-1',
          paymentId: 'payment-1',
          paymentStatus: 'DONE',
          showtimeId: 'showtime-1',
          showtimeAt: new Date('2026-07-18T11:00:00.000Z'),
          ticketItem: { id: 'ticket-item-1', ...seatIdentity },
        }]))
        .mockReturnValueOnce(chainResult([unscheduled]))
        .mockReturnValueOnce(chainResult([recordedByOtherRequest])),
      update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: casWhere }) }),
      insert: vi.fn(),
    };
    const pgBoss = {
      isAvailable: true,
      send: vi.fn().mockResolvedValue('qr-email-job-second'),
      work: vi.fn(),
      stop: vi.fn(),
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
      pgBoss as never,
    );

    const [ticket] = await service.ensureIssuedTicketsForReservation({
      reservationId: 'reservation-1',
      paymentId: 'payment-1',
    });

    expect(pgBoss.send).toHaveBeenCalledTimes(1);
    expect(casWhere).toHaveBeenCalledTimes(1);
    // The losing request re-reads the persisted row instead of claiming its own job id.
    expect(mockDb.select).toHaveBeenCalledTimes(3);
    expect(ticket?.status).toBe('ACTIVE');
  });

  describe('QR secret keyring (audit #109)', () => {
    const keyringConfig = {
      get: vi.fn((key: string) => {
        if (key === 'QR_TICKET_SECRET') return 'current-secret';
        if (key === 'QR_TICKET_SECRET_VERSION') return '2026-07';
        if (key === 'QR_TICKET_SECRET_KEYRING_JSON') {
          return JSON.stringify({ '2026-07': 'current-secret' });
        }
        return undefined;
      }),
    };

    it('answers a buyer read with a server error, not 401, when an issued ticket version is missing from the keyring', async () => {
      const seatIdentity = createSeatIdentity();
      const service = new QrTicketService(
        {
          select: vi
            .fn()
            .mockReturnValueOnce(chainResult([{
              reservationId: 'reservation-1',
              paymentId: 'payment-1',
              paymentStatus: 'DONE',
              showtimeId: 'showtime-1',
              showtimeAt: new Date('2026-07-18T11:00:00.000Z'),
              ticketItem: { id: 'ticket-item-1', ...seatIdentity },
            }]))
            .mockReturnValueOnce(chainResult([{
              ...createTicketRecord({ secretVersion: '2026-05', emailJobId: 'qr-email-job-1' }),
              ...seatIdentity,
            }])),
        } as never,
        keyringConfig as never,
        new JwtService(),
        { sendQrTicketReminderEmail: vi.fn() } as never,
        { isAvailable: false, send: vi.fn(), work: vi.fn(), stop: vi.fn() } as never,
      );

      const error = await service.ensureIssuedTicketsForReservation({
        reservationId: 'reservation-1',
        paymentId: 'payment-1',
      }).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(InternalServerErrorException);
      expect(error).not.toBeInstanceOf(UnauthorizedException);
      expect((error as InternalServerErrorException).getStatus()).toBe(500);
    });

    it('keeps the scanner answer for an unknown secret version as an invalid credential', async () => {
      const jwtService = new JwtService();
      const token = await jwtService.signAsync(
        createTokenPayload({ secretVersion: '2026-05' }),
        { secret: 'prior-secret', algorithm: 'HS256', noTimestamp: true },
      );
      const service = new QrTicketService(
        { select: vi.fn() } as never,
        keyringConfig as never,
        jwtService,
        { sendQrTicketReminderEmail: vi.fn() } as never,
        { isAvailable: false, send: vi.fn(), work: vi.fn(), stop: vi.fn() } as never,
      );

      await expect(service.verifyTicketForScannerContract(token)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    describe.each([
      ['with QR_TICKET_SECRET_KEYRING_JSON', keyringConfig],
      ['without QR_TICKET_SECRET_KEYRING_JSON', {
        get: vi.fn((key: string) => {
          if (key === 'QR_TICKET_SECRET') return 'current-secret';
          if (key === 'QR_TICKET_SECRET_VERSION') return '2026-07';
          return undefined;
        }),
      }],
    ])('unsigned secret version lookup %s', (_label, config) => {
      it.each([
        'constructor',
        'toString',
        '__proto__',
        'hasOwnProperty',
        'valueOf',
        'isPrototypeOf',
      ])('rejects a token naming the Object prototype key %s as tampered without hanging the verifier', async (secretVersion) => {
        // Real timers: the defect left verifyAsync pending forever, so a race is the assertion.
        vi.useRealTimers();
        const jwtService = new JwtService();
        const token = await jwtService.signAsync(
          createTokenPayload({ secretVersion }),
          { secret: 'attacker-secret', algorithm: 'HS256', noTimestamp: true },
        );
        const select = vi.fn();
        const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        const service = new QrTicketService(
          { select } as never,
          config as never,
          jwtService,
          { sendQrTicketReminderEmail: vi.fn() } as never,
          { isAvailable: false, send: vi.fn(), work: vi.fn(), stop: vi.fn() } as never,
        );

        const settled = await Promise.race([
          service.verifyTicketForScannerContract(token).then(
            () => 'resolved',
            (error: unknown) => error,
          ),
          new Promise((resolve) => setTimeout(() => resolve('pending'), 200)),
        ]);
        warnSpy.mockRestore();

        expect(settled).toBeInstanceOf(UnauthorizedException);
        expect(select).not.toHaveBeenCalled();
      });
    });

    it('logs an unsigned secret version escaped so it cannot forge log lines', async () => {
      const jwtService = new JwtService();
      const token = await jwtService.signAsync(
        createTokenPayload({ secretVersion: 'v9\nCRITICAL: forged line' }),
        { secret: 'attacker-secret', algorithm: 'HS256', noTimestamp: true },
      );
      const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const service = new QrTicketService(
        { select: vi.fn() } as never,
        keyringConfig as never,
        jwtService,
        { sendQrTicketReminderEmail: vi.fn() } as never,
        { isAvailable: false, send: vi.fn(), work: vi.fn(), stop: vi.fn() } as never,
      );

      await expect(service.verifyTicketForScannerContract(token)).rejects.toBeInstanceOf(UnauthorizedException);

      const logged = warnSpy.mock.calls.map(([message]) => String(message)).join('');
      warnSpy.mockRestore();
      expect(logged).toContain('secretVersion="v9\\nCRITICAL: forged line"');
      expect(logged).not.toContain('\n');
    });

    it('treats an issued ticket version that is an Object prototype key as missing, not as a signing secret', async () => {
      const seatIdentity = createSeatIdentity();
      const service = new QrTicketService(
        {
          select: vi
            .fn()
            .mockReturnValueOnce(chainResult([{
              reservationId: 'reservation-1',
              paymentId: 'payment-1',
              paymentStatus: 'DONE',
              showtimeId: 'showtime-1',
              showtimeAt: new Date('2026-07-18T11:00:00.000Z'),
              ticketItem: { id: 'ticket-item-1', ...seatIdentity },
            }]))
            .mockReturnValueOnce(chainResult([{
              ...createTicketRecord({ secretVersion: 'constructor', emailJobId: 'qr-email-job-1' }),
              ...seatIdentity,
            }])),
        } as never,
        keyringConfig as never,
        new JwtService(),
        { sendQrTicketReminderEmail: vi.fn() } as never,
        { isAvailable: false, send: vi.fn(), work: vi.fn(), stop: vi.fn() } as never,
      );
      const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      await expect(service.ensureIssuedTicketsForReservation({
        reservationId: 'reservation-1',
        paymentId: 'payment-1',
      })).rejects.toBeInstanceOf(InternalServerErrorException);
      errorSpy.mockRestore();
    });

    it('reports an issued version that is an Object prototype key as missing at boot', async () => {
      const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const service = new QrTicketService(
        {
          selectDistinct: vi.fn().mockReturnValue(chainResult([
            { secretVersion: '2026-07' },
            { secretVersion: 'toString' },
          ])),
        } as never,
        keyringConfig as never,
        new JwtService(),
        { sendQrTicketReminderEmail: vi.fn() } as never,
        { isAvailable: false, send: vi.fn(), work: vi.fn(), stop: vi.fn() } as never,
      );

      await expect(service.reportSecretKeyringCoverage()).resolves.toEqual(['toString']);
      errorSpy.mockRestore();
    });

    it('reports a keyring entry for the current version that differs from QR_TICKET_SECRET at boot', () => {
      const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      // A mismatched pair, e.g. an instance started between updating qr-ticket-secret
      // and qr-ticket-secret-version during rotation.
      const service = new QrTicketService(
        {} as never,
        {
          get: vi.fn((key: string) => {
            if (key === 'QR_TICKET_SECRET') return 'next-secret';
            if (key === 'QR_TICKET_SECRET_VERSION') return '2026-07';
            if (key === 'QR_TICKET_SECRET_KEYRING_JSON') {
              return JSON.stringify({ '2026-07': 'current-secret', '2026-10': 'next-secret' });
            }
            return undefined;
          }),
        } as never,
        new JwtService(),
        { sendQrTicketReminderEmail: vi.fn() } as never,
        { isAvailable: false, send: vi.fn(), work: vi.fn(), stop: vi.fn() } as never,
      );

      expect(service.reportSecretKeyringConflict()).toBe(true);
      const logged = errorSpy.mock.calls.map(([message]) => String(message)).join('\n');
      errorSpy.mockRestore();
      expect(logged).toContain('CRITICAL');
      expect(logged).toContain('"2026-07"');
      // Secret values never reach the log.
      expect(logged).not.toContain('current-secret');
      expect(logged).not.toContain('next-secret');
    });

    it('runs the keyring conflict and coverage checks when the module starts', async () => {
      const service = new QrTicketService(
        { selectDistinct: vi.fn().mockReturnValue(chainResult([{ secretVersion: '2026-07' }])) } as never,
        keyringConfig as never,
        new JwtService(),
        { sendQrTicketReminderEmail: vi.fn() } as never,
        { isAvailable: false, send: vi.fn(), work: vi.fn(), stop: vi.fn() } as never,
      );
      const conflict = vi.spyOn(service, 'reportSecretKeyringConflict');
      const coverage = vi.spyOn(service, 'reportSecretKeyringCoverage');

      await service.onModuleInit();

      expect(conflict).toHaveBeenCalledTimes(1);
      expect(coverage).toHaveBeenCalledTimes(1);
    });

    it('stays quiet when the keyring entry for the current version matches QR_TICKET_SECRET or is absent', () => {
      const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const build = (keyringJson: string | undefined) => new QrTicketService(
        {} as never,
        {
          get: vi.fn((key: string) => {
            if (key === 'QR_TICKET_SECRET') return 'current-secret';
            if (key === 'QR_TICKET_SECRET_VERSION') return '2026-07';
            if (key === 'QR_TICKET_SECRET_KEYRING_JSON') return keyringJson;
            return undefined;
          }),
        } as never,
        new JwtService(),
        { sendQrTicketReminderEmail: vi.fn() } as never,
        { isAvailable: false, send: vi.fn(), work: vi.fn(), stop: vi.fn() } as never,
      );

      expect(build(JSON.stringify({ '2026-07': 'current-secret', '2026-05': 'prior-secret' })).reportSecretKeyringConflict()).toBe(false);
      expect(build(JSON.stringify({ '2026-05': 'prior-secret' })).reportSecretKeyringConflict()).toBe(false);
      expect(build(undefined).reportSecretKeyringConflict()).toBe(false);
      expect(errorSpy).not.toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it('reports issued secret versions missing from the keyring at boot', async () => {
      const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const selectDistinct = vi.fn().mockReturnValue(chainResult([
        { secretVersion: '2026-07' },
        { secretVersion: '2026-05' },
      ]));
      const service = new QrTicketService(
        { selectDistinct } as never,
        keyringConfig as never,
        new JwtService(),
        { sendQrTicketReminderEmail: vi.fn() } as never,
        { isAvailable: false, send: vi.fn(), work: vi.fn(), stop: vi.fn() } as never,
      );

      await expect(service.reportSecretKeyringCoverage()).resolves.toEqual(['2026-05']);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('missing secret versions still used by issued tickets: 2026-05'));
      errorSpy.mockRestore();
    });

    it('stays quiet when the keyring covers every issued version', async () => {
      const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const service = new QrTicketService(
        { selectDistinct: vi.fn().mockReturnValue(chainResult([{ secretVersion: '2026-07' }])) } as never,
        keyringConfig as never,
        new JwtService(),
        { sendQrTicketReminderEmail: vi.fn() } as never,
        { isAvailable: false, send: vi.fn(), work: vi.fn(), stop: vi.fn() } as never,
      );

      await expect(service.reportSecretKeyringCoverage()).resolves.toEqual([]);
      expect(errorSpy).not.toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  it('distinguishes a pending cancellation from a completed refund in the scanner contract (audit #115)', async () => {
    const configService = {
      get: vi.fn((key: string) => {
        if (key === 'QR_TICKET_SECRET') return 'current-secret';
        if (key === 'QR_TICKET_SECRET_VERSION') return '2026-07';
        return undefined;
      }),
    };
    const jwtService = new JwtService();
    const token = await jwtService.signAsync(
      createTokenPayload({ issuedAt: now.toISOString() }),
      { secret: 'current-secret', algorithm: 'HS256', noTimestamp: true },
    );
    const scannerRow = (ticketItemStatus: string) => ({
      status: 'revoked',
      expiresAt: null,
      usedAt: null,
      revokedAt: new Date('2026-07-10T08:00:00.000Z'),
      ticketId: 'ticket-1',
      ticketItemId: 'ticket-item-1',
      ticketItemStatus,
      reservationStatus: 'CONFIRMED',
      paymentStatus: 'DONE',
      ticketItemAdmissionState: 'not_entered',
      reservationNumber: 'GRP-27-SCAN-0001',
      reservationId: 'reservation-1',
      userId: 'buyer-1',
      paymentId: 'payment-1',
      showtimeId: 'showtime-1',
      performanceId: 'performance-1',
      performanceTitle: 'Girl Rules FAN MEETING IN SEOUL',
      showtimeAt: new Date('2026-07-18T11:00:00.000Z'),
      venueName: '동해문화예술관 대극장',
      seatIdentity: createSeatIdentity(),
    });
    const service = new QrTicketService(
      {
        select: vi
          .fn()
          .mockReturnValueOnce(chainResult([scannerRow('cancellation_pending')]))
          .mockReturnValueOnce(chainResult([scannerRow('cancelled')])),
      } as never,
      configService as never,
      jwtService,
      { sendQrTicketReminderEmail: vi.fn() } as never,
      { isAvailable: false, send: vi.fn(), work: vi.fn(), stop: vi.fn() } as never,
    );

    await expect(service.verifyTicketForScannerContract(token)).resolves.toMatchObject({
      ticketStatus: 'REVOKED',
      ticketItemStatus: 'cancellation_pending',
      cancellationPending: true,
    });
    await expect(service.verifyTicketForScannerContract(token)).resolves.toMatchObject({
      ticketStatus: 'REVOKED',
      ticketItemStatus: 'cancelled',
      cancellationPending: false,
    });
  });
});
