---
status: diagnosed
phase: 25-admin-operations-console
source:
  - 25-01-SUMMARY.md through 25-23-SUMMARY.md
started: 2026-05-14T05:13:49Z
updated: 2026-05-14T05:13:49Z
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
result: issue
reported: "Browser MCP entered `showtime-1` into `/admin/seat-operations`; API returned 500 Internal Server Error for `/api/v1/admin/seat-operations/history?showtimeId=showtime-1...`."
severity: major
root_cause: "Phase 25 shared/controller schemas only require `showtimeId` to be a non-empty string (`z.string().min(1)`). The service then compares that value against PostgreSQL UUID columns, so malformed IDs reach Drizzle/Postgres and raise `22P02 invalid input syntax for type uuid`, which Nest surfaces as 500."
artifacts:
  - path: "packages/shared/src/schemas/admin-operations.schema.ts"
    issue: "`showtimeId` in admin seat operation request/history schemas is `z.string().min(1)` instead of UUID validation."
  - path: "apps/api/src/modules/admin/admin-seat-operations.controller.ts"
    issue: "History query schema accepts malformed `showtimeId`."
  - path: "apps/api/src/modules/admin/admin-seat-operations.service.ts"
    issue: "Service trusts malformed `showtimeId` and sends it into UUID comparisons."
  - path: "apps/api/src/modules/admin/admin-seat-operations.service.spec.ts"
    issue: "Existing tests use `showtime-1`, so they do not catch production UUID constraints."
missing:
  - "Validate admin seat operation `showtimeId` as UUID in shared request/history schemas or controller schema."
  - "Add API regression coverage that malformed `showtimeId` returns 400, not 500."
  - "Update tests/fixtures that use `showtime-1` where they are meant to represent production API inputs."

### 9. Translation review and zh-TW launch locale
expected: Admin translation review includes `en`, `th`, `zh-CN`, and `zh-TW` surfaces, with no active Japanese launch locale drift.
result: pass
evidence:
  - `pnpm test` covered Phase 25 locale/schema/component tests.
  - Browser MCP opened `/admin/translations` and observed `en/th/zh-CN/zh-TW` draft-generation copy plus visible `繁體中文` rows.

## Summary

total: 9
passed: 8
issues: 1
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "Malformed admin seat operation showtime IDs should be rejected as validation errors instead of surfacing internal server errors."
  status: failed
  reason: "Browser MCP reported `/api/v1/admin/seat-operations/history?showtimeId=showtime-1...` returned 500 Internal Server Error."
  severity: major
  test: 8
  root_cause: "Phase 25 admin seat operation schemas accept any non-empty string for `showtimeId`; malformed IDs reach PostgreSQL UUID comparisons and raise `22P02`, producing 500."
  artifacts:
    - path: "packages/shared/src/schemas/admin-operations.schema.ts"
      issue: "`showtimeId` is `z.string().min(1)` for admin seat operations."
    - path: "apps/api/src/modules/admin/admin-seat-operations.controller.ts"
      issue: "History query schema accepts malformed `showtimeId`."
    - path: "apps/api/src/modules/admin/admin-seat-operations.service.spec.ts"
      issue: "Fixtures use `showtime-1`, hiding UUID validation mismatch."
  missing:
    - "UUID validation for admin seat operation request/history inputs."
    - "400-not-500 regression tests for malformed `showtimeId`."
  debug_session: "automated-browser-mcp-2026-05-14"
