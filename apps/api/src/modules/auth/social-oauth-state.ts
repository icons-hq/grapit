import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request } from 'express';
import {
  resolveSafeSocialReturnTo,
  resolveSocialCallbackLocale,
} from './social-callback-url.js';

/**
 * Social OAuth CSRF protection.
 *
 * - The provider `state` is HMAC-signed and carries a random nonce, the provider,
 *   the issue time and the existing locale/returnTo navigation hints.
 * - The same nonce is stored in a short-lived httpOnly cookie on the API host. The
 *   callback is accepted only when the signed state, the provider and the cookie
 *   nonce all match, so a callback URL captured in another browser (login CSRF)
 *   cannot complete there.
 * - A needs_registration result additionally binds the registrationToken to a
 *   httpOnly cookie, so a forwarded `/auth/callback?registrationToken=...` link
 *   cannot attach someone else's social login to the recipient's account.
 */
export const SOCIAL_OAUTH_STATE_COOKIE = 'grabit_oauth_state';
export const SOCIAL_REGISTRATION_BINDING_COOKIE = 'grabit_social_registration';
export const SOCIAL_AUTH_COOKIE_PATH = '/api/v1/auth/social';
export const SOCIAL_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
export const SOCIAL_REGISTRATION_BINDING_TTL_MS = 30 * 60 * 1000;

const STATE_VERSION = '1';
const STATE_SIGNATURE_PARAM = 'sig';
const STATE_CLOCK_SKEW_MS = 60 * 1000;
// Used only when no JWT secret is configured (local tooling). Production always
// configures JWT_SECRET, which every instance shares.
const PROCESS_LOCAL_STATE_SECRET = randomBytes(32).toString('hex');

export type SocialOAuthStateRejection =
  | 'missing_state'
  | 'malformed_state'
  | 'bad_signature'
  | 'provider_mismatch'
  | 'expired_state'
  | 'missing_nonce_cookie'
  | 'nonce_mismatch';

export type SocialOAuthStateVerification =
  | { ok: true; locale: string | null; returnTo: string | null }
  | { ok: false; reason: SocialOAuthStateRejection };

export function resolveSocialOAuthStateSecret(configService: Pick<ConfigService, 'get'>): string {
  return (
    configService.get<string>('auth.jwtSecret') ??
    configService.get<string>('JWT_SECRET') ??
    PROCESS_LOCAL_STATE_SECRET
  );
}

export function createSocialOAuthNonce(): string {
  return randomBytes(32).toString('base64url');
}

export function socialOAuthStateCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: true,
    // The provider returns with a top-level GET navigation, which carries Lax cookies.
    sameSite: 'lax',
    path: SOCIAL_AUTH_COOKIE_PATH,
    maxAge: SOCIAL_OAUTH_STATE_TTL_MS,
  };
}

export function socialRegistrationBindingCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: true,
    // complete-registration is a credentialed fetch from the web origin, like refresh.
    sameSite: 'none',
    path: SOCIAL_AUTH_COOKIE_PATH,
    maxAge: SOCIAL_REGISTRATION_BINDING_TTL_MS,
  };
}

export function buildSignedSocialOAuthState(input: {
  provider: string;
  nonce: string;
  locale: unknown;
  returnTo: unknown;
  secret: string;
  issuedAt?: Date;
}): string {
  const params = new URLSearchParams();
  params.set('v', STATE_VERSION);
  params.set('provider', input.provider);
  params.set('nonce', input.nonce);
  params.set('iat', String(Math.floor((input.issuedAt ?? new Date()).getTime() / 1000)));
  const locale = resolveSocialCallbackLocale(input.locale);
  if (locale) params.set('locale', locale);
  const returnTo = resolveSafeSocialReturnTo(input.returnTo);
  if (returnTo) params.set('returnTo', returnTo);

  const payload = params.toString();
  return `${payload}&${STATE_SIGNATURE_PARAM}=${signStatePayload(payload, input.secret)}`;
}

export function verifySignedSocialOAuthState(
  rawState: unknown,
  input: { provider: string; nonceCookie: unknown; secret: string; now?: Date },
): SocialOAuthStateVerification {
  const state = Array.isArray(rawState) ? rawState[0] : rawState;
  if (typeof state !== 'string' || state.length === 0) {
    return { ok: false, reason: 'missing_state' };
  }

  const separator = state.lastIndexOf(`&${STATE_SIGNATURE_PARAM}=`);
  if (separator <= 0) {
    return { ok: false, reason: 'malformed_state' };
  }
  const payload = state.slice(0, separator);
  const signature = state.slice(separator + STATE_SIGNATURE_PARAM.length + 2);
  if (!safeEqual(signature, signStatePayload(payload, input.secret))) {
    return { ok: false, reason: 'bad_signature' };
  }

  const params = new URLSearchParams(payload);
  const nonce = params.get('nonce');
  const issuedAtSeconds = Number(params.get('iat'));
  if (params.get('v') !== STATE_VERSION || !nonce || !Number.isFinite(issuedAtSeconds)) {
    return { ok: false, reason: 'malformed_state' };
  }
  if (params.get('provider') !== input.provider) {
    return { ok: false, reason: 'provider_mismatch' };
  }

  const ageMs = (input.now ?? new Date()).getTime() - issuedAtSeconds * 1000;
  if (ageMs > SOCIAL_OAUTH_STATE_TTL_MS || ageMs < -STATE_CLOCK_SKEW_MS) {
    return { ok: false, reason: 'expired_state' };
  }

  if (typeof input.nonceCookie !== 'string' || input.nonceCookie.length === 0) {
    return { ok: false, reason: 'missing_nonce_cookie' };
  }
  if (!safeEqual(input.nonceCookie, nonce)) {
    return { ok: false, reason: 'nonce_mismatch' };
  }

  return {
    ok: true,
    locale: resolveSocialCallbackLocale(params.get('locale')),
    returnTo: resolveSafeSocialReturnTo(params.get('returnTo')),
  };
}

/**
 * passport-oauth2 reports an error for `query.error` and exchanges a code from
 * `query.code`; version 1.8 (used by the Google and Naver strategies) also reads
 * `body.code`. Any of them makes the request a callback whose state must be
 * verified first.
 */
export function isSocialProviderCallbackRequest(req: Pick<Request, 'query'> & { body?: unknown }): boolean {
  const query = (req.query ?? {}) as Record<string, unknown>;
  const body = (req.body !== null && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  return (
    query['code'] !== undefined ||
    query['error'] !== undefined ||
    body['code'] !== undefined ||
    body['error'] !== undefined
  );
}

export function createSocialRegistrationBinding(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSocialRegistrationBinding(binding: string): string {
  return createHash('sha256').update(`social-registration-binding:v1:${binding}`).digest('base64url');
}

export function isSocialRegistrationBindingValid(
  expectedHash: unknown,
  presentedBinding: unknown,
): boolean {
  if (typeof expectedHash !== 'string' || expectedHash.length === 0) return false;
  if (typeof presentedBinding !== 'string' || presentedBinding.length === 0) return false;
  return safeEqual(expectedHash, hashSocialRegistrationBinding(presentedBinding));
}

function signStatePayload(payload: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`social-oauth-state:v1:${payload}`)
    .digest('base64url');
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
