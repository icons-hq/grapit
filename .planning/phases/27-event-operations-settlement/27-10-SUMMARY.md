---
phase: 27-event-operations-settlement
plan: 10
subsystem: ui
tags: [qr, qrcode.react, idb, field-operations, tdd]

requires:
  - phase: 27-01
    provides: "shared Phase 27 field-operations contracts"
  - phase: 27-03
    provides: "buyer QR and scanner RED contracts"
provides:
  - "qrcode.react and idb web dependency declarations"
  - "Reusable QrTicketImage component for buyer QR surfaces"
  - "Unit tests proving the QR URL and raw token/JTI are not visible text"
affects: [27-11, 27-13, buyer-qr, field-check-in]

tech-stack:
  added: [qrcode.react, idb]
  patterns:
    - "QRCodeSVG with HTTPS value validation, level M, and marginSize 4"
    - "Safe QR fallback copy that never prints raw token/JTI/value text"

key-files:
  created:
    - apps/web/components/field/qr-ticket-image.tsx
    - .planning/phases/27-event-operations-settlement/deferred-items.md
  modified:
    - apps/web/package.json
    - pnpm-lock.yaml
    - apps/web/components/field/__tests__/qr-ticket-image.test.tsx

key-decisions:
  - "Use qrcode.react QRCodeSVG for buyer-visible QR rendering."
  - "Reserve idb for Plan 27-13 offline pending scan storage without adding scanner camera dependencies."
  - "Reject non-HTTPS QR values with safe fallback copy instead of rendering unsafe QR text."

patterns-established:
  - "QrTicketImage accepts value/title/size and defaults to a 220px stable square with QR title '티켓 검표 QR'."
  - "QR renderer tests assert no raw URL, token, or JTI appears as visible text."

requirements-completed: [QR-02]

duration: 7 min
completed: 2026-05-22
---

# Phase 27 Plan 10: QR Ticket Image Dependencies Summary

**Buyer QR rendering foundation using qrcode.react QRCodeSVG with safe HTTPS value handling and raw-token non-rendering tests**

## Performance

- **Duration:** 7 min
- **Started:** 2026-05-22T02:55:40Z
- **Completed:** 2026-05-22T03:03:04Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Added `qrcode.react` and `idb` to `@grabit/web`, with `@zxing/browser` intentionally not added.
- Added `QrTicketImage`, a reusable client component that renders HTTPS check-in URLs as a stable QR SVG.
- Strengthened unit tests for stable QR sizing, accessible QR title, safe fallback copy, and non-rendering of raw URL/token/JTI text.

## Task Commits

1. **Task 1: Install QR/offline web dependencies** - `5e01ad98` (feat)
2. **Task 2 RED: Add failing QR ticket image tests** - `7fc95332` (test)
3. **Task 2 GREEN: Implement QrTicketImage** - `845dbaa3` (feat)

## Files Created/Modified

- `apps/web/components/field/qr-ticket-image.tsx` - Reusable QR renderer using `QRCodeSVG`.
- `apps/web/components/field/__tests__/qr-ticket-image.test.tsx` - Component tests for QR image rendering and no visible token/JTI leakage.
- `apps/web/package.json` - Added `qrcode.react` and `idb`.
- `pnpm-lock.yaml` - Locked `qrcode.react@4.2.0` and `idb@8.0.3`.
- `.planning/phases/27-event-operations-settlement/deferred-items.md` - Logged out-of-scope typecheck failures.

## Decisions Made

- Used `QRCodeSVG` rather than canvas so the initial buyer QR surface is accessible and testable in jsdom.
- Kept `@zxing/browser` out of dependencies because Phase 27 locked the phone-camera-to-HTTPS-URL model and did not require in-browser camera scanning in this plan.
- Added HTTPS validation in `QrTicketImage`; invalid values show safe Korean fallback copy and do not render the unsafe value.

## Verification

| Command | Result | Notes |
|---|---|---|
| `pnpm --filter @grabit/web exec node -e "import('qrcode.react').then(() => import('idb')).then(() => console.log('phase27 deps ok'))"` | PASS | Printed `phase27 deps ok`. |
| `pnpm --filter @grabit/web exec vitest run components/field/__tests__/qr-ticket-image.test.tsx` | PASS | 4 tests passed. |
| `pnpm --filter @grabit/web exec eslint components/field/qr-ticket-image.tsx components/field/__tests__/qr-ticket-image.test.tsx` | PASS | No lint output. |
| `pnpm --filter @grabit/web typecheck` | FAIL (out of scope) | Fails on pre-existing/future-plan files: missing `scanner-check-in`, `field-monitor`, `settlement-dashboard`, plus existing admin/shared TypeScript errors. No reported error references `qr-ticket-image.tsx`. |

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- `pnpm --filter @grabit/web typecheck` is not green because earlier Phase 27 RED/future-plan contracts and existing admin/shared TypeScript issues are currently in the branch. This is logged in `deferred-items.md`; Plan 27-10-specific checks pass.
- An initial patch attempt targeted the main repository due the patch tool's default cwd. The specific tracked file was restored immediately; verified main repo has no tracked diff from this plan. All committed work is in `/Users/sangwopark19/icons/grapit/.codex/worktrees/agent-phase27-10`.

## Known Stubs

None.

## Authentication Gates

None.

## TDD Gate Compliance

- RED commit present: `7fc95332` (`test(27-10): add failing QR ticket image tests`)
- GREEN commit present after RED: `845dbaa3` (`feat(27-10): implement QR ticket image component`)
- REFACTOR commit: not needed

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

`QrTicketImage` is ready for Plan 27-11 buyer surface integration into payment complete and My Page reservation detail. Phase-level web typecheck still needs the out-of-scope Phase 27 RED/future-plan modules and existing admin/shared TypeScript issues resolved by their owning plans.

## Self-Check: PASSED

- Confirmed created/modified files exist on disk.
- Confirmed task commits exist in git history: `5e01ad98`, `7fc95332`, `845dbaa3`.
- Confirmed `STATE.md` and `ROADMAP.md` were not modified.

---
*Phase: 27-event-operations-settlement*
*Completed: 2026-05-22*
