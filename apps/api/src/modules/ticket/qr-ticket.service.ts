import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as Sentry from '@sentry/nestjs';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { QrTicket, QrTicketStatus } from '@grabit/shared';
import type { TicketEmailDelivery } from '@grabit/shared/types/booking.types.js';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import {
  payments,
  performances,
  reservations,
  showtimes,
  ticketItems,
  tickets,
  users,
  venues,
} from '../../database/schema/index.js';
import { EmailService } from '../auth/email/email.service.js';
import { resolveTicketEmailDelivery } from './ticket-email-delivery.js';
import { getPrimaryFrontendUrl } from '../../config/frontend-origins.js';
import {
  PG_BOSS,
  PG_BOSS_JOB_NAMES,
  type PgBossContract,
} from '../jobs/pgboss.provider.js';

const DAY_IN_MS = 24 * 60 * 60 * 1000;

type TicketRecord = {
  id: string;
  reservationId: string;
  paymentId: string;
  showtimeId: string;
  ticketItemId: string | null;
  qrTokenJti: string;
  secretVersion: string;
  status: 'active' | 'revoked' | 'used' | 'expired';
  issuedAt: Date;
  expiresAt: Date | null;
  usedAt: Date | null;
  revokedAt: Date | null;
  emailScheduledAt: Date | null;
  emailSentAt: Date | null;
  emailJobId: string | null;
};

export type QrTicketSeatIdentity = {
  seatId: string;
  seatKey: string;
  floorKey: string;
  floorLabel: string;
  row: string;
  number: string;
  tierName: string;
};

type TicketItemIssueRecord = QrTicketSeatIdentity & {
  id: string;
};

type TicketWithSeatRecord = TicketRecord & {
  ticketItemId: string;
  seatIdentity: QrTicketSeatIdentity;
};

type TicketWithSeatRow = TicketRecord & QrTicketSeatIdentity;

type ReservationIssueContext = {
  reservationId: string;
  paymentId: string;
  paymentStatus: string;
  showtimeId: string;
  showtimeAt: Date;
};

type ReservationIssueContextWithTicketItems = ReservationIssueContext & {
  ticketItems: TicketItemIssueRecord[];
};

type QrTicketEmailJobPayload = {
  ticketId: string;
  reservationId: string;
};

type TicketEmailContextRow = {
  ticket: TicketWithSeatRow;
  reservation: {
    id: string;
    reservationNumber: string;
  };
  user: {
    email: string;
    isEmailVerified: boolean;
    preferredLocale: string | null;
  };
  showtime: {
    dateTime: Date;
  };
  performance: {
    title: string;
  };
  venue: {
    name: string | null;
  } | null;
};

/** One reservation's ticket email: every active seat credential in seat order. */
type TicketEmailContext = Omit<TicketEmailContextRow, 'ticket'> & {
  tickets: TicketWithSeatRecord[];
};

type TicketEmailContextScope =
  | { scope: 'owner'; reservationId: string; userId: string }
  | { scope: 'system-reminder'; reservationId: string };

type TicketReadDb = Pick<DrizzleDB, 'select'>;

type TicketItemStatus = 'active' | 'cancellation_pending' | 'cancelled' | 'expired';

export interface QrTicketTokenPayload {
  exp?: number;
  type: 'qr-ticket';
  jti: string;
  reservationId: string;
  paymentId: string;
  showtimeId: string;
  ticketItemId: string;
  seatIdentity: QrTicketSeatIdentity;
  secretVersion: string;
  issuedAt: string;
}

export interface QrTicketScannerContract {
  ticketId?: string;
  ticketItemId: string;
  userId: string;
  tokenVersion: string;
  ticketStatus: QrTicketStatus;
  /** Seat entitlement state, so a pending cancellation is not reported as a completed refund. */
  ticketItemStatus: TicketItemStatus;
  /** True while a cancellation/refund is requested but not yet confirmed by the PG. */
  cancellationPending: boolean;
  reservationNumber?: string;
  reservationId: string;
  paymentId: string;
  showtimeId: string;
  performanceId: string;
  performanceTitle: string;
  showtimeAt: string;
  venueName: string;
  seatIdentity: QrTicketSeatIdentity;
  seatLabels: string[];
  maskedJti: string;
  verifiedAt: string;
  enteredAt?: string | null;
}

@Injectable()
export class QrTicketService implements OnModuleInit {
  private readonly logger = new Logger(QrTicketService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
    @Inject(PG_BOSS) private readonly pgBoss: PgBossContract,
  ) {}

  async onModuleInit(): Promise<void> {
    this.reportSecretKeyringConflict();
    // Not awaited: a slow database must not delay readiness. The check only reports.
    void this.reportSecretKeyringCoverage();

    if (!this.pgBoss?.isAvailable || this.pgBoss.processesJobs === false) {
      return;
    }

    try {
      await this.pgBoss.work<QrTicketEmailJobPayload>(
        PG_BOSS_JOB_NAMES.qrTicketEmailResend,
        async ([job]) => {
          if (!job) {
            return;
          }

          await this.handleReminderEmailJob(job.data, job.id);
        },
      );
    } catch (error) {
      this.logger.error(
        'QR reminder worker registration failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Compares the configured keyring with the secret versions of credentials that
   * buyers can still open. A missing version means buyer QR reads, ticket emails
   * and field scans for those tickets fail, so it is reported as critical at boot
   * instead of surfacing later as buyer-facing errors.
   */
  async reportSecretKeyringCoverage(): Promise<string[]> {
    try {
      const keyring = this.loadSecretKeyring();
      const rows = await this.db
        .selectDistinct({ secretVersion: tickets.secretVersion })
        .from(tickets)
        .where(inArray(tickets.status, ['active', 'used']));
      const missingVersions = rows
        .map((row) => row.secretVersion)
        .filter((version) => !findKeyringSecret(keyring, version))
        .sort();

      if (missingVersions.length > 0) {
        const message = `CRITICAL: QR_TICKET_SECRET_KEYRING_JSON is missing secret versions still used by issued tickets: ${missingVersions.join(', ')}. Buyer QR reads, ticket emails and field scans for those tickets fail until the keyring includes them.`;
        this.logger.error(message);
        Sentry.withScope((scope) => {
          scope.setTag('component', 'qr-ticket');
          scope.setTag('check', 'secret-keyring-coverage');
          scope.setLevel('fatal');
          scope.setContext('qrSecretKeyring', { missingVersions });
          Sentry.captureException(new Error(message));
        });
      }

      return missingVersions;
    } catch (error) {
      this.logger.error(
        'QR secret keyring coverage check failed',
        error instanceof Error ? error.stack : String(error),
      );
      return [];
    }
  }

  /**
   * QR_TICKET_SECRET overrides the keyring JSON entry for the current version.
   * When they differ, this instance signs and verifies that version with a
   * different secret than instances that read a consistent pair (for example an
   * instance started between two Secret Manager updates during rotation), so
   * credentials it serves fail elsewhere as tampered. Reported at boot only;
   * secret values are never logged.
   */
  reportSecretKeyringConflict(): boolean {
    try {
      const configured = this.parseConfiguredKeyring();
      if (configured.size === 0) {
        return false;
      }

      const currentVersion = this.getCurrentSecretVersion();
      const configuredSecret = configured.get(currentVersion);
      if (configuredSecret === undefined || configuredSecret === this.getCurrentSecret()) {
        return false;
      }

      const message = `CRITICAL: QR_TICKET_SECRET_KEYRING_JSON entry for the current QR secret version ${JSON.stringify(currentVersion)} differs from QR_TICKET_SECRET. This instance uses QR_TICKET_SECRET for that version, so credentials it signs or verifies disagree with instances that read a consistent secret/version pair. Redeploy API and worker with a matching pair (see the QR secret rotation runbook).`;
      this.logger.error(message);
      Sentry.withScope((scope) => {
        scope.setTag('component', 'qr-ticket');
        scope.setTag('check', 'secret-keyring-conflict');
        scope.setLevel('fatal');
        scope.setContext('qrSecretKeyring', { currentVersion });
        Sentry.captureException(new Error(message));
      });
      return true;
    } catch (error) {
      this.logger.error(
        'QR secret keyring conflict check failed',
        error instanceof Error ? error.stack : String(error),
      );
      return false;
    }
  }

  async ensureIssuedTicketForReservation(input: {
    reservationId: string;
    paymentId: string;
  }): Promise<QrTicket> {
    const [ticket] = await this.ensureIssuedTicketsForReservation(input);
    if (!ticket) {
      throw new NotFoundException('QR 티켓을 찾을 수 없습니다');
    }

    return ticket;
  }

  async ensureIssuedTicketsForReservation(input: {
    reservationId: string;
    paymentId: string;
  }): Promise<QrTicket[]> {
    const issueContext = await this.getReservationIssueContextWithTicketItems(input);
    let ticketItemsInOrder = issueContext.ticketItems;
    let activeTickets = await this.findActiveTicketsByTicketItemIds(
      ticketItemsInOrder.map((ticketItem) => ticketItem.id),
    );
    const issuedTicketItemIds = new Set(activeTickets.map((ticket) => ticket.ticketItemId));

    // Fast path stays lock-free. Only a missing credential takes the reservation
    // lock, because the unlocked reads above may straddle a cancellation commit.
    if (ticketItemsInOrder.some((ticketItem) => !issuedTicketItemIds.has(ticketItem.id))) {
      const issued = await this.issueMissingTicketsUnderReservationLock(input);
      ticketItemsInOrder = issued.ticketItems;
      activeTickets = issued.activeTickets;
    }

    const activeTicketByItemId = new Map(
      activeTickets.map((ticket) => [ticket.ticketItemId, ticket]),
    );
    const orderedTickets = ticketItemsInOrder.map((ticketItem) =>
      activeTicketByItemId.get(ticketItem.id),
    );

    if (orderedTickets.some((ticket) => !ticket)) {
      throw new NotFoundException('QR 티켓을 찾을 수 없습니다');
    }

    const scheduledTickets = await this.ensureSingleReminderSchedule(
      orderedTickets as TicketWithSeatRecord[],
    );
    return Promise.all(scheduledTickets.map((ticket) => this.toQrTicket(ticket)));
  }

  /**
   * Issues credentials only for Ticket Items that are still active while the
   * reservation row is share-locked. Ticket-item cancellation, full refund,
   * rights restoration and field consume all lock the reservation row first, so
   * a cancellation prepare either commits before the status re-read below (and
   * the item is skipped) or waits for this insert and then revokes it.
   */
  private async issueMissingTicketsUnderReservationLock(input: {
    reservationId: string;
    paymentId: string;
  }): Promise<{
    ticketItems: TicketItemIssueRecord[];
    activeTickets: TicketWithSeatRecord[];
  }> {
    return this.db.transaction(async (tx) => {
      const locked = await tx.execute(sql`
        SELECT r.id
        FROM reservations r
        INNER JOIN payments p ON p.reservation_id = r.id
        WHERE r.id = ${input.reservationId}
          AND p.id = ${input.paymentId}
          AND r.status = 'CONFIRMED'
          AND p.status = 'DONE'
        FOR SHARE OF r
      `);
      if (locked.rows.length === 0) {
        return { ticketItems: [], activeTickets: [] };
      }

      const rows = await this.selectIssueContextRows(tx, input);
      const [first] = rows;
      if (!first) {
        return { ticketItems: [], activeTickets: [] };
      }

      const ticketItemsInOrder = rows.map((row) => row.ticketItem);
      const ticketItemIds = ticketItemsInOrder.map((ticketItem) => ticketItem.id);
      const existingTickets = await this.findActiveTicketsByTicketItemIds(ticketItemIds, tx);
      const existingTicketItemIds = new Set(
        existingTickets.map((ticket) => ticket.ticketItemId),
      );
      const missingTicketItems = ticketItemsInOrder.filter(
        (ticketItem) => !existingTicketItemIds.has(ticketItem.id),
      );

      if (missingTicketItems.length === 0) {
        return { ticketItems: ticketItemsInOrder, activeTickets: existingTickets };
      }

      const issuedAt = new Date();
      const emailScheduledAt = this.calculateEmailScheduledAt(first.showtimeAt, issuedAt);
      const secretVersion = this.getCurrentSecretVersion();
      // Concurrent readers share the lock; idx_tickets_ticket_item_active makes the
      // loser a no-op instead of aborting the transaction.
      await tx
        .insert(tickets)
        .values(missingTicketItems.map((ticketItem) => ({
          reservationId: first.reservationId,
          paymentId: first.paymentId,
          showtimeId: first.showtimeId,
          ticketItemId: ticketItem.id,
          qrTokenJti: randomUUID(),
          secretVersion,
          status: 'active' as const,
          issuedAt,
          emailScheduledAt,
          updatedAt: issuedAt,
        })))
        .onConflictDoNothing();

      return {
        ticketItems: ticketItemsInOrder,
        activeTickets: await this.findActiveTicketsByTicketItemIds(ticketItemIds, tx),
      };
    });
  }

  async getOrIssueTicketForReservation(input: {
    reservationId: string;
    paymentId: string;
  }): Promise<QrTicket> {
    const ticketRecord = await this.findFirstTicketWithSeatByReservationId(input.reservationId);

    if (!ticketRecord) {
      return this.ensureIssuedTicketForReservation(input);
    }

    const issueContext = await this.getReservationIssueContext(input);
    if (
      ticketRecord.paymentId !== issueContext.paymentId
      || ticketRecord.showtimeId !== issueContext.showtimeId
    ) {
      throw new NotFoundException('QR 티켓 발급 대상 예매를 찾을 수 없습니다');
    }

    const scheduledTicket =
      this.mapCredentialStatus(ticketRecord) === 'ACTIVE'
        ? this.withSeatIdentity(
            await this.ensureReminderSchedule(ticketRecord),
            ticketRecord,
          )
        : ticketRecord;
    return this.toQrTicket(scheduledTicket);
  }

  async getOwnedTicketForReservation(
    reservationId: string,
    userId: string,
  ): Promise<QrTicket> {
    const [ticket] = await this.getOwnedTicketsForReservation(reservationId, userId);
    if (!ticket) {
      throw new NotFoundException('QR 티켓을 찾을 수 없습니다');
    }

    return ticket;
  }

  async getOwnedTicketsForReservation(
    reservationId: string,
    userId: string,
  ): Promise<QrTicket[]> {
    const [reservationPayment] = await this.db
      .select({
        reservationId: reservations.id,
        paymentId: payments.id,
        paymentStatus: payments.status,
      })
      .from(reservations)
      .innerJoin(payments, eq(payments.reservationId, reservations.id))
      .where(
        and(
          eq(reservations.id, reservationId),
          eq(reservations.userId, userId),
          eq(reservations.status, 'CONFIRMED'),
          eq(payments.status, 'DONE'),
        ),
      );

    if (!reservationPayment) {
      throw new NotFoundException('QR 티켓을 찾을 수 없습니다');
    }

    return this.ensureIssuedTicketsForReservation(reservationPayment);
  }

  async getReservationTicket(reservationId: string): Promise<QrTicket | null> {
    const ticketRecord = await this.findFirstTicketWithSeatByReservationId(reservationId);
    if (!ticketRecord) {
      return null;
    }

    const scheduledTicket = this.withSeatIdentity(
      await this.ensureReminderSchedule(ticketRecord),
      ticketRecord,
    );
    return this.toQrTicket(scheduledTicket);
  }

  async sendOwnedTicketsForReservationEmail(
    reservationId: string,
    userId: string,
  ): Promise<{ ticketEmailDelivery: TicketEmailDelivery }> {
    const context = await this.findTicketEmailContext({ scope: 'owner', reservationId, userId });
    if (!context) {
      throw new NotFoundException('QR 티켓을 찾을 수 없습니다');
    }

    const delivery = this.resolveTicketEmailDelivery(context);
    if (!delivery.canSend) {
      throw new BadRequestException('티켓을 받을 이메일 인증이 필요합니다');
    }

    await this.sendTicketEmail(context);

    const sentAt = new Date();
    await this.db
      .update(tickets)
      .set({
        emailSentAt: sentAt,
        updatedAt: sentAt,
      })
      .where(inArray(tickets.id, context.tickets.map((ticket) => ticket.id)));

    return {
      ticketEmailDelivery: resolveTicketEmailDelivery({
        email: context.user.email,
        isEmailVerified: context.user.isEmailVerified,
        scheduledAt: delivery.scheduledAt,
        lastSentAt: sentAt.toISOString(),
      }),
    };
  }

  async verifyTicketToken(token: string): Promise<QrTicketTokenPayload> {
    const verified = await this.verifyTicketPayload(token);
    await this.requireValidTicketState(verified);

    return verified;
  }

  private async verifyTicketPayload(token: string, allowExpiredForScanner = false): Promise<QrTicketTokenPayload> {
    const decoded = this.jwtService.decode<Record<string, unknown> | null>(token);
    const secretVersion =
      decoded && typeof decoded === 'object' && typeof decoded['secretVersion'] === 'string'
        ? decoded['secretVersion']
        : null;

    if (!secretVersion) {
      throw new UnauthorizedException('유효하지 않은 QR 티켓입니다');
    }

    const secret = this.getVerificationSecret(secretVersion);
    let verified: QrTicketTokenPayload;
    try {
      verified = await this.jwtService.verifyAsync<QrTicketTokenPayload>(token, {
        secret, algorithms: ['HS256'], ignoreExpiration: allowExpiredForScanner,
      });
    } catch (error) {
      if (error instanceof Error && ['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError'].includes(error.name)) {
        throw new UnauthorizedException('유효하지 않은 QR 티켓입니다');
      }
      throw error;
    }

    if (
      verified.type !== 'qr-ticket'
      || verified.secretVersion !== secretVersion
      || !verified.jti
      || !verified.reservationId
      || !verified.paymentId
      || !verified.showtimeId
    ) {
      throw new UnauthorizedException('유효하지 않은 QR 티켓입니다');
    }

    if (!this.isSeatLevelPayload(verified)) {
      throw new UnauthorizedException('좌석별 QR 티켓을 다시 열어주세요');
    }

    return verified;
  }

  async verifyTicketForScannerContract(token: string, db: Pick<DrizzleDB, 'select'> = this.db): Promise<QrTicketScannerContract> {
    const payload = await this.verifyTicketPayload(token, true);
    const [row] = await db
      .select({
        ticketId: tickets.id,
        ticketItemId: ticketItems.id,
        ticketItemStatus: ticketItems.status,
        ticketItemAdmissionState: ticketItems.admissionState,
        enteredAt: ticketItems.enteredAt,
        reservationStatus: reservations.status,
        paymentStatus: payments.status,
        status: tickets.status,
        expiresAt: tickets.expiresAt,
        usedAt: tickets.usedAt,
        revokedAt: tickets.revokedAt,
        reservationNumber: reservations.reservationNumber,
        reservationId: reservations.id,
        userId: reservations.userId,
        paymentId: payments.id,
        showtimeId: showtimes.id,
        performanceId: performances.id,
        performanceTitle: performances.title,
        showtimeAt: showtimes.dateTime,
        venueName: venues.name,
        seatIdentity: {
          seatId: ticketItems.seatId,
          seatKey: ticketItems.seatKey,
          floorKey: ticketItems.floorKey,
          floorLabel: ticketItems.floorLabel,
          row: ticketItems.row,
          number: ticketItems.number,
          tierName: ticketItems.tierName,
        },
      })
      .from(tickets)
      .innerJoin(ticketItems, eq(tickets.ticketItemId, ticketItems.id))
      .innerJoin(reservations, eq(tickets.reservationId, reservations.id))
      .innerJoin(payments, eq(tickets.paymentId, payments.id))
      .innerJoin(showtimes, eq(tickets.showtimeId, showtimes.id))
      .innerJoin(performances, eq(showtimes.performanceId, performances.id))
      .leftJoin(venues, eq(performances.venueId, venues.id))
      .where(
        and(
          eq(tickets.qrTokenJti, payload.jti),
          eq(tickets.ticketItemId, payload.ticketItemId),
          eq(ticketItems.id, payload.ticketItemId),
          eq(tickets.reservationId, payload.reservationId),
          eq(tickets.paymentId, payload.paymentId),
          eq(tickets.showtimeId, payload.showtimeId),
        ),
      );

    if (!row) {
      throw new UnauthorizedException('사용할 수 없는 QR 티켓입니다');
    }

    return {
      tokenVersion: payload.secretVersion,
      ticketId: row.ticketId,
      ticketItemId: row.ticketItemId,
      userId: row.userId,
      ticketStatus: row.ticketItemStatus === 'expired' || (typeof payload.exp === 'number' && payload.exp <= Date.now() / 1000)
        ? 'EXPIRED'
        : row.ticketItemStatus !== 'active' || row.reservationStatus !== 'CONFIRMED' || row.paymentStatus !== 'DONE'
          ? 'REVOKED'
          : this.mapCredentialStatus(row) !== 'ACTIVE'
            ? this.mapCredentialStatus(row)
            : row.ticketItemAdmissionState === 'entered' ? 'USED' : this.mapScannerStatus(row),
      ticketItemStatus: row.ticketItemStatus,
      cancellationPending: row.ticketItemStatus === 'cancellation_pending',
      enteredAt: (row.enteredAt ?? row.usedAt)?.toISOString() ?? null,
      reservationNumber: row.reservationNumber,
      reservationId: row.reservationId,
      paymentId: row.paymentId,
      showtimeId: row.showtimeId,
      performanceId: row.performanceId,
      performanceTitle: row.performanceTitle,
      showtimeAt: row.showtimeAt.toISOString(),
      venueName: row.venueName ?? '',
      seatIdentity: row.seatIdentity,
      seatLabels: this.buildSeatLabels(row.seatIdentity),
      maskedJti: this.maskJti(payload.jti),
      verifiedAt: new Date().toISOString(),
    };
  }

  private async requireValidTicketState(
    payload: QrTicketTokenPayload,
  ): Promise<void> {
    const [row] = await this.db
      .select({
        ticket: this.ticketRecordFields(),
        ticketItemStatus: ticketItems.status,
        reservationStatus: reservations.status,
        paymentStatus: payments.status,
      })
      .from(tickets)
      .innerJoin(ticketItems, eq(tickets.ticketItemId, ticketItems.id))
      .innerJoin(reservations, eq(tickets.reservationId, reservations.id))
      .innerJoin(payments, eq(tickets.paymentId, payments.id))
      .where(
        and(
          eq(tickets.qrTokenJti, payload.jti),
          eq(tickets.ticketItemId, payload.ticketItemId),
          eq(tickets.reservationId, payload.reservationId),
          eq(tickets.paymentId, payload.paymentId),
          eq(tickets.showtimeId, payload.showtimeId),
        ),
      );

    if (!row) {
      throw new UnauthorizedException('유효하지 않은 QR 티켓입니다');
    }

    const ticketRecord = row.ticket;
    const isExpired =
      ticketRecord.expiresAt instanceof Date &&
      ticketRecord.expiresAt.getTime() <= Date.now();

    if (
      ticketRecord.status !== 'active'
      || ticketRecord.usedAt
      || ticketRecord.revokedAt
      || isExpired
      || row.ticketItemStatus !== 'active'
      || row.reservationStatus !== 'CONFIRMED'
      || row.paymentStatus !== 'DONE'
    ) {
      throw new UnauthorizedException('사용할 수 없는 QR 티켓입니다');
    }
  }

  private async findFirstTicketWithSeatByReservationId(
    reservationId: string,
  ): Promise<TicketWithSeatRecord | null> {
    const [ticketRecord] = await this.db
      .select(this.ticketWithSeatRecordFields())
      .from(tickets)
      .innerJoin(ticketItems, eq(tickets.ticketItemId, ticketItems.id))
      .where(eq(tickets.reservationId, reservationId))
      .orderBy(asc(ticketItems.createdAt), asc(ticketItems.id));

    return ticketRecord ? this.toTicketWithSeatRecord(ticketRecord) : null;
  }

  private async getReservationIssueContext(input: {
    reservationId: string;
    paymentId: string;
  }): Promise<ReservationIssueContext> {
    const [context] = await this.db
      .select({
        reservationId: reservations.id,
        paymentId: payments.id,
        paymentStatus: payments.status,
        showtimeId: reservations.showtimeId,
        showtimeAt: showtimes.dateTime,
      })
      .from(reservations)
      .innerJoin(payments, eq(payments.reservationId, reservations.id))
      .innerJoin(showtimes, eq(reservations.showtimeId, showtimes.id))
      .where(
        and(
          eq(reservations.id, input.reservationId),
          eq(payments.id, input.paymentId),
          eq(reservations.status, 'CONFIRMED'),
          eq(payments.status, 'DONE'),
        ),
      );

    if (!context || context.paymentStatus !== 'DONE') {
      throw new NotFoundException('QR 티켓 발급 대상 예매를 찾을 수 없습니다');
    }

    return context;
  }

  private async getReservationIssueContextWithTicketItems(input: {
    reservationId: string;
    paymentId: string;
  }): Promise<ReservationIssueContextWithTicketItems> {
    const rows = await this.selectIssueContextRows(this.db, input);

    const [first] = rows;
    if (!first || first.paymentStatus !== 'DONE') {
      throw new NotFoundException('QR 티켓 발급 대상 예매를 찾을 수 없습니다');
    }

    return {
      reservationId: first.reservationId,
      paymentId: first.paymentId,
      paymentStatus: first.paymentStatus,
      showtimeId: first.showtimeId,
      showtimeAt: first.showtimeAt,
      ticketItems: rows.map((row) => row.ticketItem),
    };
  }

  private async selectIssueContextRows(
    db: TicketReadDb,
    input: {
      reservationId: string;
      paymentId: string;
    },
  ): Promise<Array<ReservationIssueContext & { ticketItem: TicketItemIssueRecord }>> {
    return db
      .select({
        reservationId: reservations.id,
        paymentId: payments.id,
        paymentStatus: payments.status,
        showtimeId: reservations.showtimeId,
        showtimeAt: showtimes.dateTime,
        ticketItem: {
          id: ticketItems.id,
          seatId: ticketItems.seatId,
          seatKey: ticketItems.seatKey,
          floorKey: ticketItems.floorKey,
          floorLabel: ticketItems.floorLabel,
          row: ticketItems.row,
          number: ticketItems.number,
          tierName: ticketItems.tierName,
        },
      })
      .from(reservations)
      .innerJoin(payments, eq(payments.reservationId, reservations.id))
      .innerJoin(showtimes, eq(reservations.showtimeId, showtimes.id))
      .innerJoin(
        ticketItems,
        and(
          eq(ticketItems.reservationId, reservations.id),
          eq(ticketItems.paymentId, payments.id),
          eq(ticketItems.showtimeId, reservations.showtimeId),
          eq(ticketItems.status, 'active'),
        ),
      )
      .where(
        and(
          eq(reservations.id, input.reservationId),
          eq(payments.id, input.paymentId),
          eq(reservations.status, 'CONFIRMED'),
          eq(payments.status, 'DONE'),
        ),
      )
      .orderBy(asc(ticketItems.createdAt), asc(ticketItems.id));
  }

  private async findActiveTicketsByTicketItemIds(
    ticketItemIds: string[],
    db: TicketReadDb = this.db,
  ): Promise<TicketWithSeatRecord[]> {
    if (ticketItemIds.length === 0) {
      return [];
    }

    const rows = await db
      .select(this.ticketWithSeatRecordFields())
      .from(tickets)
      .innerJoin(ticketItems, eq(tickets.ticketItemId, ticketItems.id))
      .where(
        and(
          inArray(tickets.ticketItemId, ticketItemIds),
          eq(tickets.status, 'active'),
        ),
      )
      .orderBy(asc(ticketItems.createdAt), asc(ticketItems.id));

    return rows.map((row) => this.toTicketWithSeatRecord(row));
  }

  private maskJti(jti: string): string {
    if (jti.length <= 10) {
      return `${jti.slice(0, 2)}...${jti.slice(-2)}`;
    }

    return `${jti.slice(0, 6)}...${jti.slice(-4)}`;
  }

  private async ensureReminderSchedule(ticketRecord: TicketRecord): Promise<TicketRecord> {
    if (!ticketRecord.emailScheduledAt || ticketRecord.emailJobId || !this.pgBoss?.isAvailable) {
      return ticketRecord;
    }

    const jobId = await this.pgBoss.send<QrTicketEmailJobPayload>(
      PG_BOSS_JOB_NAMES.qrTicketEmailResend,
      {
        ticketId: ticketRecord.id,
        reservationId: ticketRecord.reservationId,
      },
      {
        startAfter: ticketRecord.emailScheduledAt,
        // Not a dedupe guarantee: the queue uses pg-boss' standard policy, which
        // ignores singletonKey. The email_job_id CAS below and the send claim in
        // handleReminderEmailJob are what prevent duplicate reminders.
        singletonKey: ticketRecord.id,
        retryLimit: 3,
        retryBackoff: true,
        retryDelay: 60,
      },
    );

    if (!jobId) {
      this.logger.warn(`QR reminder schedule skipped for ticketId=${ticketRecord.id}`);
      return ticketRecord;
    }

    const [updated] = await this.db
      .update(tickets)
      .set({
        emailJobId: jobId,
        updatedAt: new Date(),
      })
      .where(and(eq(tickets.id, ticketRecord.id), isNull(tickets.emailJobId)))
      .returning(this.ticketRecordFields());

    if (updated) {
      return updated;
    }

    // A concurrent read recorded its job first. This job stays queued but is
    // skipped by handleReminderEmailJob because it is not the recorded job.
    this.logger.log(
      `QR reminder already scheduled by a concurrent request. ticketId=${ticketRecord.id}, supersededJobId=${jobId}`,
    );
    const [current] = await this.db
      .select(this.ticketRecordFields())
      .from(tickets)
      .where(eq(tickets.id, ticketRecord.id));
    return current ?? ticketRecord;
  }

  private async ensureSingleReminderSchedule(
    ticketRecords: TicketWithSeatRecord[],
  ): Promise<TicketWithSeatRecord[]> {
    if (
      ticketRecords.length === 0
      || ticketRecords.some((ticket) => ticket.emailJobId || ticket.emailSentAt)
    ) {
      return ticketRecords;
    }

    const candidate = ticketRecords.find((ticket) => ticket.emailScheduledAt) ?? ticketRecords[0];
    if (!candidate) {
      return ticketRecords;
    }

    // The reminder is a side effect of issued QR tickets. A pg-boss or DB
    // failure here must not fail issuance or the buyer's QR lookup; the
    // missing emailJobId makes the next lookup schedule it again.
    let scheduled: TicketRecord;
    try {
      scheduled = await this.ensureReminderSchedule(candidate);
    } catch (error) {
      this.logger.warn(
        `QR reminder schedule failed; will retry on next lookup. ticketId=${candidate.id}`,
        error instanceof Error ? error.stack : String(error),
      );
      return ticketRecords;
    }
    return ticketRecords.map((ticket) =>
      ticket.id === scheduled.id
        ? this.withSeatIdentity(scheduled, ticket)
        : ticket,
    );
  }

  /**
   * One reminder per reservation, covering every active seat. The anchor ticket
   * only identifies the reservation and the recorded job; the send right is
   * claimed atomically on email_sent_at so duplicate jobs on other workers skip.
   */
  private async handleReminderEmailJob(
    payload: QrTicketEmailJobPayload,
    jobId?: string,
  ): Promise<void> {
    const [anchor] = await this.db
      .select({
        id: tickets.id,
        reservationId: tickets.reservationId,
        emailJobId: tickets.emailJobId,
      })
      .from(tickets)
      .where(eq(tickets.id, payload.ticketId));

    if (!anchor) {
      this.logger.warn(`QR reminder skipped: missing ticketId=${payload.ticketId}`);
      return;
    }

    if (jobId && anchor.emailJobId && anchor.emailJobId !== jobId) {
      this.logger.log(
        `QR reminder skipped: superseded job. ticketId=${anchor.id}, jobId=${jobId}`,
      );
      return;
    }

    const context = await this.findTicketEmailContext({
      scope: 'system-reminder',
      reservationId: anchor.reservationId,
    });
    if (!context) {
      return;
    }

    if (context.tickets.some((ticket) => ticket.emailSentAt)) {
      // email_sent_at is also the send claim. After a crash between claim and
      // send, the pg-boss retry lands here: a "claimed" log for this job id with
      // no matching "sent" log is the signal that the reminder was lost.
      this.logger.log(
        `QR reminder skipped: already sent or claimed. reservationId=${context.reservation.id}, jobId=${jobId ?? 'none'}`,
      );
      return;
    }

    const delivery = this.resolveTicketEmailDelivery(context);
    if (!delivery.canSend) {
      this.logger.warn(
        `QR reminder skipped: ticket email verification required for reservationId=${context.reservation.id}`,
      );
      return;
    }

    const claimedAt = new Date();
    const claimed = await this.db
      .update(tickets)
      .set({
        emailSentAt: claimedAt,
        updatedAt: claimedAt,
      })
      .where(
        and(
          inArray(tickets.id, context.tickets.map((ticket) => ticket.id)),
          eq(tickets.status, 'active'),
          isNull(tickets.emailSentAt),
        ),
      )
      .returning({ id: tickets.id });

    if (claimed.length === 0) {
      this.logger.log(
        `QR reminder skipped: claimed by another worker. reservationId=${context.reservation.id}, jobId=${jobId ?? 'none'}`,
      );
      return;
    }

    const logRef = `reservationId=${context.reservation.id}, jobId=${jobId ?? 'none'}, claimedAt=${claimedAt.toISOString()}`;
    this.logger.log(`QR reminder claimed. ${logRef}, ticketCount=${claimed.length}`);

    // The claim is the authority on what this job may send. A seat cancelled or
    // already emailed after the context read was not claimed, so its token must
    // not go out with this reminder.
    const claimedIds = new Set(claimed.map((row) => row.id));
    const claimedTickets = context.tickets.filter((ticket) => claimedIds.has(ticket.id));
    if (claimedTickets.length !== context.tickets.length) {
      this.logger.warn(
        `QR reminder partial claim. ${logRef}, readTicketCount=${context.tickets.length}, claimedTicketCount=${claimedTickets.length}`,
      );
    }

    try {
      await this.sendTicketEmail({ ...context, tickets: claimedTickets });
    } catch (error) {
      // Release the claim so the pg-boss retry can send. A crash before this
      // point leaves the claim in place (at-most-once reminder, never duplicate).
      const releasedCount = await this.releaseReminderClaim([...claimedIds], claimedAt);
      if (releasedCount !== null && releasedCount > 0) {
        this.logger.warn(`QR reminder claim released after send failure. ${logRef}, releasedCount=${releasedCount}`);
      } else if (releasedCount === 0) {
        this.logger.warn(`QR reminder claim already superseded after send failure. ${logRef}, releasedCount=0`);
      }
      throw error;
    }

    this.logger.log(`QR reminder sent. ${logRef}`);
  }

  /** Returns how many claimed rows were released, or null when the release itself failed. */
  private async releaseReminderClaim(ticketIds: string[], claimedAt: Date): Promise<number | null> {
    try {
      const released = await this.db
        .update(tickets)
        .set({
          emailSentAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            inArray(tickets.id, ticketIds),
            eq(tickets.emailSentAt, claimedAt),
          ),
        )
        .returning({ id: tickets.id });
      return released.length;
    } catch (error) {
      this.logger.error(
        `QR reminder claim release failed; email_sent_at keeps an unsent claim. ticketIds=${ticketIds.join(',')}`,
        error instanceof Error ? error.stack : String(error),
      );
      return null;
    }
  }

  /**
   * Buyer paths must pass `owner`; only the system reminder (whose job payload
   * came from this server) reads without an owner filter. Keeping the two
   * shapes distinct means a missing user id can never silently drop the filter.
   */
  private async findTicketEmailContext(
    input: TicketEmailContextScope,
  ): Promise<TicketEmailContext | undefined> {
    if (input.scope === 'owner' && !input.userId) {
      return undefined;
    }

    const rows = await this.db
      .select({
        ticket: this.ticketWithSeatRecordFields(),
        reservation: {
          id: reservations.id,
          reservationNumber: reservations.reservationNumber,
        },
        user: {
          email: users.email,
          isEmailVerified: users.isEmailVerified,
          preferredLocale: users.preferredLocale,
        },
        showtime: {
          dateTime: showtimes.dateTime,
        },
        performance: {
          title: performances.title,
        },
        venue: {
          name: venues.name,
        },
      })
      .from(tickets)
      .innerJoin(ticketItems, eq(tickets.ticketItemId, ticketItems.id))
      .innerJoin(reservations, eq(tickets.reservationId, reservations.id))
      .innerJoin(payments, eq(tickets.paymentId, payments.id))
      .innerJoin(users, eq(reservations.userId, users.id))
      .innerJoin(showtimes, eq(tickets.showtimeId, showtimes.id))
      .innerJoin(performances, eq(showtimes.performanceId, performances.id))
      .leftJoin(venues, eq(performances.venueId, venues.id))
      .where(
        and(
          eq(tickets.reservationId, input.reservationId),
          input.scope === 'owner' ? eq(reservations.userId, input.userId) : undefined,
          eq(reservations.status, 'CONFIRMED'),
          eq(payments.status, 'DONE'),
          eq(tickets.status, 'active'),
          eq(ticketItems.status, 'active'),
        ),
      )
      .orderBy(asc(ticketItems.createdAt), asc(ticketItems.id));

    const contextRows = rows as TicketEmailContextRow[];
    const [first] = contextRows;
    if (!first) {
      return undefined;
    }

    return {
      reservation: first.reservation,
      user: first.user,
      showtime: first.showtime,
      performance: first.performance,
      venue: first.venue,
      tickets: contextRows.map((row) => this.toTicketWithSeatRecord(row.ticket)),
    };
  }

  private resolveTicketEmailDelivery(context: TicketEmailContext): TicketEmailDelivery {
    const scheduledAt = context.tickets.find((ticket) => ticket.emailScheduledAt)?.emailScheduledAt;
    const lastSentAt = context.tickets
      .map((ticket) => ticket.emailSentAt)
      .filter((sentAt): sentAt is Date => sentAt instanceof Date)
      .sort((left, right) => right.getTime() - left.getTime())[0];

    return resolveTicketEmailDelivery({
      email: context.user.email,
      isEmailVerified: context.user.isEmailVerified,
      scheduledAt: scheduledAt?.toISOString() ?? null,
      lastSentAt: lastSentAt?.toISOString() ?? null,
    });
  }

  private async sendTicketEmail(context: TicketEmailContext): Promise<void> {
    const seatTickets = await Promise.all(
      context.tickets.map(async (ticket) => ({
        seatLabel: this.buildSeatLabels(ticket.seatIdentity).join(', '),
        token: await this.buildTicketToken(ticket),
      })),
    );
    const frontendUrl = getPrimaryFrontendUrl(this.configService.get<string>('FRONTEND_URL'));
    const ticketUrl = `${frontendUrl}/mypage/reservations/${context.reservation.id}`;
    const result = await this.emailService.sendQrTicketReminderEmail(context.user.email, {
      reservationNumber: context.reservation.reservationNumber,
      performanceTitle: context.performance.title,
      showDateTime: context.showtime.dateTime.toISOString(),
      venue: context.venue?.name ?? '',
      tickets: seatTickets,
      ticketUrl,
      locale: context.user.preferredLocale ?? 'ko',
    });

    if (!result.success) {
      throw new Error(result.error ?? 'QR reminder email send failed');
    }
  }

  /** Buyer-side signing (QR display and ticket email). */
  private async buildTicketToken(ticketRecord: TicketWithSeatRecord): Promise<string> {
    return this.jwtService.signAsync(
      {
        type: 'qr-ticket',
        jti: ticketRecord.qrTokenJti,
        reservationId: ticketRecord.reservationId,
        paymentId: ticketRecord.paymentId,
        showtimeId: ticketRecord.showtimeId,
        ticketItemId: ticketRecord.ticketItemId,
        seatIdentity: ticketRecord.seatIdentity,
        secretVersion: ticketRecord.secretVersion,
        issuedAt: ticketRecord.issuedAt.toISOString(),
      } satisfies QrTicketTokenPayload,
      {
        secret: this.getSigningSecretForIssuedTicket(ticketRecord),
        algorithm: 'HS256',
        noTimestamp: true,
      },
    );
  }

  private async toQrTicket(ticketRecord: TicketWithSeatRecord): Promise<QrTicket> {
    const status = this.mapCredentialStatus(ticketRecord);
    const isActive = status === 'ACTIVE';

    return {
      id: ticketRecord.id,
      ticketItemId: ticketRecord.ticketItemId,
      seatIdentity: ticketRecord.seatIdentity,
      token: isActive ? await this.buildTicketToken(ticketRecord) : '',
      jti: isActive ? ticketRecord.qrTokenJti : '',
      status,
      entryStatus: ticketRecord.usedAt ? 'ENTERED' : 'NOT_ENTERED',
      enteredAt: ticketRecord.usedAt?.toISOString() ?? null,
      issuedAt: ticketRecord.issuedAt.toISOString(),
      emailScheduledAt: ticketRecord.emailScheduledAt?.toISOString() ?? null,
      emailedAt: ticketRecord.emailSentAt?.toISOString() ?? null,
    };
  }

  private mapCredentialStatus(
    ticketRecord: Pick<TicketRecord, 'status' | 'expiresAt' | 'usedAt' | 'revokedAt'>,
  ): QrTicketStatus {
    const isExpired =
      ticketRecord.expiresAt instanceof Date &&
      ticketRecord.expiresAt.getTime() <= Date.now();

    if (ticketRecord.revokedAt || ticketRecord.status === 'revoked') {
      return 'REVOKED';
    }

    if (isExpired || ticketRecord.status === 'expired') {
      return 'EXPIRED';
    }

    return 'ACTIVE';
  }

  private mapScannerStatus(
    ticketRecord: Pick<TicketRecord, 'status' | 'expiresAt' | 'usedAt' | 'revokedAt'>,
  ): QrTicketStatus {
    if (ticketRecord.usedAt || ticketRecord.status === 'used') {
      return 'USED';
    }

    return this.mapCredentialStatus(ticketRecord);
  }

  private calculateEmailScheduledAt(showtimeAt: Date, issuedAt: Date): Date {
    const scheduledAt = new Date(showtimeAt.getTime() - DAY_IN_MS);
    return scheduledAt.getTime() <= issuedAt.getTime() ? issuedAt : scheduledAt;
  }

  private getCurrentSecretVersion(): string {
    const secretVersion = this.configService.get<string>('QR_TICKET_SECRET_VERSION')?.trim();
    if (!secretVersion) {
      throw new Error('QR_TICKET_SECRET_VERSION is required');
    }

    return secretVersion;
  }

  private getCurrentSecret(): string {
    const secret = this.configService.get<string>('QR_TICKET_SECRET')?.trim();
    if (!secret) {
      throw new Error('QR_TICKET_SECRET is required');
    }

    return secret;
  }

  /**
   * Scanner-side lookup for a presented token. The version comes from the token
   * before its signature is checked, so it is attacker-controlled. An unknown
   * version is an invalid credential from the scanner's point of view, so it
   * stays a 401 (tampered).
   */
  private getVerificationSecret(secretVersion: string): string {
    const secret = findKeyringSecret(this.loadSecretKeyring(), secretVersion);
    if (!secret) {
      this.logger.warn(
        `QR token presented with a secret version missing from the keyring. secretVersion=${JSON.stringify(secretVersion.slice(0, 40))}`,
      );
      throw new UnauthorizedException('알 수 없는 QR secret version 입니다');
    }

    return secret;
  }

  /**
   * Buyer-side lookup for a credential this server issued. A missing version is
   * a keyring misconfiguration, not a buyer auth failure: answering 401 would
   * make the web client refresh the session and report an expired login.
   */
  private getSigningSecretForIssuedTicket(
    ticketRecord: Pick<TicketRecord, 'id' | 'secretVersion'>,
  ): string {
    const secret = findKeyringSecret(this.loadSecretKeyring(), ticketRecord.secretVersion);
    if (!secret) {
      this.logger.error(
        `CRITICAL: QR secret version ${JSON.stringify(ticketRecord.secretVersion)} of issued ticketId=${ticketRecord.id} is missing from QR_TICKET_SECRET_KEYRING_JSON.`,
      );
      throw new InternalServerErrorException(
        'QR 티켓을 일시적으로 표시할 수 없습니다. 잠시 후 다시 시도해주세요.',
      );
    }

    return secret;
  }

  /**
   * Version → secret map used for signing and verification. QR_TICKET_SECRET
   * overrides the keyring JSON entry for the current version (startup reports a
   * conflict through reportSecretKeyringConflict). A Map, not a plain object, so
   * a token-supplied version such as `constructor` never resolves to an Object
   * prototype member.
   */
  private loadSecretKeyring(): Map<string, string> {
    const keyring = this.parseConfiguredKeyring();
    keyring.set(this.getCurrentSecretVersion(), this.getCurrentSecret());
    return keyring;
  }

  /** Entries of QR_TICKET_SECRET_KEYRING_JSON only, without the current-secret override. */
  private parseConfiguredKeyring(): Map<string, string> {
    const keyring = new Map<string, string>();
    const rawKeyring = this.configService.get<string>('QR_TICKET_SECRET_KEYRING_JSON')?.trim();

    if (!rawKeyring) {
      return keyring;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawKeyring);
    } catch (error) {
      throw new Error(
        `QR_TICKET_SECRET_KEYRING_JSON must be valid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('QR_TICKET_SECRET_KEYRING_JSON must be a JSON object');
    }

    for (const [version, secret] of Object.entries(parsed)) {
      if (typeof secret === 'string' && secret.trim().length > 0) {
        keyring.set(version, secret);
      }
    }

    return keyring;
  }

  private isSeatLevelPayload(
    payload: QrTicketTokenPayload,
  ): payload is QrTicketTokenPayload & {
    ticketItemId: string;
    seatIdentity: QrTicketSeatIdentity;
  } {
    return (
      typeof payload.ticketItemId === 'string'
      && payload.ticketItemId.length > 0
      && this.isSeatIdentity(payload.seatIdentity)
    );
  }

  private isSeatIdentity(value: unknown): value is QrTicketSeatIdentity {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }

    const candidate = value as Partial<Record<keyof QrTicketSeatIdentity, unknown>>;
    return [
      candidate.seatId,
      candidate.seatKey,
      candidate.floorKey,
      candidate.floorLabel,
      candidate.row,
      candidate.number,
      candidate.tierName,
    ].every((field) => typeof field === 'string' && field.length > 0);
  }

  private withSeatIdentity(
    ticketRecord: TicketRecord,
    source: Pick<TicketWithSeatRecord, 'seatIdentity'>,
  ): TicketWithSeatRecord {
    if (!ticketRecord.ticketItemId) {
      throw new UnauthorizedException('좌석별 QR 티켓을 다시 열어주세요');
    }

    return {
      ...ticketRecord,
      ticketItemId: ticketRecord.ticketItemId,
      seatIdentity: source.seatIdentity,
    };
  }

  private buildSeatLabels(seatIdentity: QrTicketSeatIdentity): string[] {
    return [`${seatIdentity.floorLabel || seatIdentity.floorKey} · ${seatIdentity.tierName} ${seatIdentity.row}열 ${seatIdentity.number}번`];
  }

  private ticketRecordFields() {
    return {
      id: tickets.id,
      reservationId: tickets.reservationId,
      paymentId: tickets.paymentId,
      showtimeId: tickets.showtimeId,
      ticketItemId: tickets.ticketItemId,
      qrTokenJti: tickets.qrTokenJti,
      secretVersion: tickets.secretVersion,
      status: tickets.status,
      issuedAt: tickets.issuedAt,
      expiresAt: tickets.expiresAt,
      usedAt: tickets.usedAt,
      revokedAt: tickets.revokedAt,
      emailScheduledAt: tickets.emailScheduledAt,
      emailSentAt: tickets.emailSentAt,
      emailJobId: tickets.emailJobId,
    };
  }

  private ticketWithSeatRecordFields() {
    return {
      ...this.ticketRecordFields(),
      seatId: ticketItems.seatId,
      seatKey: ticketItems.seatKey,
      floorKey: ticketItems.floorKey,
      floorLabel: ticketItems.floorLabel,
      row: ticketItems.row,
      number: ticketItems.number,
      tierName: ticketItems.tierName,
    };
  }

  private toTicketWithSeatRecord(row: TicketWithSeatRow): TicketWithSeatRecord {
    if (!row.ticketItemId) {
      throw new UnauthorizedException('좌석별 QR 티켓을 다시 열어주세요');
    }

    return {
      id: row.id,
      reservationId: row.reservationId,
      paymentId: row.paymentId,
      showtimeId: row.showtimeId,
      ticketItemId: row.ticketItemId,
      qrTokenJti: row.qrTokenJti,
      secretVersion: row.secretVersion,
      status: row.status,
      issuedAt: row.issuedAt,
      expiresAt: row.expiresAt,
      usedAt: row.usedAt,
      revokedAt: row.revokedAt,
      emailScheduledAt: row.emailScheduledAt,
      emailSentAt: row.emailSentAt,
      emailJobId: row.emailJobId,
      seatIdentity: {
        seatId: row.seatId,
        seatKey: row.seatKey,
        floorKey: row.floorKey,
        floorLabel: row.floorLabel,
        row: row.row,
        number: row.number,
        tierName: row.tierName,
      },
    };
  }
}

/**
 * Own-entry, non-empty string lookup. jsonwebtoken treats a function secret as
 * an async key getter and never settles when it is not called back, so a
 * non-string value must never be returned as a secret.
 */
function findKeyringSecret(keyring: Map<string, string>, secretVersion: string): string | undefined {
  const secret = keyring.get(secretVersion);
  return typeof secret === 'string' && secret.length > 0 ? secret : undefined;
}
