import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { and, eq, gt, gte, inArray, isNull, or, sql } from 'drizzle-orm';
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
import { bookingPolicies } from '../../database/schema/booking-policies.js';
import {
  SHOWTIME_STARTED_MESSAGE,
  isShowtimeSalesClosed,
  showtimeOnSaleCondition,
} from '../booking/showtime-sales-cutoff.js';
import { QueueGateway } from './queue.gateway.js';
import {
  COUNT_VALID_LOCKED_SEATS_LUA,
  CREATE_QUEUE_SESSION_LUA,
  PURGE_QUEUE_SESSION_LUA,
  QUEUE_SESSION_TRANSITION_LUA,
} from './queue-redis-scripts.js';

export const QUEUE_ADMISSION_COOKIE_NAME = 'grabit_queue_admission';
// Admitted sessions: active window + re-entry grace.
export const QUEUE_ADMISSION_COOKIE_MAX_AGE_MS = 780_000;
export const QUEUE_ACTIVE_WINDOW_SECONDS = 600;
export const QUEUE_REENTRY_GRACE_SECONDS = 180;

// WAITING sessions are idle-timed: every status poll or re-entry slides the
// expiry forward, so only sessions whose heartbeat stopped are dropped.
export const QUEUE_WAIT_SESSION_SECONDS = 1_800;
// A WAITING session's cookie lives as long as the idle window, so a buyer who
// comes back to a backgrounded tab within it still finds the position.
export const QUEUE_WAITING_COOKIE_MAX_AGE_MS = QUEUE_WAIT_SESSION_SECONDS * 1000;
const QUEUE_WAIT_SESSION_RENEW_INTERVAL_SECONDS = 60;
const QUEUE_EXPIRED_RETENTION_SECONDS = 300;
const QUEUE_MAX_ACTIVE_ADMISSIONS = 1000;
const QUEUE_RECONCILE_LOCK_TTL_MS = 30_000;
// Queue requests run at most one reconcile per performance per interval.
const QUEUE_RECONCILE_MIN_INTERVAL_MS = 1_000;
const QUEUE_RECONCILE_MAX_FILL_ROUNDS = 5;
const QUEUE_POSITION_BROADCAST_LIMIT = 500;
const QUEUE_REMAINING_SEATS_CACHE_SECONDS = 2;
// Cached instead of a seat count when no showtime of the performance is on sale
// any more (C1). Older releases read it as 0 remaining seats.
const QUEUE_REMAINING_SEATS_NO_BOOKABLE_SHOWTIME = 'no-bookable-showtime';
const QUEUE_SESSION_SETUP_MAX_ATTEMPTS = 3;
const QUEUE_ENTER_MAX_PASSES = 2;
// Wait estimate (audit #91). Admission runs in cycles: reconcile keeps at most
// min(remainingSeats, QUEUE_MAX_ACTIVE_ADMISSIONS) sessions active. A slot is
// returned when that session's authority window ends (expireStaleSessions), at
// most the active window plus the payment-recovery grace (resolveAuthorityExpiry).
// A successful payment confirm returns the slot right away
// (releaseAdmissionForOrder), so a slot has no guaranteed minimum hold and
// the estimate never promises a minimum wait. Every bound holds only at the
// remaining seats of the snapshot: seats sold or locked later shrink the cycle
// capacity, and the next snapshot reports a longer range.
export const QUEUE_SLOT_MIN_HOLD_SECONDS = 0;
export const QUEUE_SLOT_MAX_HOLD_SECONDS =
  QUEUE_ACTIVE_WINDOW_SECONDS + QUEUE_REENTRY_GRACE_SECONDS;
// An ended slot is only noticed by the next reconcile, which runs on queue
// requests; waiting clients poll every 15-20 s, so allow one poll per cycle.
const QUEUE_ETA_RECONCILE_LATENCY_SECONDS = 20;
export const QUEUE_ETA_CYCLE_MAX_SECONDS =
  QUEUE_SLOT_MAX_HOLD_SECONDS + QUEUE_ETA_RECONCILE_LATENCY_SECONDS;
// Beyond this the estimate is reported as unavailable instead of a huge number.
export const QUEUE_ETA_MAX_SECONDS = 3 * 60 * 60;
const BOOKING_NOT_OPEN_MESSAGE = '예매는 추후 오픈 예정입니다';
const BOOKING_ENDED_MESSAGE = '판매가 종료된 공연입니다';
const PERFORMANCE_NOT_FOUND_MESSAGE = '공연을 찾을 수 없습니다';
const NO_SHOWTIME_MESSAGE = '예매 가능한 회차가 없습니다.';

export const QUEUE_ENTRY_ERROR_CODES = {
  performanceNotFound: 'PERFORMANCE_NOT_FOUND',
  bookingNotOpen: 'BOOKING_NOT_OPEN',
  bookingEnded: 'BOOKING_ENDED',
  noBookableShowtime: 'NO_BOOKABLE_SHOWTIME',
} as const;

export const WAITING = 'WAITING';
export const ADMITTED = 'ADMITTED';
export const PAYMENT_RECOVERY = 'PAYMENT_RECOVERY';
export const EXPIRED = 'EXPIRED';

export const RELEASE_QUEUE_RECONCILE_LOCK_LUA = `
-- RELEASE_QUEUE_RECONCILE_LOCK_LUA
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

function isBookingStartReached(value: Date | null | undefined, now: Date = new Date()): boolean {
  return value instanceof Date && !Number.isNaN(value.getTime()) && value.getTime() <= now.getTime();
}

export type QueueWaitEstimate = {
  // Upper bound of the wait in seconds at the current remaining seats (also
  // what older clients display). Fewer remaining seats later raise it.
  etaSeconds: number;
  // Lower bound of the wait in seconds.
  etaMinSeconds: number;
  // true when no honest estimate exists: no seat left to admit into, no rank,
  // or the upper bound exceeds QUEUE_ETA_MAX_SECONDS.
  etaUnavailable: boolean;
};

const NO_WAIT_ESTIMATE: QueueWaitEstimate = {
  etaSeconds: 0,
  etaMinSeconds: 0,
  etaUnavailable: false,
};

/**
 * Deterministic wait range for the current admission algorithm. The waiting
 * line moves in cycles of `min(remainingSeats, QUEUE_MAX_ACTIVE_ADMISSIONS)`
 * admissions, and every cycle takes between the minimum and maximum slot hold.
 * The range assumes the remaining seats stay as they are now; when they shrink
 * the cycles shrink too and a later snapshot reports a longer range.
 * Position p is admitted in cycle ceil(p / cycleCapacity): no earlier than
 * (cycles - 1) minimum holds and no later than `cycles` maximum holds (plus
 * the reconcile latency of each cycle).
 * The range does not depend on when the session was first observed, so wave-
 * shaped admission (an opening burst, then a cycle every 10-13 minutes) cannot
 * make it under-report the wait the way a short line-movement sample does.
 */
export function estimateQueueWait(params: {
  position: number;
  remainingSeats: number;
}): QueueWaitEstimate {
  const position = Math.floor(params.position);
  const remainingSeats = Math.floor(params.remainingSeats);

  if (!(position > 0)) {
    return { etaSeconds: 0, etaMinSeconds: 0, etaUnavailable: true };
  }

  if (!(remainingSeats > 0)) {
    // Reconcile admits nobody until seats come back (sold out or all held).
    return { etaSeconds: QUEUE_ETA_MAX_SECONDS, etaMinSeconds: 0, etaUnavailable: true };
  }

  const cycleCapacity = Math.min(remainingSeats, QUEUE_MAX_ACTIVE_ADMISSIONS);
  const cycles = Math.ceil(position / cycleCapacity);
  const maxSeconds = cycles * QUEUE_ETA_CYCLE_MAX_SECONDS;
  if (maxSeconds > QUEUE_ETA_MAX_SECONDS) {
    return { etaSeconds: QUEUE_ETA_MAX_SECONDS, etaMinSeconds: 0, etaUnavailable: true };
  }

  return {
    etaSeconds: maxSeconds,
    etaMinSeconds: (cycles - 1) * QUEUE_SLOT_MIN_HOLD_SECONDS,
    etaUnavailable: false,
  };
}

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
  // Set when the session's active window has ended and only payment recovery
  // of this pending order (its toss order id) remains.
  recoveryOrderId?: string;
};

export type QueueSessionSnapshot = {
  queueSessionId: string;
  state: QueueSessionState;
  position: number;
  waitingCount: number;
  etaSeconds: number;
  etaMinSeconds: number;
  etaUnavailable: boolean;
  remainingSeats: number;
  autoEnter: boolean;
  admittedAt: string | null;
  activeUntilAt: string | null;
  reentryGraceUntilAt: string | null;
  // Only on a PAYMENT_RECOVERY snapshot: the pending order (toss order id) the
  // buyer can still pay for. The admission itself is over (autoEnter false).
  recoveryOrderId?: string;
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

type QueueTransitionOp = 'admit' | 'touch' | 'recovery' | 'expire' | 'release';

type QueueTransitionResult = {
  applied: boolean;
  status: string;
  record: QueueSessionRecord | null;
  previousTokenHash: string;
  ttlMs: number;
};

type QueueSnapshotContext = {
  waitingCount: number;
  rank: number | null;
  remainingSeats: number;
};

type QueueSnapshotOptions = {
  // Counters the caller already read for many sessions (reconcile, broadcasts).
  context?: QueueSnapshotContext;
  // Remaining seats the caller already read; only the waiting counters are read.
  remainingSeats?: number;
  // The pending order found by findRecoveryOrderId.
  recoveryOrderId?: string;
  // The instant the caller judged the admission window at. One request judges
  // it once, so a window that ends during the snapshot reads is not judged
  // again (and reported EXPIRED without the recovery lookup).
  now?: number;
};

type RemainingSeatsState = {
  remainingSeats: number;
  // false once no showtime of the performance is on sale (C1)
  hasBookableShowtime: boolean;
};

type OrderAdmissionBinding = {
  status: string;
  queueSessionId: string | null;
  refreshFamilyId: string | null;
  deviceSlotKey: string | null;
  admittedAt: Date | null;
  admissionActiveUntilAt: Date | null;
  reentryGraceUntilAt: Date | null;
  paymentDeadlineAt: Date | null;
};

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);
  private readonly reconcileInFlight = new Set<string>();
  // One fresh remaining-seat computation per performance per instance at a
  // time; concurrent cache misses share it.
  private readonly remainingSeatsInFlight = new Map<string, Promise<RemainingSeatsState>>();

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
    presentedAdmissionToken?: string;
  }): Promise<QueueSessionLease> {
    const { performanceId, identity } = params;
    const identityKey = this.identityKey(performanceId, identity);

    // Every write below is a conditional Redis script, so a lost race (another tab
    // creating the session, or reconcile admitting it) re-reads instead of
    // overwriting the newer state.
    for (let attempt = 0; attempt < QUEUE_SESSION_SETUP_MAX_ATTEMPTS; attempt += 1) {
      const now = new Date();
      const existingSessionId = await this.redis.get(identityKey);

      if (existingSessionId) {
        let record = await this.readQueueSessionRecord(performanceId, existingSessionId);

        // An admission whose active window has ended is never handed out as an
        // admission again: seat lock and prepare would refuse it anyway. Only a
        // pending order bound to it keeps it, for payment recovery; otherwise it
        // is expired and the browser takes a new waiting position below.
        if (record && this.isAdmissionWindowClosed(record, now.getTime())) {
          const recoveryOrderId = await this.findRecoveryOrderId(record, now.getTime());
          if (recoveryOrderId) {
            const recovery = await this.reuseQueueSession(
              record,
              params.presentedAdmissionToken,
              now,
              { allowExpired: true },
            );
            if (recovery) {
              return { ...recovery, recoveryOrderId };
            }
            continue;
          }

          if (record.state !== EXPIRED) {
            const expired = await this.expireQueueSession(record);
            if (expired.state !== EXPIRED) {
              continue;
            }
            record = expired;
          }
        } else if (record && this.isReusable(record, now)) {
          const reused = await this.reuseQueueSession(
            record,
            params.presentedAdmissionToken,
            now,
          );
          if (reused) {
            return reused;
          }
          continue;
        }

        await this.purgeQueueSession({
          performanceId,
          queueSessionId: existingSessionId,
          identityKey,
          admissionTokenHash: record?.admissionTokenHash ?? null,
          now,
        });
      }

      const created = await this.createQueueSession(performanceId, identity, identityKey, now);
      if (created) {
        return created;
      }
    }

    throw new ConflictException('대기열 세션을 준비하지 못했습니다. 잠시 후 다시 시도해주세요.');
  }

  private async reuseQueueSession(
    record: QueueSessionRecord,
    presentedAdmissionToken: string | undefined,
    now: Date,
    options: { allowExpired?: boolean } = {},
  ): Promise<QueueSessionLease | null> {
    // Re-entry from the browser that already holds the current token keeps it,
    // so several tabs sharing one cookie jar do not invalidate each other.
    const keepPresentedToken =
      typeof presentedAdmissionToken === 'string'
      && presentedAdmissionToken.length > 0
      && this.hashAdmissionToken(presentedAdmissionToken) === record.admissionTokenHash;
    const admissionToken = keepPresentedToken
      ? presentedAdmissionToken
      : this.generateAdmissionToken();

    const result = await this.transitionQueueSession(record, 'touch', [
      keepPresentedToken ? '' : this.hashAdmissionToken(admissionToken),
      ...this.buildWaitingRenewalArgs(record, now),
      // A retained EXPIRED session only gets a new token (payment recovery).
      options.allowExpired ? '1' : '',
    ]);
    if (!result.applied || !result.record) {
      return null;
    }

    await this.syncQueueSessionIndexes(result);
    return this.toLease(result.record, admissionToken);
  }

  private async createQueueSession(
    performanceId: string,
    identity: QueueIdentity,
    identityKey: string,
    now: Date,
  ): Promise<QueueSessionLease | null> {
    const admissionToken = this.generateAdmissionToken();
    const record: QueueSessionRecord = {
      queueSessionId: randomUUID(),
      performanceId,
      userId: identity.userId,
      refreshTokenFamilyId: identity.refreshTokenFamilyId,
      deviceSlotId: identity.deviceSlotId,
      admissionTokenHash: this.hashAdmissionToken(admissionToken),
      state: WAITING,
      enteredAt: now.toISOString(),
      admittedAt: null,
      activeUntilAt: null,
      reentryGraceUntilAt: null,
      paymentRecoveryUntilAt: null,
      expiresAt: new Date(now.getTime() + QUEUE_WAIT_SESSION_SECONDS * 1000).toISOString(),
    };
    const ttlMs = QUEUE_WAIT_SESSION_SECONDS * 1000;
    const sessionRefKey = this.sessionRefKey(record.queueSessionId);
    const admissionTokenKey = this.admissionTokenKey(record.admissionTokenHash);

    // Index keys live in other cluster slots; write them first so the session is
    // never visible without them, and drop them if another request won the race.
    await Promise.all([
      this.redis.set(sessionRefKey, performanceId, 'PX', ttlMs),
      this.redis.set(admissionTokenKey, record.queueSessionId, 'PX', ttlMs),
    ]);

    const reply = (await this.redis.eval(
      CREATE_QUEUE_SESSION_LUA,
      3,
      identityKey,
      this.sessionKey(performanceId, record.queueSessionId),
      this.waitingQueueKey(performanceId),
      record.queueSessionId,
      JSON.stringify(record),
      String(ttlMs),
      String(now.getTime()),
    )) as [number | string, string] | null;

    if (Number(reply?.[0]) !== 1) {
      await this.redis.del(sessionRefKey);
      await this.redis.del(admissionTokenKey);
      return null;
    }

    return this.toLease(record, admissionToken);
  }

  async enterPerformanceQueue(params: {
    performanceId: string;
    identity: QueueIdentity;
    bypassQueue?: boolean;
    actorRole?: string;
    presentedAdmissionToken?: string;
  }): Promise<QueueEnterResult> {
    await this.assertPerformanceBookingOpen(params.performanceId, params.actorRole);

    // Entry never answers with an expired session: when the session it found
    // ended while this request ran (a reconcile expired it, or its recovery
    // order was paid or cancelled), the second pass replaces it with a new
    // waiting position.
    for (let attempt = 1; ; attempt += 1) {
      const lease = await this.ensureQueueSession(params);
      if (!lease.recoveryOrderId) {
        if (params.bypassQueue) {
          await this.admitQueueSession(params.performanceId, lease.queueSessionId);
        } else {
          await this.reconcilePerformanceQueueIfDue(params.performanceId);
          // The reconcile above is throttled; admit this session directly when every
          // session ahead of it also fits into the free slots.
          await this.admitQueueSessionWithinCapacity(params.performanceId, lease.queueSessionId);
        }
      }

      const snapshot = await this.getQueueSessionStatus({
        queueSessionId: lease.queueSessionId,
        identity: lease,
        admissionToken: lease.admissionToken,
      });

      if (snapshot.state !== EXPIRED || attempt >= QUEUE_ENTER_MAX_PASSES) {
        return {
          ...snapshot,
          admissionToken: lease.admissionToken,
        };
      }
    }
  }

  /**
   * Queue entry gate. Runs before any queue key is created so unknown, hidden,
   * ended or fully started performances never get a waiting session.
   * Sales cutoff (C1): a showtime is sellable only while now < showtimes.date_time,
   * and the cutoff has no admin bypass. showtimeOnSaleCondition is the set form
   * of isShowtimeSalesClosed (booking/showtime-sales-cutoff.ts), shared with
   * seat lock, prepare and the pre-approval confirm check.
   */
  private async assertPerformanceBookingOpen(
    performanceId: string,
    actorRole: string | undefined,
  ): Promise<void> {
    const now = new Date();
    const [row] = await this.db
      .select({
        status: performances.status,
        publishState: performances.publishState,
        bookingStartsAt: bookingPolicies.bookingStartsAt,
        showtimeCount: sql<number>`(select count(*)::int from ${showtimes} where ${eq(showtimes.performanceId, performances.id)})`,
        sellableShowtimeCount: sql<number>`(select count(*)::int from ${showtimes} where ${and(eq(showtimes.performanceId, performances.id), showtimeOnSaleCondition(now))})`,
      })
      .from(performances)
      .leftJoin(bookingPolicies, eq(bookingPolicies.performanceId, performances.id))
      .where(eq(performances.id, performanceId));

    const isAdmin = actorRole === 'admin';
    if (!row || (!isAdmin && row.publishState !== 'published')) {
      throw new NotFoundException({
        message: PERFORMANCE_NOT_FOUND_MESSAGE,
        errorCode: QUEUE_ENTRY_ERROR_CODES.performanceNotFound,
      });
    }

    if (row.status === 'ended') {
      throw new ForbiddenException({
        message: BOOKING_ENDED_MESSAGE,
        errorCode: QUEUE_ENTRY_ERROR_CODES.bookingEnded,
      });
    }

    if (Number(row.sellableShowtimeCount ?? 0) <= 0) {
      throw new ForbiddenException({
        message:
          Number(row.showtimeCount ?? 0) > 0
            ? SHOWTIME_STARTED_MESSAGE
            : NO_SHOWTIME_MESSAGE,
        errorCode: QUEUE_ENTRY_ERROR_CODES.noBookableShowtime,
      });
    }

    if (isAdmin) {
      return;
    }

    const bookingNotOpen =
      (row.bookingStartsAt && !isBookingStartReached(row.bookingStartsAt, now)) ||
      (row.status === 'upcoming' && !isBookingStartReached(row.bookingStartsAt, now));
    if (bookingNotOpen) {
      throw new ForbiddenException({
        message: BOOKING_NOT_OPEN_MESSAGE,
        errorCode: QUEUE_ENTRY_ERROR_CODES.bookingNotOpen,
        bookingStartsAt: row.bookingStartsAt?.toISOString() ?? null,
        serverNow: now.toISOString(),
      });
    }
  }

  private async admitQueueSession(
    performanceId: string,
    queueSessionId: string,
  ): Promise<void> {
    const record = await this.readQueueSessionRecord(performanceId, queueSessionId);
    if (!record || record.state !== WAITING) {
      return;
    }

    const result = await this.transitionQueueSession(record, 'admit', [
      ...this.buildAdmissionArgs(new Date()),
      '',
    ]);
    if (!result.applied || !result.record) {
      return;
    }

    await this.syncQueueSessionIndexes(result);
    this.gateway.emitAdmitted(queueSessionId, await this.buildSnapshot(result.record));
  }

  private async admitQueueSessionWithinCapacity(
    performanceId: string,
    queueSessionId: string,
  ): Promise<void> {
    const record = await this.readQueueSessionRecord(performanceId, queueSessionId);
    if (!record || record.state !== WAITING) {
      return;
    }

    const capacity = Math.min(
      await this.calculateRemainingSeats(performanceId),
      QUEUE_MAX_ACTIVE_ADMISSIONS,
    );
    if (capacity <= 0) {
      return;
    }

    const result = await this.transitionQueueSession(record, 'admit', [
      ...this.buildAdmissionArgs(new Date()),
      String(capacity),
    ]);
    if (result.applied) {
      await this.syncQueueSessionIndexes(result);
    }
  }

  async getQueueSessionStatus(params: QueueStatusParams): Promise<QueueSessionSnapshot> {
    const performanceId = await this.redis.get(this.sessionRefKey(params.queueSessionId));
    if (!performanceId) {
      throw new NotFoundException('대기열 세션을 찾을 수 없습니다');
    }

    await this.reconcilePerformanceQueueIfDue(performanceId);

    const record = await this.readQueueSessionRecord(performanceId, params.queueSessionId);
    if (!record) {
      throw new NotFoundException('대기열 세션을 찾을 수 없습니다');
    }

    this.assertRecordMatchesIdentity(record, params.identity);
    this.assertAdmissionTokenMatches(record, params.admissionToken);

    // Same sales cutoff (C1) as queue entry: once every showtime has started
    // nobody is admitted any more, so the waiting line is closed.
    const seats = await this.readRemainingSeatsState(performanceId);
    if (!seats.hasBookableShowtime) {
      throw new ForbiddenException({
        message: SHOWTIME_STARTED_MESSAGE,
        errorCode: QUEUE_ENTRY_ERROR_CODES.noBookableShowtime,
      });
    }

    // The window is judged once, at `now`: the snapshot reads below take Redis
    // round trips (and a DB query on a cache miss), and a window that ended
    // meanwhile must not turn into EXPIRED without the recovery lookup. The
    // remaining seats read above are reused instead of read again.
    const now = Date.now();
    const snapshotOptions = { now, remainingSeats: seats.remainingSeats };
    if (this.isAdmissionWindowClosed(record, now)) {
      const recoveryOrderId = await this.findRecoveryOrderId(record, now);
      if (recoveryOrderId) {
        return this.buildSnapshot(record, { ...snapshotOptions, recoveryOrderId });
      }
      return this.buildSnapshot(
        record.state === EXPIRED ? record : await this.expireQueueSession(record),
        snapshotOptions,
      );
    }

    return this.buildSnapshot(await this.renewWaitingSession(record), snapshotOptions);
  }

  /**
   * ADMITTED past its active window, or EXPIRED. Seat lock and prepare need the
   * active window, so such a session is no longer an admission.
   */
  private isAdmissionWindowClosed(record: QueueSessionRecord, now: number): boolean {
    if (record.state === EXPIRED) {
      return true;
    }
    if (record.state !== ADMITTED) {
      return false;
    }

    const activeUntilAt = record.activeUntilAt ? Date.parse(record.activeUntilAt) : Number.NaN;
    return !Number.isFinite(activeUntilAt) || now > activeUntilAt;
  }

  /**
   * The pending order prepared under this queue session that payment confirm
   * would still accept through the order binding (same user, refresh family and
   * device slot, before max(paymentDeadlineAt, admissionActiveUntilAt)), for a
   * showtime that has not started yet (C1). Its toss order id, or null. Uses
   * idx_reservations_queue_session_id.
   *
   * The payment deadline is not capped at the showtime start, so an order
   * prepared just before the start can outlive it. Payment handoff and confirm
   * refuse such an order, so it must not hold the buyer in payment recovery
   * (autoEnter false) instead of a new waiting position for another showtime.
   */
  private async findRecoveryOrderId(
    record: QueueSessionRecord,
    now: number,
  ): Promise<string | null> {
    const nowDate = new Date(now);
    const rows = await this.db
      .select({
        tossOrderId: reservations.tossOrderId,
        status: reservations.status,
        queueSessionId: reservations.queueSessionId,
        refreshFamilyId: reservations.refreshFamilyId,
        deviceSlotKey: reservations.deviceSlotKey,
        admittedAt: reservations.admittedAt,
        admissionActiveUntilAt: reservations.admissionActiveUntilAt,
        reentryGraceUntilAt: reservations.reentryGraceUntilAt,
        paymentDeadlineAt: reservations.paymentDeadlineAt,
        showtimeAt: showtimes.dateTime,
      })
      .from(reservations)
      .innerJoin(showtimes, eq(reservations.showtimeId, showtimes.id))
      .where(
        and(
          eq(reservations.queueSessionId, record.queueSessionId),
          eq(reservations.userId, record.userId),
          eq(reservations.status, 'PENDING_PAYMENT'),
          // greatest(payment_deadline_at, admission_active_until_at) >= now
          or(
            gte(reservations.paymentDeadlineAt, nowDate),
            gte(reservations.admissionActiveUntilAt, nowDate),
          ),
          showtimeOnSaleCondition(nowDate),
        ),
      );

    let best: { orderId: string; endsAt: number } | null = null;
    for (const row of rows) {
      if (!row.tossOrderId || row.queueSessionId !== record.queueSessionId) {
        continue;
      }
      if (isShowtimeSalesClosed(row.showtimeAt, nowDate)) {
        continue;
      }
      const admission = this.resolveOrderBoundAdmission(row, record, record.userId, now);
      if (!admission || row.status !== 'PENDING_PAYMENT') {
        continue;
      }
      const endsAt = Math.max(
        ...[row.paymentDeadlineAt, row.admissionActiveUntilAt]
          .filter((value): value is Date => this.isValidDate(value))
          .map((value) => value.getTime()),
      );
      if (!best || endsAt > best.endsAt) {
        best = { orderId: row.tossOrderId, endsAt };
      }
    }

    return best?.orderId ?? null;
  }

  /**
   * Status polls are the WAITING heartbeat: slide the idle expiry forward while
   * keeping the original enteredAt score (queue order). Renewal is skipped when
   * it already happened within the last renew interval.
   */
  private async renewWaitingSession(record: QueueSessionRecord): Promise<QueueSessionRecord> {
    if (record.state !== WAITING) {
      return record;
    }

    const now = new Date();
    const remainingMs = Date.parse(record.expiresAt) - now.getTime();
    const renewBelowMs =
      (QUEUE_WAIT_SESSION_SECONDS - QUEUE_WAIT_SESSION_RENEW_INTERVAL_SECONDS) * 1000;
    if (Number.isFinite(remainingMs) && remainingMs > renewBelowMs) {
      return record;
    }

    const result = await this.transitionQueueSession(record, 'touch', [
      '',
      ...this.buildWaitingRenewalArgs(record, now),
    ]);
    if (result.applied) {
      await this.syncQueueSessionIndexes(result);
    }

    return result.record ?? record;
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

  /**
   * Payment confirm is authorised by the order binding first: the pending order
   * was prepared by an admitted queue session, and its server-side payment
   * deadline (extended by the provider handoff grace) outlives the Redis queue
   * session and the 13-minute admission cookie. The Redis session is only the
   * fallback for orders whose binding does not match the current browser.
   */
  async assertAdmissionForOrder(params: {
    orderId: string;
    userId: string;
    identity: QueueIdentity;
    admissionToken?: string;
  }): Promise<ValidatedAdmission> {
    const [reservation] = await this.db
      .select({
        performanceId: showtimes.performanceId,
        status: reservations.status,
        queueSessionId: reservations.queueSessionId,
        refreshFamilyId: reservations.refreshFamilyId,
        deviceSlotKey: reservations.deviceSlotKey,
        admittedAt: reservations.admittedAt,
        admissionActiveUntilAt: reservations.admissionActiveUntilAt,
        reentryGraceUntilAt: reservations.reentryGraceUntilAt,
        paymentDeadlineAt: reservations.paymentDeadlineAt,
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

    const orderBoundAdmission = this.resolveOrderBoundAdmission(
      reservation,
      params.identity,
      params.userId,
      Date.now(),
    );
    if (orderBoundAdmission) {
      return orderBoundAdmission;
    }

    if (!params.admissionToken) {
      throw new ForbiddenException('대기열 입장 인증이 필요합니다');
    }

    return this.assertAdmissionForPerformance({
      performanceId: reservation.performanceId,
      identity: params.identity,
      admissionToken: params.admissionToken,
      action: 'confirm-payment',
    });
  }

  private resolveOrderBoundAdmission(
    binding: OrderAdmissionBinding,
    identity: QueueIdentity,
    userId: string,
    now: number,
  ): ValidatedAdmission | null {
    if (
      !binding.queueSessionId
      || identity.userId !== userId
      || binding.refreshFamilyId !== identity.refreshTokenFamilyId
      || binding.deviceSlotKey !== identity.deviceSlotId
    ) {
      return null;
    }

    const authorityEndsAt = [binding.paymentDeadlineAt, binding.admissionActiveUntilAt]
      .filter((value): value is Date => this.isValidDate(value))
      .map((value) => value.getTime());

    if (binding.status === 'PENDING_PAYMENT') {
      if (authorityEndsAt.length === 0 || now > Math.max(...authorityEndsAt)) {
        return null;
      }
    } else if (binding.status !== 'CONFIRMED') {
      // CONFIRMED stays allowed so an idempotent confirm retry still reaches
      // the finalization service and returns the confirmed reservation.
      return null;
    }

    const fallback = new Date(authorityEndsAt.length > 0 ? Math.max(...authorityEndsAt) : now);
    const activeUntilAt = this.isValidDate(binding.admissionActiveUntilAt)
      ? binding.admissionActiveUntilAt
      : fallback;

    return {
      queueSessionId: binding.queueSessionId,
      userId,
      refreshTokenFamilyId: identity.refreshTokenFamilyId,
      deviceSlotId: identity.deviceSlotId,
      admittedAt: (this.isValidDate(binding.admittedAt) ? binding.admittedAt : activeUntilAt)
        .toISOString(),
      activeUntilAt: activeUntilAt.toISOString(),
      reentryGraceUntilAt: (
        this.isValidDate(binding.reentryGraceUntilAt) ? binding.reentryGraceUntilAt : activeUntilAt
      ).toISOString(),
    };
  }

  /**
   * Returns the queue slot of the confirmed order: the queue session the order
   * was prepared under (reservations.queue_session_id), never the session of
   * the browser that sent the confirm, which differs when confirm was allowed
   * through the Redis fallback. Never throws, like releaseAdmissionAfterPurchase.
   */
  async releaseAdmissionForOrder(orderId: string, userId: string): Promise<boolean> {
    try {
      const [reservation] = await this.db
        .select({
          queueSessionId: reservations.queueSessionId,
          status: reservations.status,
        })
        .from(reservations)
        .where(
          and(
            eq(reservations.tossOrderId, orderId),
            eq(reservations.userId, userId),
            eq(reservations.status, 'CONFIRMED'),
          ),
        );

      if (!reservation || reservation.status !== 'CONFIRMED') {
        return false;
      }

      return await this.releaseAdmissionAfterPurchase(reservation.queueSessionId);
    } catch (error) {
      this.logger.warn(
        `Queue admission release for a confirmed order failed. orderId=${orderId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return false;
    }
  }

  /**
   * Returns the queue slot of a completed purchase to the waiting line right
   * away instead of holding it until the active/recovery window ends. Never
   * throws: a confirmed purchase must not fail because the slot release did.
   */
  async releaseAdmissionAfterPurchase(queueSessionId: string | null | undefined): Promise<boolean> {
    if (!queueSessionId) {
      return false;
    }

    try {
      const performanceId = await this.redis.get(this.sessionRefKey(queueSessionId));
      if (!performanceId) {
        return false;
      }

      const record = await this.readQueueSessionRecord(performanceId, queueSessionId);
      if (!record) {
        await this.redis.srem(this.activeAdmissionsKey(performanceId), queueSessionId);
        return false;
      }

      const expiresAt = new Date(Date.now() + QUEUE_EXPIRED_RETENTION_SECONDS * 1000);
      const result = await this.transitionQueueSession(record, 'release', [
        '',
        expiresAt.toISOString(),
        String(QUEUE_EXPIRED_RETENTION_SECONDS * 1000),
      ]);
      if (result.applied) {
        await this.syncQueueSessionIndexes(result);
      }
      return result.applied;
    } catch (error) {
      this.logger.warn(
        `Queue admission release after purchase failed. queueSessionId=${queueSessionId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return false;
    }
  }

  private async assertAdmissionForPerformance(
    params: QueueActionParams,
  ): Promise<ValidatedAdmission> {
    // Booking mutations never run the queue reconcile inline; queue status
    // polls and entries drive it so seat locks and payment confirms stay fast.
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
      if (currentRecord.state === EXPIRED) {
        throw new ForbiddenException('대기열 입장 시간이 만료되었습니다');
      }
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

    // No showtime on sale (C1) reads as 0 remaining seats: nobody is admitted.
    const remainingSeats = await this.calculateRemainingSeats(performanceId);
    if (remainingSeats <= 0) {
      return;
    }

    const capacity = Math.min(remainingSeats, QUEUE_MAX_ACTIVE_ADMISSIONS);
    const activeCount = await this.redis.scard(this.activeAdmissionsKey(performanceId));
    const slotsToFill = Math.max(0, capacity - activeCount);

    if (slotsToFill <= 0) {
      return;
    }

    const admittedRecords = await this.admitWaitingSessions(performanceId, slotsToFill, capacity);
    if (admittedRecords.length === 0) {
      return;
    }

    const waitingCount = await this.redis.zcard(this.waitingQueueKey(performanceId));
    for (const admittedRecord of admittedRecords) {
      this.gateway.emitAdmitted(
        admittedRecord.queueSessionId,
        await this.buildSnapshot(admittedRecord, {
          context: { waitingCount, rank: null, remainingSeats },
        }),
      );
    }

    await this.broadcastWaitingPositions(performanceId);
  }

  /**
   * Admits up to `slotsToFill` sessions in queue order. Each admission is one
   * atomic script (state + waiting + active), issued concurrently so a batch
   * costs a few round trips instead of several per session. Members whose
   * record already expired are dropped and the freed slots are refilled from
   * the next sessions in line. Every script re-checks the active set against
   * `capacity` when it runs, so direct admissions on other instances between
   * the SCARD above and this batch never push the active set past it.
   */
  private async admitWaitingSessions(
    performanceId: string,
    slotsToFill: number,
    capacity: number,
  ): Promise<QueueSessionRecord[]> {
    const admitted: QueueSessionRecord[] = [];
    let remainingSlots = slotsToFill;

    for (
      let round = 0;
      round < QUEUE_RECONCILE_MAX_FILL_ROUNDS && remainingSlots > 0;
      round += 1
    ) {
      const waitingIds = await this.redis.zrange(
        this.waitingQueueKey(performanceId),
        0,
        remainingSlots - 1,
      );
      if (waitingIds.length === 0) {
        break;
      }

      const records = await this.readQueueSessionRecords(performanceId, waitingIds);
      const admissionArgs = [...this.buildAdmissionArgs(new Date()), String(capacity)];
      const results = await Promise.all(
        waitingIds.map((queueSessionId, index) => {
          const record = records[index];
          if (!record) {
            return this.redis
              .zrem(this.waitingQueueKey(performanceId), queueSessionId)
              .then(() => null);
          }
          return this.transitionQueueSession(record, 'admit', admissionArgs);
        }),
      );

      const applied = results.filter(
        (result): result is QueueTransitionResult & { record: QueueSessionRecord } =>
          Boolean(result?.applied && result.record),
      );
      await Promise.all(applied.map((result) => this.syncQueueSessionIndexes(result)));
      admitted.push(...applied.map((result) => result.record));
      remainingSlots -= applied.length;

      if (results.some((result) => result?.status === 'NO_CAPACITY')) {
        // The active set is full: another instance admitted in the meantime.
        break;
      }
    }

    return admitted;
  }

  private async reconcilePerformanceQueueIfDue(performanceId: string): Promise<void> {
    // One in-flight reconcile per performance per instance, at most one run per
    // interval across instances, and the lock keeps long runs exclusive.
    if (this.reconcileInFlight.has(performanceId)) {
      return;
    }

    this.reconcileInFlight.add(performanceId);
    try {
      const due = await this.redis.set(
        this.reconcileThrottleKey(performanceId),
        '1',
        'PX',
        QUEUE_RECONCILE_MIN_INTERVAL_MS,
        'NX',
      );
      if (due !== 'OK') {
        return;
      }

      const lockKey = this.reconcileLockKey(performanceId);
      const lockToken = randomUUID();
      const acquired = await this.redis.set(
        lockKey,
        lockToken,
        'PX',
        QUEUE_RECONCILE_LOCK_TTL_MS,
        'NX',
      );

      if (acquired !== 'OK') {
        return;
      }

      try {
        await this.reconcilePerformanceQueue(performanceId);
      } finally {
        await this.redis.eval(RELEASE_QUEUE_RECONCILE_LOCK_LUA, 1, lockKey, lockToken);
      }
    } finally {
      this.reconcileInFlight.delete(performanceId);
    }
  }

  private async expireStaleSessions(performanceId: string): Promise<void> {
    const activeKey = this.activeAdmissionsKey(performanceId);
    const activeIds = await this.redis.smembers(activeKey);
    if (activeIds.length === 0) {
      return;
    }

    const records = await this.readQueueSessionRecords(performanceId, activeIds);
    const now = Date.now();
    const missingIds: string[] = [];
    const tasks: Promise<unknown>[] = [];

    activeIds.forEach((queueSessionId, index) => {
      const record = records[index];
      if (!record) {
        missingIds.push(queueSessionId);
        return;
      }

      if (record.state === WAITING) {
        // A WAITING record never owns an active slot. Older releases could leave
        // one behind after a lost update; put it back in line at its old position.
        tasks.push(this.transitionQueueSession(record, 'touch', [
          '',
          '',
          '',
          String(this.resolveEnteredAtScore(record)),
        ]));
        return;
      }

      const authorityEndsAt = this.resolveAuthorityExpiry(record);
      if (record.state !== EXPIRED && authorityEndsAt !== null && now <= authorityEndsAt) {
        return;
      }

      tasks.push(this.expireQueueSession(record));
    });

    if (missingIds.length > 0) {
      tasks.push(this.redis.srem(activeKey, ...missingIds));
    }

    await Promise.all(tasks);
  }

  private async expireQueueSession(record: QueueSessionRecord): Promise<QueueSessionRecord> {
    const expiresAt = new Date(Date.now() + QUEUE_EXPIRED_RETENTION_SECONDS * 1000);
    const result = await this.transitionQueueSession(record, 'expire', [
      this.authorityFingerprint(record),
      expiresAt.toISOString(),
      String(QUEUE_EXPIRED_RETENTION_SECONDS * 1000),
    ]);

    if (!result.applied || !result.record) {
      return result.record ?? { ...record, state: EXPIRED };
    }

    await this.syncQueueSessionIndexes(result);
    this.gateway.emitExpired(record.queueSessionId, {
      queueSessionId: record.queueSessionId,
      state: EXPIRED,
      autoEnter: false,
    });

    return result.record;
  }

  private async enablePaymentRecovery(record: QueueSessionRecord): Promise<QueueSessionRecord> {
    if (!record.admittedAt || !record.activeUntilAt || !record.reentryGraceUntilAt) {
      return record;
    }

    const currentRecovery = record.paymentRecoveryUntilAt
      ? Date.parse(record.paymentRecoveryUntilAt)
      : 0;
    const targetRecovery = Date.parse(record.reentryGraceUntilAt);

    if (currentRecovery >= targetRecovery) {
      return record;
    }

    const expiresAt = targetRecovery + QUEUE_EXPIRED_RETENTION_SECONDS * 1000;
    const result = await this.transitionQueueSession(record, 'recovery', [
      record.admittedAt,
      record.reentryGraceUntilAt,
      new Date(expiresAt).toISOString(),
      String(Math.max(1, expiresAt - Date.now())),
    ]);
    if (result.applied) {
      await this.syncQueueSessionIndexes(result);
    }

    return result.record ?? record;
  }

  /** admittedAt, activeUntilAt, reentryGraceUntilAt, expiresAt, ttlMs for an admission now. */
  private buildAdmissionArgs(admittedAt: Date): string[] {
    const activeUntilAt = new Date(
      admittedAt.getTime() + QUEUE_ACTIVE_WINDOW_SECONDS * 1000,
    );
    const reentryGraceUntilAt = new Date(
      activeUntilAt.getTime() + QUEUE_REENTRY_GRACE_SECONDS * 1000,
    );
    const expiresAt = new Date(
      reentryGraceUntilAt.getTime() + QUEUE_EXPIRED_RETENTION_SECONDS * 1000,
    );

    return [
      admittedAt.toISOString(),
      activeUntilAt.toISOString(),
      reentryGraceUntilAt.toISOString(),
      expiresAt.toISOString(),
      String(expiresAt.getTime() - admittedAt.getTime()),
    ];
  }

  /** Sliding WAITING expiresAt, ttlMs, and the original enteredAt score. */
  private buildWaitingRenewalArgs(record: QueueSessionRecord, now: Date): string[] {
    return [
      new Date(now.getTime() + QUEUE_WAIT_SESSION_SECONDS * 1000).toISOString(),
      String(QUEUE_WAIT_SESSION_SECONDS * 1000),
      String(this.resolveEnteredAtScore(record, now)),
    ];
  }

  private resolveEnteredAtScore(record: QueueSessionRecord, now: Date = new Date()): number {
    const enteredAt = Date.parse(record.enteredAt);
    return Number.isFinite(enteredAt) ? enteredAt : now.getTime();
  }

  private authorityFingerprint(record: QueueSessionRecord): string {
    return [
      record.state,
      record.activeUntilAt ?? '',
      record.paymentRecoveryUntilAt ?? '',
    ].join('|');
  }

  /**
   * `recoveryOrderId` is the pending order found by findRecoveryOrderId; with
   * it a session whose active window ended reports PAYMENT_RECOVERY (payment
   * of that order only, autoEnter false, no new window). `now` is the instant
   * the caller judged the window at (default: when the counters were read).
   */
  private async buildSnapshot(
    record: QueueSessionRecord,
    options: QueueSnapshotOptions = {},
  ): Promise<QueueSessionSnapshot> {
    const { recoveryOrderId } = options;
    const { waitingCount, rank, remainingSeats } =
      options.context ?? (await this.readSnapshotContext(record, options.remainingSeats));
    const state = this.resolveVisibleState(record, recoveryOrderId, options.now);
    const position = state === WAITING && rank !== null ? rank + 1 : 0;
    const estimate =
      state === WAITING ? estimateQueueWait({ position, remainingSeats }) : NO_WAIT_ESTIMATE;

    return {
      queueSessionId: record.queueSessionId,
      state,
      position,
      waitingCount,
      etaSeconds: estimate.etaSeconds,
      etaMinSeconds: estimate.etaMinSeconds,
      etaUnavailable: estimate.etaUnavailable,
      remainingSeats,
      autoEnter: state === ADMITTED,
      admittedAt: record.admittedAt,
      activeUntilAt: record.activeUntilAt,
      reentryGraceUntilAt: record.reentryGraceUntilAt,
      ...(state === PAYMENT_RECOVERY && recoveryOrderId ? { recoveryOrderId } : {}),
    };
  }

  /**
   * Waiting counters of the session. `knownRemainingSeats` is the remaining
   * seat count the caller already read (status polls read it for the C1
   * check), so a poll reads the remaining-seats cache once instead of twice.
   */
  private async readSnapshotContext(
    record: QueueSessionRecord,
    knownRemainingSeats?: number,
  ): Promise<QueueSnapshotContext> {
    const waitingKey = this.waitingQueueKey(record.performanceId);
    const [waitingCount, rank, remainingSeats] = await Promise.all([
      this.redis.zcard(waitingKey),
      this.redis.zrank(waitingKey, record.queueSessionId),
      knownRemainingSeats ?? this.calculateRemainingSeats(record.performanceId),
    ]);
    return { waitingCount, rank, remainingSeats };
  }

  /**
   * An admission whose active window has ended is never reported as ADMITTED:
   * it is PAYMENT_RECOVERY while a bound pending order can still be paid
   * (`recoveryOrderId`), otherwise EXPIRED. `now` is the instant the window is
   * judged at.
   */
  private resolveVisibleState(
    record: QueueSessionRecord,
    recoveryOrderId?: string,
    now: number = Date.now(),
  ): QueueSessionState {
    if (record.state === WAITING || !this.isAdmissionWindowClosed(record, now)) {
      return record.state;
    }

    return recoveryOrderId ? PAYMENT_RECOVERY : EXPIRED;
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

    const record = await this.readQueueSessionRecord(performanceId, queueSessionId);
    // The token index is only a lookup; the record's current hash is the
    // authority, so a token replaced by a concurrent re-entry stops working.
    return record?.admissionTokenHash === tokenHash ? record : null;
  }

  private generateAdmissionToken(): string {
    return randomBytes(32).toString('hex');
  }

  private hashAdmissionToken(admissionToken: string): string {
    return createHash('sha256').update(admissionToken).digest('hex');
  }

  private toLease(record: QueueSessionRecord, admissionToken: string): QueueSessionLease {
    return {
      queueSessionId: record.queueSessionId,
      admissionToken,
      userId: record.userId,
      refreshTokenFamilyId: record.refreshTokenFamilyId,
      deviceSlotId: record.deviceSlotId,
    };
  }

  /**
   * Applies one atomic session transition. The script reads the record stored
   * at execution time and only rewrites the fields of that transition, so the
   * state and admission token hash written by a concurrent request survive.
   */
  private async transitionQueueSession(
    record: QueueSessionRecord,
    op: QueueTransitionOp,
    args: string[],
  ): Promise<QueueTransitionResult> {
    const reply = (await this.redis.eval(
      QUEUE_SESSION_TRANSITION_LUA,
      4,
      this.sessionKey(record.performanceId, record.queueSessionId),
      this.waitingQueueKey(record.performanceId),
      this.activeAdmissionsKey(record.performanceId),
      this.identityKey(record.performanceId, record),
      record.queueSessionId,
      op,
      ...args,
    )) as [number | string, string, string, string, number | string] | null;

    const [applied, status, encoded, previousTokenHash, ttlMs] = reply ?? [0, 'MISSING', '', '', 0];
    return {
      applied: Number(applied) === 1,
      status: String(status ?? ''),
      record: encoded ? (JSON.parse(encoded) as QueueSessionRecord) : null,
      previousTokenHash: String(previousTokenHash ?? ''),
      ttlMs: Number(ttlMs) || 0,
    };
  }

  /**
   * Keeps the cross-slot index keys (session ref and admission token) alive
   * as long as the session record. A rotated token gets a fresh index and the
   * previous one is removed; otherwise only the TTL is refreshed so a stale
   * caller can never resurrect a token index that a rotation already deleted.
   */
  private async syncQueueSessionIndexes(result: QueueTransitionResult): Promise<void> {
    const record = result.record;
    if (!record || result.ttlMs <= 0) {
      return;
    }

    const ttlMs = Math.max(1, Math.floor(result.ttlMs));
    const tokenKey = this.admissionTokenKey(record.admissionTokenHash);
    const rotated =
      result.previousTokenHash.length > 0
      && result.previousTokenHash !== record.admissionTokenHash;

    await Promise.all([
      this.redis.set(this.sessionRefKey(record.queueSessionId), record.performanceId, 'PX', ttlMs),
      rotated
        ? this.redis.set(tokenKey, record.queueSessionId, 'PX', ttlMs)
        : this.redis.expire(tokenKey, Math.max(1, Math.ceil(ttlMs / 1000))),
    ]);

    if (rotated) {
      await this.redis.del(this.admissionTokenKey(result.previousTokenHash));
    }
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

  private async readQueueSessionRecords(
    performanceId: string,
    queueSessionIds: string[],
  ): Promise<Array<QueueSessionRecord | null>> {
    // Issued concurrently: ioredis pipelines the commands on one connection,
    // so a batch costs about one round trip instead of one per session.
    return Promise.all(
      queueSessionIds.map((queueSessionId) =>
        this.readQueueSessionRecord(performanceId, queueSessionId),
      ),
    );
  }

  /**
   * Removes a stale session. Same-slot keys go through one script that keeps a
   * still-live session; cross-slot index keys are deleted one by one so the
   * purge stays Redis Cluster slot safe.
   */
  private async purgeQueueSession(params: {
    performanceId: string;
    queueSessionId: string;
    identityKey: string;
    admissionTokenHash: string | null;
    now: Date;
  }): Promise<boolean> {
    const purged = await this.redis.eval(
      PURGE_QUEUE_SESSION_LUA,
      4,
      this.sessionKey(params.performanceId, params.queueSessionId),
      this.waitingQueueKey(params.performanceId),
      this.activeAdmissionsKey(params.performanceId),
      params.identityKey,
      params.queueSessionId,
      params.now.toISOString(),
    );

    if (Number(purged) !== 1) {
      return false;
    }

    await this.redis.del(this.sessionRefKey(params.queueSessionId));
    if (params.admissionTokenHash) {
      await this.redis.del(this.admissionTokenKey(params.admissionTokenHash));
    }
    return true;
  }

  private isReusable(record: QueueSessionRecord, now: Date): boolean {
    return record.state !== EXPIRED && Date.parse(record.expiresAt) > now.getTime();
  }

  private isValidDate(value: Date | null | undefined): value is Date {
    return value instanceof Date && !Number.isNaN(value.getTime());
  }

  private async broadcastWaitingPositions(performanceId: string): Promise<void> {
    const waitingIds = await this.redis.zrange(
      this.waitingQueueKey(performanceId),
      0,
      QUEUE_POSITION_BROADCAST_LIMIT - 1,
    );
    if (waitingIds.length === 0) {
      return;
    }

    // Position is the ZRANGE index, so one batch read replaces a ZRANK/ZCARD
    // and remaining-seat lookup per session.
    const [records, waitingCount, remainingSeats] = await Promise.all([
      this.readQueueSessionRecords(performanceId, waitingIds),
      this.redis.zcard(this.waitingQueueKey(performanceId)),
      this.calculateRemainingSeats(performanceId),
    ]);

    for (const [index, queueSessionId] of waitingIds.entries()) {
      const record = records[index];
      if (!record || record.state !== WAITING) {
        continue;
      }

      this.gateway.emitPosition(
        queueSessionId,
        await this.buildSnapshot(record, { context: { waitingCount, rank: index, remainingSeats } }),
      );
    }
  }

  private async calculateRemainingSeats(performanceId: string): Promise<number> {
    return (await this.readRemainingSeatsState(performanceId)).remainingSeats;
  }

  /**
   * Remaining seats with a 2-second cache. A cache miss is computed once per
   * performance per instance: status polls, entries, broadcasts and reconcile
   * that miss at the same time share the in-flight computation.
   */
  private async readRemainingSeatsState(performanceId: string): Promise<RemainingSeatsState> {
    const inFlight = this.remainingSeatsInFlight.get(performanceId);
    if (inFlight) {
      return inFlight;
    }

    const cached = await this.redis.get(this.remainingSeatsCacheKey(performanceId));
    if (cached !== null) {
      return this.parseRemainingSeatsCache(cached);
    }

    const joined = this.remainingSeatsInFlight.get(performanceId);
    if (joined) {
      return joined;
    }

    const computation = (async (): Promise<RemainingSeatsState> => {
      const state = await this.calculateRemainingSeatsFresh(performanceId);
      await this.redis.set(
        this.remainingSeatsCacheKey(performanceId),
        state.hasBookableShowtime
          ? String(state.remainingSeats)
          : QUEUE_REMAINING_SEATS_NO_BOOKABLE_SHOWTIME,
        'EX',
        QUEUE_REMAINING_SEATS_CACHE_SECONDS,
      );
      return state;
    })().finally(() => {
      this.remainingSeatsInFlight.delete(performanceId);
    });
    this.remainingSeatsInFlight.set(performanceId, computation);
    return computation;
  }

  private parseRemainingSeatsCache(cached: string): RemainingSeatsState {
    if (cached === QUEUE_REMAINING_SEATS_NO_BOOKABLE_SHOWTIME) {
      return { remainingSeats: 0, hasBookableShowtime: false };
    }
    return { remainingSeats: Math.max(Number(cached) || 0, 0), hasBookableShowtime: true };
  }

  /**
   * Capacity and occupancy of the showtimes still on sale (C1, the same
   * showtimeOnSaleCondition as the queue entry gate): a showtime that has
   * started can never sell again, so its seats are not waited for. Capacity,
   * sold seats and live locks are all counted over that one showtime set.
   */
  private async calculateRemainingSeatsFresh(performanceId: string): Promise<RemainingSeatsState> {
    const now = new Date();
    const showtimeRows = await this.db
      .select({ id: showtimes.id })
      .from(showtimes)
      .where(and(eq(showtimes.performanceId, performanceId), showtimeOnSaleCondition(now)));

    if (showtimeRows.length === 0) {
      return { remainingSeats: 0, hasBookableShowtime: false };
    }

    const [seatCapacity] = await this.db
      .select({
        totalSeats: sql<number>`coalesce(sum(${seatMaps.totalSeats}), 0)`,
      })
      .from(seatMaps)
      .where(eq(seatMaps.performanceId, performanceId));

    if (!seatCapacity) {
      return { remainingSeats: 0, hasBookableShowtime: true };
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
          showtimeOnSaleCondition(now),
          inArray(seatInventories.status, ['sold', 'held_cancelled', 'disabled']),
        ),
      );

    // Count only live seat locks: the locked-seats set has no TTL, so members of
    // expired locks are removed here instead of shrinking capacity until the
    // next seat-map read cleans them.
    const lockedCounts = await Promise.all(
      showtimeRows.map((showtime) =>
        this.redis.eval(
          COUNT_VALID_LOCKED_SEATS_LUA,
          1,
          `{${showtime.id}}:locked-seats`,
          `{${showtime.id}}:seat:`,
        ),
      ),
    );
    const lockedCount = lockedCounts.reduce<number>(
      (total, count) => total + (Number(count) || 0),
      0,
    );

    const onSaleCapacity = Number(seatCapacity.totalSeats) * showtimeRows.length;
    return {
      remainingSeats: Math.max(onSaleCapacity - Number(soldCount?.total ?? 0) - lockedCount, 0),
      hasBookableShowtime: true,
    };
  }

  private waitingQueueKey(performanceId: string): string {
    return `${this.queuePrefix(performanceId)}:waiting`;
  }

  private activeAdmissionsKey(performanceId: string): string {
    return `${this.queuePrefix(performanceId)}:active`;
  }

  private reconcileLockKey(performanceId: string): string {
    return `${this.queuePrefix(performanceId)}:reconcile-lock`;
  }

  private reconcileThrottleKey(performanceId: string): string {
    return `${this.queuePrefix(performanceId)}:reconcile-throttle`;
  }

  private remainingSeatsCacheKey(performanceId: string): string {
    return `${this.queuePrefix(performanceId)}:remaining-seats`;
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
