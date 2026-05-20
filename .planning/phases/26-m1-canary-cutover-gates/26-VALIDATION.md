---
phase: 26
slug: m1-canary-cutover-gates
status: draft
nyquist_compliant: false
wave_0_complete: false
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
| 26-W0-M1 | TBD | 0 | M1-01 | T-26-DEPLOY | Direct deploy watch proves health/auth/session/public detail/booking-disabled/queue/payment-safe paths without traffic-split canary. | E2E + ops smoke | Targeted Playwright smoke plus Phase 26 watch script | Partial | pending |
| 26-W0-LOAD | TBD | 0 | LOAD-01 | T-26-LOAD | k6 10k baseline and 20k stress gates enforce p95 < 2s and error rate < 1%, or ledger blocks/records accepted risk. | load | `docker run --rm -i grafana/k6 run - < scripts/k6/phase26-baseline.js` and stress variant | missing | pending |
| 26-W0-DR | TBD | 0 | DR-01 | T-26-DR | Cloud Run rollback, Cloud SQL PITR/restore, and Valkey reconnect/failure evidence are captured against safe targets. | ops drill | GCP commands with explicit `--project=grapit-491806` plus Valkey smoke | partial | pending |
| 26-W0-INFRA | TBD | 0 | INFRA-01 | T-26-INFRA | pgBouncer, HA/read replica, and DB pool sizing are either drilled, config-evidenced, or ledgered as non-PASS states. | config + ops evidence | New infra evidence script/runbook commands | missing | pending |
| 26-W0-OPS1 | TBD | 0 | OPS-01 | T-26-OPS | Sentry, Cloud Run logs, Cloudflare, business metrics, and 1-person playbooks have dry-run evidence. | ops smoke | Sentry/Cloud Run/Cloudflare/business metric evidence commands | partial | pending |
| 26-W0-PAY | TBD | 0 | PAY-01 | T-26-PAY | Toss test/live cutover preserves server-side amount verification, server-only secrets, webhook re-query, idempotency, and `BOOKING_ENABLED` no-go semantics. | integration + ops smoke | Existing payment tests plus new Toss query/idempotency tests and live-key smoke checklist | partial | pending |
| 26-W0-OPS2 | TBD | 0 | OPS-02 | T-26-WATCH | First-2h intensive and first-24h periodic monitoring checks queue/payment/seat/QR/Cloud Run/Sentry/Cloudflare and close-booking triggers. | runbook + manual ops | New first-24h watch checklist plus ledger validator | missing | pending |

*Status: pending, green, red, flaky.*

---

## Wave 0 Requirements

- [ ] `scripts/phase26/validate-gate-ledger.mjs` - validates required gate rows and preserves `PASS`, `FAIL`, `ACCEPTED_RISK`, `CONFIG_READY_NOT_DRILLED`, and `BLOCKED` without collapsing them.
- [ ] `scripts/k6/phase26-baseline.js` and `scripts/k6/phase26-stress.js` - encode LOAD-01 thresholds and export evidence.
- [ ] QR visibility smoke for payment complete page and My Page/ticket detail - covers D-25 through D-27.
- [ ] API tests or smoke scripts for Toss `Idempotency-Key` on POST confirm/cancel and Toss webhook `queryPayment(paymentKey)` re-verification.
- [ ] `scripts/phase26/cleanup-dry-run.sql` or equivalent guarded cleanup plan - constrains rehearsal cleanup to dedicated test event/order markers and stops on unexpected rows.
- [ ] `26-FIRST-24H-WATCH.md` or equivalent runbook/checklist - covers first-2h and first-24h monitoring cadence and close-booking triggers.
- [ ] Locale scope decision/test update - reconciles four active public locales in code with older five-locale success wording before M1 smoke can pass.

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

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies.
- [ ] Sampling continuity: no 3 consecutive implementation tasks without automated or evidence-producing verification.
- [ ] Wave 0 covers all missing references above.
- [ ] No watch-mode flags in verification commands.
- [ ] Gate Ledger validates every required cutover gate before `BOOKING_ENABLED=true`.
- [ ] `nyquist_compliant: true` set in frontmatter after the planner maps validation rows to concrete tasks.

**Approval:** pending
