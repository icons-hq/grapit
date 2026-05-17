---
phase: quick-260517-mhn-admin-user-management-with-role-capabili
plan: "01"
subsystem: admin-users-mypage
tags: [admin, rbac, audit, mypage, signup, countries, nextjs, nestjs]
requires:
  - phase: quick-260517-mhn-admin-user-management-with-role-capabili
    provides: "Locked discussion decisions in 260517-mhn-CONTEXT.md"
provides:
  - "Admin `/admin/users` route with user search, detail context, and role/capability editor"
  - "Reasoned and confirmed admin permission API with security.manage guard and masked audit logging"
  - "Member MyPage account hub, ticket wallet, and settings center"
  - "Signup country selector backed by all ISO-3166 alpha-2 countries with English labels"
affects: [admin-console, auth-user-profile, mypage, signup, user-permissions]
tech-stack:
  added: []
  patterns:
    - "Admin privilege mutation requires reason, explicit confirmation, security.manage, and audit write"
    - "Frontend admin users hook adapts API response contracts into a stable UI view model"
    - "Country selector values remain ISO-3166 alpha-2 codes while labels are English"
key-files:
  created:
    - "apps/api/src/modules/admin/admin-user.controller.ts"
    - "apps/api/src/modules/admin/admin-user.service.ts"
    - "apps/api/src/database/migrations/0020_admin_user_management.sql"
    - "apps/web/app/admin/users/page.tsx"
    - "apps/web/components/admin/admin-user-management.tsx"
    - "apps/web/hooks/use-admin-users.ts"
    - "packages/shared/src/constants/countries.ts"
  modified:
    - "apps/web/app/mypage/page.tsx"
    - "apps/web/components/auth/profile-form.tsx"
    - "apps/web/components/auth/signup-step3.tsx"
    - "packages/shared/src/schemas/admin-operations.schema.ts"
    - "packages/shared/src/schemas/user.schema.ts"
    - "packages/shared/src/types/user.types.ts"
key-decisions:
  - "Role/capability management is included, but MFA remains the existing deferred accepted risk."
  - "MyPage includes all three selected directions: account hub, ticket wallet, and settings center."
  - "Signup country labels are English for every locale, while persisted values remain country codes."
requirements-completed: [QUICK-260517-MHN]
duration: "26m01s"
completed: "2026-05-17T07:37:35Z"
status: complete
---

# Quick 260517-mhn: Admin Users + MyPage Summary

Admin user management, member MyPage, and signup country selection were implemented and verified.

## Accomplishments

- Added admin user management backend contracts, DB columns, migration journal entry, controller, service, and tests.
- Added `/admin/users` to the existing admin shell with search, user detail, verification badges, reservation/CS/audit context, and a reasoned confirmation flow for role/capability changes.
- Extended JWT/current-user capability truth so `AdminCapabilitiesGuard` can use persisted bundle/capability data.
- Extended profile updates to persist `preferredLocale` and `marketingConsent`.
- Rebuilt `/mypage` as a mobile-first account hub with account, ticket wallet, and settings sections.
- Replaced the short signup country list with shared all-country English options.
- Fixed an integration mismatch between the backend user-management API shape and the admin UI view model before final verification.

## Task Commits

1. **Planning checkpoint:** `7da2214` `docs(260517-mhn): pre-dispatch plan for admin user management`
2. **Implementation:** `4f701e5` `feat(quick-260517-mhn): add admin users and account hub`

## Verification

| Command | Result |
| --- | --- |
| `pnpm --filter @grabit/shared test -- src/schemas/admin-operations.schema.test.ts src/constants/countries.test.ts` | Passed: 9 files, 53 tests |
| `pnpm --filter @grabit/api test -- src/modules/admin/admin-user.controller.spec.ts src/modules/admin/admin-user.service.spec.ts src/modules/admin/admin-audit.service.spec.ts src/modules/user/user.service.spec.ts src/modules/user/user.controller.spec.ts src/common/guards/admin-capabilities.guard.spec.ts` | Passed: 67 files, 698 tests |
| `pnpm --filter @grabit/web test -- components/admin/__tests__/admin-user-management.test.tsx app/mypage/__tests__/mypage-account-hub.test.tsx components/auth/__tests__/profile-form.test.tsx components/auth/__tests__/signup-step3-i18n.test.tsx` | Passed: 75 files, 447 tests; existing jsdom/React warning output remains |
| `pnpm --filter @grabit/shared typecheck && pnpm --filter @grabit/api typecheck && pnpm --filter @grabit/web typecheck` | Passed |
| `pnpm --filter @grabit/web test:e2e -- admin-rbac-and-security.spec.ts admin-users.spec.ts` | Passed: 4 tests |
| `pnpm --filter @grabit/web build` | Passed; production build includes `/admin/users` and `/mypage` |
| `git diff --check` | Passed |

## Notes

- The in-app Browser MCP could not be opened because the shared Playwright Chrome profile was locked. Equivalent Chromium route verification was completed through Playwright E2E against the local dev server.
- Existing test-suite warning noise remains in unrelated areas: React `act(...)`, jsdom `window.scrollTo`, and mocked failure logs. No verification command failed.

## Self-Check: PASSED

- `260517-mhn-CONTEXT.md` and `260517-mhn-PLAN.md` exist.
- Implementation commit exists: `4f701e5`.
- Summary artifact exists: `.planning/quick/260517-mhn-admin-user-management-with-role-capabili/260517-mhn-SUMMARY.md`.
- Quick task is ready for docs/state commit.
