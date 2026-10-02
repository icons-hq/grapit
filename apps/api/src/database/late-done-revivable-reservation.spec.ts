import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
  LATE_DONE_REVIVE_WINDOW_HOURS,
  alipayFamilyReservationSql,
  lateDoneRevivableFailedReservationSql,
} from './late-done-revivable-reservation.js';
import { ACCOUNT_MERGE_PAYMENT_SETTLE_WINDOW_HOURS } from '../modules/account-merge/account-merge.service.js';

const dialect = new PgDialect();

function render(query: SQL): { sql: string; params: unknown[] } {
  const rendered = dialect.sqlToQuery(query);
  return { sql: rendered.sql.replace(/\s+/g, ' '), params: rendered.params };
}

/**
 * pay-server-5 (#44 follow-up): a FAILED Alipay-family reservation a late
 * provider DONE can still revive is one shared definition for account merge
 * and member withdrawal.
 */
describe('late DONE revivable reservation SQL', () => {
  it('keeps the 24 hour revive window, aliased by the account merge settle window', () => {
    expect(LATE_DONE_REVIVE_WINDOW_HOURS).toBe(24);
    expect(ACCOUNT_MERGE_PAYMENT_SETTLE_WINDOW_HOURS).toBe(LATE_DONE_REVIVE_WINDOW_HOURS);
  });

  it('matches only a FAILED Alipay-family reservation changed within the window', () => {
    const { sql, params } = render(lateDoneRevivableFailedReservationSql('r'));

    expect(sql).toContain("r.status = 'FAILED'");
    expect(sql).toContain('r.updated_at > now() - make_interval(hours => $1)');
    expect(params).toEqual([LATE_DONE_REVIVE_WINDOW_HOURS]);
    expect(sql).toContain(
      "upper(coalesce(r.checkout_payment_method ->> 'provider', '')) in ('ALIPAY', 'ALIPAY_PLUS')",
    );
    expect(sql).toContain('where late_done_pay.reservation_id = r.id');
    expect(sql).toContain("upper(late_done_pay.provider) in ('ALIPAY', 'ALIPAY_PLUS')");
    // Every condition is AND-ed: a card FAILED row or an older one never matches.
    expect(sql).toMatch(/r\.status = 'FAILED' and r\.updated_at > .* and \( upper\(coalesce/);
  });

  it('renders against the unaliased reservations table of a query builder select', () => {
    const { sql } = render(lateDoneRevivableFailedReservationSql('reservations'));

    expect(sql).toContain("reservations.status = 'FAILED'");
    expect(sql).toContain('reservations.updated_at > now()');
    expect(sql).toContain("reservations.checkout_payment_method ->> 'provider'");
    expect(sql).toContain('late_done_pay.reservation_id = reservations.id');
    expect(sql).not.toMatch(/\br\./);
  });

  it('defaults the Alipay-family predicate to the r alias used by account merge', () => {
    expect(render(alipayFamilyReservationSql()).sql)
      .toBe(render(alipayFamilyReservationSql('r')).sql);
  });
});
