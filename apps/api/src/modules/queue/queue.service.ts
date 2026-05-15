import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import type IORedis from 'ioredis';
import { AUTH_COOKIE_NAME } from '@grabit/shared/constants/index.js';
import { REDIS_CLIENT } from '../booking/providers/redis.provider.js';
import { DRIZZLE } from '../../database/drizzle.provider.js';
import type { DrizzleDB } from '../../database/drizzle.provider.js';
import { refreshTokens } from '../../database/schema/refresh-tokens.js';
import { reservations } from '../../database/schema/reservations.js';
import { seatInventories } from '../../database/schema/seat-inventories.js';
import { seatMaps } from '../../database/schema/seat-maps.js';
import { showtimes } from '../../database/schema/showtimes.js';
import { performances } from '../../database/schema/performances.js';
import { QueueGateway } from './queue.gateway.js';

export const QUEUE_ADMISSION_COOKIE_NAME = 'grabit_queue_admission';
export const QUEUE_ADMISSION_COOKIE_MAX_AGE_MS = 780_000;
export const QUEUE_ACTIVE_WINDOW_SECONDS = 600;
export const QUEUE_REENTRY_GRACE_SECONDS = 180;

const QUEUE_WAIT_SESSION_SECONDS = 1_800;
const QUEUE_EXPIRED_RETENTION_SECONDS = 300;
const QUEUE_MAX_ACTIVE_ADMISSIONS = 25;
const QUEUE_POSITION_STEP_SECONDS = 15;

export const WAITING = 'WAITING';
export const ADMITTED = 'ADMITTED';
export const PAYMENT_RECOVERY = 'PAYMENT_RECOVERY';
export const EXPIRED = 'EXPIRED';

export type QueueSessionState =
  | typeof WAITING
  | typeof ADMITTED
  | typeof PAYMENT_RECOVERY
  | typeof EXPIRED;

export type QueueIdentity = {
  userId: string;
  refreshTokenFamilyId: string;
  deviceSlotId: string;
};

type QueueSessionRecord = {
  queueSessionId: string;
  performanceId: string;
  userId: string;
  refreshTokenFamilyId: string;
  deviceSlotId: string;
  admissionTokenHash: string;
  state: QueueSessionState;
  enteredAt: string;
  admittedAt: string | null;
  activeUntilAt: string | null;
  reentryGraceUntilAt: string | null;
  paymentRecoveryUntilAt: string | null;
  expiresAt: string;
};

export type QueueSessionLease = QueueIdentity & {
  queueSessionId: string;
  admissionToken: string;
};

export type QueueSessionSnapshot = {
  queueSessionId: string;
  state: QueueSessionState;
  position: number;
  waitingCount: number;
  etaSeconds: number;
  remainingSeats: number;
  autoEnter: boolean;
  admittedAt: string | null;
  activeUntilAt: string | null;
  reentryGraceUntilAt: string | null;
};

type QueueEnterResult = QueueSessionSnapshot & {
  admissionToken: string;
};

type QueueStatusParams = {
  queueSessionId: string;
  identity: QueueIdentity;
  admissionToken: string;
};

type QueueAction = 'lock-seat' | 'prepare-reservation' | 'confirm-payment';

type QueueActionParams = {
  performanceId: string;
  identity: QueueIdentity;
  admissionToken: string;
  action: QueueAction;
};

export type ValidatedAdmission = QueueIdentity & {
  queueSessionId: string;
  admittedAt: string;
  activeUntilAt: string;
  reentryGraceUntilAt: string;
};

@Injectable()
export class QueueService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: IORedis,
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly gateway: QueueGateway,
  ) {}

  async resolveBrowserIdentity(
    userId: string,
    refreshToken: string | undefined,
  ): Promise<QueueIdentity> {
    if (!refreshToken) {
      throw new UnauthorizedException('브라우저 세션이 필요합니다');
    }

    const tokenHash = createHash('sha256').update(refreshToken).digest('hex');
    const [tokenRecord] = await this.db
      .select({
        family: refreshTokens.family,
      })
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.userId, userId),
          eq(refreshTokens.tokenHash, tokenHash),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, new Date()),
        ),
      );

    if (!tokenRecord) {
      throw new UnauthorizedException('유효한 브라우저 세션이 필요합니다');
    }

    return {
      userId,
      refreshTokenFamilyId: tokenRecord.family,
      deviceSlotId: tokenRecord.family,
    };
  }

  async ensureQueueSession(params: {
    performanceId: string;
    identity: QueueIdentity;
  }): Promise<QueueSessionLease> {
    const { performanceId, identity } = params;
    const identityKey = this.identityKey(performanceId, identity);
    const existingSessionId = await this.redis.get(identityKey);
    const now = new Date();

    let record: QueueSessionRecord | null = null;
    if (existingSessionId) {
      record = await this.readQueueSessionRecord(performanceId, existingSessionId);
      if (record && this.isReusable(record, now)) {
        const rotated = this.rotateAdmissionToken(record);
        await this.persistQueueSessionRecord(rotated.record);
        return {
          queueSessionId: rotated.record.queueSessionId,
          admissionToken: rotated.admissionToken,
          userId: rotated.record.userId,
          refreshTokenFamilyId: rotated.record.refreshTokenFamilyId,
          deviceSlotId: rotated.record.deviceSlotId,
        };
      }

      if (record) {
        await this.purgeQueueSessionRecord(record);
      } else {
        await this.redis.del(identityKey);
      }
    }

    const created = this.rotateAdmissionToken({
      queueSessionId: randomUUID(),
      performanceId,
      userId: identity.userId,
      refreshTokenFamilyId: identity.refreshTokenFamilyId,
      deviceSlotId: identity.deviceSlotId,
      admissionTokenHash: '',
      state: WAITING,
      enteredAt: now.toISOString(),
      admittedAt: null,
      activeUntilAt: null,
      reentryGraceUntilAt: null,
      paymentRecoveryUntilAt: null,
      expiresAt: new Date(now.getTime() + QUEUE_WAIT_SESSION_SECONDS * 1000).toISOString(),
    });

    await this.persistQueueSessionRecord(created.record);
    await this.redis.zadd(
      this.waitingQueueKey(performanceId),
      now.getTime(),
      created.record.queueSessionId,
    );

    return {
      queueSessionId: created.record.queueSessionId,
      admissionToken: created.admissionToken,
      userId: created.record.userId,
      refreshTokenFamilyId: created.record.refreshTokenFamilyId,
      deviceSlotId: created.record.deviceSlotId,
    };
  }

  async enterPerformanceQueue(params: {
    performanceId: string;
    identity: QueueIdentity;
    bypassQueue?: boolean;
    actorRole?: string;
  }): Promise<QueueEnterResult> {
    await this.assertPerformanceBookingOpen(params.performanceId, params.actorRole);
    const lease = await this.ensureQueueSession(params);
    if (params.bypassQueue) {
      await this.admitQueueSession(params.performanceId, lease.queueSessionId);
    } else {
      await this.reconcilePerformanceQueue(params.performanceId);
    }

    const snapshot = await this.getQueueSessionStatus({
      queueSessionId: lease.queueSessionId,
      identity: lease,
      admissionToken: lease.admissionToken,
    });

    return {
      ...snapshot,
      admissionToken: lease.admissionToken,
    };
  }

  private async assertPerformanceBookingOpen(
    performanceId: string,
    actorRole: string | undefined,
  ): Promise<void> {
    if (actorRole === 'admin') {
      return;
    }

    const [row] = await this.db
      .select({ status: performances.status })
      .from(performances)
      .where(eq(performances.id, performanceId));

    if (row?.status === 'upcoming') {
      throw new ForbiddenException('예매는 추후 오픈 예정입니다');
    }
  }

  private async admitQueueSession(
    performanceId: string,
    queueSessionId: string,
  ): Promise<void> {
    const record = await this.readQueueSessionRecord(performanceId, queueSessionId);
    if (!record || record.state === EXPIRED || record.state === ADMITTED) {
      return;
    }

    const admittedRecord = this.toAdmittedRecord(record);
    await this.persistQueueSessionRecord(admittedRecord);
    await this.redis.zrem(this.waitingQueueKey(performanceId), queueSessionId);
    await this.redis.sadd(this.activeAdmissionsKey(performanceId), queueSessionId);
    this.gateway.emitAdmitted(queueSessionId, await this.buildSnapshot(admittedRecord));
  }

  async getQueueSessionStatus(params: QueueStatusParams): Promise<QueueSessionSnapshot> {
    const performanceId = await this.redis.get(this.sessionRefKey(params.queueSessionId));
    if (!performanceId) {
      throw new NotFoundException('대기열 세션을 찾을 수 없습니다');
    }

    await this.reconcilePerformanceQueue(performanceId);

    const record = await this.readQueueSessionRecord(performanceId, params.queueSessionId);
    if (!record) {
      throw new NotFoundException('대기열 세션을 찾을 수 없습니다');
    }

    this.assertRecordMatchesIdentity(record, params.identity);
    this.assertAdmissionTokenMatches(record, params.admissionToken);

    return this.buildSnapshot(record);
  }

  async assertAdmissionForShowtime(params: {
    showtimeId: string;
    identity: QueueIdentity;
    admissionToken: string;
    action: Exclude<QueueAction, 'confirm-payment'>;
  }): Promise<ValidatedAdmission> {
    const [showtime] = await this.db
      .select({
        performanceId: showtimes.performanceId,
      })
      .from(showtimes)
      .where(eq(showtimes.id, params.showtimeId));

    if (!showtime) {
      throw new NotFoundException('회차를 찾을 수 없습니다');
    }

    return this.assertAdmissionForPerformance({
      performanceId: showtime.performanceId,
      identity: params.identity,
      admissionToken: params.admissionToken,
      action: params.action,
    });
  }

  async assertAdmissionForOrder(params: {
    orderId: string;
    userId: string;
    identity: QueueIdentity;
    admissionToken: string;
  }): Promise<ValidatedAdmission> {
    const [reservation] = await this.db
      .select({
        performanceId: showtimes.performanceId,
      })
      .from(reservations)
      .innerJoin(showtimes, eq(reservations.showtimeId, showtimes.id))
      .where(
        and(
          eq(reservations.tossOrderId, params.orderId),
          eq(reservations.userId, params.userId),
        ),
      );

    if (!reservation) {
      throw new NotFoundException('예매 정보를 찾을 수 없습니다. 다시 시도해주세요.');
    }

    return this.assertAdmissionForPerformance({
      performanceId: reservation.performanceId,
      identity: params.identity,
      admissionToken: params.admissionToken,
      action: 'confirm-payment',
    });
  }

  private async assertAdmissionForPerformance(
    params: QueueActionParams,
  ): Promise<ValidatedAdmission> {
    await this.reconcilePerformanceQueue(params.performanceId);

    const record = await this.findQueueSessionByAdmissionToken(params.admissionToken);
    if (!record) {
      throw new ForbiddenException('대기열 입장 인증이 필요합니다');
    }

    this.assertRecordMatchesIdentity(record, params.identity);
    if (record.performanceId !== params.performanceId) {
      throw new ForbiddenException('대기열 입장 정보가 현재 공연과 일치하지 않습니다');
    }

    const now = Date.now();
    const activeUntilAt = record.activeUntilAt ? Date.parse(record.activeUntilAt) : null;
    const paymentRecoveryUntilAt = record.paymentRecoveryUntilAt
      ? Date.parse(record.paymentRecoveryUntilAt)
      : null;

    if (record.state === WAITING) {
      throw new ForbiddenException('대기열 입장이 아직 승인되지 않았습니다');
    }

    if (record.state === EXPIRED) {
      throw new ForbiddenException('대기열 입장 시간이 만료되었습니다');
    }

    const hasActiveAuthority = activeUntilAt !== null && now <= activeUntilAt;
    const hasPaymentRecoveryAuthority =
      paymentRecoveryUntilAt !== null && now <= paymentRecoveryUntilAt;

    if (params.action === 'confirm-payment') {
      if (!hasActiveAuthority && !hasPaymentRecoveryAuthority) {
        const expired = await this.expireQueueSession(record);
        throw new ForbiddenException(
          expired.state === EXPIRED
            ? '대기열 입장 시간이 만료되었습니다'
            : '대기열 입장 인증이 필요합니다',
        );
      }
    } else if (!hasActiveAuthority) {
      await this.expireQueueSession(record);
      throw new ForbiddenException('대기열 입장 시간이 만료되었습니다');
    }

    let currentRecord = record;
    if (params.action === 'prepare-reservation') {
      currentRecord = await this.enablePaymentRecovery(record);
    }

    if (!currentRecord.admittedAt || !currentRecord.activeUntilAt || !currentRecord.reentryGraceUntilAt) {
      throw new ForbiddenException('대기열 입장 정보가 유효하지 않습니다');
    }

    return {
      queueSessionId: currentRecord.queueSessionId,
      userId: currentRecord.userId,
      refreshTokenFamilyId: currentRecord.refreshTokenFamilyId,
      deviceSlotId: currentRecord.deviceSlotId,
      admittedAt: currentRecord.admittedAt,
      activeUntilAt: currentRecord.activeUntilAt,
      reentryGraceUntilAt: currentRecord.reentryGraceUntilAt,
    };
  }

  private async reconcilePerformanceQueue(performanceId: string): Promise<void> {
    await this.expireStaleSessions(performanceId);

    const remainingSeats = await this.calculateRemainingSeats(performanceId);
    if (remainingSeats <= 0) {
      return;
    }

    const activeSessionIds = await this.redis.smembers(this.activeAdmissionsKey(performanceId));
    const activeCount = activeSessionIds.length;
    const slotsToFill = Math.max(
      0,
      Math.min(remainingSeats, QUEUE_MAX_ACTIVE_ADMISSIONS) - activeCount,
    );

    if (slotsToFill <= 0) {
      await this.broadcastWaitingPositions(performanceId);
      return;
    }

    const waitingIds = await this.redis.zrange(
      this.waitingQueueKey(performanceId),
      0,
      slotsToFill - 1,
    );

    if (waitingIds.length === 0) {
      return;
    }

    for (const queueSessionId of waitingIds) {
      const record = await this.readQueueSessionRecord(performanceId, queueSessionId);
      if (!record) {
        await this.redis.zrem(this.waitingQueueKey(performanceId), queueSessionId);
        continue;
      }

      const admittedRecord = this.toAdmittedRecord(record);
      await this.persistQueueSessionRecord(admittedRecord);
      await this.redis.zrem(this.waitingQueueKey(performanceId), queueSessionId);
      await this.redis.sadd(this.activeAdmissionsKey(performanceId), queueSessionId);
      this.gateway.emitAdmitted(queueSessionId, await this.buildSnapshot(admittedRecord));
    }

    await this.broadcastWaitingPositions(performanceId);
  }

  private async expireStaleSessions(performanceId: string): Promise<void> {
    const activeIds = await this.redis.smembers(this.activeAdmissionsKey(performanceId));

    for (const queueSessionId of activeIds) {
      const record = await this.readQueueSessionRecord(performanceId, queueSessionId);
      if (!record) {
        await this.redis.srem(this.activeAdmissionsKey(performanceId), queueSessionId);
        continue;
      }

      const authorityEndsAt = this.resolveAuthorityExpiry(record);
      if (authorityEndsAt === null || Date.now() <= authorityEndsAt) {
        continue;
      }

      await this.expireQueueSession(record);
    }
  }

  private async expireQueueSession(record: QueueSessionRecord): Promise<QueueSessionRecord> {
    const expiredAt = new Date(Date.now() + QUEUE_EXPIRED_RETENTION_SECONDS * 1000).toISOString();
    const expiredRecord: QueueSessionRecord = {
      ...record,
      state: EXPIRED,
      expiresAt: expiredAt,
    };

    await this.persistQueueSessionRecord(expiredRecord);
    await this.redis.zrem(this.waitingQueueKey(record.performanceId), record.queueSessionId);
    await this.redis.srem(this.activeAdmissionsKey(record.performanceId), record.queueSessionId);
    this.gateway.emitExpired(record.queueSessionId, {
      queueSessionId: record.queueSessionId,
      state: EXPIRED,
      autoEnter: false,
    });

    return expiredRecord;
  }

  private async enablePaymentRecovery(record: QueueSessionRecord): Promise<QueueSessionRecord> {
    if (!record.activeUntilAt || !record.reentryGraceUntilAt) {
      return record;
    }

    const currentRecovery = record.paymentRecoveryUntilAt
      ? Date.parse(record.paymentRecoveryUntilAt)
      : 0;
    const targetRecovery = Date.parse(record.reentryGraceUntilAt);

    if (currentRecovery >= targetRecovery) {
      return record;
    }

    const updatedRecord: QueueSessionRecord = {
      ...record,
      paymentRecoveryUntilAt: record.reentryGraceUntilAt,
      expiresAt: new Date(
        targetRecovery + QUEUE_EXPIRED_RETENTION_SECONDS * 1000,
      ).toISOString(),
    };

    await this.persistQueueSessionRecord(updatedRecord);
    return updatedRecord;
  }

  private toAdmittedRecord(record: QueueSessionRecord): QueueSessionRecord {
    const admittedAt = new Date();
    const activeUntilAt = new Date(
      admittedAt.getTime() + QUEUE_ACTIVE_WINDOW_SECONDS * 1000,
    );
    const reentryGraceUntilAt = new Date(
      activeUntilAt.getTime() + QUEUE_REENTRY_GRACE_SECONDS * 1000,
    );

    return {
      ...record,
      state: ADMITTED,
      admittedAt: admittedAt.toISOString(),
      activeUntilAt: activeUntilAt.toISOString(),
      reentryGraceUntilAt: reentryGraceUntilAt.toISOString(),
      paymentRecoveryUntilAt: null,
      expiresAt: new Date(
        reentryGraceUntilAt.getTime() + QUEUE_EXPIRED_RETENTION_SECONDS * 1000,
      ).toISOString(),
    };
  }

  private async buildSnapshot(record: QueueSessionRecord): Promise<QueueSessionSnapshot> {
    const waitingCount = await this.redis.zcard(this.waitingQueueKey(record.performanceId));
    const rank = await this.redis.zrank(
      this.waitingQueueKey(record.performanceId),
      record.queueSessionId,
    );
    const remainingSeats = await this.calculateRemainingSeats(record.performanceId);
    const state = this.resolveVisibleState(record);
    const position = state === WAITING && rank !== null ? rank + 1 : 0;
    const etaSeconds = position > 1 ? (position - 1) * QUEUE_POSITION_STEP_SECONDS : 0;

    return {
      queueSessionId: record.queueSessionId,
      state,
      position,
      waitingCount,
      etaSeconds,
      remainingSeats,
      autoEnter: state === ADMITTED,
      admittedAt: record.admittedAt,
      activeUntilAt: record.activeUntilAt,
      reentryGraceUntilAt: record.reentryGraceUntilAt,
    };
  }

  private resolveVisibleState(record: QueueSessionRecord): QueueSessionState {
    if (record.state !== ADMITTED) {
      return record.state;
    }

    if (
      record.activeUntilAt &&
      Date.now() > Date.parse(record.activeUntilAt) &&
      record.paymentRecoveryUntilAt &&
      Date.now() <= Date.parse(record.paymentRecoveryUntilAt)
    ) {
      return PAYMENT_RECOVERY;
    }

    return record.state;
  }

  private resolveAuthorityExpiry(record: QueueSessionRecord): number | null {
    const candidates = [record.activeUntilAt, record.paymentRecoveryUntilAt]
      .filter((value): value is string => Boolean(value))
      .map((value) => Date.parse(value));

    if (candidates.length === 0) {
      return null;
    }

    return Math.max(...candidates);
  }

  private assertRecordMatchesIdentity(
    record: QueueSessionRecord,
    identity: QueueIdentity,
  ): void {
    if (
      record.userId !== identity.userId ||
      record.refreshTokenFamilyId !== identity.refreshTokenFamilyId ||
      record.deviceSlotId !== identity.deviceSlotId
    ) {
      throw new ForbiddenException('대기열 입장 정보가 현재 세션과 일치하지 않습니다');
    }
  }

  private assertAdmissionTokenMatches(record: QueueSessionRecord, admissionToken: string): void {
    const tokenHash = createHash('sha256').update(admissionToken).digest('hex');
    if (record.admissionTokenHash !== tokenHash) {
      throw new ForbiddenException('대기열 입장 인증이 필요합니다');
    }
  }

  private async findQueueSessionByAdmissionToken(
    admissionToken: string,
  ): Promise<QueueSessionRecord | null> {
    const tokenHash = createHash('sha256').update(admissionToken).digest('hex');
    const queueSessionId = await this.redis.get(this.admissionTokenKey(tokenHash));
    if (!queueSessionId) {
      return null;
    }

    const performanceId = await this.redis.get(this.sessionRefKey(queueSessionId));
    if (!performanceId) {
      return null;
    }

    return this.readQueueSessionRecord(performanceId, queueSessionId);
  }

  private rotateAdmissionToken(record: QueueSessionRecord): {
    record: QueueSessionRecord;
    admissionToken: string;
  } {
    const admissionToken = randomBytes(32).toString('hex');
    const admissionTokenHash = createHash('sha256')
      .update(admissionToken)
      .digest('hex');

    return {
      record: {
        ...record,
        admissionTokenHash,
      },
      admissionToken,
    };
  }

  private async persistQueueSessionRecord(record: QueueSessionRecord): Promise<void> {
    const ttlSeconds = this.calculateTtlSeconds(record.expiresAt);
    const previous = await this.readQueueSessionRecord(record.performanceId, record.queueSessionId);
    if (previous?.admissionTokenHash && previous.admissionTokenHash !== record.admissionTokenHash) {
      await this.redis.del(this.admissionTokenKey(previous.admissionTokenHash));
    }

    await this.redis.set(
      this.sessionKey(record.performanceId, record.queueSessionId),
      JSON.stringify(record),
      'EX',
      ttlSeconds,
    );
    await this.redis.set(
      this.sessionRefKey(record.queueSessionId),
      record.performanceId,
      'EX',
      ttlSeconds,
    );
    await this.redis.set(
      this.identityKey(record.performanceId, {
        userId: record.userId,
        refreshTokenFamilyId: record.refreshTokenFamilyId,
        deviceSlotId: record.deviceSlotId,
      }),
      record.queueSessionId,
      'EX',
      ttlSeconds,
    );
    await this.redis.set(
      this.admissionTokenKey(record.admissionTokenHash),
      record.queueSessionId,
      'EX',
      ttlSeconds,
    );
  }

  private async readQueueSessionRecord(
    performanceId: string,
    queueSessionId: string,
  ): Promise<QueueSessionRecord | null> {
    const raw = await this.redis.get(this.sessionKey(performanceId, queueSessionId));
    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as QueueSessionRecord;
  }

  private async purgeQueueSessionRecord(record: QueueSessionRecord): Promise<void> {
    const keys = [
      this.sessionKey(record.performanceId, record.queueSessionId),
      this.sessionRefKey(record.queueSessionId),
      this.identityKey(record.performanceId, {
        userId: record.userId,
        refreshTokenFamilyId: record.refreshTokenFamilyId,
        deviceSlotId: record.deviceSlotId,
      }),
      this.admissionTokenKey(record.admissionTokenHash),
    ];

    for (const key of keys) {
      await this.redis.del(key);
    }

    await this.redis.zrem(this.waitingQueueKey(record.performanceId), record.queueSessionId);
    await this.redis.srem(this.activeAdmissionsKey(record.performanceId), record.queueSessionId);
  }

  private isReusable(record: QueueSessionRecord, now: Date): boolean {
    return record.state !== EXPIRED && Date.parse(record.expiresAt) > now.getTime();
  }

  private calculateTtlSeconds(expiresAt: string): number {
    return Math.max(
      1,
      Math.ceil((Date.parse(expiresAt) - Date.now()) / 1000),
    );
  }

  private async broadcastWaitingPositions(performanceId: string): Promise<void> {
    const waitingIds = await this.redis.zrange(this.waitingQueueKey(performanceId), 0, -1);

    for (const queueSessionId of waitingIds) {
      const record = await this.readQueueSessionRecord(performanceId, queueSessionId);
      if (!record) {
        continue;
      }

      this.gateway.emitPosition(queueSessionId, await this.buildSnapshot(record));
    }
  }

  private async calculateRemainingSeats(performanceId: string): Promise<number> {
    const [seatCapacity] = await this.db
      .select({
        totalSeats: sql<number>`coalesce(sum(${seatMaps.totalSeats}), 0)`,
      })
      .from(seatMaps)
      .where(eq(seatMaps.performanceId, performanceId));

    const showtimeRows = await this.db
      .select({ id: showtimes.id })
      .from(showtimes)
      .where(eq(showtimes.performanceId, performanceId));

    if (!seatCapacity || showtimeRows.length === 0) {
      return 0;
    }

    const [soldCount] = await this.db
      .select({
        total: sql<number>`count(*)`,
      })
      .from(seatInventories)
      .innerJoin(showtimes, eq(seatInventories.showtimeId, showtimes.id))
      .where(
        and(
          eq(showtimes.performanceId, performanceId),
          inArray(seatInventories.status, ['sold', 'held_cancelled', 'disabled']),
        ),
      );

    let lockedCount = 0;
    for (const showtime of showtimeRows) {
      lockedCount += await this.redis.scard(`{${showtime.id}}:locked-seats`);
    }

    const performanceCapacity = seatCapacity.totalSeats * showtimeRows.length;
    return Math.max(performanceCapacity - Number(soldCount?.total ?? 0) - lockedCount, 0);
  }

  private waitingQueueKey(performanceId: string): string {
    return `${this.queuePrefix(performanceId)}:waiting`;
  }

  private activeAdmissionsKey(performanceId: string): string {
    return `${this.queuePrefix(performanceId)}:active`;
  }

  private sessionKey(performanceId: string, queueSessionId: string): string {
    return `${this.queuePrefix(performanceId)}:session:${queueSessionId}`;
  }

  private sessionRefKey(queueSessionId: string): string {
    return `{queue:session-ref}:${queueSessionId}`;
  }

  private admissionTokenKey(admissionTokenHash: string): string {
    return `{queue:admission}:${admissionTokenHash}`;
  }

  private identityKey(performanceId: string, identity: QueueIdentity): string {
    return `${this.queuePrefix(performanceId)}:identity:${identity.userId}:${identity.refreshTokenFamilyId}:${identity.deviceSlotId}`;
  }

  private queuePrefix(performanceId: string): string {
    return `{queue:${performanceId}}`;
  }
}

export function readQueueAdmissionCookie(cookies?: Record<string, string | undefined>): string | undefined {
  return cookies?.[QUEUE_ADMISSION_COOKIE_NAME];
}

export function readRefreshCookie(cookies?: Record<string, string | undefined>): string | undefined {
  return cookies?.[AUTH_COOKIE_NAME];
}
