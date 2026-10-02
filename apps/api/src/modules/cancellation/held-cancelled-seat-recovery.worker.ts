import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import { BookingGateway } from '../booking/booking.gateway.js';
import { isBackgroundProcessingEnabled } from '../jobs/pgboss.provider.js';
import { waitWithinRunDeadline } from '../../common/run-deadline.js';

export const HELD_SEAT_RECOVERY_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
/** A release job normally runs at its hold expiry; only seats held well past it are treated as stranded. */
export const HELD_SEAT_RECOVERY_GRACE_MS = 15 * 60 * 1000;
/** Same guard as the release worker: never reopen a cancelled seat in the last minutes before showtime. */
export const HELD_SEAT_RECOVERY_SHOWTIME_GUARD_MS = 5 * 60 * 1000;
export const HELD_SEAT_RECOVERY_BATCH_SIZE = 200;
/** Bounded wait for an in-flight sweep on shutdown (the bounded worker closes the database right after). */
export const HELD_SEAT_RECOVERY_SHUTDOWN_WAIT_MS = 30 * 1000;
const SHOWTIME_IMMINENT_REOPEN_REASON = 'SHOWTIME_IMMINENT';

export interface HeldSeatRecoveryResult {
  releasedSeats: number;
}

/**
 * Releases `held_cancelled` seats whose cancellation hold expired but whose release job never ran: the job
 * enqueue failed (pg-boss unavailable), the process died between commit and enqueue, or the job id write was
 * lost. Release keeps the same guards as the release worker: no active/cancellation-pending Ticket Item on
 * the seat, and no reopen within the showtime guard (those seats stay held as `SHOWTIME_IMMINENT`).
 * It applies to whole-reservation and single Ticket Item cancellations alike.
 */
@Injectable()
export class HeldCancelledSeatRecoveryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HeldCancelledSeatRecoveryWorker.name);
  private sweepInterval: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private sweepRun: Promise<unknown> | null = null;
  private stopping = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    @Optional() private readonly configService?: ConfigService,
    @Optional() private readonly bookingGateway?: BookingGateway,
  ) {}

  onModuleInit(): void {
    if (!this.configService || !isBackgroundProcessingEnabled(this.configService) || this.sweepInterval) {
      return;
    }

    const run = () => {
      if (this.stopping || this.sweepRun) {
        return;
      }
      const sweep = this.releaseExpiredHeldSeats()
        .catch((error: unknown) => {
          this.logger.error(
            'Held cancelled seat recovery sweep failed',
            error instanceof Error ? error.stack : String(error),
          );
        })
        .finally(() => {
          if (this.sweepRun === sweep) {
            this.sweepRun = null;
          }
        });
      this.sweepRun = sweep;
    };
    run();
    this.sweepInterval = setInterval(run, HELD_SEAT_RECOVERY_SWEEP_INTERVAL_MS);
    this.sweepInterval.unref?.();
  }

  /** Waits (bounded) for an in-flight sweep so a bounded worker run does not close the database under it. */
  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
      this.sweepInterval = null;
    }

    const inFlight = this.sweepRun;
    if (!inFlight) {
      return;
    }

    // The bounded worker shortens the wait to its run deadline (common/run-deadline.ts).
    await waitWithinRunDeadline(inFlight, HELD_SEAT_RECOVERY_SHUTDOWN_WAIT_MS);
  }

  async releaseExpiredHeldSeats(now: Date = new Date()): Promise<HeldSeatRecoveryResult> {
    if (this.running) {
      return { releasedSeats: 0 };
    }
    this.running = true;

    try {
      const holdExpiredBefore = new Date(now.getTime() - HELD_SEAT_RECOVERY_GRACE_MS).toISOString();
      const showtimeAfter = new Date(now.getTime() + HELD_SEAT_RECOVERY_SHOWTIME_GUARD_MS).toISOString();
      const result = await this.db.execute(sql`
        WITH candidates AS (
          SELECT si.id
          FROM seat_inventories si
          INNER JOIN showtimes s ON s.id = si.showtime_id
          WHERE si.status = 'held_cancelled'
            AND si.reopen_hold_until IS NOT NULL
            AND si.reopen_hold_until < ${holdExpiredBefore}::timestamptz
            AND coalesce(si.reopen_job_id, '') <> ${SHOWTIME_IMMINENT_REOPEN_REASON}
            AND s.date_time > ${showtimeAfter}::timestamptz
            AND NOT EXISTS (
              SELECT 1 FROM ticket_items ti
              WHERE ti.showtime_id = si.showtime_id
                AND ti.floor_key = si.floor_key
                AND ti.seat_key = si.seat_key
                AND ti.status IN ('active', 'cancellation_pending')
            )
          ORDER BY si.reopen_hold_until
          LIMIT ${HELD_SEAT_RECOVERY_BATCH_SIZE}
          FOR UPDATE OF si SKIP LOCKED
        ),
        released AS (
          UPDATE seat_inventories si
          SET
            status = 'available',
            locked_by = NULL,
            locked_until = NULL,
            sold_at = NULL,
            held_cancelled_at = NULL,
            reopen_hold_until = NULL,
            reopen_job_id = NULL
          FROM candidates c
          WHERE si.id = c.id
            AND si.status = 'held_cancelled'
          RETURNING si.showtime_id, si.seat_key
        ),
        reopened_items AS (
          UPDATE ticket_items ti
          SET
            reopen_state = 'available',
            reopen_hold_until = NULL,
            reopen_job_id = NULL,
            updated_at = ${now.toISOString()}::timestamptz
          FROM released r
          WHERE ti.showtime_id = r.showtime_id
            AND ti.seat_key = r.seat_key
            AND ti.status = 'cancelled'
            AND ti.reopen_state = 'held_cancelled'
          RETURNING ti.id
        )
        SELECT
          released.showtime_id AS showtime_id,
          released.seat_key AS seat_key,
          (SELECT count(*) FROM reopened_items)::int AS reopened_item_count
        FROM released
      `);

      const releasedSeats = result.rows.map((row) => ({
        showtimeId: String((row as Record<string, unknown>)['showtime_id']),
        seatKey: String((row as Record<string, unknown>)['seat_key']),
      }));
      for (const seat of releasedSeats) {
        this.bookingGateway?.broadcastSeatUpdate(seat.showtimeId, seat.seatKey, 'available');
      }

      if (releasedSeats.length > 0) {
        this.logger.warn(
          `Released held_cancelled seats whose release job did not run. count=${releasedSeats.length}`,
        );
      }

      return { releasedSeats: releasedSeats.length };
    } finally {
      this.running = false;
    }
  }
}
