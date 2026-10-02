/**
 * `errorCode` the API returns (400) when a phone verification token was
 * already used for another signup, social registration or profile change.
 * Each SMS verification backs one write, so the form must verify again.
 */
export const PHONE_VERIFICATION_TOKEN_USED = 'PHONE_VERIFICATION_TOKEN_USED';

/**
 * True for an API error whose body carries `PHONE_VERIFICATION_TOKEN_USED`.
 * Reads the parsed body (`ApiClientError.data`) structurally so callers do not
 * depend on the error class.
 */
export function isPhoneVerificationTokenUsedError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('data' in error)) return false;
  const data: unknown = (error as { data?: unknown }).data;
  return (
    typeof data === 'object'
    && data !== null
    && (data as { errorCode?: unknown }).errorCode === PHONE_VERIFICATION_TOKEN_USED
  );
}
