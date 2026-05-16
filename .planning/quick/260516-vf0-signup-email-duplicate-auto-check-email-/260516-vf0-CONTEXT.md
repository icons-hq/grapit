# Quick Task 260516-vf0: Signup Email Verification And Social Onboarding Gates - Context

**Gathered:** 2026-05-16
**Status:** Ready for planning

<domain>
## Task Boundary

User request:

- 회원가입 시 현재 빠져 있는 이메일 중복검사와 이메일 인증을 둘 다 할 수 있게 한다.
- 일반 회원가입뿐 아니라 소셜 로그인으로 처음 가입하는 사용자도 자동 통과시키지 않는다.
- 소셜 신규 가입도 이메일 인증 및 전화번호 인증 화면을 반드시 거치게 한다.

This is a quick task against the existing auth/signup implementation. Existing backend email verification infrastructure should be reused where possible.

</domain>

<decisions>
## Implementation Decisions

### Execution Scope

- User selected: plan first, then implement in the same quick task.

### Email Verification UX

- User selected: reuse the existing link-based email verification flow.
- Do not design a new screen-entered email OTP unless the current code makes the existing link flow unusable.
- The expected user-facing path is the existing `/auth/verify-email?token=...` route and `EmailVerificationStatus` component.

### Email Duplicate Check UX

- User selected: automatic duplicate check.
- Do not require a dedicated "중복확인" button.
- The signup credentials step should check email availability automatically on blur and/or before moving to the next signup step.

### Social Signup Gate

- New social users must still complete phone verification.
- New social users must also complete email verification before they receive authenticated app access.
- Existing social accounts should not bypass email verification if their linked user row is not verified.

</decisions>

<specifics>
## Specific Ideas

- Backend already has email verification endpoints and token storage; planner should verify current behavior before adding new API surface.
- `SignupStep3` is shared by normal signup and social completion, so phone verification should remain common unless the code proves otherwise.
- Social completion currently returns an authenticated response; this likely needs to become a pending email-verification response or equivalent gate.
- Normal signup already appears to return an email-verification pending response; the frontend may need better step-1 duplicate handling more than new final-submit behavior.

</specifics>

<canonical_refs>
## Canonical References

- `apps/api/src/modules/auth/auth.service.ts`
- `apps/api/src/modules/auth/auth.controller.ts`
- `apps/api/src/modules/auth/dto/register.dto.ts`
- `apps/api/src/modules/auth/dto/social-register.dto.ts`
- `apps/web/components/auth/signup-form.tsx`
- `apps/web/components/auth/signup-step1.tsx`
- `apps/web/components/auth/signup-step3.tsx`
- `apps/web/components/auth/email-verification-status.tsx`
- `apps/web/app/auth/callback/page.tsx`
- `apps/web/app/auth/verify-email/page.tsx`
- `packages/shared/src/types/auth.types.ts`
- `packages/shared/src/schemas/auth.schema.ts`

</canonical_refs>
