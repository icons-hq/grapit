import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
  countBuyerActiveTicketsForPerformance,
  getTicketLimitSnapshot,
  lockTicketLimitScope,
} from './ticket-limit.js';

const PHONE_SUFFIX_EXPRESSION =
  "right(regexp_replace(translate(phone, '０１２３４５６７８９', '0123456789'), '[^0-9]', '', 'g'), 8)";

function executorReturning(row: Record<string, unknown>) {
  return { execute: vi.fn().mockResolvedValue({ rows: [row] }) };
}

function renderedSql(executor: { execute: ReturnType<typeof vi.fn> }): string {
  return new PgDialect().sqlToQuery(executor.execute.mock.calls[0]?.[0] as SQL).sql;
}

describe('ticket limit buyer identity (audit #62)', () => {
  it('adds tickets of other accounts that verified the same phone in another format', async () => {
    const executor = executorReturning({
      active_ticket_count: 0,
      buyer_phone: '+821012345678',
      buyer_phone_verified: true,
      linked_phone_accounts: [
        { phone: '010-1234-5678', active_ticket_count: 1 },
        { phone: '+82 (0)10 1234 5678', active_ticket_count: 2 },
      ],
    });

    await expect(countBuyerActiveTicketsForPerformance(executor, 'user-b', 'performance-1'))
      .resolves.toBe(3);
  });

  it('ignores accounts that only share the last digits of a different number', async () => {
    const executor = executorReturning({
      active_ticket_count: 1,
      buyer_phone: '+821012345678',
      buyer_phone_verified: true,
      linked_phone_accounts: [
        { phone: '+66812345678', active_ticket_count: 4 },
        { phone: 'not-a-phone-12345678', active_ticket_count: 4 },
      ],
    });

    await expect(countBuyerActiveTicketsForPerformance(executor, 'user-b', 'performance-1'))
      .resolves.toBe(1);
  });

  it('keeps the account-only limit when the buyer phone is not verified', async () => {
    const executor = executorReturning({
      active_ticket_count: 1,
      buyer_phone: '+821012345678',
      buyer_phone_verified: false,
      linked_phone_accounts: [{ phone: '+821012345678', active_ticket_count: 3 }],
    });

    await expect(countBuyerActiveTicketsForPerformance(executor, 'user-b', 'performance-1'))
      .resolves.toBe(1);
  });

  it('applies the same identity sum to the confirm-time snapshot', async () => {
    const executor = executorReturning({
      performance_id: 'performance-1',
      max_tickets_per_user: 1,
      active_ticket_count: 0,
      buyer_phone: '01012345678',
      buyer_phone_verified: true,
      linked_phone_accounts: [{ phone: '+821012345678', active_ticket_count: 1 }],
    });

    await expect(getTicketLimitSnapshot(executor, 'user-b', 'reservation-b', 'showtime-1'))
      .resolves.toEqual({ performanceId: 'performance-1', maxTicketsPerUser: 1, activeTicketCount: 1 });
    expect(renderedSql(executor)).toContain('r.id <> $');
  });

  it('only groups verified accounts and narrows them with the indexed phone suffix', async () => {
    const executor = executorReturning({ active_ticket_count: 0 });
    await countBuyerActiveTicketsForPerformance(executor, 'user-b', 'performance-1');
    const rendered = renderedSql(executor);

    expect(rendered).toContain('linked.is_phone_verified = true');
    expect(rendered).toContain('buyer.is_phone_verified = true');
    expect(rendered).toContain(PHONE_SUFFIX_EXPRESSION.replace('(phone,', '(linked.phone,'));
  });

  it('serializes every account of one verified phone under the same advisory lock scope', async () => {
    const executor = { execute: vi.fn().mockResolvedValue({ rows: [] }) };
    await lockTicketLimitScope(executor, 'user-b', 'performance-1');
    const rendered = renderedSql(executor);

    expect(rendered).toContain('pg_advisory_xact_lock');
    expect(rendered).toContain(`'phone:' || ${PHONE_SUFFIX_EXPRESSION.replace('(phone,', '(buyer.phone,')}`);
    expect(rendered).toContain('buyer.is_phone_verified = true');
  });

  it('keeps the SQL expression byte-identical to the migration 0039 index', () => {
    const migration = readFileSync(
      resolve(__dirname, 'migrations/0039_buyer_phone_identity_and_admission_token_cleanup.sql'),
      'utf8',
    );

    expect(migration).toContain(`ON users ((${PHONE_SUFFIX_EXPRESSION}))`);
    expect(migration).toContain('WHERE is_phone_verified = true');
  });
});
