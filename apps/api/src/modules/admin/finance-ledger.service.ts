import { BadGatewayException, BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import { financeLedgerQuerySchema, type FinanceAmounts, type FinanceCurrencyTotal, type FinanceLedger,
  type FinanceLedgerQuery, type FinancePaymentRow, type FinanceTicket, type FinanceProviderEvidence, type FinanceProviderRow,
  financeLedgerExportSchema, resolveAdminCapabilitySnapshot, ADMIN_CAPABILITIES, type FinanceLedgerExportRequest } from '@grabit/shared';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import { payments, performances, refunds, reservations, showtimes, ticketItems } from '../../database/schema/index.js';
import { TossPaymentsClient, type TossSettlementRow } from '../payment/toss-payments.client.js';
import { resolvePaymentCancelSecretScope } from '../payment/payment-cancel-policy.js';
import { AdminAuditService } from './admin-audit.service.js';
import type { AdminCapabilityBundle } from '@grabit/shared';
import { financeLedgerCsv } from './finance-ledger-export.js';

interface FinanceExportActor {
  actorUserId: string;
  role?: string | null;
  bundle?: AdminCapabilityBundle | null;
  capabilities?: readonly string[] | null;
  adminCapabilityBundle?: AdminCapabilityBundle | null;
  adminCapabilities?: readonly string[] | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

type Payment = typeof payments.$inferSelect;
type Item = typeof ticketItems.$inferSelect;
type Refund = typeof refunds.$inferSelect;
type PaymentSource = { payment: Payment; reservation: typeof reservations.$inferSelect;
  showtime: typeof showtimes.$inferSelect; refund: Refund | null };

@Injectable()
export class FinanceLedgerService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly toss: TossPaymentsClient, private readonly audit: AdminAuditService) {}

  async exportLedger(input: FinanceLedgerExportRequest, actor: FinanceExportActor) {
    const parsed = financeLedgerExportSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException('조회 조건과 내보내기 사유를 확인해주세요');
    const request = parsed.data;
    const capability = resolveAdminCapabilitySnapshot({ id: actor.actorUserId, role: actor.role ?? null,
      adminCapabilityBundle: actor.adminCapabilityBundle ?? actor.bundle ?? null,
      adminCapabilities: ADMIN_CAPABILITIES.filter((capability) => (actor.adminCapabilities ?? actor.capabilities ?? []).includes(capability)) });
    const auditBase = { actorUserId: actor.actorUserId, action: 'settlement.export' as const,
      resourceType: 'finance_ledger', resourceId: request.query.eventId, reason: request.reason,
      changedFields: ['dataset', 'filters', 'rowCount'], ipAddress: actor.ipAddress, userAgent: actor.userAgent };
    if (!capability.superuser && !capability.capabilities.includes('settlement.export')) {
      await this.audit.write({ ...auditBase, status: 'denied', after: { dataset: request.dataset, query: request.query } }, this.db);
      throw new ForbiddenException('정산 내보내기 권한이 필요합니다');
    }
    const ledger = await this.getLedger(request.query);
    if (request.dataset === 'provider' && !['ready', 'empty'].includes(ledger.provider.status)) {
      await this.audit.write({ ...auditBase, status: 'failed', after: { dataset: request.dataset, query: request.query, providerStatus: ledger.provider.status } }, this.db);
      throw new BadGatewayException('PG 정산 조회가 완료되지 않아 내보낼 수 없습니다. 다시 조회해주세요');
    }
    const { csv, rowCount } = financeLedgerCsv(ledger, request.dataset);
    await this.audit.write({ ...auditBase, status: 'success', after: { dataset: request.dataset, query: ledger.query,
      rowCount, generatedAt: ledger.generatedAt, summary: ledger.summary, providerStatus: ledger.provider.status } }, this.db);
    return { csv, filename: `finance-${request.dataset}-${request.query.eventId}-${request.query.dateFrom}-${request.query.dateTo}.csv` };
  }

  async getLedger(input: FinanceLedgerQuery): Promise<FinanceLedger> {
    const parsed = financeLedgerQuerySchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException('조회 기간과 기준을 확인해주세요');
    const query = parsed.data;
    const cutoff = new Date(query.asOf);
    if (cutoff.getTime() > Date.now() + 1000) throw new BadRequestException('기준 시각은 현재보다 늦을 수 없습니다');
    const { sources, items, title } = await this.db.transaction(async (tx) => {
      const [event] = await tx.select({ title: performances.title }).from(performances).where(eq(performances.id, query.eventId));
      if (!event) throw new NotFoundException('공연을 찾을 수 없습니다');
      if (query.showtimeId) {
        const [show] = await tx.select({ id: showtimes.id }).from(showtimes)
          .where(and(eq(showtimes.id, query.showtimeId), eq(showtimes.performanceId, query.eventId)));
        if (!show) throw new BadRequestException('선택한 공연에 속하지 않는 회차입니다');
      }
      const sources = await tx.select({ payment: payments, reservation: reservations, showtime: showtimes, refund: refunds })
        .from(payments).innerJoin(reservations, eq(payments.reservationId, reservations.id))
        .innerJoin(showtimes, eq(reservations.showtimeId, showtimes.id)).leftJoin(refunds, eq(refunds.paymentId, payments.id))
        .where(and(eq(showtimes.performanceId, query.eventId), query.showtimeId ? eq(showtimes.id, query.showtimeId) : undefined,
          lte(payments.paidAt, cutoff))).orderBy(asc(payments.paidAt), asc(payments.id));
      const items = sources.length ? await tx.select().from(ticketItems)
        .where(inArray(ticketItems.paymentId, sources.map(({ payment }) => payment.id))).orderBy(asc(ticketItems.seatKey)) : [];
      return { sources, items, title: event.title };
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
    const byPayment = new Map<string, Item[]>();
    for (const item of items) byPayment.set(item.paymentId, [...(byPayment.get(item.paymentId) ?? []), item]);
    const rows = sources.map((source) => describePayment(source, byPayment.get(source.payment.id) ?? [], query))
      .filter((row) => query.dateBasis === 'paid_at' ? within(row.paidAt, query)
        : within(row.cancelledAt, query) || row.tickets.some((item) => item.state === 'unknown' || within(item.completedAt ?? item.requestedAt, query)));
    const summary = { ...emptyAmounts(), paymentCount: rows.length, unknownPaymentCount: rows.filter((row) => row.warnings.length).length };
    const currencies = new Map<string, FinanceCurrencyTotal>();
    for (const row of rows) {
      for (const key of Object.keys(emptyAmounts()) as Array<keyof FinanceAmounts>) summary[key] = addKnown(summary[key], row[key]);
      if (!row.chargeCurrency) continue;
      const total = currencies.get(row.chargeCurrency) ?? { currency: row.chargeCurrency,
        exponent: row.chargeCurrency === 'USD' ? 2 : 0, chargeMinor: 0, confirmedCancelMinor: 0,
        pendingCancelMinor: 0, balanceMinor: 0, unknownPaymentCount: 0 };
      total.chargeMinor = addKnown(total.chargeMinor, row.chargeMinor);
      total.confirmedCancelMinor = addKnown(total.confirmedCancelMinor, row.confirmedCancelMinor);
      total.pendingCancelMinor = addKnown(total.pendingCancelMinor, row.pendingCancelMinor);
      total.balanceMinor = addKnown(total.balanceMinor, row.balanceMinor);
      if ([row.chargeMinor, row.confirmedCancelMinor, row.pendingCancelMinor, row.balanceMinor].includes(null)) total.unknownPaymentCount++;
      currencies.set(row.chargeCurrency, total);
    }
    const provider = query.includeProvider === 'true' ? await this.readProvider(query, sources)
      : { status: 'not_queried' as const, observedAt: null, dateBasis: query.providerDateBasis, rows: [], scopes: [] };
    return { query, generatedAt: new Date().toISOString(), timezone: 'Asia/Seoul', performanceTitle: title, summary,
      currencies: [...currencies.values()].sort((a, b) => a.currency.localeCompare(b.currency)), rows,
      provider,
      bankEvidence: 'unverified', closingStatus: 'not_closed', warnings: [...new Set(rows.flatMap((row) => row.warnings))] };
  }

  private async readProvider(query: FinanceLedgerQuery, sources: PaymentSource[]): Promise<FinanceProviderEvidence> {
    const rows: FinanceProviderRow[] = [];
    const scopes: FinanceProviderEvidence['scopes'] = [];
    const requestedScopes = [...new Set(sources.map(({ payment }) => resolvePaymentCancelSecretScope(payment)))];
    for (const scope of requestedScopes) {
      const owned = new Map(sources.filter(({ payment }) => resolvePaymentCancelSecretScope(payment) === scope)
        .map((source) => [source.payment.paymentKey, source]));
      try {
        const scopedRows: FinanceProviderRow[] = [];
        const seen = new Set<string>();
        for (const range of dateChunks(query.dateFrom, query.dateTo, query.asOf)) {
          const response = await this.toss.querySettlements({ startDate: range[0], endDate: range[1],
            dateType: query.providerDateBasis, secretKeyScope: scope });
          if (!Array.isArray(response)) throw new Error('Invalid settlement response');
          for (const row of response) {
            const source = owned.get(row.paymentKey);
            if (!source) continue;
            if (!row.transactionKey) throw new Error('Missing transaction identity');
            if (seen.has(row.transactionKey)) continue;
            if (!validCalendarDate(row.soldDate) || !validCalendarDate(row.paidOutDate))
              throw new Error('Missing settlement dates');
            const date = row[query.providerDateBasis];
            if (!within(`${date}T00:00:00+09:00`, query)) continue;
            scopedRows.push(providerRow(row, source));
            seen.add(row.transactionKey);
          }
        }
        rows.push(...scopedRows);
        scopes.push({ scope, status: scopedRows.length ? 'ready' : 'empty', message: null });
      } catch {
        // Never turn transport/schema/key errors into a successful zero amount,
        // or expose raw provider errors that can contain a payment identifier.
        scopes.push({ scope, status: 'failed', message: 'PG 정산 조회 또는 응답 검증에 실패했습니다. 상점 키·계약·기간을 확인하고 다시 조회해주세요.' });
      }
    }
    const failed = scopes.filter((scope) => scope.status === 'failed').length;
    return { dateBasis: query.providerDateBasis, observedAt: new Date().toISOString(), rows, scopes,
      status: failed ? failed === scopes.length ? 'failed' : 'partial' : rows.length ? 'ready' : 'empty' };
  }
}

function providerRow(row: TossSettlementRow, source: PaymentSource): FinanceProviderRow {
  const currency = row.currency;
  if (currency !== 'KRW' && currency !== 'USD') throw new Error('Unsupported settlement currency');
  const amountMinor = toMinor(row.amount, currency);
  const payoutMinor = toMinor(row.payOutAmount, currency);
  return { paymentId: source.payment.id, reservationNumber: source.reservation.reservationNumber,
    transactionKey: row.transactionKey ?? null, currency, amountMinor, payoutMinor, feeMinor: amountMinor - payoutMinor,
    soldDate: row.soldDate, paidOutDate: row.paidOutDate };
}

function toMinor(amount: number, currency: string): number {
  const scaled = amount * (currency === 'USD' ? 100 : 1);
  const rounded = Math.round(scaled);
  if (typeof amount !== 'number' || !Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > 0.000001)
    throw new Error('Invalid monetary amount');
  return rounded;
}

function dateChunks(from: string, to: string, asOf: string): Array<[string, string]> {
  const cutoff = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(asOf));
  const end = new Date(`${to < cutoff ? to : cutoff}T00:00:00Z`).getTime();
  const ranges: Array<[string, string]> = [];
  for (let start = new Date(`${from}T00:00:00Z`).getTime(); start <= end; start += 30 * 86400000) {
    ranges.push([new Date(start).toISOString().slice(0, 10), new Date(Math.min(start + 29 * 86400000, end)).toISOString().slice(0, 10)]);
  }
  return ranges;
}

function emptyAmounts(): FinanceAmounts {
  return { originalOrderKrw: 0, confirmedPaymentKrw: 0, confirmedRefundKrw: 0, pendingRefundKrw: 0, remainingTicketKrw: 0,
    retainedCancellationFeeKrw: 0, retainedServiceFeeKrw: 0, periodApprovedKrw: 0, periodRefundKrw: 0 };
}

function describePayment(source: PaymentSource, items: Item[], query: FinanceLedgerQuery): FinancePaymentRow {
  const { payment, reservation, showtime, refund } = source;
  const warnings: string[] = [];
  const cutoff = new Date(query.asOf).getTime();
  const attempt = refundAttemptAt(refund, cutoff);
  const quoteItems = Array.isArray(attempt?.cancellationQuote.items) ? attempt.cancellationQuote.items.map(record) : [];
  const fullRefundFor = (item: Item) => Boolean(attempt && (quoteItems.some((quote) => quote.ticketItemId === item.id)
    || (quoteItems.length === 0 && items.every((candidate) => !candidate.cancellationCommand)))
    && (!item.cancellationCommand || new Date(item.cancellationCommand.requestedAt).getTime() > cutoff
      || new Date(item.cancellationCommand.requestedAt).getTime() <= new Date(attempt.requestedAt).getTime()));
  const snapshots = items.filter((item) => item.createdAt.getTime() <= cutoff).map((item) => {
    const full = fullRefundFor(item) ? attempt : null;
    const command = full ? null : item.cancellationCommand;
    const restored = full && before(full.restoredAt, cutoff);
    const requestedAt = restored ? null : command?.requestedAt ?? full?.requestedAt ?? item.cancelledAt?.toISOString() ?? null;
    const completedAt = restored ? null : command?.completedAt ?? full?.completedAt
      ?? (item.status === 'cancelled' ? item.cancelledAt?.toISOString() ?? null : null);
    const isCompleted = before(completedAt, cutoff);
    const isRequested = before(requestedAt, cutoff);
    // A compensated seat cancellation may erase its command and quote. A later
    // mutable row cannot prove that it was active at this earlier cutoff.
    const historicalUncertain = !isRequested && item.updatedAt.getTime() > cutoff;
    if (historicalUncertain) warnings.push('기준 시각 이후 변경된 티켓의 과거 취소 상태를 복원할 수 없습니다. 관련 금액은 미확인이며 취소일 조회에서는 대조 후보로 포함합니다.');
    const quote = full ? quoteItems.find((entry) => entry.ticketItemId === item.id) : null;
    const historicalWithoutQuote = full && item.status === 'active' && !restored && !quote;
    const valueAtRequest = (key: 'refundableAmount' | 'cancellationFee' | 'serviceFeeRefund') =>
      historicalUncertain ? null : !isRequested ? 0 : typeof quote?.[key] === 'number' && Number.isSafeInteger(quote[key]) ? quote[key] as number
        : historicalWithoutQuote ? null : item[key];
    const ticket: FinanceTicket = {
      id: item.id, seat: `${item.floorLabel} · ${item.tierName} · ${item.row}-${item.number}`,
      state: historicalUncertain ? 'unknown' : isCompleted ? 'cancelled' : isRequested ? 'cancellation_pending' : item.status === 'expired' ? 'expired' : 'active',
      priceKrw: item.price, serviceFeeKrw: item.serviceFee, refundKrw: valueAtRequest('refundableAmount'),
      cancellationFeeKrw: valueAtRequest('cancellationFee'), serviceFeeRefundKrw: valueAtRequest('serviceFeeRefund'),
      requestedAt: isRequested ? requestedAt : null, completedAt: isCompleted ? completedAt : null,
      enteredAt: item.enteredAt && before(item.enteredAt.toISOString(), cutoff) ? item.enteredAt.toISOString() : null,
    };
    return { item, ticket, command, full };
  });
  const tickets = snapshots.map(({ ticket }) => ticket);
  const confirmedPaymentKrw = payment.currency === 'KRW' ? payment.amount : null;
  if (confirmedPaymentKrw !== reservation.totalAmount)
    warnings.push('원 주문액과 저장된 원 결제액이 다르거나 원화 결제 근거가 없습니다. 원본 승인 자료를 대조하세요.');
  const amounts = { ...emptyAmounts(), originalOrderKrw: reservation.totalAmount, confirmedPaymentKrw,
    periodApprovedKrw: within(payment.paidAt!.toISOString(), query) ? confirmedPaymentKrw : 0 };
  for (const item of tickets) {
    if (item.state === 'active') amounts.remainingTicketKrw = addKnown(amounts.remainingTicketKrw, item.priceKrw + item.serviceFeeKrw);
    if (item.state === 'cancellation_pending') amounts.pendingRefundKrw = addKnown(amounts.pendingRefundKrw, item.refundKrw);
    if (item.state === 'cancelled') {
      amounts.confirmedRefundKrw = addKnown(amounts.confirmedRefundKrw, item.refundKrw);
      amounts.retainedCancellationFeeKrw = addKnown(amounts.retainedCancellationFeeKrw, item.cancellationFeeKrw);
      amounts.retainedServiceFeeKrw = addKnown(amounts.retainedServiceFeeKrw,
        item.serviceFeeRefundKrw === null ? null : item.serviceFeeKrw - item.serviceFeeRefundKrw);
      if (within(item.completedAt, query)) amounts.periodRefundKrw = addKnown(amounts.periodRefundKrw, item.refundKrw);
    }
  }
  const domestic = payment.currency === 'KRW' && payment.provider !== 'PAYPAL' && resolvePaymentCancelSecretScope(payment) === 'default';
  const chargeCurrency = payment.providerChargeCurrency
    ? ['KRW', 'USD'].includes(payment.providerChargeCurrency) ? payment.providerChargeCurrency : null : domestic ? 'KRW' : null;
  const chargeMinor = chargeCurrency ? payment.providerChargeAmountMinor ?? (domestic && chargeCurrency === 'KRW' ? payment.amount : null) : null;
  let confirmedCancelMinor: number | null = 0;
  let pendingCancelMinor: number | null = 0;
  const commands = new Set<string>();
  for (const { item, ticket, command, full } of snapshots) {
    if (ticket.state !== 'cancelled' && ticket.state !== 'cancellation_pending') continue;
    let amount: number | null = command && command.currency === chargeCurrency ? command.amountMinor : null;
    if (command) {
      if (commands.has(command.id)) continue;
      commands.add(command.id);
    } else if (full) {
      const receiptId = `refund:${refund!.id}:${full.requestedAt}`;
      if (commands.has(receiptId)) continue;
      commands.add(receiptId);
      const snapshot = full.providerRefund;
      const options = record(full.cancelRequest.options);
      if (snapshot.currency === chargeCurrency && Number.isSafeInteger(snapshot.amountMinor)) amount = snapshot.amountMinor as number;
      else if (options.currency === chargeCurrency && typeof options.cancelAmount === 'number') {
        try { amount = toMinor(options.cancelAmount, chargeCurrency!); } catch { amount = null; }
      } else if (chargeCurrency === 'KRW') amount = snapshots.filter((entry) => entry.full === full)
        .reduce<number | null>((sum, entry) => addKnown(sum, entry.ticket.refundKrw), 0);
    } else if (domestic && chargeCurrency === 'KRW') amount = item.refundableAmount;
    if (ticket.state === 'cancelled') confirmedCancelMinor = addKnown(confirmedCancelMinor, amount);
    else pendingCancelMinor = addKnown(pendingCancelMinor, amount);
  }
  if (!tickets.length || tickets.some((item) => item.state === 'unknown')) {
    confirmedCancelMinor = null; pendingCancelMinor = null;
    amounts.confirmedRefundKrw = null; amounts.pendingRefundKrw = null; amounts.remainingTicketKrw = null;
    amounts.retainedCancellationFeeKrw = null; amounts.retainedServiceFeeKrw = null; amounts.periodRefundKrw = null;
  }
  if (!tickets.length || !chargeCurrency || chargeMinor === null || confirmedCancelMinor === null || pendingCancelMinor === null
    || Object.values(amounts).includes(null))
    warnings.push('일부 거래의 티켓 또는 PG 금액 증거가 없습니다. 원거래·취소 자료를 별도로 대조하세요.');
  return { ...amounts, paymentId: payment.id, reservationNumber: reservation.reservationNumber, orderId: payment.tossOrderId,
    showtimeId: showtime.id, showtimeAt: showtime.dateTime.toISOString(), paidAt: payment.paidAt!.toISOString(),
    cancelledAt: payment.cancelledAt && before(payment.cancelledAt.toISOString(), cutoff) ? payment.cancelledAt.toISOString() : null,
    storedPaymentAmount: payment.amount, storedPaymentCurrency: payment.currency,
    provider: payment.provider, method: payment.method, chargeCurrency, chargeMinor, confirmedCancelMinor, pendingCancelMinor,
    balanceMinor: chargeMinor !== null && confirmedCancelMinor !== null ? chargeMinor - confirmedCancelMinor : null, tickets, warnings };
}

function refundAttemptAt(refund: Refund | null, cutoff: number) {
  if (!refund) return null;
  const metadata = record(refund.providerMetadata);
  const candidates = [
    ...(Array.isArray(metadata.previousAttempts) ? metadata.previousAttempts.map(record) : []),
    { ...metadata, requestedAt: refund.requestedAt.toISOString(), completedAt: refund.completedAt?.toISOString() },
  ].filter((entry) => typeof entry.requestedAt === 'string' && before(entry.requestedAt, cutoff))
    .sort((a, b) => new Date(String(b.requestedAt)).getTime() - new Date(String(a.requestedAt)).getTime());
  const selected = candidates[0];
  if (!selected) return null;
  return { requestedAt: selected.requestedAt as string,
    completedAt: typeof selected.completedAt === 'string' ? selected.completedAt : null,
    restoredAt: typeof selected.rightsRestoredAt === 'string' ? selected.rightsRestoredAt : null,
    cancellationQuote: record(selected.cancellationQuote), providerRefund: record(selected.providerRefund),
    cancelRequest: record(selected.cancelRequest) };
}

function addKnown(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : left + right;
}

function validCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function before(value: string | null | undefined, cutoff: number): boolean {
  return Boolean(value && new Date(value).getTime() <= cutoff);
}

function within(value: string | null, query: FinanceLedgerQuery): boolean {
  if (!value) return false;
  const time = new Date(value).getTime();
  return time >= new Date(`${query.dateFrom}T00:00:00+09:00`).getTime()
    && time <= new Date(`${query.dateTo}T23:59:59.999+09:00`).getTime() && time <= new Date(query.asOf).getTime();
}
