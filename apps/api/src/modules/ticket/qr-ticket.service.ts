import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
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

export interface QrTicketTokenPayload {
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
  tokenVersion: string;
  ticketStatus: QrTicketStatus;
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
    if (!this.pgBoss?.isAvailable) {
      return;
    }

    try {
      await this.pgBoss.work<QrTicketEmailJobPayload>(
        PG_BOSS_JOB_NAMES.qrTicketEmailResend,
        async ([job]) => {
          if (!job) {
            return;
          }

          await this.handleReminderEmailJob(job.data);
        },
      );
    } catch (error) {
      this.logger.error(
        'QR reminder worker registration failed',
        error instanceof Error ? error.stack : String(error),
      );
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
    const ticketItemIds = issueContext.ticketItems.map((ticketItem) => ticketItem.id);
    const existingTickets = await this.findActiveTicketsByTicketItemIds(ticketItemIds);
    const existingTicketItemIds = new Set(
      existingTickets.map((ticket) => ticket.ticketItemId),
    );
    const issuedAt = new Date();
    const emailScheduledAt = this.calculateEmailScheduledAt(issueContext.showtimeAt, issuedAt);

    for (const ticketItem of issueContext.ticketItems) {
      if (existingTicketItemIds.has(ticketItem.id)) {
        continue;
      }

      try {
        await this.db
          .insert(tickets)
          .values({
            reservationId: issueContext.reservationId,
            paymentId: issueContext.paymentId,
            showtimeId: issueContext.showtimeId,
            ticketItemId: ticketItem.id,
            qrTokenJti: randomUUID(),
            secretVersion: this.getCurrentSecretVersion(),
            status: 'active',
            issuedAt,
            emailScheduledAt,
            updatedAt: issuedAt,
          })
          .returning(this.ticketRecordFields());
      } catch (error) {
        if (!this.isUniqueViolation(error)) {
          throw error;
        }
      }
    }

    const activeTickets = await this.findActiveTicketsByTicketItemIds(ticketItemIds);
    const activeTicketByItemId = new Map(
      activeTickets.map((ticket) => [ticket.ticketItemId, ticket]),
    );
    const orderedTickets = issueContext.ticketItems.map((ticketItem) =>
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
    const row = await this.findTicketEmailContext({ reservationId, userId });
    if (!row) {
      throw new NotFoundException('QR 티켓을 찾을 수 없습니다');
    }

    const ticket = this.toTicketWithSeatRecord(row.ticket);
    const delivery = this.resolveTicketEmailDelivery(row, ticket);
    if (!delivery.canSend) {
      throw new BadRequestException('티켓을 받을 이메일 인증이 필요합니다');
    }

    await this.sendTicketEmail(row, ticket);

    const sentAt = new Date();
    await this.db
      .update(tickets)
      .set({
        emailSentAt: sentAt,
        updatedAt: sentAt,
      })
      .where(eq(tickets.id, ticket.id));

    return {
      ticketEmailDelivery: resolveTicketEmailDelivery({
        email: row.user.email,
        isEmailVerified: row.user.isEmailVerified,
        scheduledAt: ticket.emailScheduledAt?.toISOString() ?? null,
        lastSentAt: sentAt.toISOString(),
      }),
    };
  }

  async verifyTicketToken(token: string): Promise<QrTicketTokenPayload> {
    const verified = await this.verifyTicketPayload(token);
    await this.requireValidTicketState(verified);

    return verified;
  }

  private async verifyTicketPayload(token: string): Promise<QrTicketTokenPayload> {
    const decoded = this.jwtService.decode<Record<string, unknown> | null>(token);
    const secretVersion =
      decoded && typeof decoded === 'object' && typeof decoded['secretVersion'] === 'string'
        ? decoded['secretVersion']
        : null;

    if (!secretVersion) {
      throw new UnauthorizedException('유효하지 않은 QR 티켓입니다');
    }

    const verified = await this.jwtService.verifyAsync<QrTicketTokenPayload>(token, {
      secret: this.getVerificationSecret(secretVersion),
      algorithms: ['HS256'],
    });

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

  async verifyTicketForScannerContract(token: string): Promise<QrTicketScannerContract> {
    const payload = await this.verifyTicketPayload(token);
    const [row] = await this.db
      .select({
        ticketId: tickets.id,
        ticketItemId: ticketItems.id,
        ticketItemStatus: ticketItems.status,
        ticketItemAdmissionState: ticketItems.admissionState,
        status: tickets.status,
        expiresAt: tickets.expiresAt,
        usedAt: tickets.usedAt,
        revokedAt: tickets.revokedAt,
        reservationNumber: reservations.reservationNumber,
        reservationId: reservations.id,
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
          eq(reservations.status, 'CONFIRMED'),
          eq(payments.status, 'DONE'),
        ),
      );

    if (!row) {
      throw new UnauthorizedException('사용할 수 없는 QR 티켓입니다');
    }
    if (row.ticketItemStatus !== 'active') {
      throw new UnauthorizedException('사용할 수 없는 QR 티켓입니다');
    }

    return {
      tokenVersion: payload.secretVersion,
      ticketId: row.ticketId,
      ticketItemId: row.ticketItemId,
      ticketStatus: row.ticketItemAdmissionState === 'entered'
        ? 'USED'
        : this.mapScannerStatus(row),
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
    const rows = await this.db
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

  private async findActiveTicketsByTicketItemIds(
    ticketItemIds: string[],
  ): Promise<TicketWithSeatRecord[]> {
    if (ticketItemIds.length === 0) {
      return [];
    }

    const rows = await this.db
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
      .where(eq(tickets.id, ticketRecord.id))
      .returning(this.ticketRecordFields());

    return updated ?? { ...ticketRecord, emailJobId: jobId };
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

    const scheduled = await this.ensureReminderSchedule(candidate);
    return ticketRecords.map((ticket) =>
      ticket.id === scheduled.id
        ? this.withSeatIdentity(scheduled, ticket)
        : ticket,
    );
  }

  private async handleReminderEmailJob(payload: QrTicketEmailJobPayload): Promise<void> {
    const [row] = await this.db
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
      .innerJoin(users, eq(reservations.userId, users.id))
      .innerJoin(showtimes, eq(tickets.showtimeId, showtimes.id))
      .innerJoin(performances, eq(showtimes.performanceId, performances.id))
      .leftJoin(venues, eq(performances.venueId, venues.id))
      .where(eq(tickets.id, payload.ticketId));

    if (!row) {
      this.logger.warn(`QR reminder skipped: missing ticketId=${payload.ticketId}`);
      return;
    }

    const ticket = this.toTicketWithSeatRecord(row.ticket);
    if (ticket.emailSentAt || ticket.status !== 'active') {
      return;
    }

    const delivery = this.resolveTicketEmailDelivery(row as TicketEmailContextRow, ticket);
    if (!delivery.canSend) {
      this.logger.warn(
        `QR reminder skipped: ticket email verification required for reservationId=${row.reservation.id}`,
      );
      return;
    }

    await this.sendTicketEmail(row as TicketEmailContextRow, ticket);

    await this.db
      .update(tickets)
      .set({
        emailSentAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(tickets.id, ticket.id));
  }

  private async findTicketEmailContext(input: {
    reservationId: string;
    userId: string;
  }): Promise<TicketEmailContextRow | undefined> {
    const [row] = await this.db
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
          eq(reservations.userId, input.userId),
          eq(reservations.status, 'CONFIRMED'),
          eq(payments.status, 'DONE'),
          eq(tickets.status, 'active'),
        ),
      );

    return row as TicketEmailContextRow | undefined;
  }

  private resolveTicketEmailDelivery(
    row: TicketEmailContextRow,
    ticket: TicketWithSeatRecord,
  ): TicketEmailDelivery {
    return resolveTicketEmailDelivery({
      email: row.user.email,
      isEmailVerified: row.user.isEmailVerified,
      scheduledAt: ticket.emailScheduledAt?.toISOString() ?? null,
      lastSentAt: ticket.emailSentAt?.toISOString() ?? null,
    });
  }

  private async sendTicketEmail(
    row: TicketEmailContextRow,
    ticket: TicketWithSeatRecord,
  ): Promise<void> {
    const ticketToken = await this.buildTicketToken(ticket);
    const frontendUrl = (
      this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:3000'
    ).replace(/\/$/, '');
    const ticketUrl = `${frontendUrl}/mypage/reservations/${row.reservation.id}`;
    const result = await this.emailService.sendQrTicketReminderEmail(row.user.email, {
      reservationNumber: row.reservation.reservationNumber,
      performanceTitle: row.performance.title,
      showDateTime: row.showtime.dateTime.toISOString(),
      venue: row.venue?.name ?? '',
      ticketToken,
      ticketUrl,
      locale: row.user.preferredLocale ?? 'ko',
    });

    if (!result.success) {
      throw new Error(result.error ?? 'QR reminder email send failed');
    }
  }

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
        secret: this.getVerificationSecret(ticketRecord.secretVersion),
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

  private getVerificationSecret(secretVersion: string): string {
    const keyring = this.loadSecretKeyring();
    const secret = keyring[secretVersion];
    if (!secret) {
      throw new UnauthorizedException('알 수 없는 QR secret version 입니다');
    }

    return secret;
  }

  private loadSecretKeyring(): Record<string, string> {
    const currentVersion = this.getCurrentSecretVersion();
    const currentSecret = this.getCurrentSecret();
    const rawKeyring = this.configService.get<string>('QR_TICKET_SECRET_KEYRING_JSON')?.trim();

    if (!rawKeyring) {
      return {
        [currentVersion]: currentSecret,
      };
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

    const keyring = Object.entries(parsed).reduce<Record<string, string>>((acc, [version, secret]) => {
      if (typeof secret === 'string' && secret.trim().length > 0) {
        acc[version] = secret;
      }
      return acc;
    }, {});

    keyring[currentVersion] = currentSecret;
    return keyring;
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object'
      && error !== null
      && 'code' in error
      && (error as { code?: string }).code === '23505'
    );
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
    return [`${seatIdentity.tierName} ${seatIdentity.row}열 ${seatIdentity.number}번`];
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
