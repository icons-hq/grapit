import type { FinanceLedger, FinanceLedgerExportRequest } from '@grabit/shared';
import { safeCsvCell, withUtf8Bom } from './csv-export.util.js';

/** One payment per payment row; ticket and provider exports never repeat order totals. */
export function financeLedgerCsv(ledger: FinanceLedger, dataset: FinanceLedgerExportRequest['dataset']) {
  const context = {
    performance: ledger.performanceTitle, event_id: ledger.query.eventId, showtime_filter: ledger.query.showtimeId ?? 'all',
    date_basis: ledger.query.dateBasis, date_from_kst: ledger.query.dateFrom, date_to_kst: ledger.query.dateTo,
    timezone: ledger.timezone, as_of: ledger.query.asOf, generated_at: ledger.generatedAt,
    pg_query_status: ledger.provider.status, pg_observed_at: ledger.provider.observedAt, pg_date_basis: ledger.provider.dateBasis,
    pg_scope_results: JSON.stringify(ledger.provider.scopes), bank_evidence: ledger.bankEvidence, closing_status: ledger.closingStatus,
  };
  const entries: Array<Record<string, unknown>> = dataset === 'payments' ? ledger.rows.map((row) => ({
    record_type: 'payment', reservation_number: row.reservationNumber, payment_id: row.paymentId, order_id: row.orderId,
    showtime_id: row.showtimeId, showtime_at: row.showtimeAt, approved_at: row.paidAt,
    original_order_krw: row.originalOrderKrw, confirmed_refund_krw: row.confirmedRefundKrw, pending_refund_krw: row.pendingRefundKrw,
    stored_payment_amount: row.storedPaymentAmount, stored_payment_currency: row.storedPaymentCurrency, confirmed_payment_krw: row.confirmedPaymentKrw,
    remaining_ticket_krw: row.remainingTicketKrw, retained_cancellation_fee_krw: row.retainedCancellationFeeKrw,
    retained_service_fee_krw: row.retainedServiceFeeKrw, period_approved_krw: row.periodApprovedKrw, period_refund_krw: row.periodRefundKrw,
    provider: row.provider, method: row.method, pg_currency: row.chargeCurrency, pg_charge_minor: row.chargeMinor,
    pg_confirmed_cancel_minor: row.confirmedCancelMinor, pg_pending_cancel_minor: row.pendingCancelMinor, pg_balance_minor: row.balanceMinor,
    warnings: row.warnings.join(' | '),
  })) : dataset === 'tickets' ? ledger.rows.flatMap((row) => row.tickets.map((item) => ({
    record_type: 'ticket', reservation_number: row.reservationNumber, payment_id: row.paymentId, showtime_id: row.showtimeId,
    ticket_item_id: item.id, seat: item.seat, state_as_of: item.state, price_krw: item.priceKrw, service_fee_krw: item.serviceFeeKrw,
    refund_krw: item.refundKrw, cancellation_fee_krw: item.cancellationFeeKrw, service_fee_refund_krw: item.serviceFeeRefundKrw,
    cancellation_requested_at: item.requestedAt, cancellation_completed_at: item.completedAt, entered_at: item.enteredAt,
    warnings: row.warnings.join(' | '),
  }))) : ledger.provider.rows.map((row) => ({ record_type: 'provider_settlement', reservation_number: row.reservationNumber,
    payment_id: row.paymentId, transaction_key: row.transactionKey, pg_currency: row.currency,
    amount_minor: row.amountMinor, deductions_minor: row.feeMinor, payout_minor: row.payoutMinor,
    sold_date_kst: row.soldDate, paid_out_date_kst: row.paidOutDate }));
  const columns = [...new Set(['record_type', ...Object.keys(context), ...entries.flatMap(Object.keys), 'warnings'])];
  const records: Array<Record<string, unknown>> = [
    { ...context, record_type: 'scope', warnings: ledger.warnings.join(' | ') },
    ...entries.map((entry) => ({ ...context, ...entry })),
  ];
  const cell = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : safeCsvCell(value);
  return { csv: withUtf8Bom([columns.map(safeCsvCell).join(','), ...records.map((record) => columns.map((key) => cell(record[key])).join(','))].join('\r\n')), rowCount: entries.length };
}
