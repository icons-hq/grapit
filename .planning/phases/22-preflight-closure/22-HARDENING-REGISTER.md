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
| Valkey | Cloud Run -> Valkey health/lua/socketio/logs production smoke missing | `T-22-04` | No Phase 22 production smoke artifact recorded yet. | `BLOCKER` | Maintainer + Operator | N/A | Due before Phase 23 | Run `node scripts/smoke-valkey-production.mjs --checks=health,lua,socketio,logs` or record `ACCEPTED_RISK` with `D-02` approvals. |
| R2 | Production R2 local fallback or missing provider config must not be PASS | `T-22-05` | `apps/api/src/modules/admin/upload.service.ts` returns `mode: local` when `R2_ACCOUNT_ID` is missing. | `BLOCKER` | Maintainer + Operator | N/A | Due before Phase 23 | Collect R2 provider/config evidence or record `ACCEPTED_RISK` with `D-02` approvals. |
| SMS | `isPhoneVerified` is signup idempotency support only | `T-22-03` | `apps/api/src/modules/sms/sms.service.ts` stores `{sms:<e164>}:verified` for signup re-check, not standalone public auth proof. | `ACCEPTED_RISK` | Maintainer + Operator | Not recorded yet; requires `D-02` approvals | Due before Phase 23 | Record maintainer/operator acceptance or link a shipped-surface fix. |
| SMS | Real-device OTP/provider observation missing | `T-22-06` | Phase 14 code and cluster tests exist; Phase 22 real-device production evidence is not recorded yet. | `BLOCKER` | Operator | N/A | Due before Phase 23 | Complete `22-HUMAN-UAT.md` SMS gate. |
| Email | Gmail reset-to-login/provider observation missing | `T-22-06` | `apps/api/src/modules/auth/email/email.service.ts` can return Resend accepted id, but Phase 22 Gmail receipt/reset-confirm/login evidence is not recorded yet. | `BLOCKER` | Operator | N/A | Due before Phase 23 | Complete `22-HUMAN-UAT.md` Email gate. |
| Legal | Public URL/mailbox/factual sign-off missing | `T-22-06` | Phase 16 public legal routes exist, but Phase 22 public URL, support/privacy mailbox, and factual sign-off evidence is not recorded yet. | `BLOCKER` | Operator | N/A | Due before Phase 23 | Complete `22-HUMAN-UAT.md` Legal gate. |

## Debug Session Routing

| Debug Session | Route | Linked Register Area | Status | Rationale / Next Action |
|---------------|-------|----------------------|--------|-------------------------|
| `signup-sms-otp-verify-wrong` | `v2.0 risk` | SMS | `BLOCKER` until real-device gate is complete | Phase 14 code-level CROSSSLOT and failure-copy fixes exist, but Phase 22 still needs production real-device/provider observation. |
| `password-reset-email-not-delivered-prod` | `v2.0 risk` | Email | `BLOCKER` until Gmail reset-to-login evidence is complete | Phase 18 fixed production API origin; Phase 22 still needs Gmail receipt, reset confirm, login, and provider observation evidence. |
| `legal-pages-404-heygrabit` | `closed` | Legal | 404 route gap closed; sign-off evidence remains separate `BLOCKER` | Phase 16 added public legal URLs and Footer links. Phase 22 tracks mailbox/factual sign-off as a separate launch-readiness gate. |

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
