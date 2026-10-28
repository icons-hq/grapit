import { createPublicKey, createSecretKey, type KeyObject } from 'node:crypto';

/**
 * Prepare the configured server key once, not once per request. This is the
 * same public-key-then-HMAC interpretation jsonwebtoken 9 uses for a string.
 * Only key material is prepared; signatures, algorithms and expiry are still
 * verified by jsonwebtoken for every token.
 */
export function prepareJwtVerificationKey(secret: string): KeyObject {
  if (!secret) throw new Error('A JWT verification key is required');
  try {
    return createPublicKey(secret);
  } catch {
    return createSecretKey(Buffer.from(secret));
  }
}
