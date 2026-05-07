---
phase: 23-launch-foundation
reviewed: 2026-05-07T06:20:25Z
depth: standard
files_reviewed: 166
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
  - apps/api/src/database/seed.mjs
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
  - apps/api/src/modules/performance/performance.controller.ts
  - apps/api/src/modules/performance/performance.service.ts
  - apps/api/src/modules/reservation/reservation.module.ts
  - apps/api/src/modules/reservation/reservation.service.spec.ts
  - apps/api/src/modules/reservation/reservation.service.ts
  - apps/api/src/modules/search/search.service.ts
  - apps/api/src/modules/sms/sms-copy.spec.ts
  - apps/api/src/modules/sms/sms-copy.ts
  - apps/api/src/modules/sms/sms.service.spec.ts
  - apps/api/src/modules/sms/sms.service.ts
  - apps/api/src/modules/translation/deepl.client.spec.ts
  - apps/api/src/modules/translation/deepl.client.ts
  - apps/api/src/modules/translation/performance-translation-overlay.ts
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
  - apps/web/components/auth/__tests__/signup-step1-i18n.test.tsx
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
  - apps/web/e2e/i18n-smoke.spec.ts
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
  - apps/web/lib/i18n/visible-copy.ts
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
  - packages/shared/src/schemas/performance.schema.ts
  - packages/shared/src/schemas/user.schema.ts
  - packages/shared/src/types/auth.types.ts
  - packages/shared/src/types/i18n.types.ts
  - packages/shared/src/types/performance.types.ts
  - packages/shared/src/types/user.types.ts
findings:
  critical: 4
  warning: 2
  info: 0
  total: 6
status: issues_found
---

# Phase 23: Code Review Report

**Reviewed:** 2026-05-07T06:20:25Z
**Depth:** standard
**Files Reviewed:** 166
**Status:** issues_found

## Critical Issues

### CR-01: [BLOCKER] Fresh launch databases cannot capture signup consent

**File:** `apps/api/src/database/seed.mjs:154`, `apps/api/src/modules/consent/consent.service.ts:89`

**Issue:** The launch migrations create `consent_items`, but the migration/seed path never inserts the active consent rows for version `2026-04-28`. `ConsentService.captureConsent()` loads only active rows and throws `${key} consent item is not active` when no matching key/version/locale exists. Signup and social completion call this inside the user creation transaction, so a fresh migrated and seeded environment rejects registration as soon as it tries to audit consent.

**Fix:**
```sql
INSERT INTO consent_items (key, version, locale, title, body, is_required, is_active)
VALUES
  ('terms', '2026-04-28', 'ko', '이용약관', '...', true, true),
  ('privacy', '2026-04-28', 'ko', '개인정보 처리방침', '...', true, true),
  ('pipa_required', '2026-04-28', 'ko', '개인정보 필수 수집 및 이용', '...', true, true),
  ('cross_border_transfer', '2026-04-28', 'ko', '국외 이전 동의', '...', true, true),
  ('pdpa_notice', '2026-04-28', 'ko', '태국 PDPA 고지', '...', true, true),
  ('pipl_notice', '2026-04-28', 'ko', '중국 PIPL 고지', '...', true, true),
  ('marketing', '2026-04-28', 'ko', '마케팅 정보 수신 동의', '...', false, true)
ON CONFLICT (key, version, locale)
DO UPDATE SET title = EXCLUDED.title,
              body = EXCLUDED.body,
              is_required = EXCLUDED.is_required,
              is_active = true,
              updated_at = now();
```

Add the same canonical rows for all supported launch locales or make the frontend fetch `/consent/items?locale=...` from the database. Cover this with a fresh migration + seed registration test that asserts consent audit rows are written.

### CR-02: [BLOCKER] Booking consent is validated but never persisted to the audit log

**File:** `apps/api/src/modules/reservation/reservation.service.ts:204`, `apps/api/src/modules/reservation/reservation.service.ts:331`, `packages/shared/src/schemas/booking.schema.ts:17`, `apps/web/app/booking/[performanceId]/confirm/page.tsx:155`

**Issue:** The booking confirmation page sends consent rows tagged with `sourceFlow: 'booking'`, and the shared `prepareReservationSchema` requires those rows. The API then only calls `assertRequiredConsents()` in `assertBookingConsent()` and never calls `ConsentService.captureConsent()`. As a result, successful booking consent produces no `consent_audit_logs` row with `source_flow = 'booking'`, so the admin audit trail cannot prove that booking-time consent was collected.

**Fix:**
```ts
await this.consentService.captureConsent(
  userId,
  {
    birthDate: user.birthDate,
    items: dto.consentItems,
    sourceFlow: 'booking',
  },
  requestMeta,
  tx,
);
```

Thread trusted request metadata and the user's birth date into reservation preparation, and write the audit row in the same creation/idempotency boundary as the pending reservation. Add a reservation service test that expects `captureConsent()` to be called once with `sourceFlow: 'booking'` and a controller/integration test that verifies a persisted audit row.

### CR-03: [BLOCKER] Consent audit timestamps are client-controlled

**File:** `packages/shared/src/schemas/consent.schema.ts:77`, `apps/api/src/modules/consent/consent.controller.ts:31`, `apps/api/src/modules/consent/consent.service.ts:85`

**Issue:** The authenticated `/consent/capture` request schema accepts optional `capturedAt`, and `ConsentService.captureConsent()` uses that value as both the age-gate reference time and the persisted `agreedAt`. Any authenticated client can backdate or future-date legal consent evidence, which makes the consent audit log unreliable.

**Fix:**
```ts
export const consentCaptureRequestSchema = consentCaptureBaseSchema
  .pick({
    birthDate: true,
    sourceFlow: true,
    items: true,
  });

const capturedAt = new Date();
this.assertAgeAllowed(dto.birthDate, capturedAt);
```

Remove `capturedAt` from public requests, or store it separately as non-authoritative `clientCapturedAt`. Update consent service/controller tests so server time is the only value written to `agreedAt`.

### CR-04: [BLOCKER] Consent audit IP addresses can be spoofed through `x-forwarded-for`

**File:** `apps/api/src/modules/auth/auth.controller.ts:326`, `apps/api/src/modules/consent/consent.controller.ts:46`

**Issue:** Both consent metadata resolvers take the first `x-forwarded-for` value directly and persist it as the user's consent IP. Because clients can send this header before Cloud Run or any proxy appends its own value, a caller can forge the IP address stored in the legal audit trail.

**Fix:**
```ts
private resolveIp(req: Request): string {
  const ip = req.ip || req.socket.remoteAddress || '0.0.0.0';
  return isIP(ip) ? ip : '0.0.0.0';
}
```

Configure Express/Nest `trust proxy` for the Cloud Run proxy chain and use the framework-normalized `req.ip`. If raw forwarded headers must be retained, store them separately from the authoritative consent IP and validate/truncate them before persistence.

## Warnings

### WR-01: [WARNING] `ended=false` query parameters are parsed as `true`

**File:** `packages/shared/src/schemas/performance.schema.ts:47`, `packages/shared/src/schemas/performance.schema.ts:55`

**Issue:** `z.coerce.boolean()` delegates to JavaScript truthiness, so the non-empty string `"false"` becomes `true`. Requests such as `/performances?ended=false` and `/search?q=...&ended=false` therefore include ended performances instead of excluding them, which reverses the default launch catalog behavior for normal URL query strings.

**Fix:**
```ts
const booleanQueryParam = z
  .preprocess((value) => {
    if (value === undefined || value === '') return undefined;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  }, z.boolean().optional())
  .default(false);

ended: booleanQueryParam,
```

Add schema tests for `ended=false`, `ended=true`, omitted `ended`, and invalid values.

### WR-02: [WARNING] Published translations can be moved back to review state

**File:** `apps/api/src/modules/translation/translation.service.ts:202`, `apps/web/components/admin/translation-review-detail-panel.tsx:54`

**Issue:** `markReviewed()` only rejects stale drafts and then unconditionally sets `status: 'review'`. The admin detail panel also enables the review action for any non-stale draft with translated text, including `published`. Clicking review on a published translation can demote it out of the published state, causing the public overlay to stop using that translation.

**Fix:**
```ts
if (draft.status === 'published') {
  throw new BadRequestException('이미 게시된 번역은 검수 상태로 되돌릴 수 없습니다');
}

const canReview =
  draft.status === 'draft' &&
  !isBlocked &&
  !isMissingSourceText &&
  translatedText.trim().length > 0;
```

Add a service test that `markReviewed()` rejects published drafts and a component test that the review button is disabled for published rows.

## Summary

Standard-depth review covered the explicit workflow file scope after filtering out the lock file and duplicate path. The main risks are legal/audit correctness regressions in consent capture and a URL query parsing bug that changes catalog behavior. No source files were modified.

---

_Reviewed: 2026-05-07T06:20:25Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
