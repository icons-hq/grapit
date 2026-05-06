# Phase 22 Human UAT

This worksheet captures operator-run evidence for `PREF-01` launch-facing SMS, email, and legal gates. Record only redacted evidence paths, timestamps, owners, and caveats here; keep raw screenshots/logs in sanitized artifacts before linking them.

Allowed gate statuses are `PASS`, `ACCEPTED_RISK`, and `BLOCKER`. Initial rows remain `BLOCKER` until direct evidence or a fully approved accepted risk is recorded.

## Redaction Rules

`D-08` and `D-13` require evidence redaction before commit.

Never commit or paste unredacted OTP values, full phone numbers, full recipient email addresses, reset links, reset tokens, cookies, bearer headers, Redis URLs, Secret Manager values, R2 keys, Resend tokens, or provider secrets.

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
| D-05 happy path: `send-code -> SMS received -> verify-code success -> signup step3 verified` | ACCEPTED_RISK | Not collected; accepted risk per 2026-05-04 approval | 2026-05-04 KST | Maintainer + Operator | Direct real-device production/operator evidence was not collected; launch risk accepted for Phase 22 preflight closure. Maintainer approval: 2026-05-04 KST. Operator approval: 2026-05-04 KST. | Collect direct evidence before production launch/significant traffic or if a related SMS incident occurs. |
| D-06 wrong-code SMS copy | ACCEPTED_RISK | Not collected; accepted risk per 2026-05-04 approval | 2026-05-04 KST | Maintainer + Operator | Direct wrong-code UI/operator evidence was not collected; launch risk accepted for Phase 22 preflight closure. Maintainer approval: 2026-05-04 KST. Operator approval: 2026-05-04 KST. | Collect direct evidence before production launch/significant traffic or if a related SMS incident occurs. |
| D-06 expired/resend SMS copy | ACCEPTED_RISK | Not collected; accepted risk per 2026-05-04 approval | 2026-05-04 KST | Maintainer + Operator | Direct expired/resend UI/operator evidence was not collected; launch risk accepted for Phase 22 preflight closure. Maintainer approval: 2026-05-04 KST. Operator approval: 2026-05-04 KST. | Collect direct evidence before production launch/significant traffic or if a related SMS incident occurs. |
| D-06 system-error SMS copy | ACCEPTED_RISK | Not collected; accepted risk per 2026-05-04 approval | 2026-05-04 KST | Maintainer + Operator | Direct system-error UI/operator evidence was not collected; launch risk accepted for Phase 22 preflight closure. Maintainer approval: 2026-05-04 KST. Operator approval: 2026-05-04 KST. | Collect direct evidence before production launch/significant traffic or if a related SMS incident occurs. |

## Email Reset-To-Login Gate

`D-10`: Email `PASS` requires Resend accepted evidence plus Gmail inbox observation.

`D-11`: Naver/Daum untested or unconfirmed status may become `ACCEPTED_RISK` only when D-02 maintainer and operator approvals are recorded.

`D-12`: The verified user flow is password reset email -> reset confirm -> login with the new password. Email receipt alone is not enough.

`D-13`: Email evidence must include a redacted bundle with Resend email id, Cloud Run/Sentry result, and Gmail screenshot.

| Check | Status | Evidence Path | Checked At | Owner | Risk / Caveat | Next Action |
|-------|--------|---------------|------------|-------|---------------|-------------|
| D-10 Gmail receipt screenshot | ACCEPTED_RISK | Not collected; accepted risk per 2026-05-04 approval | 2026-05-04 KST | Maintainer + Operator | Direct Gmail inbox/operator evidence was not collected; launch risk accepted for Phase 22 preflight closure. Maintainer approval: 2026-05-04 KST. Operator approval: 2026-05-04 KST. | Collect direct evidence before production launch/significant traffic or if a related email incident occurs. |
| D-13 Resend email id | ACCEPTED_RISK | Not collected; accepted risk per 2026-05-04 approval | 2026-05-04 KST | Maintainer + Operator | Direct Resend provider evidence was not collected; launch risk accepted for Phase 22 preflight closure. Maintainer approval: 2026-05-04 KST. Operator approval: 2026-05-04 KST. | Collect direct evidence before production launch/significant traffic or if a related email incident occurs. |
| D-12 reset confirm success | ACCEPTED_RISK | Not collected; accepted risk per 2026-05-04 approval | 2026-05-04 KST | Maintainer + Operator | Direct reset-confirm operator evidence was not collected; launch risk accepted for Phase 22 preflight closure. Maintainer approval: 2026-05-04 KST. Operator approval: 2026-05-04 KST. | Collect direct evidence before production launch/significant traffic or if a related email incident occurs. |
| D-12 login with the new password | ACCEPTED_RISK | Not collected; accepted risk per 2026-05-04 approval | 2026-05-04 KST | Maintainer + Operator | Direct post-reset login operator evidence was not collected; launch risk accepted for Phase 22 preflight closure. Maintainer approval: 2026-05-04 KST. Operator approval: 2026-05-04 KST. | Collect direct evidence before production launch/significant traffic or if a related email incident occurs. |
| D-13 Cloud Run/Sentry result | ACCEPTED_RISK | Not collected; accepted risk per 2026-05-04 approval | 2026-05-04 KST | Maintainer + Operator | Direct email-service production observation was not collected; launch risk accepted for Phase 22 preflight closure. Maintainer approval: 2026-05-04 KST. Operator approval: 2026-05-04 KST. | Collect direct evidence before production launch/significant traffic or if a related email incident occurs. |
| D-11 Naver/Daum `ACCEPTED_RISK` approval if untested | ACCEPTED_RISK | Not collected; accepted risk per 2026-05-04 approval | 2026-05-04 KST | Maintainer + Operator | Direct Naver/Daum inbox evidence was not collected; launch risk accepted for Phase 22 preflight closure. Maintainer approval: 2026-05-04 KST. Operator approval: 2026-05-04 KST. | Recheck Naver/Daum before production launch/significant traffic or if a related email deliverability incident occurs. |

## Legal Public And Sign-Off Gate

`D-14`: Legal technical `PASS` requires public URL checks, Footer link checks, signup/booking dialog content checks, and production robots/canonical checks.

`D-15`: Legal sign-off is factual sign-off only; external legal counsel review is outside Phase 22.

`D-16`: Legal evidence includes `support@heygrabit.com` and `privacy@heygrabit.com` mailbox receipt checks.

`D-17`: If a shipped Phase 16 legal launch surface fails, Phase 22 may include a direct fix plan; multinational consent expansion remains Phase 23+ scope.

| Check | Status | Evidence Path | Checked At | Owner | Risk / Caveat | Next Action |
|-------|--------|---------------|------------|-------|---------------|-------------|
| D-14 public URL `/legal/terms` | ACCEPTED_RISK | Not collected; accepted risk per 2026-05-04 approval | 2026-05-04 KST | Maintainer + Operator | Direct legal public URL evidence was not collected; launch risk accepted for Phase 22 preflight closure. Maintainer approval: 2026-05-04 KST. Operator approval: 2026-05-04 KST. | Collect direct evidence before production launch/significant traffic or if a related legal/public-surface incident occurs. |
| D-14 public URL `/legal/privacy` | ACCEPTED_RISK | Not collected; accepted risk per 2026-05-04 approval | 2026-05-04 KST | Maintainer + Operator | Direct legal public URL evidence was not collected; launch risk accepted for Phase 22 preflight closure. Maintainer approval: 2026-05-04 KST. Operator approval: 2026-05-04 KST. | Collect direct evidence before production launch/significant traffic or if a related legal/public-surface incident occurs. |
| D-14 public URL `/legal/marketing` | ACCEPTED_RISK | Not collected; accepted risk per 2026-05-04 approval | 2026-05-04 KST | Maintainer + Operator | Direct legal public URL evidence was not collected; launch risk accepted for Phase 22 preflight closure. Maintainer approval: 2026-05-04 KST. Operator approval: 2026-05-04 KST. | Collect direct evidence before production launch/significant traffic or if a related legal/public-surface incident occurs. |
| D-14 Footer `/legal/terms` | ACCEPTED_RISK | Not collected; accepted risk per 2026-05-04 approval | 2026-05-04 KST | Maintainer + Operator | Direct Footer terms evidence was not collected; launch risk accepted for Phase 22 preflight closure. Maintainer approval: 2026-05-04 KST. Operator approval: 2026-05-04 KST. | Collect direct evidence before production launch/significant traffic or if a related legal/public-surface incident occurs. |
| D-14 Footer `/legal/privacy` | ACCEPTED_RISK | Not collected; accepted risk per 2026-05-04 approval | 2026-05-04 KST | Maintainer + Operator | Direct Footer privacy evidence was not collected; launch risk accepted for Phase 22 preflight closure. Maintainer approval: 2026-05-04 KST. Operator approval: 2026-05-04 KST. | Collect direct evidence before production launch/significant traffic or if a related legal/public-surface incident occurs. |
| D-14 `mailto:support@heygrabit.com` | ACCEPTED_RISK | Not collected; accepted risk per 2026-05-04 approval | 2026-05-04 KST | Maintainer + Operator | Direct support mailto evidence was not collected; launch risk accepted for Phase 22 preflight closure. Maintainer approval: 2026-05-04 KST. Operator approval: 2026-05-04 KST. | Collect direct evidence before production launch/significant traffic or if a related legal/public-surface incident occurs. |
| D-14 production robots/canonical | ACCEPTED_RISK | Not collected; accepted risk per 2026-05-04 approval | 2026-05-04 KST | Maintainer + Operator | Direct robots/canonical production evidence was not collected; launch risk accepted for Phase 22 preflight closure. Maintainer approval: 2026-05-04 KST. Operator approval: 2026-05-04 KST. | Collect direct evidence before production launch/significant traffic or if a related legal/public-surface incident occurs. |
| D-16 support mailbox receipt check | ACCEPTED_RISK | Not collected; accepted risk per 2026-05-04 approval | 2026-05-04 KST | Maintainer + Operator | Direct support mailbox receipt evidence was not collected; launch risk accepted for Phase 22 preflight closure. Maintainer approval: 2026-05-04 KST. Operator approval: 2026-05-04 KST. | Collect direct evidence before production launch/significant traffic or if a related legal/mailbox incident occurs. |
| D-16 privacy mailbox receipt check | ACCEPTED_RISK | Not collected; accepted risk per 2026-05-04 approval | 2026-05-04 KST | Maintainer + Operator | Direct privacy mailbox receipt evidence was not collected; launch risk accepted for Phase 22 preflight closure. Maintainer approval: 2026-05-04 KST. Operator approval: 2026-05-04 KST. | Collect direct evidence before production launch/significant traffic or if a related legal/mailbox incident occurs. |
| D-15 factual sign-off: business identity | ACCEPTED_RISK | Not collected; accepted risk per 2026-05-04 approval | 2026-05-04 KST | Maintainer + Operator | Direct business identity evidence was not collected; launch risk accepted for Phase 22 preflight closure. Maintainer approval: 2026-05-04 KST. Operator approval: 2026-05-04 KST. | Collect direct factual sign-off before production launch/significant traffic or if a related legal/operator incident occurs. |
| D-15 factual sign-off: representative | ACCEPTED_RISK | Not collected; accepted risk per 2026-05-04 approval | 2026-05-04 KST | Maintainer + Operator | Direct representative evidence was not collected; launch risk accepted for Phase 22 preflight closure. Maintainer approval: 2026-05-04 KST. Operator approval: 2026-05-04 KST. | Collect direct factual sign-off before production launch/significant traffic or if a related legal/operator incident occurs. |
| D-15 factual sign-off: business registration number | ACCEPTED_RISK | Not collected; accepted risk per 2026-05-04 approval | 2026-05-04 KST | Maintainer + Operator | Direct business registration evidence was not collected; launch risk accepted for Phase 22 preflight closure. Maintainer approval: 2026-05-04 KST. Operator approval: 2026-05-04 KST. | Collect direct factual sign-off before production launch/significant traffic or if a related legal/operator incident occurs. |
| D-15 factual sign-off: mail-order registration number | ACCEPTED_RISK | Not collected; accepted risk per 2026-05-04 approval | 2026-05-04 KST | Maintainer + Operator | Direct mail-order registration evidence was not collected; launch risk accepted for Phase 22 preflight closure. Maintainer approval: 2026-05-04 KST. Operator approval: 2026-05-04 KST. | Collect direct factual sign-off before production launch/significant traffic or if a related legal/operator incident occurs. |
| D-15 factual sign-off: address | ACCEPTED_RISK | Not collected; accepted risk per 2026-05-04 approval | 2026-05-04 KST | Maintainer + Operator | Direct address evidence was not collected; launch risk accepted for Phase 22 preflight closure. Maintainer approval: 2026-05-04 KST. Operator approval: 2026-05-04 KST. | Collect direct factual sign-off before production launch/significant traffic or if a related legal/operator incident occurs. |
| D-15 factual sign-off: customer support contact | ACCEPTED_RISK | Not collected; accepted risk per 2026-05-04 approval | 2026-05-04 KST | Maintainer + Operator | Direct customer support contact evidence was not collected; launch risk accepted for Phase 22 preflight closure. Maintainer approval: 2026-05-04 KST. Operator approval: 2026-05-04 KST. | Collect direct factual sign-off before production launch/significant traffic or if a related legal/operator incident occurs. |
| D-15 factual sign-off: privacy/support mailbox | ACCEPTED_RISK | Not collected; accepted risk per 2026-05-04 approval | 2026-05-04 KST | Maintainer + Operator | Direct privacy/support mailbox ownership evidence was not collected; launch risk accepted for Phase 22 preflight closure. Maintainer approval: 2026-05-04 KST. Operator approval: 2026-05-04 KST. | Collect direct factual sign-off before production launch/significant traffic or if a related legal/operator incident occurs. |
| D-15 factual sign-off: effective date | ACCEPTED_RISK | Not collected; accepted risk per 2026-05-04 approval | 2026-05-04 KST | Maintainer + Operator | Direct effective-date evidence was not collected; launch risk accepted for Phase 22 preflight closure. Maintainer approval: 2026-05-04 KST. Operator approval: 2026-05-04 KST. | Collect direct factual sign-off before production launch/significant traffic or if a related legal/operator incident occurs. |

## Provider Observation

`D-07`: Immediately after SMS UAT, observe the last 1 hour for `sms.verify_failed`, `CROSSSLOT`, and Sentry `provider=valkey` errors.

| Check | Status | Evidence Path | Checked At | Owner | Risk / Caveat | Next Action |
|-------|--------|---------------|------------|-------|---------------|-------------|
| D-07 SMS 1-hour Cloud Run log observation | ACCEPTED_RISK | Not collected; accepted risk per 2026-05-04 approval | 2026-05-04 KST | Maintainer + Operator | Direct SMS production log observation was not collected; launch risk accepted for Phase 22 preflight closure. Maintainer approval: 2026-05-04 KST. Operator approval: 2026-05-04 KST. | Collect direct provider observation before production launch/significant traffic or if a related SMS/provider incident occurs. |
| D-07 Sentry `provider=valkey` observation | ACCEPTED_RISK | Not collected; accepted risk per 2026-05-04 approval | 2026-05-04 KST | Maintainer + Operator | Direct Sentry provider observation was not collected; launch risk accepted for Phase 22 preflight closure. Maintainer approval: 2026-05-04 KST. Operator approval: 2026-05-04 KST. | Collect direct provider observation before production launch/significant traffic or if a related Valkey/Sentry incident occurs. |
| D-13 email Cloud Run/Sentry observation | ACCEPTED_RISK | Not collected; accepted risk per 2026-05-04 approval | 2026-05-04 KST | Maintainer + Operator | Direct email-service production observation was not collected; launch risk accepted for Phase 22 preflight closure. Maintainer approval: 2026-05-04 KST. Operator approval: 2026-05-04 KST. | Collect direct provider observation before production launch/significant traffic or if a related email/provider incident occurs. |
| D-14 legal public-surface observation | ACCEPTED_RISK | Not collected; accepted risk per 2026-05-04 approval | 2026-05-04 KST | Maintainer + Operator | Direct legal public-surface production observation was not collected; launch risk accepted for Phase 22 preflight closure. Maintainer approval: 2026-05-04 KST. Operator approval: 2026-05-04 KST. | Collect direct provider/public-surface observation before production launch/significant traffic or if a related legal/public-surface incident occurs. |

## Accepted Risk Approvals

| Gate | Maintainer Approval | Operator Approval | Risk | Review Trigger |
|------|---------------------|-------------------|------|----------------|
| SMS | 2026-05-04 KST | 2026-05-04 KST | Direct real-device SMS happy-path, failure-copy, and SMS provider observation evidence was not collected; Phase 22 preflight closure accepts the launch risk. | Collect direct SMS evidence before production launch/significant traffic or if a related SMS incident occurs. |
| Email | 2026-05-04 KST | 2026-05-04 KST | Direct Gmail receipt, Resend id, reset-confirm, post-reset login, and email-service observation evidence was not collected; Phase 22 preflight closure accepts the launch risk. | Collect direct email evidence before production launch/significant traffic or if a related email incident occurs. |
| Legal | 2026-05-04 KST | 2026-05-04 KST | Direct legal public URL, Footer/mailto, robots/canonical, mailbox receipt, and factual operator sign-off evidence was not collected; Phase 22 preflight closure accepts the launch risk. | Collect direct legal evidence before production launch/significant traffic or if a related legal incident occurs. |
| Provider Observation | 2026-05-04 KST | 2026-05-04 KST | Direct Cloud Run/Sentry/provider observation evidence for SMS, Email, and Legal surfaces was not collected; Phase 22 preflight closure accepts the launch risk. | Collect direct provider observations before production launch/significant traffic or if a related SMS/email/legal provider incident occurs. |

## Evidence Index

| Gate | Status | Evidence Path | Owner | Notes |
|------|--------|---------------|-------|-------|
| SMS real-device gate | ACCEPTED_RISK | `.planning/phases/22-preflight-closure/22-HUMAN-UAT.md#sms-real-device-gate` | Maintainer + Operator | Direct evidence not collected; accepted risk per 2026-05-04 KST approvals |
| Email reset-to-login gate | ACCEPTED_RISK | `.planning/phases/22-preflight-closure/22-HUMAN-UAT.md#email-reset-to-login-gate` | Maintainer + Operator | Direct evidence not collected; accepted risk per 2026-05-04 KST approvals |
| Legal public and sign-off gate | ACCEPTED_RISK | `.planning/phases/22-preflight-closure/22-HUMAN-UAT.md#legal-public-and-sign-off-gate` | Maintainer + Operator | Direct evidence not collected; accepted risk per 2026-05-04 KST approvals |
| Provider observation | ACCEPTED_RISK | `.planning/phases/22-preflight-closure/22-HUMAN-UAT.md#provider-observation` | Maintainer + Operator | Direct evidence not collected; accepted risk per 2026-05-04 KST approvals |
