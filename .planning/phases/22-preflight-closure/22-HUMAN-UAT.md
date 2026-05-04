# Phase 22 Human UAT

This worksheet captures operator-run evidence for `PREF-01` launch-facing SMS, email, and legal gates. Record only redacted evidence paths, timestamps, owners, and caveats here; keep raw screenshots/logs in sanitized artifacts before linking them.

Allowed gate statuses are `PASS`, `ACCEPTED_RISK`, and `BLOCKER`. Initial rows remain `BLOCKER` until direct evidence or a fully approved accepted risk is recorded.

## Redaction Rules

`D-08` and `D-13` require evidence redaction before commit.

Never commit or paste raw OTPs, full phone numbers, full recipient email addresses, reset links, reset tokens, cookies, bearer headers, Redis URLs, Secret Manager values, R2 keys, Resend tokens, or provider secrets.

Use masked values such as `+82 10-****-1234`, `u***@gmail.com`, redacted screenshot paths, sanitized Cloud Run/Sentry references, and provider ids only when the id itself is not secret.

## Automated Guard Results

These results prove only the focused automated regression guards before manual UAT. They do not satisfy the SMS real-device, email inbox/provider, legal public/sign-off, or provider-observation gates below.

| Command | Result | Exit Status | Checked At (KST) | Owner | Output Path | Notes |
|---------|--------|-------------|------------------|-------|-------------|-------|
| `pnpm --filter @grabit/api test -- src/modules/sms/sms.service.spec.ts src/modules/auth/email/email.service.spec.ts` | GREEN | 0 | 2026-05-04T18:02:45+09:00 | Maintainer | Not saved; terminal output reviewed | Vitest completed with 29 files and 386 tests green for the API test invocation. |
| `pnpm --filter @grabit/web test -- app/auth/reset-password/__tests__/reset-password.test.tsx content/legal/__tests__/legal-content.test.ts app/legal/__tests__/metadata.test.ts components/layout/__tests__/footer.test.tsx` | GREEN | 0 | 2026-05-04T18:02:45+09:00 | Maintainer | Not saved; terminal output reviewed | Vitest completed with 27 files and 191 tests green for the web test invocation. |
| `pnpm --filter @grabit/api test:integration -- sms-cluster-crossslot` | GREEN | 0 | 2026-05-04T18:02:45+09:00 | Maintainer | Not saved; terminal output reviewed | Docker 29.1.3 was available; testcontainers Valkey cluster guard completed with 5 files and 41 tests green. |

## SMS Real-Device Gate

`D-05`: SMS `PASS` requires the real-device happy path `send-code -> SMS received -> verify-code success -> signup step3 verified`.

`D-06`: Failure-copy evidence must prove wrong-code, expired/resend, and system-error SMS copy are distinct and not collapsed into a wrong OTP message.

| Check | Status | Evidence Path | Checked At | Owner | Risk / Caveat | Next Action |
|-------|--------|---------------|------------|-------|---------------|-------------|
| D-05 happy path: `send-code -> SMS received -> verify-code success -> signup step3 verified` | BLOCKER | TBD | TBD | Maintainer | No real-device evidence recorded | Run signup on a real iOS/Android device and store redacted screenshot bundle |
| D-06 wrong-code SMS copy | BLOCKER | TBD | TBD | Maintainer | Wrong-code copy not captured | Enter an intentionally wrong code and record redacted UI/API evidence |
| D-06 expired/resend SMS copy | BLOCKER | TBD | TBD | Maintainer | Expired or resend path not captured | Let an OTP expire or trigger resend and record the displayed copy |
| D-06 system-error SMS copy | BLOCKER | TBD | TBD | Maintainer | System-error path not captured | Capture a controlled system-error response or sanitized log-backed UI evidence |

## Email Reset-To-Login Gate

`D-10`: Email `PASS` requires Resend accepted evidence plus Gmail inbox observation.

`D-11`: Naver/Daum untested or unconfirmed status may become `ACCEPTED_RISK` only when D-02 maintainer and operator approvals are recorded.

`D-12`: The verified user flow is password reset email -> reset confirm -> login with the new password. Email receipt alone is not enough.

`D-13`: Email evidence must include a redacted bundle with Resend email id, Cloud Run/Sentry result, and Gmail screenshot.

| Check | Status | Evidence Path | Checked At | Owner | Risk / Caveat | Next Action |
|-------|--------|---------------|------------|-------|---------------|-------------|
| D-10 Gmail receipt screenshot | BLOCKER | TBD | TBD | Maintainer | Gmail inbox observation not recorded | Request password reset for a registered Gmail account and save redacted screenshot |
| D-13 Resend email id | BLOCKER | TBD | TBD | Maintainer | Provider accepted id not recorded | Record sanitized Resend email id for the same reset request |
| D-12 reset confirm success | BLOCKER | TBD | TBD | Maintainer | Reset confirmation not recorded | Open the reset link, set a new password, and record redacted success evidence |
| D-12 login with the new password | BLOCKER | TBD | TBD | Maintainer | Post-reset login not recorded | Log in with the new password and record redacted browser/API evidence |
| D-13 Cloud Run/Sentry result | BLOCKER | TBD | TBD | Maintainer | Email-service observation not recorded | Check revision-scoped Cloud Run logs and Sentry `component:email-service` result |
| D-11 Naver/Daum `ACCEPTED_RISK` approval if untested | BLOCKER | TBD | TBD | Maintainer + Operator | Accepted risk requires D-02 approvals before this can change | Record maintainer approval, operator approval, owner, KST date, and residual risk |

## Legal Public And Sign-Off Gate

`D-14`: Legal technical `PASS` requires public URL checks, Footer link checks, signup/booking dialog content checks, and production robots/canonical checks.

`D-15`: Legal sign-off is factual sign-off only; external legal counsel review is outside Phase 22.

`D-16`: Legal evidence includes `support@heygrabit.com` and `privacy@heygrabit.com` mailbox receipt checks.

`D-17`: If a shipped Phase 16 legal launch surface fails, Phase 22 may include a direct fix plan; multinational consent expansion remains Phase 23+ scope.

| Check | Status | Evidence Path | Checked At | Owner | Risk / Caveat | Next Action |
|-------|--------|---------------|------------|-------|---------------|-------------|
| D-14 public URL `/legal/terms` | BLOCKER | TBD | TBD | Maintainer | Public URL response not recorded | Capture HTTP 200/body evidence for `/legal/terms` |
| D-14 public URL `/legal/privacy` | BLOCKER | TBD | TBD | Maintainer | Public URL response not recorded | Capture HTTP 200/body evidence for `/legal/privacy` |
| D-14 public URL `/legal/marketing` | BLOCKER | TBD | TBD | Maintainer | Public URL response not recorded | Capture HTTP 200/body evidence for `/legal/marketing` |
| D-14 Footer `/legal/terms` | BLOCKER | TBD | TBD | Maintainer | Footer route evidence not recorded | Click Footer terms link in production and capture redacted evidence |
| D-14 Footer `/legal/privacy` | BLOCKER | TBD | TBD | Maintainer | Footer route evidence not recorded | Click Footer privacy link in production and capture redacted evidence |
| D-14 `mailto:support@heygrabit.com` | BLOCKER | TBD | TBD | Maintainer | Support mailto evidence not recorded | Click or inspect Footer support mailto behavior |
| D-14 production robots/canonical | BLOCKER | TBD | TBD | Maintainer | Robots/canonical evidence not recorded | Capture production metadata/robots/canonical output |
| D-16 support mailbox receipt check | BLOCKER | TBD | TBD | Operator | `support@heygrabit.com` receipt not recorded | Send an external test email and record redacted inbox receipt |
| D-16 privacy mailbox receipt check | BLOCKER | TBD | TBD | Operator | `privacy@heygrabit.com` receipt not recorded | Send an external test email and record redacted inbox receipt |
| D-15 factual sign-off: business identity | BLOCKER | TBD | TBD | Operator | Business identity not approved | Compare against business registration evidence |
| D-15 factual sign-off: representative | BLOCKER | TBD | TBD | Operator | Representative not approved | Compare against business registration evidence |
| D-15 factual sign-off: business registration number | BLOCKER | TBD | TBD | Operator | Registration number not approved | Compare against business registration evidence |
| D-15 factual sign-off: mail-order registration number | BLOCKER | TBD | TBD | Operator | Mail-order registration not approved | Compare against mail-order registration evidence |
| D-15 factual sign-off: address | BLOCKER | TBD | TBD | Operator | Address not approved | Compare against registration evidence |
| D-15 factual sign-off: customer support contact | BLOCKER | TBD | TBD | Operator | Customer support contact not approved | Verify support phone/email ownership |
| D-15 factual sign-off: privacy/support mailbox | BLOCKER | TBD | TBD | Operator | Mailbox ownership not approved | Link support and privacy mailbox receipt evidence |
| D-15 factual sign-off: effective date | BLOCKER | TBD | TBD | Operator | Effective date not approved | Confirm production cutover effective date |

## Provider Observation

`D-07`: Immediately after SMS UAT, observe the last 1 hour for `sms.verify_failed`, `CROSSSLOT`, and Sentry `provider=valkey` errors.

| Check | Status | Evidence Path | Checked At | Owner | Risk / Caveat | Next Action |
|-------|--------|---------------|------------|-------|---------------|-------------|
| D-07 SMS 1-hour Cloud Run log observation | BLOCKER | TBD | TBD | Maintainer | No targeted SMS log window recorded | Query logs for `sms.verify_failed` and `CROSSSLOT` around the UAT timestamp |
| D-07 Sentry `provider=valkey` observation | BLOCKER | TBD | TBD | Maintainer | No Sentry observation recorded | Check Sentry for `provider=valkey` errors in the same 1-hour window |
| D-13 email Cloud Run/Sentry observation | BLOCKER | TBD | TBD | Maintainer | No email-service observation recorded | Query email-service failures for the reset-to-login UAT window |
| D-14 legal public-surface observation | BLOCKER | TBD | TBD | Maintainer | No production public-surface observation recorded | Save curl/browser evidence for legal URLs, Footer, robots, and canonical |

## Evidence Index

| Gate | Status | Evidence Path | Owner | Notes |
|------|--------|---------------|-------|-------|
| SMS real-device gate | BLOCKER | `.planning/phases/22-preflight-closure/22-HUMAN-UAT.md#sms-real-device-gate` | Maintainer | Fill after real-device signup OTP and failure-copy evidence |
| Email reset-to-login gate | BLOCKER | `.planning/phases/22-preflight-closure/22-HUMAN-UAT.md#email-reset-to-login-gate` | Maintainer | Fill after Gmail, Resend, reset confirm, login, and observation evidence |
| Legal public and sign-off gate | BLOCKER | `.planning/phases/22-preflight-closure/22-HUMAN-UAT.md#legal-public-and-sign-off-gate` | Operator | Fill after URL, Footer, mailbox, and factual sign-off evidence |
| Provider observation | BLOCKER | `.planning/phases/22-preflight-closure/22-HUMAN-UAT.md#provider-observation` | Maintainer | Fill after Cloud Run/Sentry/provider windows are checked |
