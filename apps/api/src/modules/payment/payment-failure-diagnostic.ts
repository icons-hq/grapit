import { sql } from 'drizzle-orm';
import type { PaymentFailureDiagnostic } from '@grabit/shared';
import type { DrizzleDB } from '../../database/drizzle.provider.js';
import { reservationPaymentFailureDiagnostics } from '../../database/schema/index.js';

interface RecordReservationPaymentFailureDiagnosticInput {
  reservationId: string;
  paymentId?: string | null;
  tossOrderId?: string | null;
  diagnosticKind: string;
  diagnosticCode: string;
  diagnosticMessage: string;
  diagnosticSource: string;
  recordedAt?: Date;
}

export interface PaymentFailureDiagnosticRow {
  diagnosticKind: string | null;
  diagnosticCode: string | null;
  diagnosticMessage: string | null;
  diagnosticSource: string | null;
  recordedAt: Date | null;
  providerCheckStatus: string | null;
  providerCheckedAt?: Date | null;
  providerCheckMessage?: string | null;
}

function dateToIsoOrNull(date: Date | null | undefined): string | null {
  return date instanceof Date ? date.toISOString() : null;
}

export function mapPaymentFailureDiagnostic(
  diagnostic: PaymentFailureDiagnosticRow | null | undefined,
): PaymentFailureDiagnostic | null {
  if (
    !diagnostic?.diagnosticKind
    || !diagnostic.diagnosticCode
    || !diagnostic.diagnosticMessage
    || !diagnostic.diagnosticSource
    || !diagnostic.recordedAt
    || !diagnostic.providerCheckStatus
  ) {
    return null;
  }

  return {
    kind: diagnostic.diagnosticKind,
    code: diagnostic.diagnosticCode,
    message: diagnostic.diagnosticMessage,
    source: diagnostic.diagnosticSource,
    recordedAt: diagnostic.recordedAt.toISOString(),
    providerCheckStatus: diagnostic.providerCheckStatus,
    providerCheckedAt: dateToIsoOrNull(diagnostic.providerCheckedAt),
    providerCheckMessage: diagnostic.providerCheckMessage ?? null,
  };
}

export async function recordReservationPaymentFailureDiagnostic(
  db: DrizzleDB,
  input: RecordReservationPaymentFailureDiagnosticInput,
): Promise<void> {
  const recordedAt = input.recordedAt ?? new Date();

  await db
    .insert(reservationPaymentFailureDiagnostics)
    .values({
      reservationId: input.reservationId,
      paymentId: input.paymentId ?? null,
      tossOrderId: input.tossOrderId ?? null,
      diagnosticKind: input.diagnosticKind,
      diagnosticCode: input.diagnosticCode,
      diagnosticMessage: input.diagnosticMessage,
      diagnosticSource: input.diagnosticSource,
      recordedAt,
      updatedAt: recordedAt,
    })
    .onConflictDoUpdate({
      target: reservationPaymentFailureDiagnostics.reservationId,
      set: {
        paymentId: input.paymentId ?? null,
        tossOrderId: input.tossOrderId ?? null,
        diagnosticKind: input.diagnosticKind,
        diagnosticCode: input.diagnosticCode,
        diagnosticMessage: input.diagnosticMessage,
        diagnosticSource: input.diagnosticSource,
        recordedAt,
        updatedAt: sql`now()`,
      },
    });
}

export function paymentTerminalFailureDiagnostic(status: string, reason?: string | null): {
  diagnosticKind: string;
  diagnosticCode: string;
  diagnosticMessage: string;
} {
  switch (status) {
    case 'EXPIRED':
      return {
        diagnosticKind: 'payment_expired',
        diagnosticCode: 'PAYMENT_EXPIRED',
        diagnosticMessage: '결제 유효 시간이 만료되었습니다.',
      };
    case 'ABORTED':
      return {
        diagnosticKind: 'payment_failed',
        diagnosticCode: 'PAYMENT_ABORTED',
        diagnosticMessage: '결제가 중단되었거나 실패했습니다.',
      };
    case 'CANCELED':
      return {
        diagnosticKind: 'payment_cancelled_before_confirm',
        diagnosticCode: 'PAYMENT_CANCELED_BEFORE_CONFIRM',
        diagnosticMessage: reason?.trim() || '결제 승인 전 취소되었습니다.',
      };
    default:
      return {
        diagnosticKind: 'payment_failed',
        diagnosticCode: 'PAYMENT_FAILED',
        diagnosticMessage: '결제 실패 또는 미완료로 예매가 실패 처리되었습니다.',
      };
  }
}
