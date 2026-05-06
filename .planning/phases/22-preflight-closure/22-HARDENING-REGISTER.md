# Phase 22 Hardening Register

**Requirement:** `PREF-03`  
**Scope:** Valkey, R2, SMS, email, and legal launch-readiness fragility  
**Created:** 2026-05-04 KST  

This register applies Phase 22 decisions `D-21`, `D-22`, and `D-23`:

- `D-21`: Valkey/R2/SMS/email/legal fragile points close as a concrete fix, accepted risk, or launch blocker.
- `D-22`: Pre-existing debug sessions are closed, converted into explicit v2.0 risks, or linked to a Phase 22 fix task.
- `D-23`: Direct fixes stay on already-shipped operational surfaces only.

## Disposition Rules

Every finding closes as exactly one of `concrete fix`, `ACCEPTED_RISK`, or `BLOCKER`.

- `concrete fix` means a shipped operational surface was patched or already has direct evidence.
- `ACCEPTED_RISK` requires both maintainer technical-risk approval and operator business launch-risk approval, with owner and KST date recorded.
- `BLOCKER` requires an owner and next action before Phase 23 launch work can treat the surface as ready.
- Missing production/provider/operator evidence is never a `PASS` equivalent. It remains `BLOCKER` or becomes `ACCEPTED_RISK` only after `D-02` approvals.
- Evidence must be redacted. Do not record raw Redis URLs, auth headers, cookies, JWTs, OTPs, full phone numbers, reset links, reset tokens, customer emails, R2 keys, Resend keys, or Cloud Run secret values.

## Register

| Area | Finding | Threat Ref | Evidence | Disposition | Owner | Accepted By | Checked At / Due | Next Action |
|------|---------|------------|----------|-------------|-------|-------------|------------------|-------------|
| Valkey | Production smoke artifact path defaulted to Phase 20 path | `T-22-04` | `scripts/smoke-valkey-production.mjs defaultArtifactUrl -> .planning/phases/22-preflight-closure/artifacts/valkey-smoke.md` | `concrete fix` | Maintainer | N/A | 2026-05-04 KST | Re-run help/default-path verification after commit. |
| Valkey | Cloud Run -> Valkey health/lua/socketio/logs production smoke missing | `T-22-04` | No Phase 22 production smoke artifact recorded yet. | `ACCEPTED_RISK` | Maintainer + Operator | Maintainer + Operator, 2026-05-04 KST | 2026-05-04 KST | Run `node scripts/smoke-valkey-production.mjs --checks=health,lua,socketio,logs` before production launch/significant traffic or if a related Valkey incident occurs. |
| R2 | Production R2 local fallback or missing provider config must not be PASS | `T-22-05` | `apps/api/src/modules/admin/upload.service.ts` returns `mode: local` when `R2_ACCOUNT_ID` is missing. | `ACCEPTED_RISK` | Maintainer + Operator | Maintainer + Operator, 2026-05-04 KST | 2026-05-04 KST | Collect R2 provider/config evidence before production launch/significant traffic or if a related upload/storage incident occurs. |
| SMS | `isPhoneVerified` is signup idempotency support only | `T-22-03` | `apps/api/src/modules/sms/sms.service.ts` stores `{sms:<e164>}:verified` for signup re-check, not standalone public auth proof. | `ACCEPTED_RISK` | Maintainer + Operator | Maintainer + Operator, 2026-05-04 KST | 2026-05-04 KST | Keep `isPhoneVerified` scoped to signup idempotency and collect direct SMS evidence before production launch/significant traffic. |
| SMS | Real-device OTP/provider observation missing | `T-22-06` | Phase 14 code and cluster tests exist; Phase 22 real-device production evidence is not recorded yet. | `ACCEPTED_RISK` | Maintainer + Operator | Maintainer + Operator, 2026-05-04 KST | 2026-05-04 KST | Collect direct SMS real-device/provider evidence before production launch/significant traffic or if a related SMS incident occurs. |
| Email | Gmail reset-to-login/provider observation missing | `T-22-06` | `apps/api/src/modules/auth/email/email.service.ts` can return Resend accepted id, but Phase 22 Gmail receipt/reset-confirm/login evidence is not recorded yet. | `ACCEPTED_RISK` | Maintainer + Operator | Maintainer + Operator, 2026-05-04 KST | 2026-05-04 KST | Collect direct Gmail/Resend/reset-to-login/provider evidence before production launch/significant traffic or if a related email incident occurs. |
| Legal | Public URL/mailbox/factual sign-off missing | `T-22-06` | Phase 16 public legal routes exist, but Phase 22 public URL, support/privacy mailbox, and factual sign-off evidence is not recorded yet. | `ACCEPTED_RISK` | Maintainer + Operator | Maintainer + Operator, 2026-05-04 KST | 2026-05-04 KST | Collect direct legal public/mailbox/factual sign-off evidence before production launch/significant traffic or if a related legal incident occurs. |

## Debug Session Routing

| Debug Session | Route | Linked Register Area | Status | Rationale / Next Action |
|---------------|-------|----------------------|--------|-------------------------|
| `signup-sms-otp-verify-wrong` | `v2.0 risk` | SMS | `ACCEPTED_RISK` until real-device gate is directly evidenced | Phase 14 code-level CROSSSLOT and failure-copy fixes exist; missing Phase 22 production real-device/provider observation is accepted by maintainer and operator on 2026-05-04 KST. |
| `password-reset-email-not-delivered-prod` | `v2.0 risk` | Email | `ACCEPTED_RISK` until Gmail reset-to-login evidence is directly evidenced | Phase 18 fixed production API origin; missing Phase 22 Gmail receipt, reset confirm, login, and provider observation evidence is accepted by maintainer and operator on 2026-05-04 KST. |
| `legal-pages-404-heygrabit` | `closed` | Legal | 404 route gap closed; missing sign-off evidence is `ACCEPTED_RISK` | Phase 16 added public legal URLs and Footer links. Phase 22 tracks mailbox/factual sign-off as accepted launch risk until direct evidence is collected. |

## Smoke And Evidence Commands

Default Valkey smoke artifact:

```bash
.planning/phases/22-preflight-closure/artifacts/valkey-smoke.md
```

Required production smoke command shape:

```bash
node scripts/smoke-valkey-production.mjs --checks=health,lua,socketio,logs
```

If an operator uses an explicit artifact path, keep it under `.planning/phases/22-preflight-closure/`:

```bash
GRABIT_SMOKE_ARTIFACT=.planning/phases/22-preflight-closure/artifacts/valkey-smoke.md node scripts/smoke-valkey-production.mjs --checks=health,lua,socketio,logs
```

Before committing evidence, verify the artifact is redacted and contains only command shape, revision/mode summaries, PASS/FAIL status, sanitized log snippets, and evidence paths.
