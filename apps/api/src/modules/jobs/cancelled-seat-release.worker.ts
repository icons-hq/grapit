import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import { seatInventories, showtimes } from '../../database/schema/index.js';
import { BookingGateway } from '../booking/booking.gateway.js';
import {
  PG_BOSS,
  PG_BOSS_JOB_NAMES,
  type PgBossContract,
  type ReleaseCancelledSeatJobPayload,
  type SeatIdentityPayload,
} from './pgboss.provider.js';

export const SHOWTIME_IMMINENT_REOPEN_REASON = 'SHOWTIME_IMMINENT';

export function pickCancelledSeatReleaseDelaySeconds(
  minMinutes: number,
  maxMinutes: number,
  rng: () => number = Math.random,
): number {
  const minSeconds = Math.max(60, Math.floor(minMinutes * 60));
  const maxSeconds = Math.max(minSeconds, Math.floor(maxMinutes * 60));
  return Math.floor(rng() * (maxSeconds - minSeconds + 1)) + minSeconds;
}

export function shouldKeepHeldCancelledSeat(
  showtimeAt: Date,
  releaseAt: Date,
  guardMinutes = 5,
): boolean {
  return releaseAt.getTime() >= showtimeAt.getTime() - guardMinutes * 60 * 1000;
}

@Injectable()
export class CancelledSeatReleaseWorker implements OnModuleInit {
  private readonly logger = new Logger(CancelledSeatReleaseWorker.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    @Optional() @Inject(PG_BOSS) private readonly pgBoss?: PgBossContract,
    @Optional() private readonly bookingGateway?: BookingGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.pgBoss?.isAvailable) {
      return;
    }

    await this.pgBoss.work<ReleaseCancelledSeatJobPayload>(
      PG_BOSS_JOB_NAMES.releaseCancelledSeat,
      async ([job]) => {
        if (!job) {
          return;
        }

        await this.handleJob(job.data, job.id);
      },
    );
  }

  async handleJob(payload: ReleaseCancelledSeatJobPayload, releaseJobId?: string): Promise<{
    status: 'released' | 'skipped_imminent' | 'missing_showtime' | 'missing_job';
  }> {
    if (!releaseJobId) {
      return { status: 'missing_job' };
    }

    const showtimeAt = await this.loadShowtimeAt(payload.showtimeId);
    if (!showtimeAt) {
      return { status: 'missing_showtime' };
    }

    const releaseAt = new Date(payload.releaseAt);
    if (shouldKeepHeldCancelledSeat(showtimeAt, releaseAt)) {
      await this.markShowtimeImminentHold(
        payload.showtimeId,
        payload.seatIdentities,
        releaseAt,
        releaseJobId,
      );
      return { status: 'skipped_imminent' };
    }

    const releasedSeats = await this.releaseHeldSeats(
      payload.showtimeId,
      payload.seatIdentities,
      releaseJobId,
    );
    for (const seatIdentity of releasedSeats) {
      this.bookingGateway?.broadcastSeatUpdate(
        payload.showtimeId,
        seatIdentity.seatKey,
        'available',
      );
    }

    return { status: 'released' };
  }

  protected async loadShowtimeAt(showtimeId: string): Promise<Date | null> {
    const [row] = await this.db
      .select({ dateTime: showtimes.dateTime })
      .from(showtimes)
      .where(eq(showtimes.id, showtimeId));

    return row?.dateTime ?? null;
  }

  protected async markShowtimeImminentHold(
    showtimeId: string,
    seatIdentities: SeatIdentityPayload[],
    releaseAt: Date,
    releaseJobId: string,
  ): Promise<void> {
    for (const seatIdentity of seatIdentities) {
      await this.db
        .update(seatInventories)
        .set({
          status: 'held_cancelled',
          reopenHoldUntil: releaseAt,
          reopenJobId: SHOWTIME_IMMINENT_REOPEN_REASON,
        })
        .where(
          and(
            eq(seatInventories.showtimeId, showtimeId),
            eq(seatInventories.floorKey, seatIdentity.floorKey),
            eq(seatInventories.seatKey, seatIdentity.seatKey),
            eq(seatInventories.status, 'held_cancelled'),
            eq(seatInventories.reopenJobId, releaseJobId),
          ),
        );
    }
  }

  protected async releaseHeldSeats(
    showtimeId: string,
    seatIdentities: SeatIdentityPayload[],
    releaseJobId: string,
  ): Promise<SeatIdentityPayload[]> {
    const releasedSeats: SeatIdentityPayload[] = [];

    for (const seatIdentity of seatIdentities) {
      const released = await this.db
        .update(seatInventories)
        .set({
          status: 'available',
          lockedBy: null,
          lockedUntil: null,
          soldAt: null,
          heldCancelledAt: null,
          reopenHoldUntil: null,
          reopenJobId: null,
        })
        .where(
          and(
            eq(seatInventories.showtimeId, showtimeId),
            eq(seatInventories.floorKey, seatIdentity.floorKey),
            eq(seatInventories.seatKey, seatIdentity.seatKey),
            eq(seatInventories.status, 'held_cancelled'),
            eq(seatInventories.reopenJobId, releaseJobId),
          ),
        )
        .returning({ id: seatInventories.id });

      if (released.length > 0) {
        releasedSeats.push(seatIdentity);
      }
    }

    this.logger.log(
      `Released held_cancelled seats for showtimeId=${showtimeId}, count=${releasedSeats.length}`,
    );

    return releasedSeats;
  }
}
