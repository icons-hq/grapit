---
phase: 23-launch-foundation
plan: 13
subsystem: legal-compliance
tags: [legal, i18n, footer, compliance, next-intl, vitest]

requires:
  - phase: 23-launch-foundation
    provides: next-intl locale routing from 23-04
  - phase: 23-launch-foundation
    provides: English canonical legal markdown from 23-17
provides:
  - Visible legal English fallback label for Thai and Chinese legal surfaces
  - Locale-aware legal pages that render Korean or English canonical markdown
  - Launch footer business, support, and DPO contact compliance surface
affects: [phase-23, legal-content, footer, i18n, consent]

tech-stack:
  added: []
  patterns:
    - Async legal server pages use next-intl getLocale() to choose canonical markdown
    - Thai and Chinese legal routes render English canonical markdown with explicit fallback labeling

key-files:
  created:
    - apps/web/components/legal/legal-fallback-label.tsx
    - apps/web/app/legal/__tests__/legal-fallback.test.tsx
  modified:
    - apps/web/app/legal/terms/page.tsx
    - apps/web/app/legal/privacy/page.tsx
    - apps/web/app/legal/marketing/page.tsx
    - apps/web/components/layout/footer.tsx
    - apps/web/components/layout/__tests__/footer.test.tsx
    - apps/web/messages/ko.json
    - apps/web/messages/en.json
    - apps/web/messages/th.json
    - apps/web/messages/zh-CN.json
    - apps/web/messages/zh-TW.json

key-decisions:
  - "Thai and Chinese legal pages render English canonical markdown and show an explicit fallback label rather than native legal translation claims."
  - "Footer keeps /legal/marketing hidden from global navigation while exposing business/support/DPO contact details."

patterns-established:
  - "Legal fallback UI is centralized in LegalFallbackLabel with Korean anchor copy and localized equivalents."
  - "Legal page tests mock next-intl getLocale() to prove ko/en canonical rendering and Thai/Chinese fallback behavior."

requirements-completed:
  - TRANS-02
  - COMP-01
  - I18N-01

duration: 5m30s
completed: 2026-05-06
---

# Phase 23 Plan 13: Legal Fallback and Footer Compliance Summary

**Thai and Chinese legal pages now display English canonical legal copy with a visible fallback label, while the footer exposes launch business, support, and DPO contact details.**

## Performance

- **Duration:** 5m30s
- **Started:** 2026-05-06T07:12:39Z
- **Completed:** 2026-05-06T07:18:09Z
- **Tasks:** 1
- **Files modified:** 12

## Accomplishments

- Added `LegalFallbackLabel` with the required Korean label and localized equivalents for all five message locales.
- Updated terms, privacy, and marketing legal pages to choose Korean or English canonical markdown using `getLocale()`.
- Ensured Thai, Simplified Chinese, and Traditional Chinese legal pages render English canonical copy with a visible fallback label.
- Expanded the footer with business identity, customer support, and privacy/DPO contact information without adding a global marketing legal link or LINE/social link.
- Added TDD coverage for legal fallback routing and footer compliance surfaces.

## Task Commits

1. **Task 1 RED: Legal fallback and footer tests** - `62e9d72` (test)
2. **Task 1 GREEN: Legal fallback labels and footer compliance** - `fa8c4d3` (feat)

## Files Created/Modified

- `apps/web/components/legal/legal-fallback-label.tsx` - Central fallback label component with Korean anchor copy and localized equivalents.
- `apps/web/app/legal/__tests__/legal-fallback.test.tsx` - Tests ko/en canonical rendering and Thai/Chinese English fallback behavior.
- `apps/web/app/legal/terms/page.tsx` - Locale-aware terms markdown selection.
- `apps/web/app/legal/privacy/page.tsx` - Locale-aware privacy markdown selection.
- `apps/web/app/legal/marketing/page.tsx` - Locale-aware marketing consent markdown selection.
- `apps/web/components/layout/footer.tsx` - Adds business identity, support phone, and privacy contact surface.
- `apps/web/components/layout/__tests__/footer.test.tsx` - Locks footer compliance details and no LINE/social global links.
- `apps/web/messages/*.json` - Adds legal fallback label copy for ko, en, th, zh-CN, and zh-TW.

## Decisions Made

- Kept English legal markdown as the only fallback source for Thai and Chinese legal pages.
- Preserved the Phase 16 decision that `/legal/marketing` remains available for consent flows but hidden from global footer navigation.
- Kept footer compliance text as dense text rows, not a new global operations or admin surface.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- `pnpm --filter @grabit/web typecheck` still fails on the known `SignupStep2` `consentItems` payload gap from 23-07. This was explicitly out of scope for 23-13 and remains owned by 23-10.
- Web Vitest still emits existing jsdom warnings for `window.scrollTo`, navigation, and React `act(...)`, but all tests passed.

## Known Stubs

None. Stub-pattern scan only matched existing comments that mention placeholder leak prevention.

## User Setup Required

None - no external service configuration required.

## Verification

- `pnpm --filter @grabit/web test -- legal-fallback.test.tsx footer.test.tsx` - PASS, 273 tests.
- `pnpm --filter @grabit/web test -- legal-content.test.ts footer.test.tsx` - PASS, 273 tests.
- `grep -R "영문 법적 고지로 확인합니다" apps/web/components/legal apps/web/app/legal` - PASS.
- `pnpm --filter @grabit/web typecheck` - FAIL only on known out-of-scope `SignupStep2` `consentItems` error.

## TDD Gate Compliance

- RED commit exists: `62e9d72`
- GREEN commit exists after RED: `fa8c4d3`
- Refactor commit: Not needed

## Next Phase Readiness

Ready for 23-10 consent UI/payload work to close the known `SignupStep2` `consentItems` typecheck gap. Legal fallback and footer compliance surfaces are wired for downstream consent flows.

## Self-Check: PASSED

- Summary and key legal/footer files exist on disk.
- Task commits `62e9d72` and `fa8c4d3` exist in git history.
- No unexpected tracked file deletions were found in task commits.

---
*Phase: 23-launch-foundation*
*Completed: 2026-05-06*
