# Phase 23 Canary Rollback Runbook

## Purpose

Phase 23 canary deploys must prove that the launch foundation preserves existing production behavior while `BOOKING_ENABLED=false` blocks scarce booking/payment resources.

This runbook is the strict D-02 gate: if any smoke fails, rollback immediately and do not mark Phase 23 as PASS.

## Scope

- Applies to Phase 23 canary, progressive traffic shift, and post-shift smoke.
- Preserves Phase 22 `ACCEPTED_RISK` caveats as not-PASS evidence until direct proof is collected.
- Evidence must be redacted. Do not store raw access tokens, refresh cookies, OTP values, reset links, payment keys, or unmasked PII.

## Preconditions

- Canary revision is deployed with a revision tag.
- Production traffic shift starts at the planned canary percentage.
- `BOOKING_ENABLED=false` is present in the API runtime environment unless an approved cutover gate explicitly changes it.
- Operator has a safe test account and safe non-live booking fixture.

## Smoke Checks

### 1. auth/session

Goal: existing auth/session behavior survives the canary.

Checks:

- Login succeeds for the safe test account.
- `/auth/refresh` renews the session using the httpOnly refresh cookie.
- `/users/me` returns the same user after refresh.
- Logout invalidates the session and does not leave a usable refresh family.

PASS evidence:

- Timestamp, canary revision, redacted user identifier, HTTP statuses.
- No raw cookies, tokens, passwords, or OAuth provider payloads.

FAIL examples:

- Login fails for a previously valid account.
- Refresh returns unexpected 401/403.
- Session user changes unexpectedly.

### 2. booking-disabled API

Goal: direct API mutation attempts are blocked while advertising is open.

Checks:

- Seat lock mutation returns HTTP 403 with `예매는 5월말 오픈 예정입니다`.
- Reservation prepare returns HTTP 403 before pending reservation creation.
- Payment confirm returns HTTP 403 before confirm lock acquisition or Toss `confirmPayment`.
- No new Redis seat lock, pending reservation, payment row, or sold seat inventory is created by the smoke attempt.

PASS evidence:

- Redacted request IDs, HTTP 403 responses, and before/after mutation counts.
- Evidence that `BOOKING_ENABLED=false` was read by API runtime, not from any `NEXT_PUBLIC_*` value.

FAIL examples:

- Any booking mutation returns 2xx.
- Redis lock, DB transaction, pending reservation, payment row, sold inventory, or Toss side effect is observed.

### 3. Korean root URL

Goal: Korean root URL behavior remains stable for production SEO and existing users.

Checks:

- `https://heygrabit.com/` returns the Korean public surface without redirecting to a locale prefix.
- Existing Korean URLs remain reachable.
- Authenticated Korean session navigation does not force `/ko`.
- Canonical/hreflang output keeps Korean root URL as the default/root URL.

PASS evidence:

- HTTP status, final URL, selected page title/locale markers, and canary revision.

FAIL examples:

- `/` redirects to `/ko`, `/en`, `/th`, `/zh-CN`, or `/zh-TW`.
- Existing Korean routes return 404/500 or change canonical URL incorrectly.

### 4. locale routing

Goal: foreign locale routes work without automatic redirect from Korean root.

Checks:

- `/en`, `/th`, `/zh-CN`, and `/zh-TW` resolve successfully.
- Locale switch preserves the intended route and updates visible locale state.
- Accept-Language or GeoIP may show a suggestion, but it must not auto-navigate.
- Session/cookie locale preference does not break Korean root URL preservation.

PASS evidence:

- HTTP statuses, final URLs, visible locale markers, and redacted session/cookie state.

FAIL examples:

- Foreign locale route 404/500.
- Korean root auto-redirects.
- Locale switch causes auth/session loss.

## Rollback Rule

If any smoke check fails:

1. Stop traffic increase immediately.
2. Roll traffic back to the last known-good revision.
3. Record the failed smoke category, canary revision, previous revision, timestamp, and redacted evidence.
4. Keep Phase 22 `ACCEPTED_RISK` caveats as not-PASS evidence.
5. Do not retry traffic shift until the root cause is fixed and the full smoke set passes.
6. Do not mark Phase 23 as PASS.

Exact gate phrase: if any smoke fails, rollback immediately and do not mark Phase 23 as PASS.

## PASS Rule

Phase 23 canary can be marked PASS only when all four D-02 smoke categories pass:

- auth/session
- booking-disabled API
- Korean root URL
- locale routing

Accepted risk is not PASS evidence. A caveat can remain documented, but it cannot substitute for direct smoke evidence.
