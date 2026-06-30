import {
  Injectable,
  Inject,
  BadRequestException,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { asc, eq, and, sql, ilike, or, desc, inArray, gte, lte, ne, type SQL } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import {
  reservations,
  reservationSeats,
  payments,
  refunds,
  showtimes,
  performances,
  users,
  seatInventories,
  performanceSeatAssignments,
  performanceSeatTiers,
  venueLayoutFloors,
  venueLayoutSeats,
  bookingPolicies,
  bookingOperationAuditLogs,
  ticketItems,
  reservationPaymentFailureDiagnostics,
  paymentWebhookEvents,
} from '../../database/schema/index.js';
import { BookingGateway } from '../booking/booking.gateway.js';
import { RefundService } from '../refund/refund.service.js';
import { mapPaymentFailureDiagnostic } from '../payment/payment-failure-diagnostic.js';
import { safeCsvRows, withUtf8Bom } from './csv-export.util.js';
import { AdminAuditService } from './admin-audit.service.js';
import { normalizeSeatIdentity, toFloorAwareSeatSelection } from '@grabit/shared';
import type {
  AdminBookingFunnelStatus,
  AdminBookingListItem,
  AdminBookingTierStats,
  AdminTicketStatusCounts,
  AdminReservationExportFilter,
  BookingStats,
  FloorAwareSeatSelection,
  PaymentInfo,
  PaymentFailureBucket,
  PaymentMethod,
  PaymentMethodAttribution,
  PaymentMethodType,
  PaymentProvider,
  PaymentStatus,
  ReservationStatus,
} from '@grabit/shared';

const RAW_EXPORT_TYPE = 'raw_pii';
const FAILED_CANCELLED_CONTACTS_EXPORT_TYPE = 'failed_cancelled_contacts';
const ACTIVE_TICKET_MANIFEST_EXPORT_TYPE = 'active_ticket_manifest';
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const RESERVATION_EXPORT_HEADERS = [
  'Reservation Number',
  'User Name',
  'User Email',
  'User Phone',
  'Audience Region',
  'User Country',
  'Performance Title',
  'Show DateTime',
  'Tier',
  'Seat',
  'Payment Method',
  'Payment Status',
  'Total Amount',
  'Reservation Status',
  'Reserved At',
  'Ticket Item ID',
  'Ticket Item Status',
  'Admission State',
  'Entered At',
  'Cancelled At',
  'Cancel Reason',
  'Ticket Price',
  'Service Fee',
  'Item Gross Amount',
  'Cancellation Fee',
  'Service Fee Refund',
  'Refundable Amount',
  'Reopen State',
] as const;
const FAILED_CANCELLED_CONTACT_EXPORT_HEADERS = [
  'User Name',
  'User Email',
  'User Phone',
  'Audience Region',
  'User Country',
  'Performance ID',
  'Performance Title',
  'Last Affected Reservation Number',
  'Last Reservation Status',
  'Last Payment Status',
  'Last Affected At',
  'Payment Failed/Expired Count',
  'Cancelled Count',
  'Marketing Consent',
  'Last Failure Code',
  'Last Failure Reason',
  'Diagnostic Source',
  'Last Cancellation Reason',
  'Cancellation Revenue',
  'Cancellation Source',
  'Last Affected Reason',
] as const;
const ACTIVE_TICKET_MANIFEST_EXPORT_HEADERS = [
  'Tier',
  'Seat',
  'Floor',
  'Row',
  'Number',
  'Reservation Number',
  'Buyer Name',
  'Buyer Phone',
  'Buyer Email',
  'Audience Region',
  'Country',
  'Performance Title',
  'Show DateTime',
  'Ticket Item ID',
  'Admission State',
  'Entered At',
] as const;

const PAYMENT_METHOD_FILTER_ALIASES = {
  CARD: ['CARD', '카드'],
  VIRTUAL_ACCOUNT: ['VIRTUAL_ACCOUNT', '가상계좌'],
  TRANSFER: ['TRANSFER', '계좌이체'],
  MOBILE_PHONE: ['MOBILE_PHONE', '휴대폰'],
  FOREIGN_EASY_PAY: ['FOREIGN_EASY_PAY', '해외간편결제'],
  SIMPLE_PAY: ['SIMPLE_PAY', '간편결제'],
} as const satisfies Record<PaymentMethodType, readonly string[]>;

export interface ReservationExportRequest {
  actorUserId: string;
  filters: AdminReservationExportFilter;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface ReservationExportResult {
  filename: string;
  contentType: 'text/csv; charset=utf-8';
  csv: string;
  rowCount: number;
}

type AdminTicketItemStatus =
  | 'ACTIVE'
  | 'CANCELLATION_PENDING'
  | 'CANCELLED'
  | 'EXPIRED';

type AdminTicketItemAdmissionState = 'NOT_ENTERED' | 'ENTERED';

type AdminTicketItemReopenState =
  | 'NOT_REQUIRED'
  | 'HELD_CANCELLED'
  | 'AVAILABLE'
  | 'MANUAL_OPENED';

type AdminTicketItemDto = FloorAwareSeatSelection & {
  id: string;
  reservationId: string;
  paymentId: string;
  showtimeId: string;
  serviceFee: number;
  status: AdminTicketItemStatus;
  admissionState: AdminTicketItemAdmissionState;
  enteredAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  cancellationFee: number;
  serviceFeeRefund: number;
  refundableAmount: number;
  reopenState: AdminTicketItemReopenState;
  reopenHoldUntil: string | null;
};

type AdminBookingDetailDto = AdminBookingListItem & {
  userPhone: string;
  paymentAttemptedAt: string | null;
  paymentCompletedAt: string | null;
  paymentInfo: PaymentInfo | null;
  ticketItems: AdminTicketItemDto[];
};

type AdminBookingQueryParams = {
  status?: string;
  reservationStatus?: string;
  performanceId?: string;
  showtimeId?: string;
  funnelStatus?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  audienceRegion?: string;
  seatTier?: string;
  floorKey?: string;
  seatQuery?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  page?: number;
};

type AdminRefundStatus =
  | 'requested'
  | 'sent_to_pg'
  | 'processing_at_pg'
  | 'completed'
  | 'failed';

type AdminTicketItemRow = Pick<
  typeof ticketItems.$inferSelect,
  | 'id'
  | 'reservationId'
  | 'paymentId'
  | 'showtimeId'
  | 'seatId'
  | 'seatKey'
  | 'floorKey'
  | 'floorLabel'
  | 'tierName'
  | 'row'
  | 'number'
  | 'price'
  | 'serviceFee'
  | 'status'
  | 'admissionState'
  | 'enteredAt'
  | 'cancelledAt'
  | 'cancelReason'
  | 'cancellationFee'
  | 'serviceFeeRefund'
  | 'refundableAmount'
  | 'reopenState'
  | 'reopenHoldUntil'
>;

type ReservationExportRow = {
  reservation: {
    id: string;
    reservationNumber: string;
    status: string;
    totalAmount: number;
    createdAt: Date | null;
  };
  user: {
    name: string;
    email: string;
    phone: string;
    country: string;
  };
  showtime: {
    dateTime: Date | null;
  };
  performance: {
    id: string;
    title: string;
  };
  ticketItem: AdminTicketItemRow | null;
  payment: {
    method: string | null;
    status: string | null;
    paidAt: Date | null;
  } | null;
};

type ActiveTicketManifestExportRow = {
  reservation: {
    reservationNumber: string;
  };
  user: {
    name: string;
    email: string;
    phone: string;
    country: string;
  };
  showtime: {
    dateTime: Date | null;
  };
  performance: {
    title: string;
  };
  ticketItem: Pick<
    AdminTicketItemRow,
    | 'id'
    | 'showtimeId'
    | 'seatKey'
    | 'floorKey'
    | 'floorLabel'
    | 'tierName'
    | 'row'
    | 'number'
    | 'admissionState'
    | 'enteredAt'
  >;
};

type FailedCancelledContactExportSourceRow = {
  user: {
    id: string;
    name: string;
    email: string;
    phone: string;
    country: string;
    marketingConsent: boolean;
  };
  performance: {
    id: string;
    title: string;
  };
  reservation: {
    reservationNumber: string;
    status: string;
    createdAt: Date | null;
  };
  payment: {
    status: string | null;
  } | null;
  diagnostic: {
    diagnosticCode: string | null;
    diagnosticMessage: string | null;
    diagnosticSource: string | null;
  } | null;
  cancellation: {
    reason: string | null;
    revenue: number | string | null;
    source: string | null;
  };
};

type FailedCancelledContactExportRow = {
  user: FailedCancelledContactExportSourceRow['user'];
  performance: FailedCancelledContactExportSourceRow['performance'];
  lastReservationNumber: string;
  lastReservationStatus: string;
  lastPaymentStatus: string | null;
  lastAffectedAt: Date | null;
  lastFailureAt: Date | null;
  lastFailureCode: string | null;
  lastFailureReason: string | null;
  diagnosticSource: string | null;
  lastCancellationAt: Date | null;
  lastCancellationReason: string | null;
  cancellationRevenue: number;
  cancellationSource: string | null;
  lastAffectedReason: string | null;
  paymentFailedExpiredCount: number;
  cancelledCount: number;
};

type AdminBookingListRow = {
  reservation: {
    id: string;
    reservationNumber: string;
    tossOrderId: string | null;
    status: string;
    totalAmount: number;
    createdAt: Date | null;
  };
  user: {
    name: string;
    email: string;
    country: string;
  };
  showtime: {
    dateTime: Date | null;
  };
  performance: {
    title: string;
  };
  payment: {
    id: string | null;
    status: string | null;
    method: string | null;
    provider: string | null;
    currency: string | null;
  } | null;
  providerExpiryWebhookReceived?: boolean | null;
  diagnostic: AdminBookingDiagnosticRow | null;
  refund: {
    status: string | null;
  } | null;
};

type AdminBookingDiagnosticRow = {
  diagnosticKind: string | null;
  diagnosticCode: string | null;
  diagnosticMessage: string | null;
  diagnosticSource: string | null;
  recordedAt: Date | null;
  providerCheckStatus: string | null;
  providerCheckedAt: Date | null;
  providerCheckMessage: string | null;
};

type BookingStatsRow = {
  totalBookings?: number | string | null;
  completedRevenue?: number | string | null;
  soldCount?: number | string | null;
  pendingPaymentCount?: number | string | null;
  paymentProcessingCount?: number | string | null;
  failedCount?: number | string | null;
  expiredPaymentCount?: number | string | null;
  abortedPaymentCount?: number | string | null;
  localDeadlineExpiredCount?: number | string | null;
  providerExpiredCount?: number | string | null;
  providerAbortedCount?: number | string | null;
  buyerCancelledBeforeConfirmCount?: number | string | null;
  unreconciledProviderExpiredCount?: number | string | null;
  compensatedCancelCount?: number | string | null;
  otherPaymentFailureCount?: number | string | null;
  cancelProcessingCount?: number | string | null;
  cancelledCount?: number | string | null;
  partialCancelledCount?: number | string | null;
};

type AdminBookingTierStatsRow = {
  tierName: string;
  price: number | string | null;
  soldSeats: number | string | null;
  activeRevenue: number | string | null;
  cancelProcessingSeats: number | string | null;
  cancelledSeats: number | string | null;
  enteredSeats: number | string | null;
};

type AdminBookingTierCapacityRow = {
  tierName: string;
  price: number | string | null;
  totalSeats: number | string | null;
  unavailableSeats: number | string | null;
};

function normalizeReservationSeatIdentity(seatId: string): {
  floorKey: string;
  seatId: string;
  seatKey: string;
} {
  const identity = normalizeSeatIdentity({ seatId });
  return {
    floorKey: identity.floorKey,
    seatId: identity.seatId,
    seatKey: identity.seatKey,
  };
}

function buildAdminBookingWhereClause(filters: AdminBookingQueryParams): SQL | undefined {
  const conditions: SQL[] = [];
  const reservationStatus = filters.reservationStatus ?? filters.status;

  if (reservationStatus) {
    conditions.push(
      eq(reservations.status, reservationStatus as typeof reservations.status.enumValues[number]),
    );
  }
  if (filters.performanceId) {
    conditions.push(eq(performances.id, filters.performanceId));
  }
  if (filters.showtimeId) {
    conditions.push(eq(showtimes.id, filters.showtimeId));
  }
  if (filters.funnelStatus) {
    conditions.push(funnelStatusEqualsSql(filters.funnelStatus));
  }
  if (filters.paymentStatus) {
    conditions.push(
      eq(payments.status, filters.paymentStatus as typeof payments.status.enumValues[number]),
    );
  }
  if (filters.paymentMethod) {
    conditions.push(paymentMethodFilterSql(filters.paymentMethod));
  }
  if (filters.audienceRegion === 'domestic') {
    conditions.push(eq(users.country, 'KR'));
  }
  if (filters.audienceRegion === 'overseas') {
    conditions.push(ne(users.country, 'KR'));
  }
  const seatFilterSql = reservationSeatFilterSql(filters);
  if (seatFilterSql) {
    conditions.push(seatFilterSql);
  }
  if (filters.dateFrom) {
    conditions.push(gte(reservations.createdAt, dateOnlyStart(filters.dateFrom)));
  }
  if (filters.dateTo) {
    conditions.push(lte(reservations.createdAt, dateOnlyEnd(filters.dateTo)));
  }

  const search = filters.search?.trim();
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(
      or(
        ilike(reservations.reservationNumber, pattern),
        ilike(reservations.tossOrderId, pattern),
        ilike(performances.title, pattern),
        sql`${users.id}::text ilike ${pattern}`,
        ilike(users.email, pattern),
        ilike(users.name, pattern),
        ilike(users.phone, pattern),
        ilike(users.country, pattern),
        sql`${users.preferredLocale}::text ilike ${pattern}`,
        ilike(users.birthDate, pattern),
        ilike(users.accountStatus, pattern),
        ticketItemSearchExistsSql(pattern),
        reservationSeatSearchExistsSql(pattern),
      )!,
    );
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

function reservationSeatFilterSql(filters: AdminBookingQueryParams): SQL | undefined {
  const ticketItemConditions = ticketItemDirectFilterConditions(filters, 'admin_filter_ti');
  const fallbackConditions = reservationSeatFilterConditions(filters, 'admin_filter_rs');

  if (ticketItemConditions.length === 0 && fallbackConditions.length === 0) {
    return undefined;
  }

  const ticketItemExists = sql`exists (
    select 1
    from ticket_items admin_filter_ti
    where admin_filter_ti.reservation_id = ${reservations.id}
      and ${and(...ticketItemConditions)}
  )`;
  const fallbackExists = sql`(
    not ${hasAnyTicketItemsSql()}
    and exists (
      select 1
      from reservation_seats admin_filter_rs
      where admin_filter_rs.reservation_id = ${reservations.id}
        and ${and(...fallbackConditions)}
    )
  )`;

  return or(ticketItemExists, fallbackExists);
}

function ticketItemDirectFilterConditions(
  filters: AdminBookingQueryParams,
  alias: string,
): SQL[] {
  const conditions: SQL[] = [];
  if (filters.seatTier) {
    conditions.push(sql`${sql.raw(`${alias}.tier_name`)} = ${filters.seatTier}`);
  }
  if (filters.floorKey) {
    conditions.push(sql`${sql.raw(`${alias}.floor_key`)} = ${filters.floorKey}`);
  }
  if (filters.seatQuery) {
    const pattern = `%${filters.seatQuery}%`;
    conditions.push(sql`(
      ${sql.raw(`${alias}.seat_key`)} ilike ${pattern}
      or ${sql.raw(`${alias}.seat_id`)} ilike ${pattern}
      or ${sql.raw(`${alias}.tier_name`)} ilike ${pattern}
      or ${sql.raw(`${alias}."row"`)} ilike ${pattern}
      or ${sql.raw(`${alias}.number`)} ilike ${pattern}
    )`);
  }
  return conditions;
}

function reservationSeatFilterConditions(
  filters: AdminBookingQueryParams,
  alias: string,
): SQL[] {
  const conditions: SQL[] = [];
  if (filters.seatTier) {
    conditions.push(sql`${sql.raw(`${alias}.tier_name`)} = ${filters.seatTier}`);
  }
  if (filters.floorKey) {
    conditions.push(sql`${sql.raw(`${alias}.seat_id`)} ilike ${`${filters.floorKey}:%`}`);
  }
  if (filters.seatQuery) {
    const pattern = `%${filters.seatQuery}%`;
    conditions.push(sql`(
      ${sql.raw(`${alias}.seat_id`)} ilike ${pattern}
      or ${sql.raw(`${alias}.tier_name`)} ilike ${pattern}
      or ${sql.raw(`${alias}."row"`)} ilike ${pattern}
      or ${sql.raw(`${alias}.number`)} ilike ${pattern}
    )`);
  }
  return conditions;
}

function paymentMethodFilterSql(paymentMethod: string): SQL {
  return inArray(payments.method, paymentMethodFilterValues(paymentMethod));
}

function paymentMethodFilterValues(paymentMethod: string): string[] {
  const aliases = PAYMENT_METHOD_FILTER_ALIASES[paymentMethod as PaymentMethodType];
  return aliases ? [...aliases] : [paymentMethod];
}

function ticketItemSearchExistsSql(pattern: string): SQL {
  return sql`exists (
    select 1
    from ticket_items admin_search_ti
    where admin_search_ti.reservation_id = ${reservations.id}
      and (
        admin_search_ti.seat_key ilike ${pattern}
        or admin_search_ti.seat_id ilike ${pattern}
        or admin_search_ti.tier_name ilike ${pattern}
        or admin_search_ti.row ilike ${pattern}
        or admin_search_ti.number ilike ${pattern}
      )
  )`;
}

function reservationSeatSearchExistsSql(pattern: string): SQL {
  return sql`exists (
    select 1
    from reservation_seats admin_search_rs
    where admin_search_rs.reservation_id = ${reservations.id}
      and (
        admin_search_rs.seat_id ilike ${pattern}
        or admin_search_rs.tier_name ilike ${pattern}
        or admin_search_rs.row ilike ${pattern}
        or admin_search_rs.number ilike ${pattern}
      )
  )`;
}

function hasAnyTicketItemsSql(): SQL {
  return sql`exists (
    select 1
    from ticket_items admin_any_ti
    where admin_any_ti.reservation_id = ${reservations.id}
  )`;
}

function hasActiveTicketItemsSql(): SQL {
  return sql`exists (
    select 1
    from ticket_items admin_active_ti
    where admin_active_ti.reservation_id = ${reservations.id}
      and admin_active_ti.status = 'active'
  )`;
}

function hasCancelledTicketItemsSql(): SQL {
  return sql`exists (
    select 1
    from ticket_items admin_cancelled_ti
    where admin_cancelled_ti.reservation_id = ${reservations.id}
      and admin_cancelled_ti.status = 'cancelled'
  )`;
}

function hasCancellationPendingTicketItemsSql(): SQL {
  return sql`exists (
    select 1
    from ticket_items admin_pending_cancel_ti
    where admin_pending_cancel_ti.reservation_id = ${reservations.id}
      and admin_pending_cancel_ti.status = 'cancellation_pending'
  )`;
}

function hasNonActiveTicketItemsSql(): SQL {
  return sql`exists (
    select 1
    from ticket_items admin_non_active_ti
    where admin_non_active_ti.reservation_id = ${reservations.id}
      and admin_non_active_ti.status <> 'active'
  )`;
}

function activeTicketItemRevenueSql(): SQL<number> {
  return sql<number>`coalesce((
    select sum(admin_revenue_ti.price + admin_revenue_ti.service_fee)::int
    from ticket_items admin_revenue_ti
    where admin_revenue_ti.reservation_id = ${reservations.id}
      and admin_revenue_ti.status = 'active'
  ), 0)`;
}

function refundAttentionConditionSql(): SQL {
  return sql`coalesce(${refunds.status} in (
    'requested',
    'sent_to_pg',
    'processing_at_pg',
    'failed'
  ), false)`;
}

function cancelProcessingReservationConditionSql(): SQL {
  return sql`(
    ${reservations.status} = 'CONFIRMED'
    and (
      ${hasCancellationPendingTicketItemsSql()}
      or ${refundAttentionConditionSql()}
    )
  )`;
}

function partialCancelledReservationConditionSql(): SQL {
  return sql`(
    ${reservations.status} = 'CONFIRMED'
    and ${hasActiveTicketItemsSql()}
    and ${hasCancelledTicketItemsSql()}
    and not ${cancelProcessingReservationConditionSql()}
  )`;
}

function completedRevenueEligibleConditionSql(): SQL {
  return sql`(
    ${reservations.status} = 'CONFIRMED'
    and ${payments.status} = 'DONE'
  )`;
}

function soldReservationConditionSql(): SQL {
  return sql`(
    ${completedRevenueEligibleConditionSql()}
    and not ${cancelProcessingReservationConditionSql()}
    and (
      not ${hasAnyTicketItemsSql()}
      or (
        ${hasActiveTicketItemsSql()}
        and not ${hasNonActiveTicketItemsSql()}
      )
    )
  )`;
}

function adminBookingFunnelStatusSql(): SQL<AdminBookingFunnelStatus> {
  return sql<AdminBookingFunnelStatus>`case
    when ${reservations.status} = 'CANCELLED' then 'CANCELLED'
    when ${reservations.status} = 'FAILED' then 'PAYMENT_FAILED'
    when ${reservations.status} = 'PENDING_PAYMENT'
      and ${payments.status} in ('ABORTED', 'EXPIRED', 'CANCELED') then 'PAYMENT_FAILED'
    when ${reservations.status} = 'PENDING_PAYMENT'
      and ${payments.status} = 'IN_PROGRESS' then 'PAYMENT_PROCESSING'
    when ${reservations.status} = 'PENDING_PAYMENT' then 'PAYMENT_PENDING'
    when ${cancelProcessingReservationConditionSql()} then 'CANCEL_PROCESSING'
    when ${partialCancelledReservationConditionSql()} then 'PARTIAL_CANCELLED'
    when ${reservations.status} = 'CONFIRMED'
      and ${payments.status} = 'DONE' then 'SOLD'
    when ${payments.status} = 'IN_PROGRESS' then 'PAYMENT_PROCESSING'
    else 'PAYMENT_PENDING'
  end`;
}

function funnelStatusEqualsSql(status: string): SQL {
  return sql`${adminBookingFunnelStatusSql()} = ${status}`;
}

function expiredPaymentFailureConditionSql(): SQL {
  return sql`(
    ${funnelStatusEqualsSql('PAYMENT_FAILED')}
    and (
      ${payments.status} = 'EXPIRED'
      or ${reservationPaymentFailureDiagnostics.diagnosticCode} in (
        'PAYMENT_DEADLINE_EXPIRED',
        'PAYMENT_EXPIRED'
      )
    )
  )`;
}

function abortedPaymentFailureConditionSql(): SQL {
  return sql`(
    ${funnelStatusEqualsSql('PAYMENT_FAILED')}
    and ${reservationPaymentFailureDiagnostics.diagnosticCode} is distinct from 'ASYNC_DONE_SEAT_UNAVAILABLE_CANCELLED'
    and (
      ${payments.status} = 'ABORTED'
      or ${reservationPaymentFailureDiagnostics.diagnosticCode} in (
        'PAYMENT_ABORTED',
        'PAYMENT_CANCELED_BEFORE_CONFIRM'
      )
    )
  )`;
}

function providerExpiryWebhookReceivedSql(): SQL<boolean> {
  return sql<boolean>`exists (
    select 1
    from ${paymentWebhookEvents}
    where (
      ${paymentWebhookEvents.reservationId} = ${reservations.id}
      or (
        ${paymentWebhookEvents.tossOrderId} is not null
        and ${paymentWebhookEvents.tossOrderId} = coalesce(
          ${payments.tossOrderId},
          ${reservations.tossOrderId}
        )
      )
    )
      and ${paymentWebhookEvents.eventType} = 'PAYMENT_STATUS_CHANGED'
      and ${paymentWebhookEvents.payload}->'data'->>'status' = 'EXPIRED'
  )`;
}

function paymentFailureBucketSql(): SQL<PaymentFailureBucket | null> {
  return sql<PaymentFailureBucket | null>`case
    when not (${funnelStatusEqualsSql('PAYMENT_FAILED')}) then null
    when ${reservationPaymentFailureDiagnostics.diagnosticCode} = 'ASYNC_DONE_SEAT_UNAVAILABLE_CANCELLED'
      then 'compensated_cancel'
    when ${payments.id} is null
      and ${reservationPaymentFailureDiagnostics.diagnosticCode} = 'PAYMENT_DEADLINE_EXPIRED'
      and ${reservationPaymentFailureDiagnostics.diagnosticSource} = 'payment_webhook_events'
      and ${providerExpiryWebhookReceivedSql()}
      then 'unreconciled_provider_expired'
    when ${payments.status} = 'EXPIRED'
      or ${reservationPaymentFailureDiagnostics.diagnosticCode} = 'PAYMENT_EXPIRED'
      then 'provider_expired'
    when ${payments.status} = 'ABORTED'
      or ${reservationPaymentFailureDiagnostics.diagnosticCode} = 'PAYMENT_ABORTED'
      then 'provider_aborted'
    when ${payments.status} = 'CANCELED'
      or ${reservationPaymentFailureDiagnostics.diagnosticCode} = 'PAYMENT_CANCELED_BEFORE_CONFIRM'
      then 'buyer_cancelled_before_confirm'
    when ${reservationPaymentFailureDiagnostics.diagnosticCode} = 'PAYMENT_DEADLINE_EXPIRED'
      or (${payments.id} is null and ${reservations.status} = 'FAILED')
      then 'local_deadline_expired'
    else 'other'
  end`;
}

function paymentFailureBucketEqualsSql(bucket: PaymentFailureBucket): SQL {
  return sql`${paymentFailureBucketSql()} = ${bucket}`;
}

function failedCancelledContactConditionSql(): SQL {
  return sql`(
    ${reservations.status} = 'FAILED'
    or ${reservations.status} = 'CANCELLED'
    or (
      ${reservations.status} = 'PENDING_PAYMENT'
      and ${payments.status} in ('ABORTED', 'EXPIRED', 'CANCELED')
    )
  )`;
}

function noActiveTicketForSameUserPerformanceSql(): SQL {
  return sql`not exists (
    select 1
    from reservations active_r
    inner join showtimes active_st on active_st.id = active_r.showtime_id
    inner join ticket_items active_ti on active_ti.reservation_id = active_r.id
    where active_r.user_id = ${reservations.userId}
      and active_st.performance_id = ${showtimes.performanceId}
      and active_ti.status = 'active'
  )`;
}

function countDistinctReservationsWhereSql(condition: SQL): SQL<number> {
  return sql<number>`count(distinct ${reservations.id}) filter (where ${condition})::int`;
}

function completedRevenueSql(): SQL<number> {
  return sql<number>`coalesce(sum(
    case
      when ${completedRevenueEligibleConditionSql()} then
        case
          when ${hasAnyTicketItemsSql()} then ${activeTicketItemRevenueSql()}
          else ${reservations.totalAmount}
        end
      else 0
    end
  ), 0)::int`;
}

function mapBookingStats(row: BookingStatsRow | undefined): BookingStats {
  const totalBookings = toInt(row?.totalBookings);
  const completedRevenue = toInt(row?.completedRevenue);
  const cancelledCount = toInt(row?.cancelledCount);

  return {
    totalBookings,
    totalRevenue: completedRevenue,
    cancelRate: totalBookings > 0
      ? Math.round((cancelledCount / totalBookings) * 100)
      : 0,
    soldCount: toInt(row?.soldCount),
    pendingPaymentCount: toInt(row?.pendingPaymentCount),
    paymentProcessingCount: toInt(row?.paymentProcessingCount),
    failedCount: toInt(row?.failedCount),
    expiredPaymentCount: toInt(row?.expiredPaymentCount),
    abortedPaymentCount: toInt(row?.abortedPaymentCount),
    localDeadlineExpiredCount: toInt(row?.localDeadlineExpiredCount),
    providerExpiredCount: toInt(row?.providerExpiredCount),
    providerAbortedCount: toInt(row?.providerAbortedCount),
    buyerCancelledBeforeConfirmCount: toInt(row?.buyerCancelledBeforeConfirmCount),
    unreconciledProviderExpiredCount: toInt(row?.unreconciledProviderExpiredCount),
    compensatedCancelCount: toInt(row?.compensatedCancelCount),
    otherPaymentFailureCount: toInt(row?.otherPaymentFailureCount),
    cancelProcessingCount: toInt(row?.cancelProcessingCount),
    cancelledCount,
    partialCancelledCount: toInt(row?.partialCancelledCount),
    completedRevenue,
  };
}

function toInt(value: number | string | null | undefined): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return Number.parseInt(value, 10) || 0;
  }
  return 0;
}

function buildTicketItemStatsWhereClause(
  filters: AdminBookingQueryParams,
  reservationWhereClause: SQL | undefined,
): SQL | undefined {
  const conditions: SQL[] = [];
  if (reservationWhereClause) {
    conditions.push(reservationWhereClause);
  }
  if (filters.seatTier) {
    conditions.push(eq(ticketItems.tierName, filters.seatTier));
  }
  if (filters.floorKey) {
    conditions.push(eq(ticketItems.floorKey, filters.floorKey));
  }
  if (filters.seatQuery) {
    const pattern = `%${filters.seatQuery}%`;
    conditions.push(
      or(
        ilike(ticketItems.seatKey, pattern),
        ilike(ticketItems.seatId, pattern),
        ilike(ticketItems.tierName, pattern),
        ilike(ticketItems.row, pattern),
        ilike(ticketItems.number, pattern),
      )!,
    );
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

function mergeTierStats(
  tierRows: AdminBookingTierStatsRow[],
  capacityRows: AdminBookingTierCapacityRow[],
): AdminBookingTierStats[] {
  const byTier = new Map<string, AdminBookingTierStats & { unavailableSeats: number }>();

  for (const row of tierRows) {
    const soldSeats = toInt(row.soldSeats);
    const activeRevenue = toInt(row.activeRevenue);
    byTier.set(row.tierName, {
      tierName: row.tierName,
      price: toInt(row.price),
      soldSeats,
      activeRevenue,
      averageTicketAmount: soldSeats > 0 ? Math.round(activeRevenue / soldSeats) : 0,
      cancelProcessingSeats: toInt(row.cancelProcessingSeats),
      cancelledSeats: toInt(row.cancelledSeats),
      enteredSeats: toInt(row.enteredSeats),
      totalSeats: null,
      remainingSeats: null,
      sellThroughRate: null,
      unavailableSeats: 0,
    });
  }

  for (const row of capacityRows) {
    const current = byTier.get(row.tierName) ?? {
      tierName: row.tierName,
      price: toInt(row.price),
      soldSeats: 0,
      activeRevenue: 0,
      averageTicketAmount: 0,
      cancelProcessingSeats: 0,
      cancelledSeats: 0,
      enteredSeats: 0,
      totalSeats: null,
      remainingSeats: null,
      sellThroughRate: null,
      unavailableSeats: 0,
    };
    const totalSeats = toInt(row.totalSeats);
    const unavailableSeats = toInt(row.unavailableSeats);
    current.price = current.price || toInt(row.price);
    current.totalSeats = totalSeats;
    current.unavailableSeats = unavailableSeats;
    current.remainingSeats = Math.max(totalSeats - current.soldSeats - unavailableSeats, 0);
    current.sellThroughRate = totalSeats > 0
      ? Math.round((current.soldSeats / totalSeats) * 100)
      : 0;
    byTier.set(row.tierName, current);
  }

  return Array.from(byTier.values())
    .map(({ unavailableSeats: _unused, ...stats }) => stats)
    .sort((left, right) =>
      right.averageTicketAmount - left.averageTicketAmount
      || right.soldSeats - left.soldSeats
      || left.tierName.localeCompare(right.tierName)
    );
}

@Injectable()
export class AdminBookingService {
  private readonly logger = new Logger(AdminBookingService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly bookingGateway: BookingGateway,
    private readonly refundService: RefundService,
    @Optional() private readonly injectedAuditService?: AdminAuditService,
  ) {}

  private get auditService(): AdminAuditService {
    return this.injectedAuditService ?? new AdminAuditService(this.db);
  }

  async getBookings(params: {
    status?: string;
    reservationStatus?: string;
    performanceId?: string;
    showtimeId?: string;
    funnelStatus?: string;
    paymentStatus?: string;
    paymentMethod?: string;
    audienceRegion?: string;
    seatTier?: string;
    floorKey?: string;
    seatQuery?: string;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
    page?: number;
  }): Promise<{
    bookings: AdminBookingListItem[];
    stats: BookingStats;
    tierStats: AdminBookingTierStats[];
    total: number;
  }> {
    const { page = 1 } = params;
    const limit = 20;
    const offset = (page - 1) * limit;
    const whereClause = buildAdminBookingWhereClause(params);

    const [statsRow] = await this.db
      .select({
        totalBookings: sql<number>`count(distinct ${reservations.id})::int`,
        completedRevenue: completedRevenueSql(),
        soldCount: countDistinctReservationsWhereSql(soldReservationConditionSql()),
        pendingPaymentCount: countDistinctReservationsWhereSql(funnelStatusEqualsSql('PAYMENT_PENDING')),
        paymentProcessingCount: countDistinctReservationsWhereSql(funnelStatusEqualsSql('PAYMENT_PROCESSING')),
        failedCount: countDistinctReservationsWhereSql(funnelStatusEqualsSql('PAYMENT_FAILED')),
        expiredPaymentCount: countDistinctReservationsWhereSql(expiredPaymentFailureConditionSql()),
        abortedPaymentCount: countDistinctReservationsWhereSql(abortedPaymentFailureConditionSql()),
        localDeadlineExpiredCount: countDistinctReservationsWhereSql(paymentFailureBucketEqualsSql('local_deadline_expired')),
        providerExpiredCount: countDistinctReservationsWhereSql(paymentFailureBucketEqualsSql('provider_expired')),
        providerAbortedCount: countDistinctReservationsWhereSql(paymentFailureBucketEqualsSql('provider_aborted')),
        buyerCancelledBeforeConfirmCount: countDistinctReservationsWhereSql(paymentFailureBucketEqualsSql('buyer_cancelled_before_confirm')),
        unreconciledProviderExpiredCount: countDistinctReservationsWhereSql(paymentFailureBucketEqualsSql('unreconciled_provider_expired')),
        compensatedCancelCount: countDistinctReservationsWhereSql(paymentFailureBucketEqualsSql('compensated_cancel')),
        otherPaymentFailureCount: countDistinctReservationsWhereSql(paymentFailureBucketEqualsSql('other')),
        cancelProcessingCount: countDistinctReservationsWhereSql(cancelProcessingReservationConditionSql()),
        cancelledCount: countDistinctReservationsWhereSql(funnelStatusEqualsSql('CANCELLED')),
        partialCancelledCount: countDistinctReservationsWhereSql(partialCancelledReservationConditionSql()),
      })
      .from(reservations)
      .innerJoin(users, eq(reservations.userId, users.id))
      .innerJoin(showtimes, eq(reservations.showtimeId, showtimes.id))
      .innerJoin(performances, eq(showtimes.performanceId, performances.id))
      .leftJoin(payments, eq(payments.reservationId, reservations.id))
      .leftJoin(
        reservationPaymentFailureDiagnostics,
        eq(reservationPaymentFailureDiagnostics.reservationId, reservations.id),
      )
      .leftJoin(refunds, eq(refunds.reservationId, reservations.id))
      .where(whereClause) as BookingStatsRow[];

    const stats = mapBookingStats(statsRow);

    const rows = await this.db
      .select({
        reservation: {
          id: reservations.id,
          reservationNumber: reservations.reservationNumber,
          tossOrderId: reservations.tossOrderId,
          status: reservations.status,
          totalAmount: reservations.totalAmount,
          createdAt: reservations.createdAt,
        },
        user: {
          name: users.name,
          email: users.email,
          country: users.country,
        },
        showtime: {
          dateTime: showtimes.dateTime,
        },
        performance: {
          title: performances.title,
        },
        payment: {
          id: payments.id,
          status: payments.status,
          method: payments.method,
          provider: payments.provider,
          currency: payments.currency,
        },
        providerExpiryWebhookReceived: providerExpiryWebhookReceivedSql(),
        diagnostic: {
          diagnosticKind: reservationPaymentFailureDiagnostics.diagnosticKind,
          diagnosticCode: reservationPaymentFailureDiagnostics.diagnosticCode,
          diagnosticMessage: reservationPaymentFailureDiagnostics.diagnosticMessage,
          diagnosticSource: reservationPaymentFailureDiagnostics.diagnosticSource,
          recordedAt: reservationPaymentFailureDiagnostics.recordedAt,
          providerCheckStatus: reservationPaymentFailureDiagnostics.providerCheckStatus,
          providerCheckedAt: reservationPaymentFailureDiagnostics.providerCheckedAt,
          providerCheckMessage: reservationPaymentFailureDiagnostics.providerCheckMessage,
        },
        refund: {
          status: refunds.status,
        },
      })
      .from(reservations)
      .innerJoin(users, eq(reservations.userId, users.id))
      .innerJoin(showtimes, eq(reservations.showtimeId, showtimes.id))
      .innerJoin(performances, eq(showtimes.performanceId, performances.id))
      .leftJoin(payments, eq(payments.reservationId, reservations.id))
      .leftJoin(
        reservationPaymentFailureDiagnostics,
        eq(reservationPaymentFailureDiagnostics.reservationId, reservations.id),
      )
      .leftJoin(refunds, eq(refunds.reservationId, reservations.id))
      .where(whereClause)
      .orderBy(desc(reservations.createdAt), desc(reservations.id))
      .limit(limit)
      .offset(offset) as AdminBookingListRow[];

    // Batch-fetch all ticket items for all reservations (eliminates N+1)
    const reservationIds = rows.map((r) => r.reservation.id);
    const allTicketItems = reservationIds.length > 0
      ? await this.db
          .select()
          .from(ticketItems)
          .where(inArray(ticketItems.reservationId, reservationIds))
          .orderBy(asc(ticketItems.createdAt), asc(ticketItems.id))
      : [];
    const ticketItemsByReservation = new Map<string, typeof allTicketItems>();
    for (const ticketItem of allTicketItems) {
      const existing = ticketItemsByReservation.get(ticketItem.reservationId) ?? [];
      existing.push(ticketItem);
      ticketItemsByReservation.set(ticketItem.reservationId, existing);
    }
    const reservationIdsWithoutTicketItems = reservationIds.filter(
      (reservationId) => (ticketItemsByReservation.get(reservationId)?.length ?? 0) === 0,
    );
    const allReservationSeats = reservationIdsWithoutTicketItems.length > 0
      ? await this.db
          .select()
          .from(reservationSeats)
          .where(inArray(reservationSeats.reservationId, reservationIdsWithoutTicketItems))
          .orderBy(asc(reservationSeats.id))
      : [];
    const reservationSeatsByReservation = new Map<string, typeof allReservationSeats>();
    for (const reservationSeat of allReservationSeats) {
      const existing = reservationSeatsByReservation.get(reservationSeat.reservationId) ?? [];
      existing.push(reservationSeat);
      reservationSeatsByReservation.set(reservationSeat.reservationId, existing);
    }

    const bookings: AdminBookingListItem[] = rows.map((row) => {
      const reservationTicketItems = ticketItemsByReservation.get(row.reservation.id) ?? [];
      const reservationSeatsFallback = reservationSeatsByReservation.get(row.reservation.id) ?? [];
      const ticketStatusCounts = countTicketStatuses(reservationTicketItems);
      const funnelStatus = deriveAdminBookingFunnelStatus({
        reservationStatus: row.reservation.status,
        paymentStatus: row.payment?.status ?? null,
        refundStatus: row.refund?.status ?? null,
        ticketStatusCounts,
      });
      return {
        id: row.reservation.id,
        reservationNumber: row.reservation.reservationNumber,
        tossOrderId: row.reservation.tossOrderId,
        userName: row.user.name,
        userEmail: row.user.email,
        userCountry: row.user.country,
        performanceTitle: row.performance.title,
        showDateTime: row.showtime.dateTime?.toISOString() ?? '',
        seats: reservationTicketItems.length > 0
          ? reservationTicketItems.map(mapTicketItemToSeatSelection)
          : reservationSeatsFallback.map(mapReservationSeatToSeatSelection),
        totalAmount: row.reservation.totalAmount,
        status: row.reservation.status as ReservationStatus,
        funnelStatus,
        paymentStatus: mapPaymentStatusOrNull(row.payment?.status),
        paymentMethod: row.payment?.method ?? null,
        paymentFailureBucket: derivePaymentFailureBucket({
          reservationStatus: row.reservation.status,
          paymentStatus: row.payment?.status ?? null,
          paymentIdPresent: row.payment?.id !== null && row.payment?.id !== undefined,
          diagnosticCode: row.diagnostic?.diagnosticCode ?? null,
          diagnosticSource: row.diagnostic?.diagnosticSource ?? null,
          providerExpiryWebhookReceived: row.providerExpiryWebhookReceived === true,
          funnelStatus,
        }),
        paymentFailureDiagnostic: mapPaymentFailureDiagnostic(row.diagnostic),
        paymentMethodAttribution: mapPaymentMethodAttribution(row.payment),
        ticketStatusCounts,
        createdAt: row.reservation.createdAt?.toISOString() ?? '',
      };
    });
    const tierStats = await this.getTierStats(params, whereClause);

    return {
      bookings,
      stats,
      tierStats,
      total: stats.totalBookings,
    };
  }

  private async getTierStats(
    params: AdminBookingQueryParams,
    whereClause: SQL | undefined,
  ): Promise<AdminBookingTierStats[]> {
    const ticketItemWhere = buildTicketItemStatsWhereClause(params, whereClause);
    const tierRows = await this.db
      .select({
        tierName: ticketItems.tierName,
        price: sql<number>`min(${ticketItems.price})::int`,
        soldSeats: sql<number>`count(*) filter (
          where ${ticketItems.status} = 'active'
            and ${completedRevenueEligibleConditionSql()}
        )::int`,
        activeRevenue: sql<number>`coalesce(sum(
          case
            when ${ticketItems.status} = 'active'
              and ${completedRevenueEligibleConditionSql()}
            then ${ticketItems.price} + ${ticketItems.serviceFee}
            else 0
          end
        ), 0)::int`,
        cancelProcessingSeats: sql<number>`count(*) filter (
          where ${ticketItems.status} = 'cancellation_pending'
        )::int`,
        cancelledSeats: sql<number>`count(*) filter (
          where ${ticketItems.status} = 'cancelled'
        )::int`,
        enteredSeats: sql<number>`count(*) filter (
          where ${ticketItems.status} = 'active'
            and ${ticketItems.admissionState} = 'entered'
            and ${completedRevenueEligibleConditionSql()}
        )::int`,
      })
      .from(ticketItems)
      .innerJoin(reservations, eq(ticketItems.reservationId, reservations.id))
      .innerJoin(users, eq(reservations.userId, users.id))
      .innerJoin(showtimes, eq(reservations.showtimeId, showtimes.id))
      .innerJoin(performances, eq(showtimes.performanceId, performances.id))
      .leftJoin(payments, eq(payments.reservationId, reservations.id))
      .leftJoin(refunds, eq(refunds.reservationId, reservations.id))
      .where(ticketItemWhere)
      .groupBy(ticketItems.tierName)
      .orderBy(ticketItems.tierName) as AdminBookingTierStatsRow[];

    const capacityRows = params.showtimeId
      ? await this.getTierCapacityRows(params)
      : [];

    return mergeTierStats(tierRows, capacityRows);
  }

  private async getTierCapacityRows(
    params: AdminBookingQueryParams,
  ): Promise<AdminBookingTierCapacityRow[]> {
    if (!params.showtimeId) {
      return [];
    }

    const conditions: SQL[] = [eq(showtimes.id, params.showtimeId)];
    if (params.performanceId) {
      conditions.push(eq(performanceSeatAssignments.performanceId, params.performanceId));
    }
    if (params.seatTier) {
      conditions.push(eq(performanceSeatTiers.tierName, params.seatTier));
    }
    if (params.floorKey) {
      conditions.push(eq(venueLayoutFloors.floorKey, params.floorKey));
    }
    if (params.seatQuery) {
      const pattern = `%${params.seatQuery}%`;
      conditions.push(
        or(
          ilike(venueLayoutSeats.seatKey, pattern),
          ilike(venueLayoutSeats.sourceSeatId, pattern),
          ilike(venueLayoutSeats.rowLabel, pattern),
          ilike(venueLayoutSeats.seatNumber, pattern),
        )!,
      );
    }

    return await this.db
      .select({
        tierName: performanceSeatTiers.tierName,
        price: performanceSeatTiers.price,
        totalSeats: sql<number>`count(*) filter (
          where ${performanceSeatAssignments.saleStatus} = 'available'
        )::int`,
        unavailableSeats: sql<number>`count(${seatInventories.id}) filter (
          where ${seatInventories.status} in ('locked', 'held_cancelled', 'disabled')
        )::int`,
      })
      .from(performanceSeatAssignments)
      .innerJoin(
        performanceSeatTiers,
        eq(performanceSeatAssignments.tierId, performanceSeatTiers.id),
      )
      .innerJoin(
        venueLayoutSeats,
        eq(performanceSeatAssignments.layoutSeatId, venueLayoutSeats.id),
      )
      .innerJoin(venueLayoutFloors, eq(venueLayoutSeats.floorId, venueLayoutFloors.id))
      .innerJoin(showtimes, eq(showtimes.performanceId, performanceSeatAssignments.performanceId))
      .leftJoin(
        seatInventories,
        and(
          eq(seatInventories.showtimeId, showtimes.id),
          eq(seatInventories.performanceSeatAssignmentId, performanceSeatAssignments.id),
        ),
      )
      .where(and(...conditions))
      .groupBy(performanceSeatTiers.tierName, performanceSeatTiers.price, performanceSeatTiers.sortOrder)
      .orderBy(performanceSeatTiers.sortOrder, performanceSeatTiers.tierName) as AdminBookingTierCapacityRow[];
  }

  async getBookingDetail(reservationId: string): Promise<AdminBookingDetailDto> {
    const [row] = await this.db
      .select({
        reservation: {
          id: reservations.id,
          reservationNumber: reservations.reservationNumber,
          tossOrderId: reservations.tossOrderId,
          status: reservations.status,
          totalAmount: reservations.totalAmount,
          createdAt: reservations.createdAt,
        },
        user: {
          name: users.name,
          phone: users.phone,
          email: users.email,
          country: users.country,
        },
        showtime: {
          dateTime: showtimes.dateTime,
        },
        performance: {
          title: performances.title,
        },
        payment: {
          id: payments.id,
          paymentKey: payments.paymentKey,
          tossOrderId: payments.tossOrderId,
          method: payments.method,
          provider: payments.provider,
          currency: payments.currency,
          amount: payments.amount,
          status: payments.status,
          createdAt: payments.createdAt,
          paidAt: payments.paidAt,
        },
        refund: {
          status: refunds.status,
        },
        diagnostic: {
          diagnosticKind: reservationPaymentFailureDiagnostics.diagnosticKind,
          diagnosticCode: reservationPaymentFailureDiagnostics.diagnosticCode,
          diagnosticMessage: reservationPaymentFailureDiagnostics.diagnosticMessage,
          diagnosticSource: reservationPaymentFailureDiagnostics.diagnosticSource,
          recordedAt: reservationPaymentFailureDiagnostics.recordedAt,
          providerCheckStatus: reservationPaymentFailureDiagnostics.providerCheckStatus,
          providerCheckedAt: reservationPaymentFailureDiagnostics.providerCheckedAt,
          providerCheckMessage: reservationPaymentFailureDiagnostics.providerCheckMessage,
        },
        providerExpiryWebhookReceived: providerExpiryWebhookReceivedSql(),
      })
      .from(reservations)
      .innerJoin(users, eq(reservations.userId, users.id))
      .innerJoin(showtimes, eq(reservations.showtimeId, showtimes.id))
      .innerJoin(performances, eq(showtimes.performanceId, performances.id))
      .leftJoin(payments, eq(payments.reservationId, reservations.id))
      .leftJoin(refunds, eq(refunds.reservationId, reservations.id))
      .leftJoin(
        reservationPaymentFailureDiagnostics,
        eq(reservationPaymentFailureDiagnostics.reservationId, reservations.id),
      )
      .where(eq(reservations.id, reservationId));

    if (!row) {
      throw new NotFoundException('예매를 찾을 수 없습니다');
    }

    const reservationTicketItems = await this.db
      .select()
      .from(ticketItems)
      .where(eq(ticketItems.reservationId, reservationId))
      .orderBy(asc(ticketItems.createdAt), asc(ticketItems.id));

    const reservationSeatsFallback = reservationTicketItems.length === 0
      ? await this.db
          .select()
          .from(reservationSeats)
          .where(eq(reservationSeats.reservationId, reservationId))
          .orderBy(asc(reservationSeats.id))
      : [];
    const payment = row.payment;

    const ticketStatusCounts = countTicketStatuses(reservationTicketItems);
    const funnelStatus = deriveAdminBookingFunnelStatus({
      reservationStatus: row.reservation.status,
      paymentStatus: payment?.status ?? null,
      refundStatus: row.refund?.status ?? null,
      ticketStatusCounts,
    });

    return {
      id: row.reservation.id,
      reservationNumber: row.reservation.reservationNumber,
      tossOrderId: row.reservation.tossOrderId,
      userName: row.user.name,
      userPhone: row.user.phone,
      userEmail: row.user.email,
      userCountry: row.user.country,
      performanceTitle: row.performance.title,
      showDateTime: row.showtime.dateTime?.toISOString() ?? '',
      seats: reservationTicketItems.length > 0
        ? reservationTicketItems.map(mapTicketItemToSeatSelection)
        : reservationSeatsFallback.map(mapReservationSeatToSeatSelection),
      totalAmount: row.reservation.totalAmount,
      status: row.reservation.status as ReservationStatus,
      funnelStatus,
      paymentStatus: mapPaymentStatusOrNull(payment?.status),
      paymentMethod: payment?.method ?? null,
      paymentFailureBucket: derivePaymentFailureBucket({
        reservationStatus: row.reservation.status,
        paymentStatus: payment?.status ?? null,
        paymentIdPresent: payment !== null && payment !== undefined,
        diagnosticCode: row.diagnostic?.diagnosticCode ?? null,
        diagnosticSource: row.diagnostic?.diagnosticSource ?? null,
        providerExpiryWebhookReceived: row.providerExpiryWebhookReceived === true,
        funnelStatus,
      }),
      paymentFailureDiagnostic: mapPaymentFailureDiagnostic(row.diagnostic),
      paymentMethodAttribution: mapPaymentMethodAttribution(payment ?? null),
      paymentAttemptedAt: payment?.createdAt?.toISOString() ?? null,
      paymentCompletedAt: payment?.paidAt?.toISOString() ?? null,
      ticketStatusCounts,
      createdAt: row.reservation.createdAt?.toISOString() ?? '',
      ticketItems: reservationTicketItems.map(mapTicketItemToAdminTicketItem),
      paymentInfo: payment
        ? mapPaymentToPaymentInfo(payment, null)
        : null,
    };
  }

  async refundBooking(
    reservationId: string,
    operatorUserId: string,
    reason: string,
  ): Promise<void> {
    try {
      const refundResult = await this.refundService.requestAdminRefund(
        reservationId,
        operatorUserId,
        reason,
      );

      await this.auditService.write({
        actorUserId: operatorUserId,
        action: 'refund.admin_refund',
        resourceType: 'reservation',
        resourceId: reservationId,
        status: 'success',
        reason,
        changedFields: ['refund'],
        before: {},
        after: {
          refund: {
            idempotent: refundResult.idempotent,
            retryEnqueued: refundResult.retryEnqueued,
            currentState: refundResult.refundTimeline?.currentState ?? null,
          },
        },
      });
    } catch (error) {
      await this.auditService.write({
        actorUserId: operatorUserId,
        action: 'refund.admin_refund',
        resourceType: 'reservation',
        resourceId: reservationId,
        status: 'failed',
        reason,
        changedFields: ['refund'],
        before: {},
        after: {
          refund: {
            error: error instanceof Error ? error.message : 'unknown',
          },
        },
      }).catch((auditError: unknown) => {
        this.logger.warn(
          `Failed to write admin refund failure audit for reservationId=${reservationId}: ${
            auditError instanceof Error ? auditError.message : 'unknown'
          }`,
        );
      });
      throw error;
    }
  }

  async exportReservations(
    request: ReservationExportRequest,
  ): Promise<ReservationExportResult> {
    const reason = request.filters.reason?.trim();
    if (!reason) {
      throw new BadRequestException('원본 CSV 내보내기 사유를 입력해주세요');
    }

    if (
      request.filters.dateFrom
      && request.filters.dateTo
      && request.filters.dateFrom > request.filters.dateTo
    ) {
      throw new BadRequestException('조회 종료일은 시작일 이후여야 합니다');
    }

    const filters = {
      ...request.filters,
      reason,
    } satisfies AdminReservationExportFilter;
    const isContactExport = filters.exportType === FAILED_CANCELLED_CONTACTS_EXPORT_TYPE;
    const isActiveTicketManifestExport =
      filters.exportType === ACTIVE_TICKET_MANIFEST_EXPORT_TYPE;
    let exportType = RAW_EXPORT_TYPE;
    if (isContactExport) {
      exportType = FAILED_CANCELLED_CONTACTS_EXPORT_TYPE;
    } else if (isActiveTicketManifestExport) {
      exportType = ACTIVE_TICKET_MANIFEST_EXPORT_TYPE;
    }
    const rows = await (async () => {
      if (isContactExport) {
        return this.selectFailedCancelledContactExportRows(filters);
      }
      if (isActiveTicketManifestExport) {
        return this.selectActiveTicketManifestRows(filters);
      }
      return this.selectReservationExportRows({
        ...filters,
        exportType: RAW_EXPORT_TYPE,
      });
    })();
    const csv = withUtf8Bom(safeCsvRows([
      ...(isContactExport
        ? [
            FAILED_CANCELLED_CONTACT_EXPORT_HEADERS,
            ...(rows as FailedCancelledContactExportRow[]).map((row) =>
              failedCancelledContactExportRowToCsvValues(row)
            ),
          ]
        : isActiveTicketManifestExport
          ? [
              ACTIVE_TICKET_MANIFEST_EXPORT_HEADERS,
              ...(rows as ActiveTicketManifestExportRow[]).map((row) =>
                activeTicketManifestExportRowToCsvValues(row)
              ),
            ]
          : [
              RESERVATION_EXPORT_HEADERS,
              ...(rows as ReservationExportRow[]).map((row) =>
                reservationExportRowToCsvValues(row)
              ),
            ]),
    ]));

    await this.auditService.write({
      actorUserId: request.actorUserId,
      action: 'reservations.export_raw',
      resourceType: 'reservation_export',
      resourceId: exportType,
      status: 'success',
      reason,
      changedFields: ['exportType', 'filters', 'rowCount'],
      before: {},
      after: {
        exportType,
        filters: isContactExport
          ? failedCancelledContactExportFiltersForAudit(filters)
          : isActiveTicketManifestExport
            ? activeTicketManifestExportFiltersForAudit(filters)
          : reservationExportFiltersForAudit(filters),
        rowCount: rows.length,
      },
      ipAddress: request.ipAddress ?? null,
      userAgent: request.userAgent ?? null,
    });

    return {
      filename: isContactExport
        ? `reservation-export-failed-cancelled-contacts-${new Date().toISOString().slice(0, 10)}.csv`
        : isActiveTicketManifestExport
          ? `reservation-export-active-ticket-manifest-${new Date().toISOString().slice(0, 10)}.csv`
        : `reservation-export-raw-${new Date().toISOString().slice(0, 10)}.csv`,
      contentType: 'text/csv; charset=utf-8',
      csv,
      rowCount: rows.length,
    };
  }

  private async selectReservationExportRows(
    filters: AdminReservationExportFilter,
  ): Promise<ReservationExportRow[]> {
    const conditions: SQL[] = [];

    if (filters.eventId) {
      conditions.push(eq(performances.id, filters.eventId));
    }
    if (filters.tierName) {
      conditions.push(eq(ticketItems.tierName, filters.tierName));
    }
    if (filters.zoneFloor) {
      conditions.push(
        or(
          eq(ticketItems.floorKey, filters.zoneFloor),
          ilike(ticketItems.seatKey, `${filters.zoneFloor}:%`),
        )!,
      );
    }
    if (filters.reservationStatus) {
      conditions.push(eq(reservations.status, filters.reservationStatus));
    }
    if (filters.funnelStatus) {
      conditions.push(funnelStatusEqualsSql(filters.funnelStatus));
    }
    if (filters.audienceRegion === 'domestic') {
      conditions.push(eq(users.country, 'KR'));
    }
    if (filters.audienceRegion === 'overseas') {
      conditions.push(ne(users.country, 'KR'));
    }
    if (filters.paymentMethod) {
      conditions.push(paymentMethodFilterSql(filters.paymentMethod));
    }
    if (filters.dateFrom) {
      conditions.push(gte(reservations.createdAt, dateOnlyStart(filters.dateFrom)));
    }
    if (filters.dateTo) {
      conditions.push(lte(reservations.createdAt, dateOnlyEnd(filters.dateTo)));
    }

    return this.db
      .select({
        reservation: {
          id: reservations.id,
          reservationNumber: reservations.reservationNumber,
          status: reservations.status,
          totalAmount: reservations.totalAmount,
          createdAt: reservations.createdAt,
        },
        user: {
          name: users.name,
          email: users.email,
          phone: users.phone,
          country: users.country,
        },
        showtime: {
          dateTime: showtimes.dateTime,
        },
        performance: {
          id: performances.id,
          title: performances.title,
        },
        ticketItem: {
          id: ticketItems.id,
          reservationId: ticketItems.reservationId,
          paymentId: ticketItems.paymentId,
          showtimeId: ticketItems.showtimeId,
          seatId: ticketItems.seatId,
          seatKey: ticketItems.seatKey,
          floorKey: ticketItems.floorKey,
          floorLabel: ticketItems.floorLabel,
          tierName: ticketItems.tierName,
          row: ticketItems.row,
          number: ticketItems.number,
          price: ticketItems.price,
          serviceFee: ticketItems.serviceFee,
          status: ticketItems.status,
          admissionState: ticketItems.admissionState,
          enteredAt: ticketItems.enteredAt,
          cancelledAt: ticketItems.cancelledAt,
          cancelReason: ticketItems.cancelReason,
          cancellationFee: ticketItems.cancellationFee,
          serviceFeeRefund: ticketItems.serviceFeeRefund,
          refundableAmount: ticketItems.refundableAmount,
          reopenState: ticketItems.reopenState,
          reopenHoldUntil: ticketItems.reopenHoldUntil,
        },
        payment: {
          method: payments.method,
          status: payments.status,
          paidAt: payments.paidAt,
        },
      })
      .from(reservations)
      .innerJoin(users, eq(reservations.userId, users.id))
      .innerJoin(showtimes, eq(reservations.showtimeId, showtimes.id))
      .innerJoin(performances, eq(showtimes.performanceId, performances.id))
      .leftJoin(ticketItems, eq(ticketItems.reservationId, reservations.id))
      .leftJoin(payments, eq(payments.reservationId, reservations.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(reservations.createdAt), asc(ticketItems.createdAt), asc(ticketItems.id));
  }

  private async selectActiveTicketManifestRows(
    filters: AdminReservationExportFilter,
  ): Promise<ActiveTicketManifestExportRow[]> {
    const showtimeId = filters.showtimeId?.trim();
    if (!showtimeId) {
      throw new BadRequestException('회차를 선택해주세요');
    }

    return this.db
      .select({
        reservation: {
          reservationNumber: reservations.reservationNumber,
        },
        user: {
          name: users.name,
          email: users.email,
          phone: users.phone,
          country: users.country,
        },
        showtime: {
          dateTime: showtimes.dateTime,
        },
        performance: {
          title: performances.title,
        },
        ticketItem: {
          id: ticketItems.id,
          showtimeId: ticketItems.showtimeId,
          seatKey: ticketItems.seatKey,
          floorKey: ticketItems.floorKey,
          floorLabel: ticketItems.floorLabel,
          tierName: ticketItems.tierName,
          row: ticketItems.row,
          number: ticketItems.number,
          admissionState: ticketItems.admissionState,
          enteredAt: ticketItems.enteredAt,
        },
      })
      .from(ticketItems)
      .innerJoin(reservations, eq(ticketItems.reservationId, reservations.id))
      .innerJoin(payments, eq(ticketItems.paymentId, payments.id))
      .innerJoin(users, eq(reservations.userId, users.id))
      .innerJoin(showtimes, eq(ticketItems.showtimeId, showtimes.id))
      .innerJoin(performances, eq(showtimes.performanceId, performances.id))
      .leftJoin(
        seatInventories,
        and(
          eq(seatInventories.showtimeId, ticketItems.showtimeId),
          eq(seatInventories.floorKey, ticketItems.floorKey),
          eq(seatInventories.seatKey, ticketItems.seatKey),
        ),
      )
      .leftJoin(
        performanceSeatAssignments,
        eq(seatInventories.performanceSeatAssignmentId, performanceSeatAssignments.id),
      )
      .leftJoin(
        venueLayoutSeats,
        eq(performanceSeatAssignments.layoutSeatId, venueLayoutSeats.id),
      )
      .leftJoin(venueLayoutFloors, eq(venueLayoutSeats.floorId, venueLayoutFloors.id))
      .leftJoin(
        performanceSeatTiers,
        and(
          eq(performanceSeatTiers.performanceId, performances.id),
          eq(performanceSeatTiers.tierName, ticketItems.tierName),
        ),
      )
      .where(and(
        eq(ticketItems.showtimeId, showtimeId),
        eq(reservations.status, 'CONFIRMED'),
        eq(payments.status, 'DONE'),
        eq(ticketItems.status, 'active'),
      ))
      .orderBy(
        asc(performanceSeatTiers.sortOrder),
        asc(ticketItems.tierName),
        sql`${venueLayoutFloors.sortOrder} is null`,
        asc(venueLayoutFloors.sortOrder),
        sql`${venueLayoutSeats.sortOrder} is null`,
        asc(venueLayoutSeats.sortOrder),
        asc(ticketItems.floorKey),
        asc(ticketItems.row),
        asc(ticketItems.number),
        asc(ticketItems.seatKey),
      );
  }

  private async selectFailedCancelledContactExportRows(
    filters: AdminReservationExportFilter,
  ): Promise<FailedCancelledContactExportRow[]> {
    const conditions: SQL[] = [failedCancelledContactConditionSql()];

    if (filters.eventId) {
      conditions.push(eq(performances.id, filters.eventId));
    }
    if (filters.audienceRegion === 'domestic') {
      conditions.push(eq(users.country, 'KR'));
    }
    if (filters.audienceRegion === 'overseas') {
      conditions.push(ne(users.country, 'KR'));
    }
    if (filters.paymentMethod) {
      conditions.push(paymentMethodFilterSql(filters.paymentMethod));
    }
    if (filters.dateFrom) {
      conditions.push(gte(reservations.createdAt, dateOnlyStart(filters.dateFrom)));
    }
    if (filters.dateTo) {
      conditions.push(lte(reservations.createdAt, dateOnlyEnd(filters.dateTo)));
    }
    conditions.push(noActiveTicketForSameUserPerformanceSql());

    const sourceRows = await this.db
      .select({
        user: {
          id: users.id,
          name: users.name,
          email: users.email,
          phone: users.phone,
          country: users.country,
          marketingConsent: users.marketingConsent,
        },
        performance: {
          id: performances.id,
          title: performances.title,
        },
        reservation: {
          reservationNumber: reservations.reservationNumber,
          status: reservations.status,
          createdAt: reservations.createdAt,
        },
        payment: {
          status: payments.status,
        },
        diagnostic: {
          diagnosticCode: reservationPaymentFailureDiagnostics.diagnosticCode,
          diagnosticMessage: reservationPaymentFailureDiagnostics.diagnosticMessage,
          diagnosticSource: reservationPaymentFailureDiagnostics.diagnosticSource,
        },
        cancellation: {
          reason: sql<string | null>`(
            select cancelled_ti.cancel_reason
            from ticket_items cancelled_ti
            where cancelled_ti.reservation_id = ${reservations.id}
              and cancelled_ti.cancel_reason is not null
            order by cancelled_ti.cancelled_at desc nulls last, cancelled_ti.created_at desc
            limit 1
          )`,
          revenue: sql<number>`coalesce((
            select sum(cancelled_ti.cancellation_fee)::int
            from ticket_items cancelled_ti
            where cancelled_ti.reservation_id = ${reservations.id}
              and cancelled_ti.status = 'cancelled'
          ), 0)`,
          source: sql<string | null>`case
            when exists (
              select 1
              from ticket_items cancelled_ti
              where cancelled_ti.reservation_id = ${reservations.id}
                and (
                  cancelled_ti.cancel_reason is not null
                  or cancelled_ti.cancellation_fee > 0
                )
            ) then 'ticket_item'
            else null
          end`,
        },
      })
      .from(reservations)
      .innerJoin(users, eq(reservations.userId, users.id))
      .innerJoin(showtimes, eq(reservations.showtimeId, showtimes.id))
      .innerJoin(performances, eq(showtimes.performanceId, performances.id))
      .leftJoin(payments, eq(payments.reservationId, reservations.id))
      .leftJoin(
        reservationPaymentFailureDiagnostics,
        eq(reservationPaymentFailureDiagnostics.reservationId, reservations.id),
      )
      .where(and(...conditions))
      .orderBy(desc(reservations.createdAt));

    return groupFailedCancelledContactExportRows(
      sourceRows as FailedCancelledContactExportSourceRow[],
    );
  }

  async manualOpen(
    reservationId: string,
    operatorUserId: string,
    reason: string,
  ): Promise<void> {
    const auditReason = reason.trim();
    if (!auditReason) {
      throw new BadRequestException('좌석 운영 사유를 입력해주세요');
    }

    const [context] = await this.db
      .select({
        reservation: {
          id: reservations.id,
          showtimeId: reservations.showtimeId,
          status: reservations.status,
        },
        bookingPolicy: {
          manualOpenEnabled: bookingPolicies.manualOpenEnabled,
        },
      })
      .from(reservations)
      .innerJoin(showtimes, eq(showtimes.id, reservations.showtimeId))
      .leftJoin(bookingPolicies, eq(bookingPolicies.performanceId, showtimes.performanceId))
      .where(eq(reservations.id, reservationId));

    if (!context) {
      throw new NotFoundException('예매를 찾을 수 없습니다');
    }

    if (context.reservation.status !== 'CANCELLED') {
      throw new BadRequestException('수동 오픈은 취소된 예매에만 사용할 수 있습니다');
    }

    if (context.bookingPolicy?.manualOpenEnabled === false) {
      throw new BadRequestException('수동 오픈이 비활성화된 공연입니다');
    }

    const seats = await this.db
      .select({ seatId: reservationSeats.seatId })
      .from(reservationSeats)
      .where(eq(reservationSeats.reservationId, reservationId));

    if (seats.length === 0) {
      throw new NotFoundException('오픈할 좌석을 찾을 수 없습니다');
    }

    const now = new Date();
    const seatIdentities = seats.map((seat) =>
      normalizeReservationSeatIdentity(seat.seatId),
    );
    const beforeSeatStatus = seatIdentities.map((seatIdentity) => ({
      seatKey: seatIdentity.seatKey,
      status: 'held_cancelled',
    }));
    const afterSeatStatus = seatIdentities.map((seatIdentity) => ({
      seatKey: seatIdentity.seatKey,
      status: 'available',
    }));

    await this.db.transaction(async (tx) => {
      await tx.insert(bookingOperationAuditLogs).values(
        seatIdentities.map((seatIdentity) => ({
          operatorUserId,
          action: 'manual_open' as const,
          seatKey: seatIdentity.seatKey,
          reservationId,
          createdAt: now,
        })),
      );

      await this.auditService.write(
        {
          actorUserId: operatorUserId,
          action: 'seat.manual_open',
          resourceType: 'reservation',
          resourceId: reservationId,
          status: 'success',
          reason: auditReason,
          changedFields: ['seatStatus'],
          before: {
            seatStatus: beforeSeatStatus,
          },
          after: {
            seatStatus: afterSeatStatus,
          },
        },
        tx,
      );

      for (const seatIdentity of seatIdentities) {
        await tx
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
              eq(seatInventories.showtimeId, context.reservation.showtimeId),
              eq(seatInventories.floorKey, seatIdentity.floorKey),
              eq(seatInventories.seatKey, seatIdentity.seatKey),
              eq(seatInventories.status, 'held_cancelled'),
            ),
          );
      }
    });

    for (const seat of seats) {
      this.bookingGateway.broadcastSeatUpdate(
        context.reservation.showtimeId,
        seat.seatId,
        'available',
      );
    }

    this.logger.log(
      `Manual open completed for reservationId=${reservationId}, operatorUserId=${operatorUserId}, seats=${seatIdentities.length}`,
    );
  }
}

function reservationExportRowToCsvValues(row: ReservationExportRow): readonly unknown[] {
  const audienceRegion = row.user.country === 'KR' ? 'domestic' : 'overseas';
  const ticketItem = row.ticketItem
    ? mapTicketItemToAdminTicketItem(row.ticketItem)
    : null;

  return [
    row.reservation.reservationNumber,
    row.user.name,
    row.user.email,
    row.user.phone,
    audienceRegion,
    row.user.country,
    row.performance.title,
    row.showtime.dateTime?.toISOString() ?? '',
    row.ticketItem?.tierName ?? '',
    row.ticketItem?.seatKey ?? '',
    row.payment?.method ?? '',
    row.payment?.status ?? '',
    row.reservation.totalAmount,
    row.reservation.status,
    row.reservation.createdAt?.toISOString() ?? '',
    ticketItem?.id ?? '',
    ticketItem?.status ?? '',
    ticketItem?.admissionState ?? '',
    ticketItem?.enteredAt ?? '',
    ticketItem?.cancelledAt ?? '',
    ticketItem?.cancelReason ?? '',
    ticketItem?.price ?? '',
    ticketItem?.serviceFee ?? '',
    ticketItem ? ticketItem.price + ticketItem.serviceFee : '',
    ticketItem?.cancellationFee ?? '',
    ticketItem?.serviceFeeRefund ?? '',
    ticketItem?.refundableAmount ?? '',
    ticketItem?.reopenState ?? '',
  ];
}

function failedCancelledContactExportRowToCsvValues(
  row: FailedCancelledContactExportRow,
): readonly unknown[] {
  const audienceRegion = row.user.country === 'KR' ? 'domestic' : 'overseas';

  return [
    row.user.name,
    row.user.email,
    row.user.phone,
    audienceRegion,
    row.user.country,
    row.performance.id,
    row.performance.title,
    row.lastReservationNumber,
    row.lastReservationStatus,
    row.lastPaymentStatus ?? '',
    row.lastAffectedAt?.toISOString() ?? '',
    row.paymentFailedExpiredCount,
    row.cancelledCount,
    row.user.marketingConsent ? 'Y' : 'N',
    row.lastFailureCode ?? '',
    row.lastFailureReason ?? '',
    row.diagnosticSource ?? '',
    row.lastCancellationReason ?? '',
    row.cancellationRevenue,
    row.cancellationSource ?? '',
    row.lastAffectedReason ?? '',
  ];
}

function activeTicketManifestExportRowToCsvValues(
  row: ActiveTicketManifestExportRow,
): readonly unknown[] {
  const audienceRegion = row.user.country === 'KR' ? 'domestic' : 'overseas';

  return [
    row.ticketItem.tierName,
    row.ticketItem.seatKey,
    row.ticketItem.floorLabel,
    row.ticketItem.row,
    row.ticketItem.number,
    row.reservation.reservationNumber,
    row.user.name,
    row.user.phone,
    row.user.email,
    audienceRegion,
    row.user.country,
    row.performance.title,
    row.showtime.dateTime?.toISOString() ?? '',
    row.ticketItem.id,
    mapAdminTicketItemAdmissionState(row.ticketItem.admissionState),
    dateToIsoOrNull(row.ticketItem.enteredAt) ?? '',
  ];
}

function groupFailedCancelledContactExportRows(
  rows: FailedCancelledContactExportSourceRow[],
): FailedCancelledContactExportRow[] {
  const grouped = new Map<string, FailedCancelledContactExportRow>();

  for (const row of rows) {
    const key = `${row.user.id}:${row.performance.id}`;
    const existing = grouped.get(key);
    const rowAffectedAt = row.reservation.createdAt;
    const failedCount = isFailedOrExpiredContactRow(row) ? 1 : 0;
    const cancelledCount = row.reservation.status === 'CANCELLED' ? 1 : 0;

    if (!existing) {
      grouped.set(key, {
        user: row.user,
        performance: row.performance,
        lastReservationNumber: row.reservation.reservationNumber,
        lastReservationStatus: row.reservation.status,
        lastPaymentStatus: row.payment?.status ?? null,
        lastAffectedAt: rowAffectedAt,
        lastFailureAt: failedCount > 0 ? rowAffectedAt : null,
        lastFailureCode: isFailedOrExpiredContactRow(row)
          ? row.diagnostic?.diagnosticCode ?? null
          : null,
        lastFailureReason: isFailedOrExpiredContactRow(row)
          ? row.diagnostic?.diagnosticMessage ?? null
          : null,
        diagnosticSource: isFailedOrExpiredContactRow(row)
          ? row.diagnostic?.diagnosticSource ?? null
          : null,
        lastCancellationAt: cancelledCount > 0 ? rowAffectedAt : null,
        lastCancellationReason: row.reservation.status === 'CANCELLED'
          ? row.cancellation.reason
          : null,
        cancellationRevenue: row.reservation.status === 'CANCELLED'
          ? toInt(row.cancellation.revenue)
          : 0,
        cancellationSource: row.reservation.status === 'CANCELLED'
          ? row.cancellation.source
          : null,
        lastAffectedReason: affectedReason(row),
        paymentFailedExpiredCount: failedCount,
        cancelledCount,
      });
      continue;
    }

    existing.paymentFailedExpiredCount += failedCount;
    existing.cancelledCount += cancelledCount;

    if (failedCount > 0 && isNewerDate(rowAffectedAt, existing.lastFailureAt)) {
      existing.lastFailureAt = rowAffectedAt;
      existing.lastFailureCode = row.diagnostic?.diagnosticCode ?? null;
      existing.lastFailureReason = row.diagnostic?.diagnosticMessage ?? null;
      existing.diagnosticSource = row.diagnostic?.diagnosticSource ?? null;
    }
    if (cancelledCount > 0 && isNewerDate(rowAffectedAt, existing.lastCancellationAt)) {
      existing.lastCancellationAt = rowAffectedAt;
      existing.lastCancellationReason = row.cancellation.reason;
      existing.cancellationRevenue = toInt(row.cancellation.revenue);
      existing.cancellationSource = row.cancellation.source;
    }

    if (isNewerDate(rowAffectedAt, existing.lastAffectedAt)) {
      existing.lastReservationNumber = row.reservation.reservationNumber;
      existing.lastReservationStatus = row.reservation.status;
      existing.lastPaymentStatus = row.payment?.status ?? null;
      existing.lastAffectedAt = rowAffectedAt;
      existing.lastAffectedReason = affectedReason(row);
    }
  }

  return Array.from(grouped.values());
}

function affectedReason(row: FailedCancelledContactExportSourceRow): string | null {
  if (isFailedOrExpiredContactRow(row)) {
    return row.diagnostic?.diagnosticMessage ?? null;
  }
  if (row.reservation.status === 'CANCELLED') {
    return row.cancellation.reason;
  }
  return null;
}

function isFailedOrExpiredContactRow(row: FailedCancelledContactExportSourceRow): boolean {
  return row.reservation.status === 'FAILED'
    || (
      row.reservation.status === 'PENDING_PAYMENT'
      && ['ABORTED', 'EXPIRED', 'CANCELED'].includes(row.payment?.status ?? '')
    );
}

function isNewerDate(candidate: Date | null, current: Date | null): boolean {
  if (!candidate) {
    return false;
  }
  return !current || candidate.getTime() > current.getTime();
}

function mapTicketItemToSeatSelection(item: AdminTicketItemRow): FloorAwareSeatSelection {
  return {
    seatId: item.seatId,
    seatKey: item.seatKey,
    floorKey: item.floorKey,
    floorLabel: item.floorLabel,
    tierName: item.tierName,
    price: item.price,
    row: item.row,
    number: item.number,
  };
}

function mapReservationSeatToSeatSelection(
  seat: typeof reservationSeats.$inferSelect,
): FloorAwareSeatSelection {
  return toFloorAwareSeatSelection({
    seatId: seat.seatId,
    tierName: seat.tierName,
    price: seat.price,
    row: seat.row,
    number: seat.number,
  });
}

function countTicketStatuses(items: AdminTicketItemRow[]): AdminTicketStatusCounts {
  const counts: AdminTicketStatusCounts = {
    ACTIVE: 0,
    CANCELLATION_PENDING: 0,
    CANCELLED: 0,
    EXPIRED: 0,
  };

  for (const item of items) {
    counts[mapAdminTicketItemStatus(item.status)] += 1;
  }

  return counts;
}

function deriveAdminBookingFunnelStatus(input: {
  reservationStatus: string;
  paymentStatus: string | null;
  refundStatus: string | null;
  ticketStatusCounts: AdminTicketStatusCounts;
}): AdminBookingFunnelStatus {
  if (input.reservationStatus === 'CANCELLED') {
    return 'CANCELLED';
  }
  if (
    input.reservationStatus === 'FAILED'
    || (
      input.reservationStatus === 'PENDING_PAYMENT'
      && ['ABORTED', 'EXPIRED', 'CANCELED'].includes(input.paymentStatus ?? '')
    )
  ) {
    return 'PAYMENT_FAILED';
  }
  if (
    input.reservationStatus === 'PENDING_PAYMENT'
    && input.paymentStatus === 'IN_PROGRESS'
  ) {
    return 'PAYMENT_PROCESSING';
  }
  if (input.reservationStatus === 'PENDING_PAYMENT') {
    return 'PAYMENT_PENDING';
  }
  if (
    input.reservationStatus === 'CONFIRMED'
    && (
      input.ticketStatusCounts.CANCELLATION_PENDING > 0
      || isRefundAttentionStatus(input.refundStatus)
    )
  ) {
    return 'CANCEL_PROCESSING';
  }
  if (
    input.reservationStatus === 'CONFIRMED'
    && input.ticketStatusCounts.ACTIVE > 0
    && input.ticketStatusCounts.CANCELLED > 0
  ) {
    return 'PARTIAL_CANCELLED';
  }
  if (input.reservationStatus === 'CONFIRMED' && input.paymentStatus === 'DONE') {
    return 'SOLD';
  }
  if (input.paymentStatus === 'IN_PROGRESS') {
    return 'PAYMENT_PROCESSING';
  }
  return 'PAYMENT_PENDING';
}

function derivePaymentFailureBucket(input: {
  reservationStatus: string;
  paymentStatus: string | null;
  paymentIdPresent: boolean;
  diagnosticCode: string | null;
  diagnosticSource: string | null;
  providerExpiryWebhookReceived: boolean;
  funnelStatus: AdminBookingFunnelStatus;
}): PaymentFailureBucket | null {
  if (input.funnelStatus !== 'PAYMENT_FAILED') {
    return null;
  }

  if (input.diagnosticCode === 'ASYNC_DONE_SEAT_UNAVAILABLE_CANCELLED') {
    return 'compensated_cancel';
  }

  if (
    !input.paymentIdPresent
    && input.diagnosticCode === 'PAYMENT_DEADLINE_EXPIRED'
    && input.diagnosticSource === 'payment_webhook_events'
    && input.providerExpiryWebhookReceived
  ) {
    return 'unreconciled_provider_expired';
  }

  if (
    input.paymentStatus === 'EXPIRED'
    || input.diagnosticCode === 'PAYMENT_EXPIRED'
  ) {
    return 'provider_expired';
  }

  if (
    input.paymentStatus === 'ABORTED'
    || input.diagnosticCode === 'PAYMENT_ABORTED'
  ) {
    return 'provider_aborted';
  }

  if (
    input.paymentStatus === 'CANCELED'
    || input.diagnosticCode === 'PAYMENT_CANCELED_BEFORE_CONFIRM'
  ) {
    return 'buyer_cancelled_before_confirm';
  }

  if (
    input.diagnosticCode === 'PAYMENT_DEADLINE_EXPIRED'
    || (!input.paymentIdPresent && input.reservationStatus === 'FAILED')
  ) {
    return 'local_deadline_expired';
  }

  return 'other';
}

function isRefundAttentionStatus(status: string | null): status is AdminRefundStatus {
  return status === 'requested'
    || status === 'sent_to_pg'
    || status === 'processing_at_pg'
    || status === 'failed';
}

function mapPaymentStatusOrNull(status: string | null | undefined): PaymentStatus | null {
  if (
    status === 'READY'
    || status === 'IN_PROGRESS'
    || status === 'DONE'
    || status === 'CANCELED'
    || status === 'ABORTED'
    || status === 'EXPIRED'
  ) {
    return status;
  }
  return null;
}

function mapPaymentMethodAttribution(
  payment: Pick<typeof payments.$inferSelect, 'method' | 'provider' | 'currency'> | {
    method: string | null;
    provider: string | null;
    currency: string | null;
  } | null | undefined,
): PaymentMethodAttribution {
  const method = payment?.method?.trim() || null;
  if (!payment || !method) {
    return {
      label: '결제수단 확인 필요',
      method: null,
      provider: null,
      currency: null,
      source: payment ? 'Needs Review: payment method missing' : 'Needs Review: payment row missing',
    };
  }

  const provider = payment.provider?.trim() || null;
  const currency = payment.currency?.trim() || null;
  const labelParts = [
    paymentMethodLabel(method),
    provider ? paymentProviderLabel(provider) : null,
    currency,
  ].filter((part): part is string => Boolean(part));

  return {
    label: labelParts.join(' / ') || method,
    method,
    provider,
    currency,
    source: 'DB',
  };
}

function paymentMethodLabel(method: string): string {
  switch (method) {
    case 'CARD':
      return '카드';
    case 'VIRTUAL_ACCOUNT':
      return '가상계좌';
    case 'TRANSFER':
      return '계좌이체';
    case 'MOBILE_PHONE':
      return '휴대폰';
    case 'FOREIGN_EASY_PAY':
      return '해외간편결제';
    case 'SIMPLE_PAY':
      return '간편결제';
    default:
      return method;
  }
}

function paymentProviderLabel(provider: string): string {
  switch (provider) {
    case 'TOSS_PAY':
      return 'Toss Pay';
    case 'NAVER_PAY':
      return 'Naver Pay';
    case 'KAKAOPAY':
      return 'KakaoPay';
    case 'ALIPAY_PLUS':
      return 'Alipay+';
    case 'TRUEMONEY':
      return 'TrueMoney';
    case 'PAYPAL':
      return 'PayPal';
    case 'CARD':
      return '카드사';
    default:
      return provider;
  }
}

function mapPaymentToPaymentInfo(
  payment: Pick<
    typeof payments.$inferSelect,
    'paymentKey' | 'method' | 'amount' | 'status' | 'paidAt' | 'provider' | 'currency'
  >,
  paymentDeadlineAt: Date | null | undefined,
): PaymentInfo {
  const paymentMethod = mapStoredPaymentMethod(payment);
  return {
    paymentKey: payment.paymentKey,
    method: payment.method,
    amount: payment.amount,
    status: payment.status as PaymentStatus,
    paidAt: payment.paidAt?.toISOString() ?? null,
    paymentDeadlineAt: paymentDeadlineAt?.toISOString() ?? null,
    ...(paymentMethod ? { paymentMethod } : {}),
  };
}

function mapStoredPaymentMethod(
  payment: Pick<typeof payments.$inferSelect, 'method' | 'provider' | 'currency'>,
): PaymentMethod | undefined {
  if (!isPaymentMethodType(payment.method) || !isPaymentProvider(payment.provider)) {
    return undefined;
  }

  return {
    method: payment.method,
    provider: payment.provider,
    currency: payment.currency,
  };
}

function isPaymentMethodType(method: string): method is PaymentMethodType {
  return method === 'CARD'
    || method === 'VIRTUAL_ACCOUNT'
    || method === 'TRANSFER'
    || method === 'MOBILE_PHONE'
    || method === 'FOREIGN_EASY_PAY'
    || method === 'SIMPLE_PAY';
}

function isPaymentProvider(provider: string): provider is PaymentProvider {
  return provider === 'CARD'
    || provider === 'TOSS_PAY'
    || provider === 'NAVER_PAY'
    || provider === 'KAKAOPAY'
    || provider === 'ALIPAY_PLUS'
    || provider === 'TRUEMONEY'
    || provider === 'PAYPAL';
}

function mapTicketItemToAdminTicketItem(item: AdminTicketItemRow): AdminTicketItemDto {
  return {
    ...mapTicketItemToSeatSelection(item),
    id: item.id,
    reservationId: item.reservationId,
    paymentId: item.paymentId,
    showtimeId: item.showtimeId,
    serviceFee: item.serviceFee,
    status: mapAdminTicketItemStatus(item.status),
    admissionState: mapAdminTicketItemAdmissionState(item.admissionState),
    enteredAt: dateToIsoOrNull(item.enteredAt),
    cancelledAt: dateToIsoOrNull(item.cancelledAt),
    cancelReason: item.cancelReason ?? null,
    cancellationFee: item.cancellationFee,
    serviceFeeRefund: item.serviceFeeRefund,
    refundableAmount: item.refundableAmount,
    reopenState: mapAdminTicketItemReopenState(item.reopenState),
    reopenHoldUntil: dateToIsoOrNull(item.reopenHoldUntil),
  };
}

function mapAdminTicketItemStatus(status: string): AdminTicketItemStatus {
  switch (status) {
    case 'cancellation_pending':
      return 'CANCELLATION_PENDING';
    case 'cancelled':
      return 'CANCELLED';
    case 'expired':
      return 'EXPIRED';
    case 'active':
    default:
      return 'ACTIVE';
  }
}

function mapAdminTicketItemAdmissionState(
  admissionState: string,
): AdminTicketItemAdmissionState {
  return admissionState === 'entered' ? 'ENTERED' : 'NOT_ENTERED';
}

function mapAdminTicketItemReopenState(
  reopenState: string,
): AdminTicketItemReopenState {
  switch (reopenState) {
    case 'held_cancelled':
      return 'HELD_CANCELLED';
    case 'available':
      return 'AVAILABLE';
    case 'manual_opened':
      return 'MANUAL_OPENED';
    case 'not_required':
    default:
      return 'NOT_REQUIRED';
  }
}

function dateToIsoOrNull(date: Date | null | undefined): string | null {
  return date instanceof Date ? date.toISOString() : null;
}

function reservationExportFiltersForAudit(
  filters: AdminReservationExportFilter,
): Record<string, string> {
  const auditFilters: Record<string, string> = {};

  for (const key of [
    'eventId',
    'tierName',
    'zoneFloor',
    'reservationStatus',
    'funnelStatus',
    'audienceRegion',
    'paymentMethod',
    'dateFrom',
    'dateTo',
  ] as const) {
    const value = filters[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      auditFilters[key] = value;
    }
  }

  return auditFilters;
}

function failedCancelledContactExportFiltersForAudit(
  filters: AdminReservationExportFilter,
): Record<string, string> {
  const auditFilters: Record<string, string> = {};

  for (const key of [
    'eventId',
    'audienceRegion',
    'paymentMethod',
    'dateFrom',
    'dateTo',
  ] as const) {
    const value = filters[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      auditFilters[key] = value;
    }
  }

  return auditFilters;
}

function activeTicketManifestExportFiltersForAudit(
  filters: AdminReservationExportFilter,
): Record<string, string> {
  const auditFilters: Record<string, string> = {};
  const showtimeId = filters.showtimeId?.trim();
  if (showtimeId) {
    auditFilters.showtimeId = showtimeId;
  }
  return auditFilters;
}

function dateOnlyStart(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!) - KST_OFFSET_MS);
}

function dateOnlyEnd(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + 1) - KST_OFFSET_MS - 1);
}
