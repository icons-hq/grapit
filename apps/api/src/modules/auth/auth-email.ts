import { sql } from 'drizzle-orm';
import type { DrizzleDB } from '../../database/drizzle.provider.js';

/**
 * Canonical form used when Grabit stores or compares a login email.
 *
 * Mailbox providers used by buyers treat the address case-insensitively, so new
 * accounts, verification codes and provider-email comparisons use the lower-case
 * form. Lookups keep accepting legacy rows that were stored with mixed case (see
 * UserRepository.findByEmail), so no existing row has to be rewritten.
 */
export function normalizeAuthEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isSameAuthEmail(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) return false;
  return normalizeAuthEmail(left) === normalizeAuthEmail(right);
}

/**
 * Serializes every write that gives an account a login email (sign-up, social
 * sign-up, account email change) on the canonical lower-case address, until
 * the caller's transaction ends.
 *
 * There is no `UNIQUE (lower(email))` (legacy rows may differ only by case;
 * see the duplicate check in docs/runbooks/auth-session-operations.md), so the
 * duplicate check is a `lower(email)` read before the write. Without this lock
 * two concurrent claims of a free address both pass that check, and only the
 * exact `users_email_unique` constraint stops the loser: a raw unique
 * violation (500) after its email verification code was already spent. The
 * caller takes the lock first and re-checks the address with the same
 * transaction, so the loser sees the winner's committed row and answers 409
 * without spending anything.
 */
export async function lockAuthEmailClaim(
  tx: Pick<DrizzleDB, 'execute'>,
  email: string,
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`auth-email:${normalizeAuthEmail(email)}`}, 0))`,
  );
}
