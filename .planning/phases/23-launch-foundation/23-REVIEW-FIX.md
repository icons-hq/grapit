---
phase: 23-launch-foundation
fixed_at: 2026-05-07T00:52:34Z
review_path: .planning/phases/23-launch-foundation/23-REVIEW.md
iteration: 1
findings_in_scope: 9
fixed: 9
skipped: 0
status: all_fixed
---

# Phase 23: Code Review Fix Report

**Fixed at:** 2026-05-07T00:52:34Z
**Source review:** .planning/phases/23-launch-foundation/23-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 9
- Fixed: 9
- Skipped: 0

## Fixed Issues

### CR-01: SMS verified flag alone can authorize phone ownership

**Status:** fixed: requires human verification
**Files modified:** `apps/api/src/modules/auth/auth.service.ts`, `apps/api/src/modules/auth/auth.service.spec.ts`, `apps/api/src/modules/auth/dto/auth-consent.dto.spec.ts`, `apps/api/src/modules/auth/dto/register.dto.ts`, `apps/api/src/modules/auth/dto/social-register.dto.ts`, `apps/api/src/modules/sms/sms.controller.ts`, `apps/api/src/modules/sms/sms.service.ts`, `apps/api/src/modules/sms/sms.service.spec.ts`, `apps/web/app/auth/callback/page.tsx`, `apps/web/components/auth/phone-verification.tsx`, `apps/web/components/auth/signup-form.tsx`, `apps/web/components/auth/signup-step3.tsx`, `apps/web/components/auth/__tests__/phone-verification.test.tsx`, `apps/web/components/auth/__tests__/signup-submit-consent.test.tsx`, `packages/shared/src/schemas/auth.schema.ts`
**Commit:** 1ebdc29
**Applied fix:** `/sms/verify-code`가 phone/purpose-bound signed token을 반환하게 하고 signup/social completion이 `phoneVerificationToken`을 검증하도록 변경했다. `isPhoneVerified(phone)` fallback은 가입 권한 증명 경로에서 제거했다.

### CR-02: Refresh token rotation can be bypassed by concurrent requests

**Status:** fixed: requires human verification
**Files modified:** `apps/api/src/modules/auth/auth.service.ts`, `apps/api/src/modules/auth/auth.service.spec.ts`
**Commit:** 0774036
**Applied fix:** refresh token rotation을 transaction으로 감싸고, `revokedAt IS NULL` 조건부 update 결과가 없으면 token family reuse로 처리하도록 변경했다.

### CR-03: Email verification is not enforced before session issuance

**Status:** fixed: requires human verification
**Files modified:** `apps/api/src/modules/auth/auth.controller.ts`, `apps/api/src/modules/auth/auth.controller.spec.ts`, `apps/api/src/modules/auth/auth.service.ts`, `apps/api/src/modules/auth/auth.service.spec.ts`, `apps/web/components/auth/signup-form.tsx`, `apps/web/components/auth/__tests__/signup-submit-consent.test.tsx`, `packages/shared/src/types/auth.types.ts`
**Commit:** 9ee34e8
**Applied fix:** password signup 직후 access/refresh token을 발급하지 않고 email verification pending response를 반환하게 했다. password login은 `isEmailVerified`를 검사해 미검증 사용자를 `EMAIL_NOT_VERIFIED`로 차단한다.

### CR-04: Profile phone updates bypass SMS verification and preserve verified state

**Status:** fixed: requires human verification
**Files modified:** `apps/api/src/modules/user/user.module.ts`, `apps/api/src/modules/user/user.repository.ts`, `apps/api/src/modules/user/user.service.ts`, `apps/api/src/modules/user/user.service.spec.ts`, `apps/web/components/auth/profile-form.tsx`, `packages/shared/src/schemas/user.schema.ts`
**Commit:** 8c034e4
**Applied fix:** profile phone change에 `profile_phone_change` purpose의 signed phone verification token을 요구하고, 검증된 변경에만 `isPhoneVerified`를 true로 저장하도록 했다.

### CR-05: Social registration links existing accounts by email without proving account ownership

**Status:** fixed: requires human verification
**Files modified:** `apps/api/src/modules/auth/auth.service.ts`, `apps/api/src/modules/auth/auth.service.spec.ts`
**Commit:** 38da740
**Applied fix:** social completion 중 동일 email의 기존 계정이 발견되면 자동 linking/session issuance를 중단하고 `ACCOUNT_LINK_CONFIRMATION_REQUIRED` conflict를 반환하도록 변경했다.

### CR-06: Translation review queue drops the Korean source text

**Status:** fixed
**Files modified:** `apps/api/src/modules/translation/translation.service.ts`, `apps/api/src/modules/translation/translation.service.spec.ts`, `apps/web/hooks/use-admin.ts`, `apps/web/app/admin/translations/page.tsx`, `apps/web/components/admin/translation-review-detail-panel.tsx`, `apps/web/components/admin/__tests__/translation-review.test.tsx`
**Commit:** 9c3ff62
**Applied fix:** translation queue API result에 `field`와 `sourceText`를 포함하고, frontend가 translated draft를 Korean source로 fallback하지 않게 했다. source text가 없으면 review/publish를 막는 error state를 표시한다.

### WR-01: Translation source creation can create unhandled promise rejections

**Status:** fixed
**Files modified:** `apps/web/components/admin/translation-source-form.tsx`, `apps/web/components/admin/__tests__/translation-review.test.tsx`
**Commit:** dd815e7
**Applied fix:** source creation과 draft generation mutation rejection을 form component에서 catch해 unhandled promise rejection이 발생하지 않게 했다.

### WR-02: DeepL error responses can mask provider failure details

**Status:** fixed
**Files modified:** `apps/api/src/modules/translation/deepl.client.ts`, `apps/api/src/modules/translation/deepl.client.spec.ts`
**Commit:** eda8b44
**Applied fix:** DeepL response body를 `text()`로 먼저 읽고, non-OK status 또는 non-JSON success response에서 status/body preview를 포함한 오류를 던지도록 변경했다.

### WR-03: Locale suggestion copy uses the current locale instead of the suggested locale

**Status:** fixed
**Files modified:** `apps/web/components/i18n/locale-suggestion.tsx`, `apps/web/components/layout/__tests__/layout-shell-locale.test.tsx`
**Commit:** 21ec1a6
**Applied fix:** locale suggestion banner copy를 active route locale이 아니라 suggested target locale 기준으로 선택하도록 변경했다.

---

_Fixed: 2026-05-07T00:52:34Z_
_Fixer: the agent (gsd-code-fixer)_
_Iteration: 1_
