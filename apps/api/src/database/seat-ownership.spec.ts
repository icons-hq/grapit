import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  ACTIVE_SEAT_UNIQUE_INDEX,
  isActiveSeatUniqueViolation,
  noActiveTicketItemOnSeat,
} from './seat-ownership.js';

describe('noActiveTicketItemOnSeat', () => {
  it('renders a correlated NOT EXISTS guard against active ticket items', () => {
    const rendered = new PgDialect().sqlToQuery(noActiveTicketItemOnSeat());

    expect(rendered.sql).toContain('not exists');
    expect(rendered.sql).toContain('"ticket_items"');
    expect(rendered.sql).toContain('"seat_inventories"."seat_key"');
    expect(rendered.sql).toContain("'active'");
    expect(rendered.sql).toContain("'cancellation_pending'");
  });
});

describe('isActiveSeatUniqueViolation', () => {
  it('matches a pg unique violation on the active seat index', () => {
    const error = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: ACTIVE_SEAT_UNIQUE_INDEX,
    });
    expect(isActiveSeatUniqueViolation(error)).toBe(true);
  });

  it('matches when the pg error is wrapped as a cause', () => {
    const cause = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: ACTIVE_SEAT_UNIQUE_INDEX,
    });
    expect(isActiveSeatUniqueViolation(new Error('query failed', { cause }))).toBe(true);
  });

  it('rejects other unique violations and non-errors', () => {
    expect(isActiveSeatUniqueViolation(Object.assign(new Error('x'), {
      code: '23505',
      constraint: 'idx_ticket_items_reservation_seat',
    }))).toBe(false);
    expect(isActiveSeatUniqueViolation(null)).toBe(false);
    expect(isActiveSeatUniqueViolation(new Error('plain'))).toBe(false);
  });
});
