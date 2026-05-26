# PR #82 Review Fact Check

**PR:** [Phase 27: Event Operations + Settlement](https://github.com/sangwopark19/grapit/pull/82)  
**Head at fetch:** `349af7180f1acf05c79e363dbd35f3edbecc97be`  
**Codex reviewed commit:** `7abb100bf1`  
**Fetched:** `2026-05-26T06:43:53Z`

## Sources Fetched

| Source | Artifact | Count |
|--------|----------|-------|
| Pull review comments | `pr82-pull-review-comments.json` | 2 |
| Reviews | `pr82-reviews.json` | 1 |
| Issue comments | `pr82-issue-comments.json` | 0 |

## Findings

| ID | Reviewer | Severity | File | Status | Result |
|----|----------|----------|------|--------|--------|
| PR82-CODEX-001 | `chatgpt-codex-connector[bot]` | P1 | `apps/api/src/modules/field-operations/offline-sync.service.ts` | `confirmed_fixed` | 실제 이슈. Offline sync가 masked `redactedTokenRef`만 `consume`에 전달해 서버 QR 재검증이 실패할 수 있었다. |
| PR82-CODEX-002 | `chatgpt-codex-connector[bot]` | P2 | `apps/api/src/modules/field-operations/field-monitor.service.ts` | `confirmed_fixed` | 실제 이슈. Scan log query가 정렬 없이 `limit(100)`을 적용해 최신 운영 이벤트 누락 가능성이 있었다. |

## Fact Check Details

### PR82-CODEX-001: Preserve verifiable token for offline sync consume

Verdict: `confirmed_fixed`

Evidence:
- Review claim matched current code: `OfflineSyncService.resolveAttempt()` used `attempt.redactedTokenRef` as the `token` passed to `fieldCheckInService.consume`.
- Web pending record creation used `redactedTokenRef(token)`, producing masked `tok_...` text, not a verifiable QR token.
- Shared DTO now requires `FieldOfflineSyncAttempt.token`.
- Web pending queue stores and sends `token` for server sync while keeping `redactedTokenRef` for display/log references.
- API sync now passes `attempt.token` to `fieldCheckInService.consume`.

Fix:
- Updated shared schema/test, web offline store/page/test, and API offline sync service/test.
- Kept response/audit assertions that raw token/JTI/PII are not emitted in sync results.

### PR82-CODEX-002: Order scan logs before applying 100-row limit

Verdict: `confirmed_fixed`

Evidence:
- Review claim matched current code: `FieldMonitorService.loadScanLogs()` used `.limit(100)` without `.orderBy(...)`.
- Field monitor is an operations surface where newest abnormal scan events must be visible first.

Fix:
- Added `desc` import and `.orderBy(desc(ticketScanEvents.scannedAt), desc(ticketScanEvents.id))` before `.limit(100)`.
- Updated API service test to assert `orderBy` is invoked before `limit`.

## Verification

Commands run:

```bash
pnpm --filter @grabit/shared test -- field-operations.schema.test.ts
pnpm --filter @grabit/api test -- offline-sync.service.spec.ts field-monitor.service.spec.ts
pnpm --filter @grabit/web test -- scanner-check-in.test.tsx
pnpm --filter @grabit/shared typecheck
pnpm --filter @grabit/api typecheck
pnpm --filter @grabit/web typecheck
git diff --check
```

Results:
- `@grabit/shared` tests: passed, 10 files / 61 tests.
- `@grabit/api` tests: passed, 77 files / 773 tests.
- `@grabit/web` tests: passed, 82 files / 483 tests.
- `@grabit/shared`, `@grabit/api`, `@grabit/web` typecheck: passed.
- `git diff --check`: passed.

## Residual Risk

- Existing browser IndexedDB records created before this fix may only contain `redactedTokenRef` and cannot be server-reverified. This PR is pre-merge Phase 27 work, so no production migration was added for stale local offline attempts.
