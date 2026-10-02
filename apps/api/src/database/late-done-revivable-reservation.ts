import { sql, type SQL } from 'drizzle-orm';

/**
 * How long after its last change a FAILED Alipay-family reservation still
 * counts as revivable by a late provider DONE. The late DONE recovery itself
 * (payment.service canRecoverLateDoneReservation) has no age limit; past this
 * window the order is treated as settled.
 */
export const LATE_DONE_REVIVE_WINDOW_HOURS = 24;

/**
 * How a query names the reservations table: `r` in hand-written SQL, or
 * `reservations` (the unaliased table name drizzle renders) in a query built
 * on `from(reservations)`.
 */
export type ReservationSqlAlias = 'r' | 'reservations';

function reservationColumn(alias: ReservationSqlAlias, column: string): SQL {
  // The alias is a closed union of lowercase names and never request input,
  // so it is safe to render unquoted (as the hand-written SQL around it is).
  return sql.raw(`${alias}.${column}`);
}

/**
 * True for an Alipay-family payment attempt (the frozen checkout method or a
 * recorded payment names ALIPAY/ALIPAY_PLUS). Late provider DONE recovery
 * (payment.service canRecoverLateDoneReservation) is limited to these
 * payments.
 */
export function alipayFamilyReservationSql(alias: ReservationSqlAlias = 'r'): SQL {
  return sql`(
    upper(coalesce(${reservationColumn(alias, 'checkout_payment_method')} ->> 'provider', '')) in ('ALIPAY', 'ALIPAY_PLUS')
    or exists (
      select 1
      from payments late_done_pay
      where late_done_pay.reservation_id = ${reservationColumn(alias, 'id')}
        and upper(late_done_pay.provider) in ('ALIPAY', 'ALIPAY_PLUS')
    )
  )`;
}

/**
 * A FAILED Alipay-family reservation changed within the revive window: an
 * asynchronous DONE can still turn it into CONFIRMED and issue QR tickets.
 * Account merge counts it as a payment in flight; member withdrawal (self and
 * admin) is blocked by it like PENDING_PAYMENT, so a late DONE never confirms
 * tickets on a withdrawn account.
 */
export function lateDoneRevivableFailedReservationSql(alias: ReservationSqlAlias = 'r'): SQL {
  return sql`(
    ${reservationColumn(alias, 'status')} = 'FAILED'
    and ${reservationColumn(alias, 'updated_at')} > now() - make_interval(hours => ${LATE_DONE_REVIVE_WINDOW_HOURS})
    and ${alipayFamilyReservationSql(alias)}
  )`;
}
