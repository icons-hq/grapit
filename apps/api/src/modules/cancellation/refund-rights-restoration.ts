import { ConflictException, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { CancellationQuote } from '@grabit/shared';
import type { DrizzleDB } from '../../database/drizzle.provider.js';
import { refunds, ticketItems, tickets, ticketBenefitEntitlements } from '../../database/schema/index.js';
import { readStoredPaymentCancelRequest } from '../payment/payment-cancel-policy.js';
type RefundRecord = typeof refunds.$inferSelect;

function metadataQuote(value: unknown): CancellationQuote | null {
  if (!value || typeof value !== 'object') return null;
  const quote = (value as Record<string, unknown>).cancellationQuote as CancellationQuote | undefined;
  return quote && Array.isArray(quote.items) ? quote : null;
}

/** Restore only the rights revoked by this exact, definitively rejected attempt. */
export async function restoreRejectedRefundRights(db: DrizzleDB, requested: RefundRecord,
  failure: { code: string; message: string }): Promise<RefundRecord> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT r.id FROM reservations r JOIN payments p ON p.reservation_id = r.id
      WHERE r.id = ${requested.reservationId} FOR UPDATE OF r, p`);
    const [current] = await tx.select().from(refunds).where(eq(refunds.id, requested.id)).for('update');
    if (!current) throw new NotFoundException('환불 정보를 찾을 수 없습니다');
    const originalCommand = readStoredPaymentCancelRequest(requested.providerMetadata);
    const currentCommand = readStoredPaymentCancelRequest(current.providerMetadata);
    if (current.status === 'completed' || originalCommand?.options.idempotencyKey !== currentCommand?.options.idempotencyKey) return current;
    const quote = metadataQuote(current.providerMetadata);
    const metadata = current.providerMetadata as Record<string, unknown>;
    if (!quote || !Array.isArray(metadata.credentialStates)) throw new ConflictException('취소 전 권리 상태를 확인해야 합니다');
    const selectedIds = quote.items.map((item) => item.ticketItemId);
    const now = new Date();
    const restored = await tx.update(ticketItems).set({ status: 'active', cancelledAt: null, cancelReason: null,
      cancellationFee: 0, serviceFeeRefund: 0, refundableAmount: 0, cancellationCommand: null,
      reopenState: 'not_required', reopenHoldUntil: null, reopenJobId: null, updatedAt: now })
      .where(and(inArray(ticketItems.id, selectedIds), eq(ticketItems.status, 'cancellation_pending'))).returning({ id: ticketItems.id });
    if (restored.length !== selectedIds.length) throw new ConflictException('취소 권리 상태가 변경되어 확인이 필요합니다');
    for (const value of metadata.credentialStates) {
      const credential = value as { id: string; status: 'active' | 'used' };
      if (!['active', 'used'].includes(credential.status)) throw new ConflictException('QR 복구 상태가 유효하지 않습니다');
      await tx.update(tickets).set({ status: credential.status, revokedAt: null, updatedAt: now }).where(and(
        eq(tickets.id, credential.id), eq(tickets.reservationId, current.reservationId),
        eq(tickets.status, 'revoked'), eq(tickets.revokedAt, current.requestedAt),
      ));
    }
    await tx.update(ticketBenefitEntitlements).set({ state: 'active', inactiveReason: null, updatedAt: now }).where(and(
      inArray(ticketBenefitEntitlements.ticketItemId, selectedIds), eq(ticketBenefitEntitlements.state, 'inactive'),
      eq(ticketBenefitEntitlements.inactiveReason, 'cancellation_pending'),
    ));
    const [failed] = await tx.update(refunds).set({ status: 'failed', failedAt: now,
      resultCode: failure.code, resultMessage: failure.message,
      failureReason: failure.message, customerServiceCtaVisible: true, updatedAt: now,
      providerMetadata: { ...metadata, rightsRestoredAt: now.toISOString() },
    }).where(eq(refunds.id, current.id)).returning();
    return failed!;
  });
}
