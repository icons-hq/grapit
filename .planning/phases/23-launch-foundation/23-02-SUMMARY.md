---
phase: 23-launch-foundation
plan: 02
subsystem: database
tags: [drizzle, postgres, migrations, i18n, consent, auth, legal]

requires:
  - phase: 23-launch-foundation
    provides: Shared launch contracts from 23-01
provides:
  - Expand-only Phase 23 database schema contracts
  - Preferred user locale column for profile persistence
  - Email verification token, consent audit, translation workflow, and legal content tables
  - Reviewed and locally applied Drizzle migration 0007
affects: [phase-23, auth, i18n, consent-audit, translations, legal-content]

tech-stack:
  added: []
  patterns:
    - Drizzle expand-only migrations for launch schema changes
    - Legal-sensitive copy is stored separately from translation draft rows
    - Consent audit evidence is append-only and query-indexed by item/version/language/time/IP/user

key-files:
  created:
    - apps/api/src/database/schema/launch-foundation.schema.spec.ts
    - apps/api/src/database/schema/email-verification-tokens.ts
    - apps/api/src/database/schema/consent-items.ts
    - apps/api/src/database/schema/consent-audit-logs.ts
    - apps/api/src/database/schema/translation-sources.ts
    - apps/api/src/database/schema/translation-drafts.ts
    - apps/api/src/database/schema/legal-content.ts
    - apps/api/src/database/migrations/0007_phase23_launch_foundation.sql
    - apps/api/src/database/migrations/meta/0007_snapshot.json
  modified:
    - apps/api/src/database/schema/users.ts
    - apps/api/src/database/schema/refresh-tokens.ts
    - apps/api/src/database/schema/index.ts
    - apps/api/src/database/migrations/meta/_journal.json

key-decisions:
  - "Locale enum is exported from users.ts so users.preferred_locale and launch content tables share one enum without a circular schema import."
  - "Email verification latest-token-wins is supported by user/email/purpose/created_at query indexes while retaining historical token rows."
  - "Legal content uses manual ko/en columns and is structurally separate from translation_drafts."

patterns-established:
  - "Schema contract tests can inspect Drizzle table objects directly before migration generation."
  - "Phase 23 migrations must pass destructive SQL grep before apply."

requirements-completed:
  - FLAG-01
  - I18N-01
  - I18N-02
  - TRANS-01
  - TRANS-02
  - AUTH-01
  - AUTH-02
  - COMP-01
  - COMP-02

duration: 7 min
completed: 2026-05-06
---

# Phase 23 Plan 02: Launch Foundation Schema Summary

**Expand-only Drizzle contracts now support preferred locales, email verification, consent audit evidence, translation review state, and manual legal copy.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-05-06T04:29:36Z
- **Completed:** 2026-05-06T04:36:20Z
- **Tasks:** 2
- **Files modified:** 13

## Accomplishments

- Added RED/GREEN schema contract coverage for Phase 23 database requirements.
- Added `users.preferred_locale` with default `ko`, preserving existing rows.
- Added email verification token storage with hashed token, expiry, consumed state, and latest-token query indexes.
- Added consent item and append-only consent audit tables queryable by item, version, language, timestamp, IP, and user.
- Added translation source/draft workflow tables and a separate manual-only legal content table.
- Generated and locally applied `0007_phase23_launch_foundation.sql` after destructive SQL review.

## Task Commits

1. **Task 1 RED: Add failing schema contract tests** - `e68fa07` (test)
2. **Task 1 GREEN: Add launch foundation schema contracts** - `00b0b68` (feat)
3. **Task 2: Generate, review, and apply Drizzle migration** - `fb781f1` (feat)

## Files Created/Modified

- `apps/api/src/database/schema/launch-foundation.schema.spec.ts` - Phase 23 schema contract tests.
- `apps/api/src/database/schema/users.ts` - Added shared `localeEnum` and `preferredLocale`.
- `apps/api/src/database/schema/refresh-tokens.ts` - Added active refresh-family query index.
- `apps/api/src/database/schema/email-verification-tokens.ts` - Email verification token table.
- `apps/api/src/database/schema/consent-items.ts` - Versioned consent item table.
- `apps/api/src/database/schema/consent-audit-logs.ts` - Immutable consent evidence table.
- `apps/api/src/database/schema/translation-sources.ts` - Canonical source text and translation status enum.
- `apps/api/src/database/schema/translation-drafts.ts` - Operator-reviewed translation draft table.
- `apps/api/src/database/schema/legal-content.ts` - Manual ko/en legal content table.
- `apps/api/src/database/schema/index.ts` - Exports for all new schema contracts.
- `apps/api/src/database/migrations/0007_phase23_launch_foundation.sql` - Expand-only migration SQL.
- `apps/api/src/database/migrations/meta/0007_snapshot.json` - Drizzle snapshot.
- `apps/api/src/database/migrations/meta/_journal.json` - Drizzle migration journal entry.

## Decisions Made

- Kept legal-sensitive copy outside translation drafts by using `legal_content` with manual `ko`/`en` title/body columns only.
- Used query indexes rather than a destructive uniqueness rewrite for refresh families and email verification latest-token selection.
- Placed `localeEnum` with `users` so user profile locale and content tables share the same enum without introducing circular imports.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Started local PostgreSQL and loaded root `.env` explicitly for migration apply**
- **Found during:** Task 2 (Generate, review, and apply Drizzle migration)
- **Issue:** The planned `DOTENV_CONFIG_PATH=../../.env pnpm --filter @grabit/api exec drizzle-kit migrate` command did not inject `DATABASE_URL` into the current process, and the local Postgres service was initially not accepting connections.
- **Fix:** Verified `DATABASE_URL` existed in root `.env` without printing the secret, sourced root `.env` in the shell, started the repository `postgres` Docker Compose service, waited for `healthy`, then reran `drizzle-kit migrate`.
- **Files modified:** None
- **Verification:** `drizzle-kit migrate` completed with `[✓] migrations applied successfully!`.
- **Committed in:** N/A

---

**Total deviations:** 1 auto-fixed (Rule 3: 1)  
**Impact on plan:** The migration apply gate was completed locally without changing product scope or schema design.

## Issues Encountered

- Initial `drizzle-kit migrate` failed with an unhelpful `undefined` error. A redacted `pg` connection probe showed `ECONNREFUSED`, which was resolved by starting the local Compose Postgres service.

## Known Stubs

None.

## Threat Flags

None - new security-relevant schema surfaces were already covered by the plan threat model.

## User Setup Required

None - no external service configuration required.

## Verification

- `pnpm --filter @grabit/api exec vitest run src/database/schema/launch-foundation.schema.spec.ts` - PASS, 5 tests
- `pnpm --filter @grabit/api typecheck` - PASS
- `DOTENV_CONFIG_PATH=../../.env pnpm --filter @grabit/api exec drizzle-kit generate --name=phase23_launch_foundation` - PASS, no schema changes after migration generation
- `grep -Ei "DROP TABLE|DROP COLUMN|ALTER COLUMN .* TYPE|RENAME TO|DELETE FROM|TRUNCATE" apps/api/src/database/migrations/*phase23*launch*foundation*.sql` - PASS, no matches
- `set -a; . ./.env; set +a; pnpm --filter @grabit/api exec drizzle-kit migrate` - PASS, migrations applied successfully

## TDD Gate Compliance

- RED commit exists: `e68fa07`
- GREEN commit exists after RED: `00b0b68`
- Refactor commit: Not needed

## Next Phase Readiness

Ready for downstream Phase 23 API/web plans. They can rely on database support for preferred locale persistence, email verification, refresh-family queries, consent audit evidence, translation workflow state, and legal/manual content separation.

## Self-Check: PASSED

- Summary and key schema/migration files exist on disk.
- Task commits `e68fa07`, `00b0b68`, and `fb781f1` exist in git history.
- No unexpected tracked file deletions were found in task commits.

---
*Phase: 23-launch-foundation*
*Completed: 2026-05-06*
