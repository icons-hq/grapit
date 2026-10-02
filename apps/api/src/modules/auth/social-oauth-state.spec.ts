import { describe, expect, it } from 'vitest';
import {
  SOCIAL_OAUTH_STATE_TTL_MS,
  buildSignedSocialOAuthState,
  hashSocialRegistrationBinding,
  isSocialProviderCallbackRequest,
  isSocialRegistrationBindingValid,
  verifySignedSocialOAuthState,
} from './social-oauth-state.js';
import { resolveSocialCallbackState } from './social-callback-url.js';

const secret = 'test-state-secret';
const issuedAt = new Date('2026-10-01T11:00:00.000Z');

function issue(overrides: Partial<Parameters<typeof buildSignedSocialOAuthState>[0]> = {}) {
  return buildSignedSocialOAuthState({
    provider: 'naver',
    nonce: 'nonce-from-cookie',
    locale: 'th',
    returnTo: '/th/booking/show-1/confirm?resumeOrderId=GRP-1',
    secret,
    issuedAt,
    ...overrides,
  });
}

describe('social OAuth state', () => {
  it('accepts the state only with the same provider, nonce cookie and secret', () => {
    const state = issue();

    expect(
      verifySignedSocialOAuthState(state, { provider: 'naver', nonceCookie: 'nonce-from-cookie', secret, now: issuedAt }),
    ).toEqual({ ok: true, locale: 'th', returnTo: '/th/booking/show-1/confirm?resumeOrderId=GRP-1' });
    expect(
      verifySignedSocialOAuthState(state, { provider: 'naver', nonceCookie: 'nonce-from-cookie', secret: 'other-secret', now: issuedAt }),
    ).toEqual({ ok: false, reason: 'bad_signature' });
    expect(
      verifySignedSocialOAuthState(state, { provider: 'kakao', nonceCookie: 'nonce-from-cookie', secret, now: issuedAt }),
    ).toEqual({ ok: false, reason: 'provider_mismatch' });
    expect(
      verifySignedSocialOAuthState(state, { provider: 'naver', nonceCookie: undefined, secret, now: issuedAt }),
    ).toEqual({ ok: false, reason: 'missing_nonce_cookie' });
    expect(
      verifySignedSocialOAuthState(state, { provider: 'naver', nonceCookie: 'attacker-nonce', secret, now: issuedAt }),
    ).toEqual({ ok: false, reason: 'nonce_mismatch' });
  });

  it('expires exactly after the state lifetime', () => {
    const state = issue();
    const verifyAt = (offsetMs: number) =>
      verifySignedSocialOAuthState(state, {
        provider: 'naver',
        nonceCookie: 'nonce-from-cookie',
        secret,
        now: new Date(issuedAt.getTime() + offsetMs),
      });

    expect(verifyAt(SOCIAL_OAUTH_STATE_TTL_MS).ok).toBe(true);
    expect(verifyAt(SOCIAL_OAUTH_STATE_TTL_MS + 1)).toEqual({ ok: false, reason: 'expired_state' });
  });

  it.each([
    ['missing', undefined, 'missing_state'],
    ['legacy locale-only', 'ko', 'malformed_state'],
    ['legacy unsigned params', 'locale=ko&returnTo=%2Fbooking', 'malformed_state'],
  ])('rejects a %s state', (_label, state, reason) => {
    expect(
      verifySignedSocialOAuthState(state, { provider: 'naver', nonceCookie: 'nonce-from-cookie', secret, now: issuedAt }),
    ).toEqual({ ok: false, reason });
  });

  it('keeps locale and returnTo readable for existing callback redirects', () => {
    expect(resolveSocialCallbackState(issue())).toEqual({
      locale: 'th',
      returnTo: '/th/booking/show-1/confirm?resumeOrderId=GRP-1',
    });
  });

  it('treats a request as a provider callback whenever passport would exchange or report a code', () => {
    expect(isSocialProviderCallbackRequest({ query: { code: 'x' } } as never)).toBe(true);
    expect(isSocialProviderCallbackRequest({ query: { error: 'access_denied' } } as never)).toBe(true);
    expect(isSocialProviderCallbackRequest({ query: { locale: 'ko' } } as never)).toBe(false);
  });

  it('validates the registration binding cookie against the hash carried in the token', () => {
    const hash = hashSocialRegistrationBinding('browser-binding');

    expect(isSocialRegistrationBindingValid(hash, 'browser-binding')).toBe(true);
    expect(isSocialRegistrationBindingValid(hash, 'another-browser')).toBe(false);
    expect(isSocialRegistrationBindingValid(hash, undefined)).toBe(false);
    expect(isSocialRegistrationBindingValid(undefined, 'browser-binding')).toBe(false);
  });
});
