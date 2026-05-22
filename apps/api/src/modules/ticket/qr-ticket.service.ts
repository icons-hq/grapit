import {
  Inject,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { QrTicket, QrTicketStatus } from '@grabit/shared';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import {
  payments,
  performances,
  reservations,
  showtimes,
  tickets,
  users,
  venues,
} from '../../database/schema/index.js';
import { EmailService } from '../auth/email/email.service.js';
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

type ReservationIssueContext = {
  reservationId: string;
  paymentId: string;
  paymentStatus: string;
  showtimeId: string;
  showtimeAt: Date;
};

type QrTicketEmailJobPayload = {
  ticketId: string;
  reservationId: string;
};

export interface QrTicketTokenPayload {
  type: 'qr-ticket';
  jti: string;
  reservationId: string;
  paymentId: string;
  showtimeId: string;
  secretVersion: string;
  issuedAt: string;
}

export interface QrTicketScannerContract {
  ticketId?: string;
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
  seatLabels?: string[];
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
    let ticketRecord = await this.findTicketByReservationId(input.reservationId);

    if (ticketRecord) {
      const issueContext = await this.getReservationIssueContext(input);
      if (
        ticketRecord.paymentId !== issueContext.paymentId
        || ticketRecord.showtimeId !== issueContext.showtimeId
      ) {
        throw new NotFoundException('QR 티켓 발급 대상 예매를 찾을 수 없습니다');
      }
      if (ticketRecord.status !== 'active') {
        throw new ConflictException('QR 티켓이 활성 상태가 아닙니다');
      }
    } else {
      const issueContext = await this.getReservationIssueContext(input);
      const issuedAt = new Date();
      const emailScheduledAt = this.calculateEmailScheduledAt(issueContext.showtimeAt, issuedAt);

      try {
        const inserted = await this.db
          .insert(tickets)
          .values({
            reservationId: issueContext.reservationId,
            paymentId: issueContext.paymentId,
            showtimeId: issueContext.showtimeId,
            qrTokenJti: randomUUID(),
            secretVersion: this.getCurrentSecretVersion(),
            status: 'active',
            issuedAt,
            emailScheduledAt,
            updatedAt: issuedAt,
          })
          .returning(this.ticketRecordFields());

        ticketRecord = inserted[0] ?? null;
      } catch (error) {
        if (!this.isUniqueViolation(error)) {
          throw error;
        }
      }

      ticketRecord ??= await this.requireTicketByReservationId(input.reservationId);
    }

    const scheduledTicket = await this.ensureReminderSchedule(ticketRecord);
    return this.toQrTicket(scheduledTicket);
  }

  async getOwnedTicketForReservation(
    reservationId: string,
    userId: string,
  ): Promise<QrTicket> {
    const [existingTicket] = await this.db
      .select({
        ticket: this.ticketRecordFields(),
      })
      .from(tickets)
      .innerJoin(reservations, eq(tickets.reservationId, reservations.id))
      .where(
        and(
          eq(tickets.reservationId, reservationId),
          eq(reservations.userId, userId),
        ),
      );

    if (existingTicket?.ticket) {
      const scheduledTicket = await this.ensureReminderSchedule(existingTicket.ticket);
      return this.toQrTicket(scheduledTicket);
    }

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

    return this.ensureIssuedTicketForReservation(reservationPayment);
  }

  async getReservationTicket(reservationId: string): Promise<QrTicket | null> {
    const ticketRecord = await this.findTicketByReservationId(reservationId);
    if (!ticketRecord) {
      return null;
    }

    const scheduledTicket = await this.ensureReminderSchedule(ticketRecord);
    return this.toQrTicket(scheduledTicket);
  }

  async verifyTicketToken(token: string): Promise<QrTicketTokenPayload> {
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

    await this.requireValidTicketState(verified);

    return verified;
  }

  async verifyTicketForScannerContract(token: string): Promise<QrTicketScannerContract> {
    const payload = await this.verifyTicketToken(token);
    const [row] = await this.db
      .select({
        ticketId: tickets.id,
        ticketStatus: tickets.status,
        reservationNumber: reservations.reservationNumber,
        reservationId: reservations.id,
        paymentId: payments.id,
        showtimeId: showtimes.id,
        performanceId: performances.id,
        performanceTitle: performances.title,
        showtimeAt: showtimes.dateTime,
        venueName: venues.name,
      })
      .from(tickets)
      .innerJoin(reservations, eq(tickets.reservationId, reservations.id))
      .innerJoin(payments, eq(tickets.paymentId, payments.id))
      .innerJoin(showtimes, eq(tickets.showtimeId, showtimes.id))
      .innerJoin(performances, eq(showtimes.performanceId, performances.id))
      .leftJoin(venues, eq(performances.venueId, venues.id))
      .where(
        and(
          eq(tickets.qrTokenJti, payload.jti),
          eq(tickets.reservationId, payload.reservationId),
          eq(tickets.paymentId, payload.paymentId),
          eq(tickets.showtimeId, payload.showtimeId),
          eq(reservations.status, 'CONFIRMED'),
          eq(payments.status, 'DONE'),
          eq(tickets.status, 'active'),
        ),
      );

    if (!row) {
      throw new UnauthorizedException('사용할 수 없는 QR 티켓입니다');
    }

    return {
      tokenVersion: payload.secretVersion,
      ticketId: row.ticketId,
      ticketStatus: this.mapStatus(row.ticketStatus),
      reservationNumber: row.reservationNumber,
      reservationId: row.reservationId,
      paymentId: row.paymentId,
      showtimeId: row.showtimeId,
      performanceId: row.performanceId,
      performanceTitle: row.performanceTitle,
      showtimeAt: row.showtimeAt.toISOString(),
      venueName: row.venueName ?? '',
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
        reservationStatus: reservations.status,
        paymentStatus: payments.status,
      })
      .from(tickets)
      .innerJoin(reservations, eq(tickets.reservationId, reservations.id))
      .innerJoin(payments, eq(tickets.paymentId, payments.id))
      .where(
        and(
          eq(tickets.qrTokenJti, payload.jti),
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
      || row.reservationStatus !== 'CONFIRMED'
      || row.paymentStatus !== 'DONE'
    ) {
      throw new UnauthorizedException('사용할 수 없는 QR 티켓입니다');
    }
  }

  private async findTicketByReservationId(reservationId: string): Promise<TicketRecord | null> {
    const [ticketRecord] = await this.db
      .select(this.ticketRecordFields())
      .from(tickets)
      .where(eq(tickets.reservationId, reservationId));

    return ticketRecord ?? null;
  }

  private async requireTicketByReservationId(reservationId: string): Promise<TicketRecord> {
    const ticketRecord = await this.findTicketByReservationId(reservationId);
    if (!ticketRecord) {
      throw new NotFoundException('QR 티켓을 찾을 수 없습니다');
    }

    return ticketRecord;
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

  private async handleReminderEmailJob(payload: QrTicketEmailJobPayload): Promise<void> {
    const [row] = await this.db
      .select({
        ticket: this.ticketRecordFields(),
        reservation: {
          id: reservations.id,
          reservationNumber: reservations.reservationNumber,
        },
        user: {
          email: users.email,
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

    if (row.ticket.emailSentAt || row.ticket.status !== 'active') {
      return;
    }

    const ticketToken = await this.buildTicketToken(row.ticket);
    const frontendUrl = (this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:3000').replace(
      /\/$/,
      '',
    );
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

    await this.db
      .update(tickets)
      .set({
        emailSentAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(tickets.id, row.ticket.id));
  }

  private async buildTicketToken(ticketRecord: TicketRecord): Promise<string> {
    return this.jwtService.signAsync(
      {
        type: 'qr-ticket',
        jti: ticketRecord.qrTokenJti,
        reservationId: ticketRecord.reservationId,
        paymentId: ticketRecord.paymentId,
        showtimeId: ticketRecord.showtimeId,
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

  private toQrTicket(ticketRecord: TicketRecord): QrTicket | Promise<QrTicket> {
    return this.buildTicketToken(ticketRecord).then((token) => ({
      token,
      jti: ticketRecord.qrTokenJti,
      status: this.mapStatus(ticketRecord.status),
      issuedAt: ticketRecord.issuedAt.toISOString(),
      emailScheduledAt: ticketRecord.emailScheduledAt?.toISOString() ?? null,
      emailedAt: ticketRecord.emailSentAt?.toISOString() ?? null,
    }));
  }

  private mapStatus(status: TicketRecord['status']): QrTicketStatus {
    switch (status) {
      case 'active':
        return 'ACTIVE';
      case 'revoked':
        return 'REVOKED';
      case 'used':
        return 'USED';
      case 'expired':
        return 'EXPIRED';
    }
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

  private ticketRecordFields() {
    return {
      id: tickets.id,
      reservationId: tickets.reservationId,
      paymentId: tickets.paymentId,
      showtimeId: tickets.showtimeId,
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
}
