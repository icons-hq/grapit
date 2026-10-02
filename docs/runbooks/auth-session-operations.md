# Auth Session Operations Runbook

## Purpose

Explains how buyer sessions, social logins and login emails behave so operators can tell expected behavior from incidents around a ticket open, and lists the read-only checks to run before tightening email uniqueness.

## Refresh Token Rotation

- The web keeps the access token (15 minutes) in memory and renews it with the httpOnly `refreshToken` cookie through `POST /api/v1/auth/refresh`.
- Every refresh revokes the presented token and issues a child in the same family. The child value is derived on the server from the parent (HMAC with `JWT_REFRESH_SECRET`, falling back to `JWT_SECRET`), so concurrent or retried rotations of one parent converge on the same child.
- Rotation grace: for 30 seconds after a token is rotated, presenting it again returns the family's current active descendant (same cookie value, new access token). No row is written and the family stays active. This covers several tabs refreshing at once and a retry after a lost response.
- Reuse after the 30-second window, or reuse of a token revoked by logout, password reset, withdrawal or the device limit, still revokes the whole family (`토큰이 재사용되었습니다...`).
- Rotating `JWT_REFRESH_SECRET` (or `JWT_SECRET` when the refresh secret is unset) does not sign anyone out, but tabs that replay a pre-rotation token inside the grace window are treated as reuse. Rotate secrets outside the open window.
- Tokens rotated before this behavior was deployed have random children. Replaying one of those once more after the deploy is treated as reuse, as before.

### Web client behavior

- Tabs take turns refreshing through the Web Lock `grabit-auth-refresh` (browsers without Web Locks rely on the server grace window).
- Refresh results are classified. `401/403` (after one recheck about 300 ms later) or `204` (no cookie) signs the buyer out and sends them to `/auth` with `returnTo`. `5xx`, `429`, network errors and a 10-second timeout are temporary: the session and in-memory booking state are kept, the refresh is retried with backoff, and the original request fails with a retryable `503` toast.
- On page load the store stays uninitialized while refresh/profile retries run (about 6 seconds), so protected pages show their loading state. If the API is still unavailable the page continues signed out and the session is retried in the background (10 s, 30 s, then every 60 s) until the cookie is accepted or rejected.
- Raw CSV exports (`admin/bookings`, `admin/users`, `admin/settlement/ledger`, benefit exports) use the same refresh-and-retry path as JSON requests.

### Symptoms

| Symptom | Expected cause |
| --- | --- |
| Many tabs open at 20:00, all stay signed in | Grace window / Web Lock working |
| Buyer signed out after reopening an old device | Device limit (2 families) or reuse after grace; check `refresh_tokens.revoked_at` for the family |
| Toast `ERR-503` during an API brownout without logout | Temporary refresh failure; no action unless it persists |

## Social Login (Kakao, Naver, Google)

- `GET /api/v1/auth/social/{provider}` sets the httpOnly `grabit_oauth_state` cookie (SameSite=Lax, path `/api/v1/auth/social`, 10 minutes) and sends the provider a state signed with `JWT_SECRET` that contains the same nonce, the provider, the issue time, locale and returnTo.
- The callback is accepted only when the signature, provider, age (≤ 10 minutes) and cookie nonce all match. Otherwise the buyer lands on `/auth/callback?error=oauth_failed` before any provider code is exchanged. Opening a captured callback URL in another browser, a provider login that took longer than 10 minutes, or starting a second social login in another tab before finishing the first all produce `oauth_failed`; retrying the social login fixes it.
- A `needs_registration` result also sets the httpOnly `grabit_social_registration` cookie (SameSite=None, path `/api/v1/auth/social`, 30 minutes). `POST /api/v1/auth/social/complete-registration` is accepted only from the browser holding that cookie, so a forwarded `/auth/callback?registrationToken=...` link cannot attach someone else's social login. Failure message: `소셜 로그인 확인이 만료되었습니다. 소셜 로그인을 다시 진행해주세요.`
- Automatic linking by verified phone + birth date + name never targets accounts with `role=admin`, an admin capability bundle, or direct admin capabilities (including scanner accounts). Those buyers receive `이미 가입된 계정이 있습니다. 기존 계정으로 로그인해주세요.`
- A social login marks `users.email` verified only when the provider asserts that it verified the same address (Google `email_verified`, Kakao `is_email_verified` + `is_email_valid`). Naver does not assert verification, so new Naver accounts with a real email, and linked accounts whose stored email differs from the provider email, go through `/auth/verify-email` before booking. Provider-less placeholder addresses (`@social.grabit.com`) are never mailed.

## Login Email Case

- New signups, social sign-ups and email verification codes use the lower-case address. Login, signup duplicate checks, password reset and email verification requests look up `lower(users.email)` (index `idx_users_email_lower`, migration slot 0051), preferring the exact spelling, then an active account, then the oldest account when legacy rows differ only by case.
- Existing rows are not rewritten and there is no case-insensitive unique constraint yet.

### Read-only duplicate check (run before adding a unique constraint)

Run against the intended environment only, through the approved database access path:

```sql
SELECT lower(email) AS normalized_email, count(*) AS accounts,
       count(*) FILTER (WHERE account_status = 'active') AS active_accounts
FROM users
GROUP BY lower(email)
HAVING count(*) > 1
ORDER BY accounts DESC;
```

If the query returns rows, resolve them through the [social account merge runbook](social-account-merge.md) or an approved manual review before a later migration lowercases stored emails or adds `UNIQUE (lower(email))`. Do not paste customer emails from the result into tickets or chat.
