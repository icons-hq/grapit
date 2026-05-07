---
phase: 23-launch-foundation
plan: 17
subsystem: legal-content
tags: [legal, i18n, compliance, vitest, markdown]

requires:
  - phase: 23-launch-foundation
    provides: Shared launch locale/legal contracts from 23-01
  - phase: 23-launch-foundation
    provides: Legal content schema foundation from 23-02
provides:
  - Manual English canonical legal markdown for terms, privacy, and marketing consent
  - Legal content tests locking canonical markdown locales to Korean and English
  - Absence guard for Thai, Simplified Chinese, and Traditional Chinese legal markdown files
affects: [phase-23, legal-content, i18n, consent, translation-lock]

tech-stack:
  added: []
  patterns:
    - Static legal markdown canonical sources live under apps/web/content/legal
    - Legal-sensitive content tests use filesystem assertions to lock allowed markdown locales

key-files:
  created:
    - apps/web/content/legal/terms-of-service.en.md
    - apps/web/content/legal/privacy-policy.en.md
    - apps/web/content/legal/marketing-consent.en.md
  modified:
    - apps/web/content/legal/__tests__/legal-content.test.ts

key-decisions:
  - "Legal canonical markdown locales are locked to exactly ko and en for launch."
  - "Thai and Chinese legal-sensitive surfaces must consume English canonical fallback rather than native-language legal markdown."
  - "English legal markdown is static manual canonical copy and remains outside the translation API/DeepL workflow."

patterns-established:
  - "Legal markdown locale additions must pass explicit canonical-locale and forbidden-locale file tests."
  - "English legal files mirror the Korean document structure while preserving launch business identity and effective date."

requirements-completed:
  - TRANS-02
  - COMP-01
  - I18N-01

duration: 12 min
completed: 2026-05-06
---

# Phase 23 Plan 17: English Legal Canonical Fallback Summary

**Manual English legal markdown now backs Thai/Chinese legal fallback while tests lock launch legal canonical sources to Korean and English only.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-05-06T06:03:00Z
- **Completed:** 2026-05-06T06:14:30Z
- **Tasks:** 1
- **Files modified:** 4

## Accomplishments

- Added manual English canonical markdown for terms of service, privacy policy, and marketing consent.
- Extended legal content tests to include English files, placeholder checks, structure checks, and no automatic-translation wording checks.
- Added filesystem tests that assert legal markdown canonical locales are exactly `ko` and `en`.
- Added absence guards for `.th.md`, `.zh-CN.md`, and `.zh-TW.md` legal markdown files.

## Task Commits

1. **Task 1 RED: Legal canonical locale tests** - `9e134a2` (test)
2. **Task 1 GREEN: English legal canonical markdown** - `66f0b26` (feat)

## Files Created/Modified

- `apps/web/content/legal/terms-of-service.en.md` - Manual English terms canonical source.
- `apps/web/content/legal/privacy-policy.en.md` - Manual English privacy canonical source, including cross-border transfer disclosure.
- `apps/web/content/legal/marketing-consent.en.md` - Manual English marketing consent canonical source.
- `apps/web/content/legal/__tests__/legal-content.test.ts` - Canonical locale, English content, placeholder, and forbidden-locale file guards.

## Decisions Made

- Kept English legal copy as static markdown, not generated translation output.
- Used filesystem-based Vitest assertions so future legal markdown additions are checked by filename and locale suffix.
- Preserved Thai/Chinese legal fallback as English canonical content only; no Thai or Chinese legal markdown was created.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- The web test script still runs the full Vitest suite when passed `legal-content.test.ts`; unrelated existing jsdom warnings about `window.scrollTo`, navigation, and React `act(...)` appeared, but all tests passed.

## Known Stubs

None. Stub-pattern matches found during scan were test guard regexes that intentionally reject placeholders and automatic-translation wording.

## Threat Flags

None - this plan modified static legal markdown and its tests only. The legal markdown locale trust boundary was already covered by `T-23-17-01`, `T-23-17-02`, and `T-23-17-03`.

## User Setup Required

None - no external service configuration required.

## Verification

- `pnpm --filter @grabit/web test -- legal-content.test.ts` - PASS, 36 files / 244 tests.
- English file existence gates for `terms-of-service.en.md`, `privacy-policy.en.md`, and `marketing-consent.en.md` - PASS.
- Thai/Chinese absence gates for representative `.th.md`, `.zh-CN.md`, and `.zh-TW.md` legal files - PASS.
- Stub scan on modified files - PASS; only intentional test guard regexes matched.

## TDD Gate Compliance

- RED commit exists: `9e134a2`
- GREEN commit exists after RED: `66f0b26`
- Refactor commit: Not needed

## Next Phase Readiness

Ready for Plans 23-13 and downstream legal fallback wiring. Thai and Chinese legal-sensitive views can consume the English canonical markdown with a visible fallback label while tests prevent native-language legal markdown from being added silently.

## Self-Check: PASSED

- Summary and all three English legal markdown files exist on disk.
- Task commits `9e134a2` and `66f0b26` exist in git history.
- No unexpected tracked file deletions were found in task commits.

---
*Phase: 23-launch-foundation*
*Completed: 2026-05-06*
