---
phase: 27-event-operations-settlement
plan: 11
subsystem: ui
tags: [qr, booking, reservation, vitest, playwright]

requires:
  - phase: 27-event-operations-settlement
    provides: [signed buyer QR token, QrTicketImage component, Phase 26 QR visibility contracts]
provides:
  - real buyer QR images on payment complete and My Page reservation detail
  - HTTPS Grabit check-in URL encoding for buyer QR images
  - buyer QR tests that fail on metadata-only regressions or visible raw ticket secrets
affects: [buyer-qr, booking-complete, reservation-detail, field-check-in, qr-visibility]

tech-stack:
  added: []
  patterns:
    - QrTicketImage renders buyer check-in URLs while visible copy hides raw ticket secrets
    - Browser QR tests assert component QR attributes without treating phone-camera scanning as automated evidence

key-files:
  created:
    - apps/web/components/booking/__tests__/booking-complete-qr.test.tsx
    - apps/web/components/reservation/__tests__/reservation-detail-qr.test.tsx
    - .planning/phases/27-event-operations-settlement/27-11-SUMMARY.md
  modified:
    - apps/web/components/field/qr-ticket-image.tsx
    - apps/web/components/booking/booking-complete.tsx
    - apps/web/components/reservation/reservation-detail.tsx
    - apps/web/e2e/booking-complete-qr.spec.ts
    - apps/web/e2e/phase26-qr-visibility.spec.ts
    - .planning/phases/27-event-operations-settlement/deferred-items.md

key-decisions:
  - "Build buyer QR payloads as HTTPS `/field/check-in?ticket=...` URLs, using the current HTTPS origin when available and `https://heygrabit.com` as the non-HTTPS fallback."
  - "Keep raw QR token/JTI/full URL out of visible buyer text while allowing the QR component to carry the URL for QR rendering and test attributes."
  - "Leave phone-camera scanning proof to Plan 27-16 instead of converting device scanning into automated E2E evidence."

patterns-established:
  - "Buyer QR card pattern: real `QrTicketImage`, D-02 metadata only, scanner-result-is-final copy."
  - "QR privacy test pattern: assert QR presence and URL attribute, then separately assert raw secrets are not visible text."

requirements-completed: [QR-02]

duration: 12min
completed: 2026-05-22T03:36:00Z
---

# Phase 27 Plan 11: Buyer QR Rendering Summary

**Buyer payment complete and My Page reservation detail now render real QR images for HTTPS check-in URLs without exposing raw ticket secrets as visible text.**

## Performance

- **Duration:** 12 min commit window
- **Started:** 2026-05-22T03:24:42Z
- **Completed:** 2026-05-22T03:36:00Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments

- Rendered `QrTicketImage` on payment complete and My Page when `qrTicket.status === 'ACTIVE'`.
- Added `buildQrCheckInUrl()` so buyer QR payloads encode an HTTPS Grabit check-in URL.
- Removed visible masked JTI / Ticket ID buyer metadata and kept metadata limited to reservation number, performance title, showtime, seats, and ticket status.
- Strengthened component and browser tests so metadata-only QR regressions and visible raw-secret leaks fail.

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Render real QR images on buyer surfaces** - `74fa6313` (test)
2. **Task 1 GREEN: Render real QR images on buyer surfaces** - `1a084a8a` (feat)
3. **Task 2: Strengthen buyer QR browser evidence** - `a539533d` (test)

## Files Created/Modified

- `apps/web/components/field/qr-ticket-image.tsx` - Added buyer check-in URL builder and QR URL data attribute support.
- `apps/web/components/booking/booking-complete.tsx` - Replaced metadata-only buyer QR card with real QR image and source-of-truth copy.
- `apps/web/components/reservation/reservation-detail.tsx` - Replaced My Page metadata-only QR card with real QR image and safe non-active state copy.
- `apps/web/components/booking/__tests__/booking-complete-qr.test.tsx` - Added RED/GREEN coverage for payment complete QR rendering and privacy.
- `apps/web/components/reservation/__tests__/reservation-detail-qr.test.tsx` - Added RED/GREEN coverage for reservation detail QR rendering and privacy.
- `apps/web/e2e/booking-complete-qr.spec.ts` - Required QR image evidence and hidden raw-secret text on payment complete and My Page.
- `apps/web/e2e/phase26-qr-visibility.spec.ts` - Updated Phase 26 QR visibility evidence to remain compatible with real QR rendering.
- `.planning/phases/27-event-operations-settlement/deferred-items.md` - Logged out-of-scope Phase 27 `typecheck` failures.

## Decisions Made

- Used `window.location.origin` only when it is already HTTPS; otherwise buyer QR URLs fall back to `https://heygrabit.com`.
- Kept `data-qr-url` as component-level evidence for automated tests, while asserting the URL is not visible buyer text.
- Preserved scanner authority in buyer copy with `현장 검표 결과가 최종 입장 기준입니다.`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed worktree dependencies for verification**
- **Found during:** Task 1 RED
- **Issue:** Fresh manual worktree had no `node_modules`, so `vitest` was unavailable.
- **Fix:** Ran `pnpm install --frozen-lockfile` in the manual worktree.
- **Files modified:** None committed.
- **Verification:** RED tests executed and failed for the expected missing QR image condition.
- **Committed in:** Not applicable, no tracked file changes.

**2. [Rule 3 - Blocking] Built shared package artifacts for E2E verification**
- **Found during:** Task 2 verification
- **Issue:** Playwright test loading needed generated `@grabit/shared` `dist` artifacts.
- **Fix:** Ran `pnpm --filter @grabit/shared build`.
- **Files modified:** None committed; generated artifacts are ignored.
- **Verification:** QR E2E suite ran after the build and passed.
- **Committed in:** Not applicable, no tracked file changes.

---

**Total deviations:** 2 auto-fixed (Rule 3)
**Impact on plan:** Verification setup only. No product scope was added.

## Issues Encountered

- `pnpm --filter @grabit/web typecheck` still fails outside Plan 27-11 scope on sibling Phase 27 surfaces: missing `settlement-dashboard`, `field-monitor`, and `scanner-check-in` modules plus existing `admin-user-management` scanner/settlement role map drift. This was recorded in `deferred-items.md` and was not fixed under this buyer QR plan.
- Initial patch application was corrected after detecting that `apply_patch` does not accept a workdir. The two accidental untracked files in the main checkout were removed immediately, and all committed edits were made under the manual worktree path.

## Verification

- PASS: `pnpm --filter @grabit/web exec vitest run components/booking/__tests__ components/reservation --passWithNoTests`
  - 10 files passed, 58 tests passed.
- PASS: `CI=1 TZ=UTC pnpm --filter @grabit/web test:e2e -- booking-complete-qr.spec.ts phase26-qr-visibility.spec.ts`
  - 4 tests passed.
- DEFERRED: `pnpm --filter @grabit/web typecheck`
  - Fails on out-of-scope sibling Phase 27 files listed in `deferred-items.md`.

## Known Stubs

None - no production stubs, placeholder copy, or mock-only data paths were introduced for the buyer QR rendering path.

## Threat Flags

None - no new network endpoints, auth paths, file access patterns, or schema trust boundaries were introduced beyond the plan threat model. Mitigations for `T-27-11-TOKEN-LEAK`, `T-27-11-OFFLINE-FALSE-PASS`, and `T-27-11-PII-LEAK` are covered by UI changes and tests.

## TDD Gate Compliance

- RED gate: `74fa6313` added failing component tests for missing buyer QR images.
- GREEN gate: `1a084a8a` implemented real buyer QR rendering and passed the component suite.
- Evidence hardening: `a539533d` strengthened browser QR privacy and rendering assertions.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 27-12/27-16 can now rely on buyer surfaces exposing real check-in QR payloads while scanner result copy remains authoritative. Existing Phase 27 typecheck debt should be handled by the plans that own the admin settlement and scanner modules.

## Self-Check: PASSED

- Found created test files and modified QR rendering files in the manual worktree.
- Found task commits `74fa6313`, `1a084a8a`, and `a539533d`.
- Confirmed `STATE.md` and `ROADMAP.md` were not edited for this manual worktree execution.

---
*Phase: 27-event-operations-settlement*
*Completed: 2026-05-22*
