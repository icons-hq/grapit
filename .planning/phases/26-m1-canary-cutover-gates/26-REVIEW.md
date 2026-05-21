---
phase: 26-m1-canary-cutover-gates
reviewed: 2026-05-20T07:18:33Z
depth: standard
files_reviewed: 15
files_reviewed_list:
  - scripts/k6/phase26-baseline.js
  - scripts/k6/phase26-stress.js
  - scripts/phase26/cleanup-dry-run.sql
  - scripts/phase26/cleanup-test-event.sql
  - scripts/phase26/validate-gate-ledger.mjs
  - scripts/phase26/direct-deploy-watch.mjs
  - apps/api/Dockerfile
  - apps/api/src/modules/admin/admin-cutover.service.ts
  - apps/api/src/modules/admin/admin-cutover.service.spec.ts
  - apps/api/src/modules/payment/toss-payments.client.ts
  - apps/api/src/modules/payment/toss-payments.client.spec.ts
  - apps/api/src/modules/payment/toss-webhook.guard.ts
  - apps/api/src/modules/payment/toss-webhook.guard.spec.ts
  - docs/runbooks/phase26-direct-deploy-watch.md
  - .planning/phases/26-m1-canary-cutover-gates/26-GATE-LEDGER.json
findings:
  critical: 0
  warning: 0
  info: 0
  total: 0
status: clean
---

# Phase 26: Code Review Re-Review Report

**Reviewed:** 2026-05-20T07:18:33Z
**Depth:** standard
**Files Reviewed:** 15
**Status:** clean

## Summary

This was a targeted re-review of only the prior `26-REVIEW.md` findings:
CR-01, CR-02, CR-03, CR-04, WR-01, and WR-02. All six prior findings are resolved in the current workspace. No remaining BLOCKER or WARNING findings were found in the requested re-review scope.

Source files were not modified. This review artifact was updated to reflect the re-review result.

## Resolved Findings

### CR-01: [BLOCKER] k6 load gates accepting 401/403/404/409/429 and below-500 checks

**Verdict:** RESOLVED

**Evidence:**
- `scripts/k6/phase26-baseline.js:18` and `scripts/k6/phase26-stress.js:18` now use `http.expectedStatuses({ min: 200, max: 399 })`, so 401/403/404/409/429 are no longer accepted as expected HTTP outcomes.
- `scripts/k6/phase26-baseline.js:61-75` and `scripts/k6/phase26-stress.js:61-75` fail setup unless health, performance detail, and seat read return 2xx; the setup also checks the dedicated Phase 26 marker before load starts.
- Runtime route checks now require 2xx for read, queue, lock, and optional prepare paths at `scripts/k6/phase26-baseline.js:111-118`, `scripts/k6/phase26-baseline.js:134-147`, `scripts/k6/phase26-baseline.js:169-186`, with the same pattern in `scripts/k6/phase26-stress.js:111-118`, `scripts/k6/phase26-stress.js:134-147`, and `scripts/k6/phase26-stress.js:169-186`.

### CR-02: [BLOCKER] cleanup-test-event deleting performance without proving child scope

**Verdict:** RESOLVED

**Evidence:**
- `scripts/phase26/cleanup-test-event.sql:154-177` requires the target performance to contain the dedicated test marker and still denies the real Girl Rules event.
- `scripts/phase26/cleanup-test-event.sql:179-186` proves the supplied showtime belongs to the supplied performance.
- `scripts/phase26/cleanup-test-event.sql:224-249` adds unexpected-row checks, including `other_showtimes_for_performance`, and `scripts/phase26/cleanup-test-event.sql:269-270` aborts if any unexpected scope exists.
- `scripts/phase26/cleanup-test-event.sql:352` now preserves the performance row instead of deleting it.
- `scripts/phase26/cleanup-dry-run.sql:171-185` reports child-table counts, and `scripts/phase26/cleanup-dry-run.sql:196-197` surfaces unexpected rows before the mutating script can run.

### CR-03: [BLOCKER] Toss webhook accepting query parameter secrets

**Verdict:** RESOLVED

**Evidence:**
- `apps/api/src/modules/payment/toss-webhook.guard.ts:43-57` now extracts secrets only from webhook headers or `Authorization: Bearer`; it returns `null` after those sources and does not inspect `request.query`.
- `apps/api/src/modules/payment/toss-webhook.guard.spec.ts:45-57` explicitly verifies that `?tossWebhookSecret=` is rejected.

### CR-04: [BLOCKER] Gate Ledger redaction missing standalone Toss payment keys and admin API defensive redaction

**Verdict:** RESOLVED

**Evidence:**
- `scripts/phase26/validate-gate-ledger.mjs:54-66` now rejects standalone Toss payment keys, labelled payment keys, QR tokens, bearer headers, cookies, JWTs, OTPs, phone numbers, and email addresses.
- `scripts/phase26/validate-gate-ledger.mjs:305-309` scans raw ledger text before JSON parsing.
- `apps/api/src/modules/admin/admin-cutover.service.ts:9-30` adds defensive runtime redaction for standalone payment keys and other secret-like strings.
- `apps/api/src/modules/admin/admin-cutover.service.ts:352-363` applies redaction to exposed string arrays and scalar metadata before returning the admin summary.
- `apps/api/src/modules/admin/admin-cutover.service.spec.ts:192-221` verifies secret-like Gate Ledger metadata is not exposed through the admin API model.
- `apps/api/Dockerfile:21` still packages the Gate Ledger artifact, but the current validator and API redaction defenses cover the prior leakage path. `node scripts/phase26/validate-gate-ledger.mjs --ledger .planning/phases/26-m1-canary-cutover-gates/26-GATE-LEDGER.json --strict` passed.

### WR-01: [WARNING] cancelPayment URL encoding

**Verdict:** RESOLVED

**Evidence:**
- `apps/api/src/modules/payment/toss-payments.client.ts:122-124` now wraps `paymentKey` with `encodeURIComponent(paymentKey)` in the cancel URL.
- `apps/api/src/modules/payment/toss-payments.client.spec.ts:78-83` verifies a slash in the payment key is encoded as `%2F`.

### WR-02: [WARNING] direct-deploy public detail accepting 404/403 as PASS

**Verdict:** RESOLVED

**Evidence:**
- `scripts/phase26/direct-deploy-watch.mjs:465-472` now marks `public-detail` PASS only for 2xx responses and FAIL otherwise.
- `docs/runbooks/phase26-direct-deploy-watch.md:232-240` documents that the public event detail must return 2xx for M1 direct deploy watch PASS.

## Remaining Findings

None in the requested prior-finding scope.

## Verification

- `pnpm --filter @grabit/api test -- src/modules/payment/toss-webhook.guard.spec.ts src/modules/payment/toss-payments.client.spec.ts src/modules/admin/admin-cutover.service.spec.ts` completed successfully. Vitest ran the API suite and reported 72 test files / 739 tests passed.
- `node scripts/phase26/validate-gate-ledger.mjs --ledger .planning/phases/26-m1-canary-cutover-gates/26-GATE-LEDGER.json --strict` passed.
- `node scripts/phase26/validate-gate-ledger.mjs --ledger .planning/phases/26-m1-canary-cutover-gates/26-GATE-LEDGER.json --booking-enabled-check` failed because current Gate Ledger rows remain `BLOCKED`/unapproved no-go. That is expected readiness behavior and is not one of the prior six source defects.

---

_Reviewed: 2026-05-20T07:18:33Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
