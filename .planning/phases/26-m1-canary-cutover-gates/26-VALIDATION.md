---
phase: 26
slug: m1-canary-cutover-gates
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-20
---

# Phase 26 - Validation Strategy

Per-phase validation contract for Phase 26 planning and execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest for API/shared/web unit tests; Playwright for web E2E; k6 for load thresholds; CLI/provider evidence for production ops gates. |
| **Config file** | `apps/api/vitest.config.ts`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`; k6 scripts to be added under `scripts/k6/`. |
| **Quick run command** | `pnpm --filter @grabit/api test`, `pnpm --filter @grabit/web test`, plus targeted scripts introduced by Phase 26 plans. |
| **Full suite command** | `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, selected Playwright smoke, and k6 baseline/stress gates when environment access is available. |
| **Estimated runtime** | Local unit/type/lint/build: repo-dependent; provider/load gates require explicit operator window. |

---

## Sampling Rate

- **After every task commit:** Run the package-specific Vitest or validator command for touched files.
- **After every plan wave:** Run `pnpm test`, targeted Playwright smoke, and all new Phase 26 scripts in dry-run mode where possible.
- **Before `$gsd-verify-work`:** Full suite must be green; Gate Ledger must have every required row accounted for.
- **Max feedback latency:** Code-only tasks should get feedback in minutes; provider/load/DR gates must record exact evidence timestamps and operator prerequisites.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 26-W0-M1 | 26-07 Task 1-3; 26-11 Task 1-2; 26-12 Task 1-3 | 2-3 | M1-01 | T-26-DEPLOY, T-26-11, T-26-12 | Direct deploy watch proves health/auth/session/public detail/booking-disabled/queue/payment-safe paths without traffic-split canary; admin Gate Ledger UI exposes the no-go state. | E2E + ops smoke + admin API/UI | `CI=1 TZ=UTC pnpm --filter @grabit/web test:e2e -- phase26-m1-smoke.spec.ts`; `node scripts/phase26/direct-deploy-watch.mjs --help`; admin cutover API/UI tests | planned | planned |
| 26-W0-LOAD | 26-06 Task 1-3 | 4 | LOAD-01 | T-26-LOAD | k6 10k baseline and 20k stress gates enforce p95 < 2s and error rate < 1%, or ledger blocks/records accepted risk. | load | `docker run --rm -i grafana/k6 run - < scripts/k6/phase26-baseline.js` and stress variant | planned | planned |
| 26-W0-DR | 26-08 Task 1-3 | 2 | DR-01 | T-26-DR | Cloud Run rollback, Cloud SQL PITR/restore, and Valkey reconnect/failure evidence are captured against safe targets. | ops drill | GCP commands with explicit `--project=grapit-491806` plus Valkey smoke | planned | planned |
| 26-W0-INFRA | 26-08 Task 1-3; 26-10 Task 1 | 2, 5 | INFRA-01 | T-26-INFRA | pgBouncer, HA/read replica, and DB pool sizing are either drilled, config-evidenced, or ledgered as non-PASS states. | config + ops evidence | `node scripts/phase26/infra-evidence.mjs --help`; final cutover readiness check | planned | planned |
| 26-W0-OPS1 | 26-09 Task 1-2; 26-11 Task 1-2; 26-12 Task 1-3 | 2-3 | OPS-01 | T-26-OPS, T-26-11, T-26-12 | Sentry, Cloud Run logs, Cloudflare, business metrics, 1-person playbooks, and admin visibility have dry-run/read evidence. | ops smoke + admin UI | `node scripts/phase26/monitoring-evidence.mjs --help`; admin cutover route smoke | planned | planned |
| 26-W0-PAY | 26-02 Task 1-3; 26-03 Task 1-3; 26-04 Task 1-3; 26-05 Task 1-3; 26-10 Task 1-3 | 2-5 | PAY-01 | T-26-PAY | Toss test/live cutover preserves server-side amount verification, server-only secrets, webhook re-query, idempotency, QR visibility, and `BOOKING_ENABLED` no-go semantics. | integration + ops smoke | Payment/QR targeted Vitest, QR Playwright, rehearsal smoke, live-key cutover readiness | planned | planned |
| 26-W0-OPS2 | 26-09 Task 3; 26-10 Task 1-3; 26-12 Task 1-3 | 3, 5 | OPS-02 | T-26-WATCH | First-2h intensive and first-24h periodic monitoring checks queue/payment/seat/QR/Cloud Run/Sentry/Cloudflare and close-booking triggers; admin UI surfaces current state. | runbook + manual ops + admin UI | `rg` checks for `26-FIRST-24H-WATCH.md`; `node scripts/phase26/cutover-readiness.mjs --booking-enabled-check`; admin cutover route smoke | planned | planned |

*Status: pending, green, red, flaky.*

---

## Wave 0 Requirements

- [x] `scripts/phase26/validate-gate-ledger.mjs` - covered by 26-01 Task 2; validates required gate rows and preserves `PASS`, `FAIL`, `ACCEPTED_RISK`, `CONFIG_READY_NOT_DRILLED`, and `BLOCKED` without collapsing them.
- [x] Admin Gate Ledger/cutover UI - covered by 26-11 and 26-12; exposes read-only server-derived readiness, blocker-first rows, and disabled final cutover action.
- [x] `scripts/k6/phase26-baseline.js` and `scripts/k6/phase26-stress.js` - covered by 26-06 Task 1; encode LOAD-01 thresholds and export evidence.
- [x] QR visibility smoke for payment complete page and My Page/ticket detail - covered by 26-02 and 26-03; covers D-25 through D-27.
- [x] API tests or smoke scripts for Toss `Idempotency-Key` on POST confirm/cancel and Toss webhook `queryPayment(paymentKey)` re-verification - covered by 26-04 Task 1-2.
- [x] `scripts/phase26/cleanup-dry-run.sql` or equivalent guarded cleanup plan - covered by 26-05 Task 1; constrains rehearsal cleanup to dedicated test event/order markers and stops on unexpected rows.
- [x] `26-FIRST-24H-WATCH.md` or equivalent runbook/checklist - covered by 26-09 Task 3; covers first-2h and first-24h monitoring cadence and close-booking triggers.
- [x] Locale scope decision/test update - covered by 26-07 Task 1 and 26-01 Gate Ledger `M1_LOCALE_SCOPE`; reconciles four active public locales in code with older five-locale success wording before M1 smoke can pass.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Toss live-key presence and live-key smoke | PAY-01 | Toss review/live keys are external provider state and must not be stored in repo artifacts. | Verify key prefixes and server-only secret injection, run payment-safe smoke with `BOOKING_ENABLED=false`, then record redacted evidence in the Gate Ledger. |
| Cloudflare WAF/rate-limit active-rule evidence | OPS-01, M1-01 | Requires Cloudflare zone access and must avoid impacting real users. | Capture normal-pass smoke and low-volume suspicious challenge/block/rate-limit evidence with rule IDs redacted if needed. |
| Cloud SQL PITR/restore and HA/read replica evidence | DR-01, INFRA-01 | Requires GCP project access and safe target selection. | Use explicit `--project=grapit-491806`; restore to safe target or classify as `CONFIG_READY_NOT_DRILLED`/`ACCEPTED_RISK` in the ledger. |
| k6 10k/20k load gates | LOAD-01 | Requires operator-approved target, timing, credentials, and production-like environment. | Run dedicated test-event scenarios only; record p95/error-rate results or block cutover. |
| First-24h monitoring | OPS-02 | It is a real-time operations window after opening ticketing. | Follow first-2h 5-10 minute checks, then 30-60 minute checks until 24 hours; close booking on financial/seat safety triggers. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies.
- [x] Sampling continuity: no 3 consecutive implementation tasks without automated or evidence-producing verification.
- [x] Wave 0 covers all missing references above.
- [x] No watch-mode flags in verification commands.
- [x] Gate Ledger validates every required cutover gate before `BOOKING_ENABLED=true`.
- [x] `nyquist_compliant: true` set in frontmatter after the planner maps validation rows to concrete tasks.

**Approval:** planner revision complete; execution still must produce the evidence before any gate can be marked PASS.
