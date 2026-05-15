---
status: passed_with_accepted_risk
phase: 25-admin-operations-console
source:
  - 25-01-SUMMARY.md through 25-23-SUMMARY.md
started: 2026-05-14T05:13:49Z
updated: 2026-05-15T00:30:47Z
mode: automated
accepted_risk:
  - D-08-admin-mfa
---

# Phase 25 Automated UAT

Automated UAT was run with CLI, Playwright browser automation, Browser MCP route snapshots, and Computer Use app-state inspection. Human-only security evidence remains tracked separately in `25-HUMAN-UAT.md` and is not converted into PASS here.

## Current Test

[testing complete]

## Tests

### 1. Phase 25 cold start and database schema readiness
expected: Kill any running API process, apply current migrations, start the API from scratch, and verify Phase 25 admin tables/routes can respond without missing-column or missing-table errors.
result: pass
evidence:
  - `DOTENV_CONFIG_PATH=../../.env pnpm --filter @grabit/api exec drizzle-kit migrate` passed with `[✓] migrations applied successfully!`.
  - `pnpm --filter @grabit/api start` booted and mapped Phase 25 admin routes on `localhost:8080`.
notes:
  - Before migration, local browser smoke exposed stale local DB state (`support_threads` missing, `banners.placement` missing). This was environment drift and was resolved by applying migrations.

### 2. CLI quality gates
expected: Repository lint, typecheck, unit tests, and API integration tests pass for the implemented Phase 25 surface.
result: pass
evidence:
  - `pnpm lint` passed with existing warnings only.
  - `pnpm typecheck` passed.
  - `pnpm test` passed: shared 8 files / 42 tests, API 64 files / 641 tests, web suite passed via turbo.
  - `pnpm --filter @grabit/api test:integration` passed: 5 files / 41 tests.

### 3. Admin dashboard and publish review routes
expected: Admin dashboard renders KPI/chart/Top10 surfaces, publish review shows venue/transport/sale summary, and publish confirmation remains reason-gated.
result: pass
evidence:
  - `TZ=UTC E2E_API_URL=http://localhost:8080 pnpm --filter @grabit/web exec playwright test admin-dashboard.spec.ts admin-event-publish.spec.ts admin-operations-inbox.spec.ts admin-rbac-and-security.spec.ts admin-export-and-seat-ops.spec.ts --config=.tmp-playwright-3001.config.mjs` passed: 12/12 tests.

### 4. Operations inbox and support content
expected: `/admin/operations` shows SLA/escalation filters and masked requester workflow; `/admin/support-content` shows FAQ/notice management with review/publish affordances.
result: pass
evidence:
  - Playwright E2E passed operations inbox SLA/escalation and masked requester checks.
  - Browser MCP opened `http://localhost:3001/admin/operations`; `/api/v1/admin/operations/inbox` returned 200 after migration and the route rendered the empty-state table instead of an error.
  - Browser MCP opened `http://localhost:3001/admin/support-content`; `/api/v1/admin/support-content?includeArchived=true` returned 200 and FAQ/notice controls rendered.

### 5. Audit and security surfaces
expected: `/admin/audit` shows actor/action/resource/status/time/masked-IP/reason/changed-fields columns; `/admin/security` shows IP allowlist state and the exact MFA accepted-risk copy.
result: pass
evidence:
  - Browser MCP opened `/admin/security` after real admin login and observed the exact copy: `MFA는 아직 적용되지 않았습니다. 현재는 IP allowlist와 audit monitoring으로 운영합니다.`
  - Browser MCP opened `/admin/audit`; `/api/v1/admin/audit?limit=50` returned 200 and the masked audit table headers rendered.
accepted_risk:
  - MFA remains `ACCEPTED_RISK_DEFERRED`, not implemented or security PASS.

### 6. Booking export and manual seat-opening gates
expected: `/admin/bookings` exposes all CSV filters, opens a raw CSV confirmation dialog, requires an export reason, and keeps the export action disabled until the reason gate is satisfied.
result: pass
evidence:
  - Playwright E2E passed raw reservation CSV reasoned-confirmation coverage.
  - Browser MCP opened `/admin/bookings`, observed CSV filters and clicked `예약자 원본 CSV 내보내기`; the dialog rendered PII warning and disabled `CSV 내보내기` until `내보내기 사유` is entered.

### 7. Seat operations happy path gate
expected: `/admin/seat-operations` requires showtime ID and seat key before operations, accepts production-shaped UUID showtime IDs, shows history without server errors, and opens a reason-gated disable/reactivate confirmation dialog.
result: pass
evidence:
  - Playwright E2E passed dedicated seat operations route smoke and reason-gated modal coverage.
  - Browser MCP opened `/admin/seat-operations`, entered `00000000-0000-4000-8000-000000000001` and `1F:A-10`; `/api/v1/admin/seat-operations/history?...` returned 200.
  - Clicking `좌석 비활성화` opened the reason-gated dialog and kept `비활성화 확인` disabled until `좌석 운영 사유` is entered.

### 8. Seat operations invalid showtime ID validation
expected: If an operator enters a malformed showtime ID, the admin API should reject it as a validation error instead of surfacing an internal server error.
result: pass
reported: "Original Browser MCP run entered `showtime-1` into `/admin/seat-operations` and observed a 500 from `/api/v1/admin/seat-operations/history?showtimeId=showtime-1...`."
severity: resolved_major
root_cause: "Phase 25 shared/controller schemas only required `showtimeId` to be a non-empty string, so malformed IDs reached PostgreSQL UUID comparisons and raised `22P02 invalid input syntax for type uuid`."
resolution:
  - "Added shared UUID validation for admin seat operation request/history showtime IDs."
  - "Added controller regression coverage proving malformed history query input returns validation-level 400 and does not call the service."
  - "Added service boundary regression coverage proving malformed mutation/history inputs fail before DB/audit/broadcast side effects."
  - "Normalized production happy-path UI/E2E fixtures away from `showtime-1`."
evidence:
  - "`pnpm --filter @grabit/shared test -- src/schemas/admin-operations.schema.test.ts` passed: 8 files / 43 tests."
  - "`pnpm --filter @grabit/api exec vitest run modules/admin/admin-seat-operations.controller.spec.ts modules/admin/admin-seat-operations.service.spec.ts modules/booking/__tests__/booking.service.spec.ts modules/booking/__tests__/dto.spec.ts modules/reservation/reservation.service.spec.ts modules/payment/payment.service.spec.ts` passed: 6 files / 124 tests."
  - "`rg -n \"showtime-1\" packages/shared/src/schemas/admin-operations.schema.test.ts apps/api/src/modules/admin/admin-seat-operations.service.spec.ts apps/web/components/admin/__tests__/seat-operations-panel.test.tsx apps/web/e2e/admin-export-and-seat-ops.spec.ts` produced no output for scoped happy-path fixtures."
  - "`25-REVIEW.md` final code review status is `clean` with findings 0."

### 9. Translation review and zh-TW launch locale
expected: Admin translation review includes `en`, `th`, `zh-CN`, and `zh-TW` surfaces, with no active Japanese launch locale drift.
result: pass
evidence:
  - `pnpm test` covered Phase 25 locale/schema/component tests.
  - Browser MCP opened `/admin/translations` and observed `en/th/zh-CN/zh-TW` draft-generation copy plus visible `繁體中文` rows.

## Summary

total: 9
passed: 9
issues: 0
pending: 0
skipped: 0
blocked: 0

## Reverification 2026-05-15

Status: passed_with_accepted_risk

CLI evidence:
  - `gsd-sdk query audit-open --json` found Phase 25 `25-UAT.md` at `passed_with_accepted_risk`; `25-HUMAN-UAT.md` remains `human_uat_required_for_security_evidence`.
  - `pnpm lint` passed with existing warnings only: API 50 warnings / 0 errors, web 35 warnings / 0 errors.
  - `pnpm typecheck` passed.
  - `pnpm test` passed: shared 8 files / 43 tests, API 65 files / 657 tests, web 62 files / 385 tests.
  - `pnpm --filter @grabit/api test:integration` passed: 5 files / 41 tests.
  - `pnpm --filter @grabit/shared test -- src/schemas/admin-operations.schema.test.ts` passed: 8 files / 43 tests.
  - `pnpm --filter @grabit/api exec vitest run modules/admin/admin-seat-operations.controller.spec.ts modules/admin/admin-seat-operations.service.spec.ts modules/booking/__tests__/booking.service.spec.ts modules/booking/__tests__/dto.spec.ts modules/reservation/reservation.service.spec.ts modules/payment/payment.service.spec.ts` passed: 6 files / 124 tests.
  - `pnpm --filter @grabit/web exec vitest run components/admin/__tests__/seat-operations-panel.test.tsx components/booking/__tests__/seat-map-viewer.test.tsx` passed: 2 files / 26 tests, with existing React `act(...)` warnings.
  - `DOTENV_CONFIG_PATH=../../.env pnpm --filter @grabit/api exec drizzle-kit migrate` passed with `[✓] migrations applied successfully!`.
  - API cold start via `pnpm --filter @grabit/api dev` mapped Phase 25 admin routes and reported 0 TypeScript issues.
  - Web dev server via `pnpm --filter @grabit/web dev` served `http://localhost:3000`; `curl -I http://localhost:3000/admin` returned 200.
  - `curl http://localhost:8080/api/v1/health` returned `status: ok` with in-memory Redis dev mode.

Browser and E2E evidence:
  - `CI=1 TZ=UTC E2E_API_URL=http://localhost:8080 pnpm --filter @grabit/web test:e2e -- admin-dashboard.spec.ts admin-event-publish.spec.ts admin-operations-inbox.spec.ts admin-rbac-and-security.spec.ts admin-export-and-seat-ops.spec.ts` was blocked by Playwright's CI port ownership check because the verified local web server was already running on `3000`.
  - Local parallel E2E run on the same route set passed 11/12 and exposed one dashboard auth/session race in the `period-filter` test. The failed page snapshot was the access-denied screen, not the dashboard.
  - The same `period-filter` test passed alone with `--workers=1` in 797ms.
  - The full admin E2E route set passed with `--workers=1`: 12/12 passed in 5.7s.
  - Browser MCP logged in through the real API, opened `/admin`, and observed `대시보드`, KPI copy, chart sections, and Top 10.
  - Browser MCP route smoke opened `/admin`, `/admin/operations`, `/admin/support-content`, `/admin/security`, `/admin/audit`, `/admin/bookings`, `/admin/seat-operations`, and `/admin/translations`; all observed Phase 25 admin API responses were 200.
  - Browser MCP confirmed `/admin/bookings` raw CSV dialog shows a PII/raw export warning and keeps `CSV 내보내기` disabled until a reason is entered.
  - Browser MCP confirmed `/admin/seat-operations` accepts showtime UUID `00000000-0000-4000-8000-000000000001` plus seat key `1F:A-10`, returns history 200, opens the disable dialog, and keeps `비활성화 확인` disabled until a reason is entered.
  - Browser MCP confirmed `/admin/security` still shows the exact accepted-risk copy: `MFA는 아직 적용되지 않았습니다. 현재는 IP allowlist와 audit monitoring으로 운영합니다.`
  - Browser MCP console noise was limited to `favicon.ico` 404.
  - Computer Use inspected the running Chrome app and selected an existing `Grabit - 공연 티켓 예매` tab at `localhost:3000`, confirming the live local page renders through the desktop browser accessibility tree.

Notes:
  - The parallel E2E auth/session race is treated as a test orchestration flake because the failed snapshot was access-denied, the focused test passed alone, and the entire route set passed serially.
  - D-08 admin MFA remains `ACCEPTED_RISK_DEFERRED`, not a security PASS.

## Gaps

- truth: "Malformed admin seat operation showtime IDs should be rejected as validation errors instead of surfacing internal server errors."
  status: resolved
  reason: "Shared/controller/service UUID validation now rejects malformed showtime IDs before DB UUID comparisons."
  severity: resolved_major
  test: 8
  root_cause: "Phase 25 admin seat operation schemas accepted any non-empty string for `showtimeId`; malformed IDs reached PostgreSQL UUID comparisons and raised `22P02`, producing 500."
  fixed:
    - path: "packages/shared/src/schemas/admin-operations.schema.ts"
      evidence: "Admin seat operation request/history schemas now use UUID validation."
    - path: "apps/api/src/modules/admin/admin-seat-operations.controller.ts"
      evidence: "History query validation uses the shared UUID schema and rejects malformed input before service invocation."
    - path: "apps/api/src/modules/admin/admin-seat-operations.service.ts"
      evidence: "Service validates showtime IDs before transaction/select database work."
    - path: "apps/api/src/modules/admin/admin-seat-operations.controller.spec.ts"
      evidence: "Malformed `showtime-1` history query returns 400 and does not call the service."
  missing: []
  debug_session: "automated-browser-mcp-2026-05-14"

## Residual Accepted Risk

- D-08 admin MFA remains `ACCEPTED_RISK_DEFERRED`. This UAT does not convert MFA to PASS; it only confirms the accepted-risk copy and audit/allowlist controls remain visible.
