import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { DrizzleDB } from '../../database/drizzle.provider.js';
import { qrReminderDeliveries, tickets } from '../../database/schema/index.js';

export const QR_REMINDER_LEASE_MS = 5 * 60 * 1000;
/** Resend retains an idempotency key for 24h. Leave an hour of safety margin. */
export const QR_REMINDER_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
export type QrReminderClaim = typeof qrReminderDeliveries.$inferSelect & { claimToken: string };

/** Short database operations; no transaction/connection stays open during an email request. */
export class QrReminderDeliveryStore {
  constructor(private readonly db: DrizzleDB) {}

  async claim(reservationId: string, now = new Date()): Promise<QrReminderClaim | undefined> {
    await this.db.insert(qrReminderDeliveries).values({ reservationId, nextAttemptAt: now }).onConflictDoNothing();
    const claimToken = randomUUID();
    const [claimed] = await this.db.update(qrReminderDeliveries).set({
      claimToken,
      leaseExpiresAt: new Date(now.getTime() + QR_REMINDER_LEASE_MS),
      attempts: sql`${qrReminderDeliveries.attempts} + 1`,
      updatedAt: now,
    }).where(and(
      eq(qrReminderDeliveries.reservationId, reservationId),
      isNull(qrReminderDeliveries.sentAt),
      isNull(qrReminderDeliveries.attentionAt),
      isNull(qrReminderDeliveries.suppressedAt),
      lte(qrReminderDeliveries.nextAttemptAt, now),
      or(isNull(qrReminderDeliveries.leaseExpiresAt), lte(qrReminderDeliveries.leaseExpiresAt, now)),
    )).returning();
    return claimed ? { ...claimed, claimToken } : undefined;
  }

  /** Freeze the request identity only once an eligible recipient and payload are ready. */
  async beginSend(claim: QrReminderClaim, payloadHash: string): Promise<'ready' | 'lost_lease' | 'payload_changed' | 'retry_window_expired'> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(qrReminderDeliveries).where(this.owns(claim)).for('update');
      const now = new Date();
      if (!current?.leaseExpiresAt || current.leaseExpiresAt <= now) return 'lost_lease';
      const reason = current.payloadHash && current.payloadHash !== payloadHash
        ? 'payload_changed'
        : current.firstAttemptAt && now.getTime() - current.firstAttemptAt.getTime() >= QR_REMINDER_RETRY_WINDOW_MS
          ? 'retry_window_expired' : null;
      if (reason) {
        await tx.update(qrReminderDeliveries).set({ attentionAt: now, attentionReason: reason,
          claimToken: null, leaseExpiresAt: null, updatedAt: now }).where(this.owns(claim));
        return reason;
      }
      await tx.update(qrReminderDeliveries).set({ payloadHash,
        firstAttemptAt: current.firstAttemptAt ?? now, updatedAt: now }).where(this.owns(claim));
      return 'ready';
    });
  }

  async complete(claim: QrReminderClaim, ticketIds: string[], providerMessageId?: string): Promise<boolean> {
    const sentAt = new Date();
    return this.db.transaction(async (tx) => {
      const [completed] = await tx.update(qrReminderDeliveries).set({
        sentAt, providerMessageId: providerMessageId ?? null, claimToken: null, leaseExpiresAt: null, updatedAt: sentAt,
      }).where(this.owns(claim)).returning({ reservationId: qrReminderDeliveries.reservationId });
      if (!completed) return false;
      if (ticketIds.length) {
        await tx.update(tickets).set({
          emailSentAt: sql`coalesce(${tickets.emailSentAt}, ${sentAt.toISOString()}::timestamptz)`,
          updatedAt: sentAt,
        }).where(inArray(tickets.id, ticketIds));
      }
      return true;
    });
  }

  async release(claim: QrReminderClaim): Promise<void> {
    const now = new Date();
    const delayMs = Math.min(30 * 60 * 1000, 60 * 1000 * 2 ** Math.min(claim.attempts - 1, 5));
    await this.db.update(qrReminderDeliveries).set({
      claimToken: null, leaseExpiresAt: null,
      nextAttemptAt: new Date(now.getTime() + delayMs), updatedAt: now,
    }).where(this.owns(claim));
  }

  /** Existing/manual timestamps suppress replay but are not new provider receipts. */
  async suppress(claim: QrReminderClaim): Promise<void> {
    const now = new Date();
    await this.db.update(qrReminderDeliveries).set({
      suppressedAt: now, claimToken: null, leaseExpiresAt: null, updatedAt: now,
    }).where(this.owns(claim));
  }

  private owns(claim: QrReminderClaim) {
    return and(eq(qrReminderDeliveries.reservationId, claim.reservationId),
      eq(qrReminderDeliveries.claimToken, claim.claimToken), isNull(qrReminderDeliveries.sentAt));
  }
}
