// Naver can append the decoded state directly to its callback query string.
// Wrap the entire signed state in a URL-safe alphabet so its '&' fields remain
// one parameter. This is transport encoding, not a replacement for verification.
const NAVER_STATE_PREFIX = 'naver1.';

export function encodeNaverOAuthState(state: string): string {
  return `${NAVER_STATE_PREFIX}${Buffer.from(state, 'utf8').toString('base64url')}`;
}

export function decodeSocialOAuthState(value: unknown): string | null {
  const rawState = Array.isArray(value) ? value[0] : value;
  if (typeof rawState !== 'string') return null;
  // Keep existing signed states readable for other providers and in-flight logins.
  if (!rawState.startsWith(NAVER_STATE_PREFIX)) return rawState;

  const encoded = rawState.slice(NAVER_STATE_PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return rawState;
  const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
  // Buffer decoding is permissive; accept only the canonical UTF-8 representation.
  return Buffer.from(decoded, 'utf8').toString('base64url') === encoded
    ? decoded
    : rawState;
}
