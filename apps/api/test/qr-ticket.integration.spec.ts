import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InternalServerErrorException } from '@nestjs/common';
import { Pool } from 'pg';
import type { StartedTestContainer } from 'testcontainers';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { and, eq, sql } from 'drizzle-orm';
import * as schema from '../src/database/schema/index.js';
import type { DrizzleDB } from '../src/database/drizzle.provider.js';
import { startPostgresContainer } from './helpers/postgres-container.js';
import { createPostgresPoolCleanup } from './helpers/postgres-pool-cleanup.js';
import { AdminAuditService } from '../src/modules/admin/admin-audit.service.js';
import type { EmailService } from '../src/modules/auth/email/email.service.js';
import { QrTicketService } from '../src/modules/ticket/qr-ticket.service.js';
import { FieldCheckInService } from '../src/modules/field-operations/field-check-in.service.js';

const SECRET_VERSION = 'qr-it-v1';
const SECRET = 'qr-integration-signing-secret-at-least-32-characters';

type ReminderHandler = {
  handleReminderEmailJob(payload: { ticketId: string; reservationId: string }, jobId?: string): Promise<void>;
};

/**
 * Holds the Nth `db.select(...)` query until released, so a test can commit a
 * concurrent transaction exactly between two unlocked reads of the service.
 */
function holdNthSelect(db: DrizzleDB, heldCall: number) {
  let calls = 0;
  let markReached!: () => void;
  let releaseHeld!: () => void;
  const reached = new Promise<void>((resolve) => { markReached = resolve; });
  const released = new Promise<void>((resolve) => { releaseHeld = resolve; });
  const hold = <T extends object>(value: T): T => new Proxy(value, {
    get(target, property) {
      const member = Reflect.get(target, property, target) as unknown;
      if (typeof member !== 'function') return member;
      if (property === 'then') {
        return (onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) => {
          markReached();
          return released.then(() => (member as (...args: unknown[]) => unknown).call(target, onFulfilled, onRejected));
        };
      }
      return (...args: unknown[]) => {
        const result = (member as (...args: unknown[]) => unknown).apply(target, args);
        return result && typeof result === 'object' ? hold(result) : result;
      };
    },
  });
  const proxied = new Proxy(db, {
    get(target, property) {
      const member = Reflect.get(target, property, target) as unknown;
      if (property === 'select' && typeof member === 'function') {
        return (...args: unknown[]) => {
          calls += 1;
          const builder = (member as (...args: unknown[]) => object).apply(target, args);
          return calls === heldCall ? hold(builder) : builder;
        };
      }
      return typeof member === 'function' ? (member as (...args: unknown[]) => unknown).bind(target) : member;
    },
  });

  return { db: proxied as DrizzleDB, reached, release: () => releaseHeld() };
}

describe('QR ticket issuance, reminder email and keyring — PostgreSQL', () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let closePool: (() => Promise<void>) | undefined;
  let db: DrizzleDB;
  let actorId: string;

  function config(overrides: Record<string, string> = {}) {
    return new ConfigService({
      QR_TICKET_SECRET: SECRET,
      QR_TICKET_SECRET_VERSION: SECRET_VERSION,
      FRONTEND_URL: 'https://example.test',
      ...overrides,
    });
  }

  function createService(input: {
    database?: DrizzleDB;
    emailService?: unknown;
    pgBoss?: unknown;
    configService?: ConfigService;
  } = {}) {
    return new QrTicketService(
      input.database ?? db,
      input.configService ?? config(),
      new JwtService(),
      (input.emailService ?? { sendQrTicketReminderEmail: vi.fn().mockResolvedValue({ success: true }) }) as never,
      (input.pgBoss ?? { isAvailable: false }) as never,
    );
  }

  beforeAll(async () => {
    const postgres = await startPostgresContainer({ database: 'qr_ticket_test' });
    container = postgres.container;
    pool = new Pool({ host: postgres.host, port: postgres.port, user: 'postgres', password: 'test', database: 'qr_ticket_test', max: 8 });
    closePool = createPostgresPoolCleanup(pool);
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: 'src/database/migrations' });
    actorId = randomUUID();
    await db.insert(schema.users).values({ id: actorId, email: `${actorId}@example.test`, name: 'Scanner', role: 'admin',
      phone: '+821000000000', gender: 'unspecified', birthDate: '1990-01-01' });
  }, 120000);
  afterAll(async () => { await closePool?.(); await container?.stop(); });

  async function fixture(seatCount = 2) {
    const id = randomUUID();
    const [buyer] = await db.insert(schema.users).values({ email: `${id}@example.test`, name: 'Buyer', phone: '+821000000000',
      gender: 'unspecified', birthDate: '1990-01-01', isEmailVerified: true }).returning();
    const [event] = await db.insert(schema.performances).values({ title: 'QR rehearsal', genre: 'artist_celebrity', ageRating: 'All ages',
      status: 'selling', publishState: 'published', startDate: new Date('2099-01-01'), endDate: new Date('2099-01-02') }).returning();
    const [show] = await db.insert(schema.showtimes).values({ performanceId: event!.id, dateTime: new Date('2099-01-01T10:00:00Z') }).returning();
    const [order] = await db.insert(schema.reservations).values({ userId: buyer!.id, showtimeId: show!.id, reservationNumber: id.slice(0, 28),
      tossOrderId: id, status: 'CONFIRMED', totalAmount: 52000 * seatCount, cancelDeadline: new Date('2098-12-31') }).returning();
    const [payment] = await db.insert(schema.payments).values({ reservationId: order!.id, paymentKey: id, tossOrderId: id,
      method: 'CARD', amount: 52000 * seatCount, status: 'DONE' }).returning();
    const items = await db.insert(schema.ticketItems).values(Array.from({ length: seatCount }, (_, index) => ({
      reservationId: order!.id, paymentId: payment!.id, showtimeId: show!.id, seatId: `1F:A-${index + 1}`, seatKey: `1F:A-${index + 1}`,
      floorKey: '1F', floorLabel: '1층', row: 'A', number: String(index + 1), tierName: 'VIP', price: 50000, serviceFee: 2000,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
    }))).returning();
    items.sort((left, right) => Number(left.number) - Number(right.number));
    return { buyer: buyer!, event: event!, show: show!, order: order!, payment: payment!, items };
  }

  function issueInput(f: Awaited<ReturnType<typeof fixture>>) {
    return { reservationId: f.order.id, paymentId: f.payment.id };
  }

  async function activeCredentials(ticketItemId: string) {
    return db.select().from(schema.tickets)
      .where(and(eq(schema.tickets.ticketItemId, ticketItemId), eq(schema.tickets.status, 'active')));
  }

  /** Same row locks and writes as the ticket-item cancellation prepare. */
  async function prepareCancellation(f: Awaited<ReturnType<typeof fixture>>, ticketItemId: string, preparedAt: Date) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT r.id FROM reservations r
        INNER JOIN payments p ON p.reservation_id = r.id
        INNER JOIN ticket_items ti ON ti.reservation_id = r.id AND ti.payment_id = p.id
        WHERE r.id = $1 AND ti.id = $2 FOR UPDATE OF r, p, ti`, [f.order.id, ticketItemId]);
      await client.query(`UPDATE ticket_items SET status = 'cancellation_pending', cancelled_at = $2,
        reopen_state = 'held_cancelled', updated_at = $2 WHERE id = $1`, [ticketItemId, preparedAt]);
      await client.query(`UPDATE tickets SET status = 'revoked', revoked_at = $2, updated_at = $2
        WHERE ticket_item_id = $1 AND status = 'active'`, [ticketItemId, preparedAt]);
      return client;
    } catch (error) {
      await client.query('ROLLBACK');
      client.release();
      throw error;
    }
  }

  /** Same writes as restorePreparedTicketItemCancellation after a definite PG rejection. */
  async function restorePreparedCancellation(f: Awaited<ReturnType<typeof fixture>>, ticketItemId: string, preparedAt: Date) {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM reservations WHERE id = ${f.order.id} FOR UPDATE`);
      await tx.update(schema.ticketItems).set({ status: 'active', cancelledAt: null, reopenState: 'not_required', updatedAt: new Date() })
        .where(and(eq(schema.ticketItems.id, ticketItemId), eq(schema.ticketItems.status, 'cancellation_pending')));
      await tx.update(schema.tickets).set({ status: 'active', revokedAt: null, updatedAt: new Date() })
        .where(and(eq(schema.tickets.ticketItemId, ticketItemId), eq(schema.tickets.status, 'revoked'), eq(schema.tickets.revokedAt, preparedAt)));
    });
  }

  async function waitForLockWait(fragment: string) {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const result = await pool.query(
        "select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and query like $1",
        [`%${fragment}%`],
      );
      if (result.rows[0].n > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Expected a query containing "${fragment}" to wait on a PostgreSQL row lock`);
  }

  describe('self-healing issuance vs. cancellation prepare (audit #110)', () => {
    it('does not reissue a seat whose cancellation commits between the unlocked reads, so the restore path stays valid', async () => {
      const f = await fixture();
      const issuer = createService();
      const [originalA1] = await issuer.ensureIssuedTicketsForReservation(issueInput(f));
      const held = holdNthSelect(db, 2);
      const racingReader = createService({ database: held.db });

      // (1) reads A-1 as active, then (2) the credential read is held.
      const read = racingReader.ensureIssuedTicketsForReservation(issueInput(f));
      await held.reached;
      const preparedAt = new Date(Date.UTC(2026, 6, 10, 9, 0, 0));
      const prepare = await prepareCancellation(f, f.items[0]!.id, preparedAt);
      await prepare.query('COMMIT');
      prepare.release();
      held.release();

      const returned = await read;
      expect(returned.map((ticket) => ticket.ticketItemId)).toEqual([f.items[1]!.id]);
      expect(await activeCredentials(f.items[0]!.id)).toHaveLength(0);

      // PG rejected the cancel: the original credential comes back without a unique violation.
      await expect(restorePreparedCancellation(f, f.items[0]!.id, preparedAt)).resolves.toBeUndefined();
      const restored = await activeCredentials(f.items[0]!.id);
      expect(restored.map((ticket) => ticket.id)).toEqual([originalA1!.id]);
      const afterRestore = await issuer.getOwnedTicketsForReservation(f.order.id, f.buyer.id);
      expect(afterRestore.map((ticket) => ticket.id)).toContain(originalA1!.id);
    });

    it('makes a first issuance wait for an in-flight cancellation prepare and then skip the cancelled seat', async () => {
      const f = await fixture();
      const preparedAt = new Date(Date.UTC(2026, 6, 10, 9, 5, 0));
      const prepare = await prepareCancellation(f, f.items[0]!.id, preparedAt);
      let settled = false;
      const read = createService().ensureIssuedTicketsForReservation(issueInput(f))
        .finally(() => { settled = true; });
      try {
        await waitForLockWait('FOR SHARE OF r');
        expect(settled).toBe(false);
        await prepare.query('COMMIT');
      } finally {
        await prepare.query('ROLLBACK');
        prepare.release();
      }

      const returned = await read;
      expect(returned.map((ticket) => ticket.ticketItemId)).toEqual([f.items[1]!.id]);
      expect(await activeCredentials(f.items[0]!.id)).toHaveLength(0);
      expect(await activeCredentials(f.items[1]!.id)).toHaveLength(1);
    });

    it('lets concurrent first reads converge on one credential per seat', async () => {
      const f = await fixture(3);
      const results = await Promise.all([1, 2, 3, 4].map(() => createService().ensureIssuedTicketsForReservation(issueInput(f))));
      const credentialIds = results.map((tickets) => tickets.map((ticket) => ticket.id).join(','));
      expect(new Set(credentialIds).size).toBe(1);
      for (const item of f.items) {
        expect(await activeCredentials(item.id)).toHaveLength(1);
      }
    });
  });

  describe('reminder scheduling and sending (audit #107, #108)', () => {
    it('records one reminder job and sends one email covering every seat even when jobs run concurrently', async () => {
      const f = await fixture(3);
      const sentJobIds: string[] = [];
      const pgBoss = {
        isAvailable: true,
        send: vi.fn(async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          const jobId = randomUUID();
          sentJobIds.push(jobId);
          return jobId;
        }),
        work: vi.fn(),
        stop: vi.fn(),
      };
      const emailService = {
        sendQrTicketReminderEmail: vi.fn<EmailService['sendQrTicketReminderEmail']>(async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return { success: true };
        }),
      };
      await createService().ensureIssuedTicketsForReservation(issueInput(f));
      await Promise.all([1, 2].map(() => createService({ pgBoss, emailService }).ensureIssuedTicketsForReservation(issueInput(f))));

      const credentials = await db.select().from(schema.tickets).where(eq(schema.tickets.reservationId, f.order.id));
      const recordedJobIds = credentials.map((ticket) => ticket.emailJobId).filter((jobId): jobId is string => Boolean(jobId));
      expect(pgBoss.send).toHaveBeenCalledTimes(2);
      expect(recordedJobIds).toHaveLength(1);
      expect(sentJobIds).toContain(recordedJobIds[0]);
      const anchor = credentials.find((ticket) => ticket.emailJobId)!;
      const supersededJobId = sentJobIds.find((jobId) => jobId !== recordedJobIds[0])!;

      const worker = createService({ pgBoss, emailService }) as unknown as ReminderHandler;
      const otherWorker = createService({ pgBoss, emailService }) as unknown as ReminderHandler;
      const payload = { ticketId: anchor.id, reservationId: f.order.id };
      await Promise.all([
        worker.handleReminderEmailJob(payload, recordedJobIds[0]),
        otherWorker.handleReminderEmailJob(payload, recordedJobIds[0]),
        otherWorker.handleReminderEmailJob(payload, supersededJobId),
      ]);

      expect(emailService.sendQrTicketReminderEmail).toHaveBeenCalledTimes(1);
      const emailInput = emailService.sendQrTicketReminderEmail.mock.calls[0]?.[1];
      if (!emailInput) throw new Error('reminder email was not sent');
      expect(emailInput.tickets.map((ticket) => ticket.seatLabel)).toEqual([
        '1층 · VIP A열 1번',
        '1층 · VIP A열 2번',
        '1층 · VIP A열 3번',
      ]);
      const verifier = createService();
      const verified = await Promise.all(emailInput.tickets.map((ticket) => verifier.verifyTicketToken(ticket.token)));
      expect(verified.map((payloadEntry) => payloadEntry.ticketItemId)).toEqual(f.items.map((item) => item.id));
      const afterSend = await db.select().from(schema.tickets).where(eq(schema.tickets.reservationId, f.order.id));
      expect(afterSend.every((ticket) => ticket.emailSentAt instanceof Date)).toBe(true);
    });

    it('releases the send claim after a failed delivery so the retry delivers once', async () => {
      const f = await fixture(2);
      const emailService = {
        sendQrTicketReminderEmail: vi.fn()
          .mockResolvedValueOnce({ success: false, error: 'resend 503' })
          .mockResolvedValue({ success: true }),
      };
      const [first] = await createService().ensureIssuedTicketsForReservation(issueInput(f));
      const worker = createService({ emailService }) as unknown as ReminderHandler;
      const ticketId = first?.id;
      if (!ticketId) throw new Error('fixture issued no QR credential');
      const payload = { ticketId, reservationId: f.order.id };

      await expect(worker.handleReminderEmailJob(payload)).rejects.toThrow('resend 503');
      const afterFailure = await db.select().from(schema.tickets).where(eq(schema.tickets.reservationId, f.order.id));
      expect(afterFailure.every((ticket) => ticket.emailSentAt === null)).toBe(true);

      await worker.handleReminderEmailJob(payload);
      await worker.handleReminderEmailJob(payload);
      expect(emailService.sendQrTicketReminderEmail).toHaveBeenCalledTimes(2);
      const afterRetry = await db.select().from(schema.tickets).where(eq(schema.tickets.reservationId, f.order.id));
      expect(afterRetry.every((ticket) => ticket.emailSentAt instanceof Date)).toBe(true);
    });

    it('emails every active seat on a manual send and marks all of them sent', async () => {
      const f = await fixture(4);
      const emailService = { sendQrTicketReminderEmail: vi.fn().mockResolvedValue({ success: true }) };
      await createService().ensureIssuedTicketsForReservation(issueInput(f));
      const result = await createService({ emailService }).sendOwnedTicketsForReservationEmail(f.order.id, f.buyer.id);

      expect(result.ticketEmailDelivery.status).toBe('sent');
      const emailInput = emailService.sendQrTicketReminderEmail.mock.calls[0]?.[1] as {
        tickets: Array<{ seatLabel: string }>;
      };
      expect(emailInput.tickets).toHaveLength(4);
      const credentials = await db.select().from(schema.tickets).where(eq(schema.tickets.reservationId, f.order.id));
      expect(credentials.every((ticket) => ticket.emailSentAt instanceof Date)).toBe(true);
    });
  });

  describe('QR secret keyring (audit #109)', () => {
    it('reports an issued version missing from the keyring and answers buyer reads with 500 instead of 401', async () => {
      const f = await fixture(1);
      await createService().ensureIssuedTicketsForReservation(issueInput(f));
      const rotatedWithoutPrevious = createService({ configService: config({
        QR_TICKET_SECRET: 'rotated-signing-secret-at-least-32-characters',
        QR_TICKET_SECRET_VERSION: 'qr-it-v2',
        QR_TICKET_SECRET_KEYRING_JSON: JSON.stringify({ 'qr-it-v2': 'rotated-signing-secret-at-least-32-characters' }),
      }) });

      await expect(rotatedWithoutPrevious.reportSecretKeyringCoverage()).resolves.toEqual([SECRET_VERSION]);
      await expect(rotatedWithoutPrevious.getOwnedTicketsForReservation(f.order.id, f.buyer.id))
        .rejects.toBeInstanceOf(InternalServerErrorException);

      const rotatedCorrectly = createService({ configService: config({
        QR_TICKET_SECRET: 'rotated-signing-secret-at-least-32-characters',
        QR_TICKET_SECRET_VERSION: 'qr-it-v2',
        QR_TICKET_SECRET_KEYRING_JSON: JSON.stringify({ [SECRET_VERSION]: SECRET }),
      }) });
      await expect(rotatedCorrectly.reportSecretKeyringCoverage()).resolves.toEqual([]);
      const [ticket] = await rotatedCorrectly.getOwnedTicketsForReservation(f.order.id, f.buyer.id);
      await expect(rotatedCorrectly.verifyTicketToken(ticket!.token)).resolves.toMatchObject({ secretVersion: SECRET_VERSION });
    });

    it('answers a forged token naming an Object prototype key as tampered instead of hanging the scan', async () => {
      const f = await fixture(1);
      const qr = createService({ configService: config({ QR_TICKET_SECRET_KEYRING_JSON: JSON.stringify({ [SECRET_VERSION]: SECRET }) }) });
      const [credential] = await qr.ensureIssuedTicketsForReservation(issueInput(f));
      const genuine = new JwtService().decode<Record<string, unknown>>(credential!.token);
      const field = new FieldCheckInService(db, qr, new AdminAuditService(db));

      for (const secretVersion of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
        const forged = await new JwtService().signAsync({ ...genuine, secretVersion },
          { secret: 'attacker-chosen-secret', algorithm: 'HS256', noTimestamp: true });
        const outcome = await Promise.race([
          field.verify({ token: forged, showtimeId: f.show.id }, { scannerUserId: actorId }).then((result) => result.outcome),
          new Promise((resolve) => setTimeout(() => resolve('pending'), 2000)),
        ]);
        expect(outcome).toBe('tampered');
      }
    });
  });

  describe('field scan of a cancelled seat (audit #115)', () => {
    it('tells staff a pending cancellation is unconfirmed instead of reporting a completed refund', async () => {
      const f = await fixture(1);
      const qr = createService();
      const [credential] = await qr.ensureIssuedTicketsForReservation(issueInput(f));
      const field = new FieldCheckInService(db, qr, new AdminAuditService(db));
      const context = { scannerUserId: actorId };
      const preparedAt = new Date(Date.UTC(2026, 6, 10, 9, 10, 0));
      const prepare = await prepareCancellation(f, f.items[0]!.id, preparedAt);
      await prepare.query('COMMIT');
      prepare.release();

      const pending = await field.verify({ token: credential!.token, showtimeId: f.show.id }, context);
      expect(pending).toMatchObject({ outcome: 'refunded_cancelled', processable: false,
        resultLabel: '취소 처리 중 · 입장 불가', ticket: { cancellationPending: true } });
      expect(pending.rejectionReason).toContain('취소 처리 중인 티켓입니다');
      expect(pending.rejectionReason).toContain('현장 책임자');
      const deviceAttemptId = randomUUID();
      const consumeInput = { token: credential!.token, showtimeId: f.show.id, deviceAttemptId, confirmed: true as const };
      const consumed = await field.consume(consumeInput, context);
      expect(consumed).toMatchObject({ resultLabel: '취소 처리 중 · 입장 불가', ticket: { cancellationPending: true } });
      expect(consumed.rejectionReason).toContain('취소 처리 중인 티켓입니다');
      // A retried request replays its stored receipt with the same headline.
      await expect(field.consume(consumeInput, context)).resolves.toMatchObject({
        scanEventId: consumed.scanEventId, resultLabel: '취소 처리 중 · 입장 불가' });
      const [scanEvent] = await db.select().from(schema.ticketScanEvents).where(eq(schema.ticketScanEvents.reservationId, f.order.id));
      expect(scanEvent).toMatchObject({ result: 'refunded_cancelled' });
      expect(scanEvent!.rejectionReason).toContain('취소 처리 중인 티켓입니다');

      await db.update(schema.ticketItems).set({ status: 'cancelled' }).where(eq(schema.ticketItems.id, f.items[0]!.id));
      const completed = await field.verify({ token: credential!.token, showtimeId: f.show.id }, context);
      expect(completed).toMatchObject({ outcome: 'refunded_cancelled', rejectionReason: '취소 또는 환불된 티켓입니다',
        ticket: { cancellationPending: false } });
      expect(completed).not.toHaveProperty('resultLabel');
    });
  });
});
