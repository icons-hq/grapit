---
phase: 23-launch-foundation
reviewed: "2026-05-06T09:28:14Z"
depth: standard
files_reviewed: 156
files_reviewed_list:
  - .env.example
  - apps/api/src/app.module.ts
  - apps/api/src/database/migrations/0007_phase23_launch_foundation.sql
  - apps/api/src/database/migrations/0008_consent_audit_source_flow.sql
  - apps/api/src/database/migrations/meta/0007_snapshot.json
  - apps/api/src/database/migrations/meta/0008_snapshot.json
  - apps/api/src/database/migrations/meta/_journal.json
  - apps/api/src/database/schema/consent-audit-logs.ts
  - apps/api/src/database/schema/consent-items.ts
  - apps/api/src/database/schema/email-verification-tokens.ts
  - apps/api/src/database/schema/index.ts
  - apps/api/src/database/schema/launch-foundation.schema.spec.ts
  - apps/api/src/database/schema/legal-content.ts
  - apps/api/src/database/schema/refresh-tokens.ts
  - apps/api/src/database/schema/translation-drafts.ts
  - apps/api/src/database/schema/translation-sources.ts
  - apps/api/src/database/schema/users.ts
  - apps/api/src/modules/auth/auth.controller.spec.ts
  - apps/api/src/modules/auth/auth.controller.ts
  - apps/api/src/modules/auth/auth.module.ts
  - apps/api/src/modules/auth/auth.service.spec.ts
  - apps/api/src/modules/auth/auth.service.ts
  - apps/api/src/modules/auth/dto/auth-consent.dto.spec.ts
  - apps/api/src/modules/auth/dto/register.dto.ts
  - apps/api/src/modules/auth/dto/social-register.dto.ts
  - apps/api/src/modules/auth/email/email.service.spec.ts
  - apps/api/src/modules/auth/email/email.service.ts
  - apps/api/src/modules/auth/email/templates/email-verification.copy.spec.ts
  - apps/api/src/modules/auth/email/templates/email-verification.copy.ts
  - apps/api/src/modules/auth/email/templates/email-verification.tsx
  - apps/api/src/modules/booking/__tests__/booking.service.integration.spec.ts
  - apps/api/src/modules/booking/__tests__/booking.service.spec.ts
  - apps/api/src/modules/booking/booking.module.ts
  - apps/api/src/modules/booking/booking.service.ts
  - apps/api/src/modules/consent/consent-audit.controller.spec.ts
  - apps/api/src/modules/consent/consent-audit.controller.ts
  - apps/api/src/modules/consent/consent.controller.ts
  - apps/api/src/modules/consent/consent.module.ts
  - apps/api/src/modules/consent/consent.service.spec.ts
  - apps/api/src/modules/consent/consent.service.ts
  - apps/api/src/modules/feature-flags/feature-flags.module.ts
  - apps/api/src/modules/feature-flags/feature-flags.service.spec.ts
  - apps/api/src/modules/feature-flags/feature-flags.service.ts
  - apps/api/src/modules/reservation/reservation.module.ts
  - apps/api/src/modules/reservation/reservation.service.spec.ts
  - apps/api/src/modules/reservation/reservation.service.ts
  - apps/api/src/modules/sms/sms-copy.spec.ts
  - apps/api/src/modules/sms/sms-copy.ts
  - apps/api/src/modules/sms/sms.service.spec.ts
  - apps/api/src/modules/sms/sms.service.ts
  - apps/api/src/modules/translation/deepl.client.spec.ts
  - apps/api/src/modules/translation/deepl.client.ts
  - apps/api/src/modules/translation/translation.controller.ts
  - apps/api/src/modules/translation/translation.module.ts
  - apps/api/src/modules/translation/translation.service.spec.ts
  - apps/api/src/modules/translation/translation.service.ts
  - apps/api/src/modules/user/user.controller.spec.ts
  - apps/api/src/modules/user/user.repository.ts
  - apps/api/src/modules/user/user.service.spec.ts
  - apps/api/src/modules/user/user.service.ts
  - apps/api/test/booking-cluster-lua.integration.spec.ts
  - apps/web/app/__tests__/sitemap.test.ts
  - apps/web/app/admin/consent-audit/page.tsx
  - apps/web/app/admin/translations/page.tsx
  - apps/web/app/api/runtime-flags/route.ts
  - apps/web/app/auth/verify-email/page.tsx
  - apps/web/app/booking/[performanceId]/confirm/page.tsx
  - apps/web/app/layout-shell.tsx
  - apps/web/app/layout.tsx
  - apps/web/app/legal/__tests__/legal-fallback.test.tsx
  - apps/web/app/legal/marketing/page.tsx
  - apps/web/app/legal/privacy/page.tsx
  - apps/web/app/legal/terms/page.tsx
  - apps/web/app/performance/[id]/__tests__/performance-detail-formatting.test.tsx
  - apps/web/app/performance/[id]/__tests__/performance-detail-translation-label.test.tsx
  - apps/web/app/performance/[id]/page.tsx
  - apps/web/app/sitemap.ts
  - apps/web/components/admin/__tests__/consent-audit-table.test.tsx
  - apps/web/components/admin/__tests__/translation-review.test.tsx
  - apps/web/components/admin/admin-sidebar.tsx
  - apps/web/components/admin/consent-audit-table.tsx
  - apps/web/components/admin/translation-review-detail-panel.tsx
  - apps/web/components/admin/translation-review-table.tsx
  - apps/web/components/admin/translation-source-form.tsx
  - apps/web/components/auth/__tests__/auth-email-verification.test.tsx
  - apps/web/components/auth/__tests__/phone-verification-i18n.test.tsx
  - apps/web/components/auth/__tests__/phone-verification.test.tsx
  - apps/web/components/auth/__tests__/signup-consent.test.tsx
  - apps/web/components/auth/__tests__/signup-submit-consent.test.tsx
  - apps/web/components/auth/auth-launch-copy.ts
  - apps/web/components/auth/email-verification-status.tsx
  - apps/web/components/auth/login-form.tsx
  - apps/web/components/auth/phone-verification.tsx
  - apps/web/components/auth/signup-form.tsx
  - apps/web/components/auth/signup-step2.tsx
  - apps/web/components/booking/booking-page.tsx
  - apps/web/components/booking/seat-selection-panel.tsx
  - apps/web/components/booking/seat-selection-sheet.tsx
  - apps/web/components/i18n/__tests__/automatic-translation-label.test.tsx
  - apps/web/components/i18n/__tests__/format-components.test.tsx
  - apps/web/components/i18n/automatic-translation-label.tsx
  - apps/web/components/i18n/currency-display.tsx
  - apps/web/components/i18n/kst-time.tsx
  - apps/web/components/i18n/locale-suggestion.tsx
  - apps/web/components/i18n/locale-switcher.tsx
  - apps/web/components/layout/__tests__/footer.test.tsx
  - apps/web/components/layout/__tests__/gnb-locale.test.tsx
  - apps/web/components/layout/__tests__/layout-shell-locale.test.tsx
  - apps/web/components/layout/footer.tsx
  - apps/web/components/layout/gnb.tsx
  - apps/web/components/layout/mobile-menu.tsx
  - apps/web/components/legal/legal-fallback-label.tsx
  - apps/web/components/ui/__tests__/phone-input-i18n.test.tsx
  - apps/web/components/ui/phone-input.tsx
  - apps/web/content/legal/__tests__/legal-content.test.ts
  - apps/web/content/legal/marketing-consent.en.md
  - apps/web/content/legal/privacy-policy.en.md
  - apps/web/content/legal/terms-of-service.en.md
  - apps/web/hooks/__tests__/booking-disabled-runtime.test.tsx
  - apps/web/hooks/__tests__/use-booking.test.tsx
  - apps/web/hooks/use-admin.ts
  - apps/web/hooks/use-booking.ts
  - apps/web/hooks/use-runtime-flags.ts
  - apps/web/i18n/request.ts
  - apps/web/i18n/routing.test.ts
  - apps/web/i18n/routing.ts
  - apps/web/lib/i18n/format.test.ts
  - apps/web/lib/i18n/format.ts
  - apps/web/lib/runtime-flags.ts
  - apps/web/messages/en.json
  - apps/web/messages/ko.json
  - apps/web/messages/th.json
  - apps/web/messages/zh-CN.json
  - apps/web/messages/zh-TW.json
  - apps/web/next.config.ts
  - apps/web/package.json
  - apps/web/proxy.ts
  - docs/runbooks/phase23-canary-rollback.md
  - docs/v2.0-fanmeet-milestone-spec.md
  - packages/shared/package.json
  - packages/shared/src/constants/index.ts
  - packages/shared/src/constants/locales.test.ts
  - packages/shared/src/constants/locales.ts
  - packages/shared/src/flags.test.ts
  - packages/shared/src/flags.ts
  - packages/shared/src/i18n/launch-copy-keys.test.ts
  - packages/shared/src/i18n/launch-copy-keys.ts
  - packages/shared/src/index.ts
  - packages/shared/src/schemas/auth.schema.test.ts
  - packages/shared/src/schemas/auth.schema.ts
  - packages/shared/src/schemas/booking.schema.ts
  - packages/shared/src/schemas/consent.schema.ts
  - packages/shared/src/schemas/user.schema.ts
  - packages/shared/src/types/auth.types.ts
  - packages/shared/src/types/i18n.types.ts
  - packages/shared/src/types/user.types.ts
findings:
  critical: 6
  warning: 3
  info: 0
  total: 9
status: issues_found
---

# Phase 23: Code Review Report

**Reviewed:** 2026-05-06T09:28:14Z
**Depth:** standard
**Files Reviewed:** 156
**Status:** issues_found

## Summary

명시된 Phase 23 launch foundation 파일을 standard depth로 검토했다. `pnpm-lock.yaml`은 lockfile이라 review scope에서 제외했고, `.env.example`, migration/schema, API, web, shared package, source markdown은 검토 범위에 포함했다.

핵심 위험은 인증과 연락처 검증 경로에 집중되어 있다. SMS 검증 완료 flag가 인증 primitive처럼 사용되고, refresh token rotation이 원자적이지 않으며, email verification과 profile phone verification이 실제 authorization gate로 연결되지 않는다. 또한 social account linking은 기존 계정 소유 증명 없이 email match만으로 세션을 발급한다.

## Critical Issues

### CR-01 [BLOCKER]: SMS verified flag alone can authorize phone ownership

**File:** `apps/api/src/modules/auth/auth.service.ts:680`

**Issue:** `assertPhoneVerified()`는 `smsService.verifyCode()`가 `GoneException`을 던지면 `smsService.isPhoneVerified(phone)`를 fallback으로 확인하고 통과시킨다. 그런데 `apps/api/src/modules/sms/sms.service.ts:352`와 `apps/api/src/modules/sms/sms.service.ts:489`는 이 `{sms:{e164}}:verified` flag가 인증 primitive가 아니며 caller가 원래 `/send-code` flow/session과 correlate해야 한다고 명시한다. 현재 `register()`와 `completeSocialRegistration()`은 그 correlation 없이 phone number만으로 flag를 신뢰하므로, 최근 600초 안에 검증된 번호를 아는 공격자가 해당 번호와 임의의 만료/오류 code로 가입 또는 social completion을 통과할 수 있다.

**Fix:**

```ts
// Do not accept isPhoneVerified(phone) as proof of possession.
const verified = await this.smsVerificationTokenService.verify(dto.phoneVerificationToken, {
  phone: dto.phone,
  purpose: "signup",
  flowId: dto.flowId,
});

if (!verified) {
  throw new BadRequestException("Phone verification is required.");
}
```

`/sms/verify-code`는 phone/purpose/flow/session에 bound된 opaque server-signed token을 반환하고, signup/social completion은 이 token을 검증해야 한다. 그 전까지는 `assertPhoneVerified()`의 `isPhoneVerified()` fallback을 제거해야 한다.

### CR-02 [BLOCKER]: Refresh token rotation can be bypassed by concurrent requests

**File:** `apps/api/src/modules/auth/auth.service.ts:184`

**Issue:** `refreshTokens()`는 token row를 조회하고 `revokedAt`을 검사한 뒤, 별도 update로 기존 token을 revoke하고 새 refresh token을 insert한다. 이 check-then-update sequence가 transaction도 아니고 `revoked_at IS NULL` conditional update도 아니어서 같은 refresh cookie로 동시에 두 요청이 들어오면 둘 다 unrevoked row를 읽고 둘 다 새 valid token을 발급할 수 있다. reuse detection 경로(`apps/api/src/modules/auth/auth.service.ts:197`)는 두 요청 모두 최초 read에서 `revokedAt === null`이면 실행되지 않는다.

**Fix:**

```ts
return this.db.transaction(async (tx) => {
  const [revoked] = await tx
    .update(refreshTokens)
    .set({ revokedAt: now, replacedByTokenId: replacementId })
    .where(and(eq(refreshTokens.id, storedToken.id), isNull(refreshTokens.revokedAt)))
    .returning({ id: refreshTokens.id });

  if (!revoked) {
    await this.revokeTokenFamily(storedToken.userId);
    throw new UnauthorizedException("Refresh token reuse detected.");
  }

  await tx.insert(refreshTokens).values(newRefreshTokenRow);
  return issuedTokens;
});
```

Revocation과 replacement insert를 같은 transaction 안에서 처리하고, update가 0 rows이면 token family를 revoke해야 한다. `token_hash`에는 unique index도 추가하는 것이 안전하다.

### CR-03 [BLOCKER]: Email verification is not enforced before session issuance

**File:** `apps/api/src/modules/auth/auth.service.ts:160`

**Issue:** `register()`는 `apps/api/src/modules/auth/auth.service.ts:141`에서 email verification token을 보내지만 즉시 access/refresh token을 발급한다. `validateUser()`도 password만 확인하고 `isEmailVerified`를 검사하지 않는다. 반면 frontend는 `apps/web/components/auth/login-form.tsx:87`에서 `EMAIL_NOT_VERIFIED`/`VERIFICATION_REQUIRED` error를 처리하도록 작성되어 있어, 정책상 unverified user를 막으려는 의도가 드러난다. 현재 backend가 gate를 적용하지 않아 email verification은 account activation 보안 장치가 아니라 안내 기능에 그친다.

**Fix:**

```ts
if (!user.isEmailVerified) {
  throw new ForbiddenException({
    code: "EMAIL_NOT_VERIFIED",
    message: "Email verification is required.",
  });
}
```

`validateUser()`와 token issuance 경로에서 `isEmailVerified`를 강제하거나, 가입 직후에는 제한된 verification-only session만 발급하도록 session 권한을 분리해야 한다.

### CR-04 [BLOCKER]: Profile phone updates bypass SMS verification and preserve verified state

**File:** `apps/api/src/modules/user/user.service.ts:18`

**Issue:** `UpdateUserSchema`는 `packages/shared/src/schemas/user.schema.ts:4`에서 `phone` update를 허용하지만 verification token/code field가 없다. `UserService.updateProfile()`은 `preferredLocale`만 검증하고, `apps/api/src/modules/user/user.repository.ts:64`는 새 `phone`을 그대로 저장한다. 기존 user가 `is_phone_verified = true`인 상태에서 phone만 다른 번호로 바꾸면 검증 상태가 그대로 유지된다. 예매/알림/계정 복구에 쓰이는 전화번호가 검증 없이 변경될 수 있다.

**Fix:**

```ts
if (input.phone && input.phone !== user.phone) {
  await this.smsVerificationTokenService.verify(input.phoneVerificationToken, {
    phone: input.phone,
    purpose: "profile-phone-change",
    userId,
  });

  update.phone = input.phone;
  update.isPhoneVerified = true;
}
```

전화번호 변경에는 signup과 동일한 수준의 bound verification token을 요구해야 한다. 검증 토큰을 즉시 도입하지 못한다면 phone 변경 시 `isPhoneVerified=false`로 reset하고 검증 완료 전 민감 workflow에서 차단해야 한다.

### CR-05 [BLOCKER]: Social registration links existing accounts by email without proving account ownership

**File:** `apps/api/src/modules/auth/auth.service.ts:567`

**Issue:** `completeSocialRegistration()`은 social token의 email과 같은 기존 user를 찾으면 `apps/api/src/modules/auth/auth.service.ts:585`에서 `socialAccounts`를 insert하고 곧바로 기존 user 세션을 발급한다. 기존 password account의 session, password, email verification link 등으로 소유권을 증명하지 않는다. Google/Kakao/Naver profile extraction도 provider email verification signal을 일관되게 보존하지 않으므로, email match만으로 계정 linking과 login이 가능해진다.

**Fix:**

```ts
if (existingUser) {
  throw new ConflictException({
    code: "ACCOUNT_LINK_CONFIRMATION_REQUIRED",
    message: "Sign in to the existing account before linking this social provider.",
  });
}
```

기존 email 계정에 social provider를 연결하려면 먼저 기존 계정으로 로그인한 상태에서 linking endpoint를 호출하게 하거나, 기존 계정 email로 보낸 verification challenge를 통과시켜야 한다. Provider가 검증한 email인지 여부도 social token payload에 포함하고 검증해야 한다.

### CR-06 [BLOCKER]: Translation review queue drops the Korean source text

**File:** `apps/api/src/modules/translation/translation.service.ts:174`

**Issue:** `listQueue()`는 `translation_drafts`와 `translation_sources`를 join하지만 `translationSources.sourceText`와 `translationSources.field`를 select하지 않는다. `mapDraft()`도 source text를 반환하지 않는다. 그 결과 frontend는 `apps/web/app/admin/translations/page.tsx:55`에서 `row.sourceText ?? row.translatedText`로 fallback하여, reviewer detail panel의 "한국어 원문" 영역에 실제 Korean source가 아니라 translated draft를 표시한다. 번역 승인자가 원문 없이 번역문을 승인하게 되어 legal/marketing copy review가 잘못 작동한다.

**Fix:**

```ts
const rows = await this.db
  .select({
    draft: translationDrafts,
    sourceText: translationSources.sourceText,
    field: translationSources.field,
    contentType: legalContent.contentType,
  })
  .from(translationDrafts)
  .innerJoin(translationSources, eq(translationDrafts.sourceId, translationSources.id));

return rows.map((row) => this.mapDraft(row.draft, row));
```

API response type에 `sourceText`와 `field`를 추가하고, frontend fallback을 제거해 source가 없으면 명확한 error state를 보여줘야 한다.

## Warnings

### WR-01 [WARNING]: Translation source creation can create unhandled promise rejections

**File:** `apps/web/components/admin/translation-source-form.tsx:33`

**Issue:** `handleSubmit()`은 `await onCreateSource(...)`를 호출하지만 실패를 catch하지 않는다. Parent는 `apps/web/app/admin/translations/page.tsx:72`에서 `createSource.mutateAsync(input, { onError })`를 반환하는데, TanStack Query의 `mutateAsync`는 `onError` callback이 있어도 Promise를 reject한다. 실패 시 toast는 표시되어도 async form handler에서 rejection이 전파되어 console error 또는 test/runtime unhandled rejection으로 이어질 수 있다. Generate button 경로도 동일하게 `mutateAsync` rejection을 catch하지 않는다.

**Fix:**

```ts
try {
  await onCreateSource({ contentType, field, sourceText });
  setSourceText("");
} catch {
  // Parent onError already owns the user-facing toast.
}
```

Parent wrapper에서 `mutateAsync(...).catch(() => undefined)`를 반환하거나 form component 내부에서 catch해야 한다.

### WR-02 [WARNING]: DeepL error responses can mask provider failure details

**File:** `apps/api/src/modules/translation/deepl.client.ts:67`

**Issue:** `translateText()`는 `response.ok`를 확인하기 전에 `await response.json()`을 호출한다. DeepL 또는 proxy가 non-JSON error body를 반환하면 JSON parse error가 먼저 throw되어 `status`, `statusText`, provider error body를 포함한 `DeepL translation failed` 경로가 실행되지 않는다. 운영 장애 조사 시 실제 provider failure가 `SyntaxError`로 가려진다.

**Fix:**

```ts
const bodyText = await response.text();

if (!response.ok) {
  throw new Error(`DeepL translation failed: ${response.status} ${bodyText}`);
}

const body = JSON.parse(bodyText) as DeepLTranslateResponse;
```

또는 JSON parse를 try/catch로 감싸고 `response.status`와 raw body excerpt를 error에 포함해야 한다.

### WR-03 [WARNING]: Locale suggestion copy uses the current locale instead of the suggested locale

**File:** `apps/web/components/i18n/locale-suggestion.tsx:63`

**Issue:** `LocaleSuggestion`은 `SUGGESTION_COPY[activeLocale]`를 표시한다. 예를 들어 현재 route가 `/en`이고 browser locale로 `ko`가 추천되면 button label은 `한국어`인데 문구는 English active locale copy인 "View this page in English?"가 된다. 이는 사용자가 전환 대상 locale을 반대로 이해하게 만드는 user-facing correctness defect다.

**Fix:**

```tsx
const copy = SUGGESTION_COPY[locale] ?? SUGGESTION_COPY.en;
```

문구를 suggested `locale` 기준으로 선택하거나, active locale copy 안에 target locale label을 interpolation해서 방향이 명확하게 드러나도록 해야 한다.

---

_Reviewed: 2026-05-06T09:28:14Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
