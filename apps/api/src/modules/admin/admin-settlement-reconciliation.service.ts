import { BadGatewayException, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { AdminSettlementReconciliation } from '@grabit/shared';

import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import {
  payments,
  performances,
  reservations,
  showtimes,
  ticketItems,
} from '../../database/schema/index.js';
import {
  TossPaymentError,
  TossPaymentsClient,
  type TossSettlementRow,
} from '../payment/toss-payments.client.js';

interface ReconciliationQuery {
  eventId: string;
}

interface PaymentReconciliationRow {
  eventId: string;
  paymentKey: string;
  provider: string;
  method: string;
  providerChargeCurrency: string | null;
  activeGrossAmount: number | string | null;
  paidAt: Date | string | null;
}

@Injectable()
export class AdminSettlementReconciliationService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly tossPaymentsClient: TossPaymentsClient,
  ) {}

  async getReconciliation(
    query: ReconciliationQuery,
  ): Promise<AdminSettlementReconciliation> {
    const rows = await this.fetchPaymentRows(query.eventId);
    const siteSalesGrossAmount = sum(rows.map((row) => row.activeGrossAmount));
    const domesticRows = rows.filter((row) => !isForeignPayment(row));
    const foreignRows = rows.filter(isForeignPayment);
    const warnings: string[] = [];

    if (rows.length === 0) {
      warnings.push('선택한 이벤트의 결제 완료 active 티켓이 없습니다.');
    }

    const domestic = await this.reconcileDomesticRows(domesticRows);
    const foreign = buildForeignSummary(foreignRows);

    if (domestic.unmatchedGrossAmount > 0) {
      warnings.push('Toss 국내 정산에 아직 매칭되지 않은 국내 결제가 있습니다.');
    }
    if (foreign.grossAmount > 0) {
      warnings.push('외화정산 지급액은 Toss 상점관리자 값을 직접 입력하세요.');
    }

    return {
      eventId: query.eventId,
      siteSalesGrossAmount,
      domestic,
      foreign,
      generatedAt: new Date().toISOString(),
      warnings,
    };
  }

  private async fetchPaymentRows(
    eventId: string,
  ): Promise<PaymentReconciliationRow[]> {
    const rows = await this.db
      .select({
        eventId: performances.id,
        paymentKey: payments.paymentKey,
        provider: payments.provider,
        method: payments.method,
        providerChargeCurrency: payments.providerChargeCurrency,
        activeGrossAmount: sql<number>`coalesce(sum(${ticketItems.price} + ${ticketItems.serviceFee}), 0)::int`,
        paidAt: payments.paidAt,
      })
      .from(ticketItems)
      .innerJoin(reservations, eq(ticketItems.reservationId, reservations.id))
      .innerJoin(payments, eq(ticketItems.paymentId, payments.id))
      .innerJoin(showtimes, eq(ticketItems.showtimeId, showtimes.id))
      .innerJoin(performances, eq(showtimes.performanceId, performances.id))
      .where(
        and(
          eq(performances.id, eventId),
          eq(reservations.status, 'CONFIRMED'),
          eq(payments.status, 'DONE'),
          eq(ticketItems.status, 'active'),
        ),
      )
      .groupBy(
        performances.id,
        payments.paymentKey,
        payments.provider,
        payments.method,
        payments.providerChargeCurrency,
        payments.paidAt,
      )
      .orderBy(asc(payments.paidAt), asc(payments.paymentKey));

    return rows as PaymentReconciliationRow[];
  }

  private async reconcileDomesticRows(
    rows: PaymentReconciliationRow[],
  ): Promise<AdminSettlementReconciliation['domestic']> {
    if (rows.length === 0) {
      return emptyDomesticReconciliation();
    }

    const startDate = resolveStartDate(rows);
    const settlementRows = await this.querySettlements(startDate);
    const domesticPaymentKeys = new Set(rows.map((row) => row.paymentKey));
    const matchedSettlementRows = settlementRows.filter((row) =>
      domesticPaymentKeys.has(row.paymentKey),
    );
    const settledPaymentKeys = new Set(
      matchedSettlementRows.map((row) => row.paymentKey),
    );
    const unmatchedRows = rows.filter((row) => !settledPaymentKeys.has(row.paymentKey));
    const unsettledTransfer = await this.sumUnsettledTransfers(unmatchedRows);

    return {
      tossGrossAmount: sum(matchedSettlementRows.map((row) => row.amount)),
      payoutAmount: sum(matchedSettlementRows.map((row) => row.payOutAmount)),
      feeAmount: sum(matchedSettlementRows.map((row) => row.fee)),
      matchedGrossAmount: sum(
        rows
          .filter((row) => settledPaymentKeys.has(row.paymentKey))
          .map((row) => row.activeGrossAmount),
      ),
      unmatchedGrossAmount: sum(unmatchedRows.map((row) => row.activeGrossAmount)),
      unsettledTransferAmount: unsettledTransfer.amount,
      unsettledTransferCount: unsettledTransfer.count,
    };
  }

  private async querySettlements(startDate: string): Promise<TossSettlementRow[]> {
    try {
      return await this.tossPaymentsClient.querySettlements({
        startDate,
        endDate: todayKstDateString(),
        dateType: 'soldDate',
        secretKeyScope: 'default',
      });
    } catch (error) {
      if (error instanceof TossPaymentError) {
        throw new BadGatewayException('Toss 정산 API 확인 실패');
      }
      throw error;
    }
  }

  private async sumUnsettledTransfers(rows: PaymentReconciliationRow[]) {
    let amount = 0;
    let count = 0;

    for (const row of rows) {
      if (!isTransferMethod(row.method)) {
        continue;
      }

      const payment = await this.tossPaymentsClient.queryPayment(row.paymentKey, {
        secretKeyScope: 'default',
      });

      if (payment.transfer?.settlementStatus === 'INCOMPLETED') {
        amount += toInteger(row.activeGrossAmount);
        count += 1;
      }
    }

    return { amount, count };
  }
}

function emptyDomesticReconciliation(): AdminSettlementReconciliation['domestic'] {
  return {
    tossGrossAmount: 0,
    payoutAmount: 0,
    feeAmount: 0,
    matchedGrossAmount: 0,
    unmatchedGrossAmount: 0,
    unsettledTransferAmount: 0,
    unsettledTransferCount: 0,
  };
}

function buildForeignSummary(
  rows: PaymentReconciliationRow[],
): AdminSettlementReconciliation['foreign'] {
  const byProvider = new Map<
    string,
    { provider: string; grossAmount: number; reservationCount: number }
  >();

  for (const row of rows) {
    const provider = row.provider || 'UNKNOWN';
    const current = byProvider.get(provider) ?? {
      provider,
      grossAmount: 0,
      reservationCount: 0,
    };
    current.grossAmount += toInteger(row.activeGrossAmount);
    current.reservationCount += 1;
    byProvider.set(provider, current);
  }

  return {
    grossAmount: sum(rows.map((row) => row.activeGrossAmount)),
    byProvider: Array.from(byProvider.values()),
  };
}

function resolveStartDate(rows: PaymentReconciliationRow[]): string {
  const paidTimes = rows
    .map((row) => toDate(row.paidAt))
    .filter((value): value is Date => value !== null)
    .map((date) => date.getTime());

  if (paidTimes.length === 0) {
    return todayKstDateString();
  }

  return formatKstDate(new Date(Math.min(...paidTimes)));
}

function todayKstDateString(): string {
  return formatKstDate(new Date());
}

function formatKstDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function isForeignPayment(row: PaymentReconciliationRow): boolean {
  return Boolean(row.providerChargeCurrency && row.providerChargeCurrency !== 'KRW');
}

function isTransferMethod(method: string): boolean {
  return ['계좌이체', 'TRANSFER'].includes(method);
}

function toDate(value: Date | string | null): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function sum(values: Array<number | string | null | undefined>): number {
  return values.reduce<number>((total, value) => total + toInteger(value), 0);
}

function toInteger(value: number | string | null | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
  }
  return 0;
}
