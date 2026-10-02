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
