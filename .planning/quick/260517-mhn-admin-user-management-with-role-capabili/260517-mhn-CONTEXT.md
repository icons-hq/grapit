# Quick Task 260517-mhn: Admin user management, mypage account hub, and signup country selector - Context

**Gathered:** 2026-05-17
**Status:** Ready for planning

<domain>
## Task Boundary

Build a production-grade admin user management surface and a substantially richer member mypage experience for Grabit.

The admin work must add user management, including role/capability controls, while fitting the existing `/admin` shell and Phase 25 audit/security model. The member mypage work must become a full account hub that also covers ticket wallet and settings workflows. Signup must support selecting any country in English.

</domain>

<decisions>
## Implementation Decisions

### Admin User Management Scope

- Include user search/list, user detail, reservation/account context, verification state, account/CS notes if supported by existing data, audit visibility, and role/capability management.
- Because this touches privileges, every sensitive admin action must require an explicit reason/confirmation where appropriate and write masked audit logs.
- Preserve Phase 25 security truth: MFA remains deferred accepted risk unless a separate phase implements it; do not present this quick task as resolving MFA.

### Member MyPage Scope

- Include all three directions selected by the user:
  - Account hub: profile, verification, language, consent/account status, and account overview.
  - Ticket wallet: reservation/ticket/refund status should be prominent and easier to scan.
  - Settings center: profile, communication, language, and account/session actions should feel complete instead of a basic form.
- UI should be mobile-first, information-dense but calm, and suitable for repeated use by ticket buyers.

### Signup Country Selector

- Registration must expose a country selector with all countries shown in English.
- The selector should keep the existing signup flow behavior intact and store the selected country using the current user schema country field.

### Delivery

- Proceed beyond planning into implementation and verification.
- Keep changes scoped to this quick task and consistent with existing Next.js/NestJS/Tailwind/Radix patterns.

</decisions>

<specifics>
## Specific Ideas

- Reuse the existing admin sidebar, local `apps/web/components/ui` primitives, audit service, capability guard, and admin route conventions.
- Avoid a new admin app layout; add a focused `/admin/users` route.
- Add enough API and UI contract tests to prevent silent privilege or account-regression bugs.

</specifics>

<canonical_refs>
## Canonical References

- `.planning/STATE.md`
- `AGENTS.md`
- Existing Phase 25 admin shell and audit/security implementation
- Existing `/mypage` and signup/auth flow

</canonical_refs>
