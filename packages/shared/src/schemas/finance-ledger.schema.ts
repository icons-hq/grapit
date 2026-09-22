import { z } from 'zod';

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, '올바른 날짜가 필요합니다');

export const financeLedgerQuerySchema = z.object({
  eventId: z.string().uuid(),
  showtimeId: z.string().uuid().optional(),
  dateFrom: calendarDate,
  dateTo: calendarDate,
  dateBasis: z.enum(['paid_at', 'cancelled_at']),
  asOf: z.string().datetime({ offset: true }),
  providerDateBasis: z.enum(['soldDate', 'paidOutDate']).default('paidOutDate'),
  includeProvider: z.enum(['true', 'false']).default('false'),
}).strict().refine((query) => query.dateFrom <= query.dateTo, '조회 시작일은 종료일보다 늦을 수 없습니다')
  .refine((query) => query.includeProvider !== 'true'
    || Date.parse(`${query.dateTo}T00:00:00Z`) - Date.parse(`${query.dateFrom}T00:00:00Z`) <= 30 * 86400000,
  { message: 'PG 정산 자료는 한 번에 최대 31일까지만 조회할 수 있습니다. 기간을 나누어 조회해주세요.', path: ['dateTo'] });

export const financeLedgerExportSchema = z.object({
  query: financeLedgerQuerySchema,
  dataset: z.enum(['payments', 'tickets', 'provider']),
  reason: z.string().trim().min(1, '내보내기 사유가 필요합니다').max(500),
}).strict();

export type FinanceLedgerQuery = z.infer<typeof financeLedgerQuerySchema>;
export type FinanceLedgerExportRequest = z.infer<typeof financeLedgerExportSchema>;

export interface FinanceAmounts {
  originalOrderKrw: number | null;
  confirmedPaymentKrw: number | null;
  confirmedRefundKrw: number | null;
  pendingRefundKrw: number | null;
  remainingTicketKrw: number | null;
  retainedCancellationFeeKrw: number | null;
  retainedServiceFeeKrw: number | null;
  periodApprovedKrw: number | null;
  periodRefundKrw: number | null;
}

export interface FinanceTicket {
  id: string;
  seat: string;
  state: 'active' | 'cancellation_pending' | 'cancelled' | 'expired' | 'unknown';
  priceKrw: number;
  serviceFeeKrw: number;
  refundKrw: number | null;
  cancellationFeeKrw: number | null;
  serviceFeeRefundKrw: number | null;
  requestedAt: string | null;
  completedAt: string | null;
  enteredAt: string | null;
}

export interface FinancePaymentRow extends FinanceAmounts {
  paymentId: string;
  reservationNumber: string;
  orderId: string;
  showtimeId: string;
  showtimeAt: string;
  paidAt: string;
  cancelledAt: string | null;
  storedPaymentAmount: number;
  storedPaymentCurrency: string;
  provider: string;
  method: string;
  chargeCurrency: string | null;
  chargeMinor: number | null;
  confirmedCancelMinor: number | null;
  pendingCancelMinor: number | null;
  balanceMinor: number | null;
  tickets: FinanceTicket[];
  warnings: string[];
}

export interface FinanceCurrencyTotal {
  currency: string;
  exponent: number;
  chargeMinor: number | null;
  confirmedCancelMinor: number | null;
  pendingCancelMinor: number | null;
  balanceMinor: number | null;
  unknownPaymentCount: number;
}

export interface FinanceProviderRow {
  paymentId: string;
  reservationNumber: string;
  transactionKey: string | null;
  currency: string;
  amountMinor: number;
  feeMinor: number;
  payoutMinor: number;
  soldDate: string;
  paidOutDate: string;
}

export interface FinanceProviderEvidence {
  status: 'not_queried' | 'ready' | 'empty' | 'partial' | 'failed';
  observedAt: string | null;
  dateBasis: 'soldDate' | 'paidOutDate';
  rows: FinanceProviderRow[];
  scopes: Array<{ scope: string; status: 'ready' | 'empty' | 'failed'; message: string | null }>;
}

export interface FinanceLedger {
  query: FinanceLedgerQuery;
  generatedAt: string;
  timezone: 'Asia/Seoul';
  performanceTitle: string;
  summary: FinanceAmounts & { paymentCount: number; unknownPaymentCount: number };
  currencies: FinanceCurrencyTotal[];
  rows: FinancePaymentRow[];
  provider: FinanceProviderEvidence;
  bankEvidence: 'unverified';
  closingStatus: 'not_closed';
  warnings: string[];
}
