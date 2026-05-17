---
phase: quick-260517-mhn-admin-user-management-with-role-capabili
plan: 01
type: execute
wave: 1
depends_on: []
autonomous: true
requirements:
  - QUICK-260517-MHN
user_setup: []
files_modified:
  - packages/shared/src/schemas/admin-operations.schema.ts
  - packages/shared/src/schemas/admin-operations.schema.test.ts
  - packages/shared/src/types/admin-operations.types.ts
  - packages/shared/src/types/user.types.ts
  - packages/shared/src/schemas/user.schema.ts
  - packages/shared/src/constants/countries.ts
  - packages/shared/src/constants/countries.test.ts
  - packages/shared/src/constants/index.ts
  - apps/api/src/database/schema/users.ts
  - apps/api/src/database/schema/admin-audit-logs.ts
  - apps/api/src/database/schema/phase25-admin-operations.schema.spec.ts
  - apps/api/src/database/migrations/0020_admin_user_management.sql
  - apps/api/src/modules/user/user.repository.ts
  - apps/api/src/modules/user/user.service.ts
  - apps/api/src/modules/user/user.service.spec.ts
  - apps/api/src/modules/user/user.controller.spec.ts
  - apps/api/src/modules/auth/auth.service.ts
  - apps/api/src/modules/auth/auth.service.spec.ts
  - apps/api/src/modules/auth/strategies/jwt.strategy.ts
  - apps/api/src/common/decorators/current-user.decorator.ts
  - apps/api/src/modules/admin/admin-user.controller.ts
  - apps/api/src/modules/admin/admin-user.controller.spec.ts
  - apps/api/src/modules/admin/admin-user.service.ts
  - apps/api/src/modules/admin/admin-user.service.spec.ts
  - apps/api/src/modules/admin/admin-audit.service.ts
  - apps/api/src/modules/admin/admin-audit.service.spec.ts
  - apps/api/src/modules/admin/admin.module.ts
  - apps/web/components/admin/admin-sidebar.tsx
  - apps/web/app/admin/users/page.tsx
  - apps/web/components/admin/admin-user-management.tsx
  - apps/web/components/admin/__tests__/admin-user-management.test.tsx
  - apps/web/hooks/use-admin-users.ts
  - apps/web/e2e/helpers/mock-admin.ts
  - apps/web/e2e/admin-rbac-and-security.spec.ts
  - apps/web/e2e/admin-users.spec.ts
  - apps/web/app/mypage/page.tsx
  - apps/web/app/mypage/__tests__/mypage-account-hub.test.tsx
  - apps/web/components/auth/profile-form.tsx
  - apps/web/components/auth/__tests__/profile-form.test.tsx
  - apps/web/components/auth/signup-step3.tsx
  - apps/web/components/auth/__tests__/signup-step3-i18n.test.tsx
  - apps/web/components/auth/__tests__/auth-email-verification.test.tsx
must_haves:
  truths:
    - "Admin can open /admin/users inside the existing admin shell and search users."
    - "Admin can inspect user detail with account, verification, reservation, CS, role/capability, and masked audit context."
    - "Admin role/capability changes require reason, explicit confirmation, security.manage, and masked audit logging."
    - "Member /mypage is a mobile-first account hub with account overview, ticket wallet, and settings center."
    - "Signup and social completion expose an all-country selector with English country names and store the selected country code."
  artifacts:
    - path: "apps/api/src/modules/admin/admin-user.controller.ts"
      provides: "Admin user management API routes"
      exports: ["AdminUserController"]
    - path: "apps/api/src/modules/admin/admin-user.service.ts"
      provides: "Search/detail/permission update service with audit writes"
      exports: ["AdminUserService"]
    - path: "apps/web/app/admin/users/page.tsx"
      provides: "Admin users route within existing admin layout"
    - path: "apps/web/components/admin/admin-user-management.tsx"
      provides: "User list, detail, role/capability controls, reason/confirmation UI"
    - path: "apps/web/app/mypage/page.tsx"
      provides: "Account hub, ticket wallet, settings center tabs"
    - path: "packages/shared/src/constants/countries.ts"
      provides: "All-country English selector options"
  key_links:
    - from: "apps/api/src/modules/auth/strategies/jwt.strategy.ts"
      to: "packages/shared/src/types/admin-operations.types.ts"
      via: "Request user carries adminCapabilityBundle/adminCapabilities for AdminCapabilitiesGuard"
      pattern: "adminCapabilityBundle|adminCapabilities"
    - from: "apps/api/src/modules/admin/admin-user.service.ts"
      to: "apps/api/src/modules/admin/admin-audit.service.ts"
      via: "permission updates write security.permission.update audit rows"
      pattern: "auditService\\.write"
    - from: "apps/web/components/admin/admin-user-management.tsx"
      to: "/api/v1/admin/users"
      via: "useAdminUsers hook"
      pattern: "useAdminUsers"
    - from: "apps/web/components/auth/signup-step3.tsx"
      to: "packages/shared/src/constants/countries.ts"
      via: "country select options"
      pattern: "COUNTRY_OPTIONS"
---

<objective>
Create one executable quick-task plan for 260517-mhn.

Purpose: Deliver admin user management with role/capability controls, expand member MyPage into a complete account hub/ticket wallet/settings center, and replace the limited signup country picker with an English all-country selector.

Output: Backend API/contracts/migration/tests, existing-shell admin UI/tests, MyPage UX expansion/tests, all-country signup selector/tests, and verification commands.
</objective>

<execution_context>
@/Users/sangwopark19/.codex/get-shit-done/workflows/execute-plan.md
@/Users/sangwopark19/.codex/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@AGENTS.md
@.planning/quick/260517-mhn-admin-user-management-with-role-capabili/260517-mhn-CONTEXT.md
@apps/web/app/admin/page.tsx
@apps/web/app/admin/layout.tsx
@apps/web/components/admin/admin-sidebar.tsx
@apps/web/app/mypage/page.tsx
@apps/web/components/auth/profile-form.tsx
@apps/web/components/auth/signup-step3.tsx
@apps/api/src/modules/user/user.controller.ts
@apps/api/src/modules/user/user.service.ts
@apps/api/src/modules/user/user.repository.ts
@apps/api/src/modules/admin/admin.module.ts
@apps/api/src/modules/admin/admin-audit.service.ts
@apps/api/src/modules/auth/strategies/jwt.strategy.ts
@packages/shared/src/types/user.types.ts
@packages/shared/src/types/admin-operations.types.ts
@packages/shared/src/schemas/admin-operations.schema.ts

<interfaces>
Existing contracts and patterns to preserve:
- `AdminSidebar` is the existing admin shell navigation; add `/admin/users` under the existing "감사·보안" or "운영" grouping without creating a new admin app layout.
- `AdminAuditService.write(input)` masks email, phone, IP, and sensitive scalar fields through snapshot masking. Use it for permission changes.
- `AdminCapabilitiesGuard` reads `resolveAdminCapabilitySnapshot(request.user)` from `@grabit/shared`. JWT validation must return `adminCapabilityBundle` and `adminCapabilities` so capability checks use DB truth.
- `users.role` remains the coarse access role. Use `role='admin'` to enter the admin shell, and use `admin_capability_bundle` plus `admin_capabilities` for per-admin capabilities.
- `UserProfile` currently returns `country`, `preferredLocale`, email/phone verification, and role. Extend it to include `marketingConsent`, `adminCapabilityBundle`, and `adminCapabilities` where relevant.
- `updateProfileSchema` already supports `preferredLocale`; extend the existing profile update path rather than adding a separate settings API.
- `SignupStep3` currently has a short localized `COUNTRY_OPTIONS` list. Replace that list with shared English country labels for all locales and keep the submitted value as the existing user `country` field.
</interfaces>

<source_audit>
SOURCE | ID | Feature/Requirement | Plan | Status | Notes
GOAL | QUICK-260517-MHN | Admin user management with role/capability controls, MyPage account hub/ticket wallet/settings expansion, signup English all-country selector | 01 | COVERED | Single quick-task plan
REQ | QUICK-260517-MHN-01 | Existing `/admin` shell gains user list/search/detail and role/capability controls | 01 Task 1, Task 2 | COVERED | Uses `/admin/users`
REQ | QUICK-260517-MHN-02 | Sensitive admin actions require reason/confirmation/audit | 01 Task 1, Task 2 | COVERED | `security.permission.update`, masked audit diff
REQ | QUICK-260517-MHN-03 | MyPage includes account hub, ticket wallet, and settings center | 01 Task 3 | COVERED | Mobile-first member UX
REQ | QUICK-260517-MHN-04 | Signup exposes all countries in English and stores selected country in current field | 01 Task 3 | COVERED | Shared country constants
REQ | QUICK-260517-MHN-05 | Implementation, tests, and verification included | 01 Tasks 1-3 | COVERED | Automated commands listed per task
CONTEXT | D-01 | Admin User Management Scope | 01 Task 1, Task 2 | COVERED | Search/list/detail, context, verification, CS/reservation, audit, role/capability
CONTEXT | D-02 | Member MyPage Scope | 01 Task 3 | COVERED | All three selected directions included
CONTEXT | D-03 | Signup Country Selector | 01 Task 3 | COVERED | English all-country selector
CONTEXT | D-04 | Delivery | 01 Tasks 1-3 | COVERED | Scoped implementation + verification
RESEARCH | R-01 | Respect existing Next.js/NestJS/Tailwind/Radix patterns | 01 Tasks 1-3 | COVERED | No new external dependency
</source_audit>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add admin user management API contracts, persistence, and audit</name>
  <files>packages/shared/src/schemas/admin-operations.schema.ts, packages/shared/src/schemas/admin-operations.schema.test.ts, packages/shared/src/types/admin-operations.types.ts, packages/shared/src/types/user.types.ts, packages/shared/src/schemas/user.schema.ts, apps/api/src/database/schema/users.ts, apps/api/src/database/schema/admin-audit-logs.ts, apps/api/src/database/schema/phase25-admin-operations.schema.spec.ts, apps/api/src/database/migrations/0020_admin_user_management.sql, apps/api/src/modules/user/user.repository.ts, apps/api/src/modules/user/user.service.ts, apps/api/src/modules/user/user.service.spec.ts, apps/api/src/modules/user/user.controller.spec.ts, apps/api/src/modules/auth/auth.service.ts, apps/api/src/modules/auth/auth.service.spec.ts, apps/api/src/modules/auth/strategies/jwt.strategy.ts, apps/api/src/common/decorators/current-user.decorator.ts, apps/api/src/modules/admin/admin-user.controller.ts, apps/api/src/modules/admin/admin-user.controller.spec.ts, apps/api/src/modules/admin/admin-user.service.ts, apps/api/src/modules/admin/admin-user.service.spec.ts, apps/api/src/modules/admin/admin-audit.service.ts, apps/api/src/modules/admin/admin-audit.service.spec.ts, apps/api/src/modules/admin/admin.module.ts</files>
  <behavior>
    - Test 1: `GET /api/v1/admin/users?search=fan` returns paged rows with masked email/phone display fields, role, capability bundle, verification state, reservation summary, and last activity.
    - Test 2: `GET /api/v1/admin/users/:id` returns account overview, verification state, reservation counts/status summary, recent reservation rows, support thread summary from existing `support_threads`, and recent masked audit rows.
    - Test 3: `PATCH /api/v1/admin/users/:id/permissions` rejects missing `reason`, missing `confirmed: true`, unsupported bundle/capability values, non-`security.manage` actors, self-demotion that removes the actor's own `security.manage`, and changes that would leave no admin-capable account.
    - Test 4: A valid permission update persists `role`, `adminCapabilityBundle`, and `adminCapabilities`, invalidates stale capability assumptions by returning the updated profile shape, and writes `security.permission.update` with masked before/after snapshots and changed fields.
  </behavior>
  <action>Implement D-01 and D-04 backend scope. Add shared schemas/types for `adminUserListQuery`, `adminUserListItem`, `adminUserDetail`, and `adminUserPermissionUpdate` using the existing `ADMIN_CAPABILITIES` and `ADMIN_CAPABILITY_BUNDLES`. Extend `users` with nullable `admin_capability_bundle` and non-null JSONB `admin_capabilities` defaulting to `[]`; add `marketing_consent` to returned profile contracts if missing from API output. Add migration `0020_admin_user_management.sql` that adds the user capability columns and adds `security.permission.update` to `admin_audit_action` only if the current enum lacks it. Keep existing admin accounts operational by backfilling current `role='admin'` rows to `admin_capability_bundle='admin'`. Update `resolveAdminCapabilitySnapshot` semantics so `role='admin'` with explicit non-admin bundle/capabilities is limited by those values, while legacy admin rows without capability fields still satisfy all capabilities. Extend JWT validation and `RequestUser` with capability fields. Create `AdminUserController` under `@Controller('admin/users')`, guarded by `RolesGuard` and `AdminCapabilitiesGuard`; read routes require `audit.read`, permission mutation requires `security.manage`. Create `AdminUserService` for search/detail/permission update. Use existing `reservations`, `support_threads`, `consent_audit_logs`, and `admin_audit_logs` data for context; do not invent unsupported note storage. Permission update must require `reason` and `confirmed: true`, protect self-lockout and last admin-capable account, normalize capabilities through shared schemas, and call `AdminAuditService.write` with action `security.permission.update`, resourceType `user`, resourceId target user id, changedFields, masked before/after, actor IP, user-agent, and request id when present. Register the controller/service in `AdminModule`.</action>
  <verify>
    <automated>pnpm --filter @grabit/shared test -- src/schemas/admin-operations.schema.test.ts</automated>
    <automated>pnpm --filter @grabit/api test -- src/database/schema/phase25-admin-operations.schema.spec.ts src/modules/admin/admin-user.controller.spec.ts src/modules/admin/admin-user.service.spec.ts src/modules/admin/admin-audit.service.spec.ts src/modules/user/user.service.spec.ts src/modules/user/user.controller.spec.ts src/modules/auth/auth.service.spec.ts src/common/guards/admin-capabilities.guard.spec.ts</automated>
    <automated>pnpm --filter @grabit/api typecheck</automated>
  </verify>
  <done>Admin user API exposes search/detail/permission update; per-admin capability truth is persisted and available to guards; sensitive permission changes are reasoned, confirmed, self-lockout protected, and audit logged with masked diffs.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Build `/admin/users` inside the existing admin shell</name>
  <files>apps/web/components/admin/admin-sidebar.tsx, apps/web/app/admin/users/page.tsx, apps/web/components/admin/admin-user-management.tsx, apps/web/components/admin/__tests__/admin-user-management.test.tsx, apps/web/hooks/use-admin-users.ts, apps/web/e2e/helpers/mock-admin.ts, apps/web/e2e/admin-rbac-and-security.spec.ts, apps/web/e2e/admin-users.spec.ts</files>
  <behavior>
    - Test 1: The admin sidebar preserves existing labels and adds a visible `/admin/users` link without changing `/admin` layout behavior.
    - Test 2: `/admin/users` renders search, verification filters, role/capability summary, reservation/account context, CS context, and masked audit context from mocked API data.
    - Test 3: The role/capability editor shows bundle and capability controls, requires a reason, requires explicit confirmation, and calls `PATCH /api/v1/admin/users/:id/permissions` with `confirmed: true`.
    - Test 4: Successful mutation invalidates user list/detail and audit query state; API errors render an actionable error state without clearing the current detail view.
  </behavior>
  <action>Implement D-01 and D-04 admin UI scope using the existing `/admin` shell, Tailwind, local UI primitives, TanStack Query hook style, and lucide icons. Add `useAdminUsers`, `useAdminUserDetail`, and `useUpdateAdminUserPermissions` in `apps/web/hooks/use-admin-users.ts`; normalize search/filter params and invalidate `['admin','users']` plus `['admin','audit']` on mutation success. Add `AdminUserManagement` with a responsive two-pane desktop layout and stacked mobile layout: searchable user table/list, selected user detail, account overview, verification badges, reservation summary, support/CS summary, recent masked audit events, and role/capability editor. Use familiar controls: search input, select menus for role/bundle, checkboxes or toggles for individual capabilities, textarea for reason, and `AlertDialog` for final confirmation. Do not add a separate admin app or alternate shell. Add sidebar link labeled `회원 관리`. Update Playwright admin fixture so mocked admin users include `preferredLocale`, `country`, `marketingConsent`, `adminCapabilityBundle`, and `adminCapabilities`. Extend the existing admin RBAC smoke to assert the new link remains visible and add `admin-users.spec.ts` for list/detail/permission update flow.</action>
  <verify>
    <automated>pnpm --filter @grabit/web test -- components/admin/__tests__/admin-user-management.test.tsx</automated>
    <automated>pnpm --filter @grabit/web typecheck</automated>
    <automated>pnpm --filter @grabit/web test:e2e -- admin-rbac-and-security.spec.ts admin-users.spec.ts</automated>
  </verify>
  <done>`/admin/users` is reachable from the existing admin sidebar, supports user search/detail, displays account/reservation/CS/audit context, and performs reasoned confirmed role/capability updates against the new API.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Expand MyPage and replace signup country selector with English all-country options</name>
  <files>packages/shared/src/constants/countries.ts, packages/shared/src/constants/countries.test.ts, packages/shared/src/constants/index.ts, packages/shared/src/types/user.types.ts, packages/shared/src/schemas/user.schema.ts, apps/api/src/modules/user/user.service.ts, apps/api/src/modules/user/user.service.spec.ts, apps/api/src/modules/user/user.controller.spec.ts, apps/web/app/mypage/page.tsx, apps/web/app/mypage/__tests__/mypage-account-hub.test.tsx, apps/web/components/auth/profile-form.tsx, apps/web/components/auth/__tests__/profile-form.test.tsx, apps/web/components/auth/signup-step3.tsx, apps/web/components/auth/__tests__/signup-step3-i18n.test.tsx, apps/web/components/auth/__tests__/auth-email-verification.test.tsx</files>
  <behavior>
    - Test 1: `/mypage` exposes three first-class areas: account hub, ticket wallet, and settings center; mobile view uses stable segmented/tab controls and does not hide ticket/refund status behind the old simple profile form.
    - Test 2: Account hub shows profile basics, email/phone verification state, country, preferred language, marketing consent/account status, account age, and quick actions.
    - Test 3: Ticket wallet prominently summarizes reservation counts by status and renders scannable reservation/ticket/refund cards using existing `ReservationList`/reservation hooks.
    - Test 4: Settings center allows profile edits, phone re-verification, preferred language update, marketing communication consent update, and logout/session action through the existing profile API path.
    - Test 5: Signup and social completion country select includes all ISO-3166 country options with English labels in every locale and stores the selected code in `country`.
  </behavior>
  <action>Implement D-02, D-03, and D-04. Add shared `COUNTRY_OPTIONS` in `packages/shared/src/constants/countries.ts` with ISO-3166 alpha-2 codes and English names, including `KR` as `South Korea`, `US` as `United States`, and a complete all-country list; export it through `constants/index.ts`. Update `SignupStep3` to use `COUNTRY_OPTIONS` for the select and remove the short localized country list behavior. Keep submitted values as country codes so the existing `users.country` field stores the selected country without schema replacement. Update signup tests so country labels are English across locales and include coverage for at least `Afghanistan`, `Brazil`, `Japan`, `South Korea`, `United States`, and `Zimbabwe`, plus a count assertion above 200 options. Expand `UserProfile` and `updateProfileSchema` to include `marketingConsent`; update `UserService` and repository update shape so settings can persist preferred locale and marketing communication consent through `PATCH /api/v1/users/me`. Rework `apps/web/app/mypage/page.tsx` into a calm mobile-first account hub with three tabs or segmented sections: `계정`, `티켓 지갑`, `설정`. Keep `ProfileForm` as the settings form core but add preferred language, communication consent, verification/account overview affordances, and clear logout/session controls. Use existing `useMyReservations` and `ReservationList` where useful, but add summary cards and status grouping so reservation/ticket/refund state is scannable before the full list.</action>
  <verify>
    <automated>pnpm --filter @grabit/shared test -- src/constants/countries.test.ts</automated>
    <automated>pnpm --filter @grabit/api test -- src/modules/user/user.service.spec.ts src/modules/user/user.controller.spec.ts</automated>
    <automated>pnpm --filter @grabit/web test -- app/mypage/__tests__/mypage-account-hub.test.tsx components/auth/__tests__/profile-form.test.tsx components/auth/__tests__/signup-step3-i18n.test.tsx components/auth/__tests__/auth-email-verification.test.tsx</automated>
    <automated>pnpm --filter @grabit/web typecheck</automated>
  </verify>
  <done>MyPage is a complete account hub/ticket wallet/settings center, profile settings persist language and marketing communication consent, and signup/social completion expose all countries in English while storing the selected country code.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| admin browser -> admin API | Search, user detail, and permission update inputs cross from an authenticated browser into privileged API handlers. |
| admin API -> database | Permission and audit writes mutate user privilege state and audit rows. |
| member browser -> profile API | MyPage settings update profile, phone, language, and communication consent. |
| signup browser -> auth API | Country codes and personal information are submitted during registration/social completion. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-MHN-01 | E | `AdminUserController.patchPermissions` | mitigate | Guard with `RolesGuard` plus `AdminCapabilitiesGuard` requiring `security.manage`; validate body with shared Zod schema. |
| T-MHN-02 | T | `AdminUserService.updatePermissions` | mitigate | Require reason and `confirmed: true`; normalize bundle/capabilities through shared enums; reject self-lockout and last admin-capable removal. |
| T-MHN-03 | R | `AdminAuditService.write` permission updates | mitigate | Write `security.permission.update` audit rows with actor, resource, reason, changedFields, request context, and masked before/after snapshots. |
| T-MHN-04 | I | Admin user list/detail UI/API | mitigate | Return masked email/phone display fields for list/audit context; expose full PII only where existing authenticated admin detail policy already permits it. |
| T-MHN-05 | T | `PATCH /api/v1/users/me` settings | mitigate | Reuse `updateProfileSchema`; require phone verification token for phone change; validate preferred locale and marketing consent types. |
| T-MHN-06 | S | signup country selector | mitigate | Submit canonical country code from shared `COUNTRY_OPTIONS`; reject empty or unknown codes in shared schema tests. |
</threat_model>

<verification>
Run focused checks after the three tasks:
- `pnpm --filter @grabit/shared test -- src/schemas/admin-operations.schema.test.ts src/constants/countries.test.ts`
- `pnpm --filter @grabit/api test -- src/modules/admin/admin-user.controller.spec.ts src/modules/admin/admin-user.service.spec.ts src/modules/admin/admin-audit.service.spec.ts src/modules/user/user.service.spec.ts src/modules/user/user.controller.spec.ts src/common/guards/admin-capabilities.guard.spec.ts`
- `pnpm --filter @grabit/web test -- components/admin/__tests__/admin-user-management.test.tsx app/mypage/__tests__/mypage-account-hub.test.tsx components/auth/__tests__/profile-form.test.tsx components/auth/__tests__/signup-step3-i18n.test.tsx`
- `pnpm --filter @grabit/api typecheck`
- `pnpm --filter @grabit/web typecheck`
- `pnpm --filter @grabit/web test:e2e -- admin-rbac-and-security.spec.ts admin-users.spec.ts`
</verification>

<success_criteria>
Quick task is complete when:
- Admin `/admin/users` is reachable from the existing sidebar and supports search/list/detail.
- Admin user detail includes account, verification, reservation, CS, role/capability, and masked audit context.
- Admin permission changes require reason and confirmation, are capability-guarded, and write masked audit rows.
- MyPage has account hub, ticket wallet, and settings center as first-class mobile-friendly sections.
- Settings persist profile, preferred language, marketing communication consent, phone re-verification, and logout/session action.
- Signup and social completion country select show all countries in English and submit the selected country code.
- All automated verification commands in this plan pass or produce an explicit SUMMARY blocker with exact failing command and file.
</success_criteria>

<output>
After completion, create `.planning/quick/260517-mhn-admin-user-management-with-role-capabili/260517-mhn-SUMMARY.md`.
</output>
