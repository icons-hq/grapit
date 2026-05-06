---
phase: 23-launch-foundation
reviewed: 2026-05-06T08:03:03Z
depth: standard
files_reviewed: 135
files_reviewed_list:
  - .env.example
  - apps/api/src/app.module.ts
  - apps/api/src/database/migrations/0007_phase23_launch_foundation.sql
  - apps/api/src/database/migrations/meta/0007_snapshot.json
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
  - apps/api/src/modules/auth/auth.service.spec.ts
  - apps/api/src/modules/auth/auth.service.ts
  - apps/api/src/modules/auth/dto/auth-consent.dto.spec.ts
  - apps/api/src/modules/auth/dto/register.dto.ts
  - apps/api/src/modules/auth/dto/social-register.dto.ts
  - apps/api/src/modules/booking/__tests__/booking.service.integration.spec.ts
  - apps/api/src/modules/booking/__tests__/booking.service.spec.ts
  - apps/api/src/modules/booking/booking.module.ts
  - apps/api/src/modules/booking/booking.service.ts
  - apps/api/src/modules/feature-flags/feature-flags.module.ts
  - apps/api/src/modules/feature-flags/feature-flags.service.spec.ts
  - apps/api/src/modules/feature-flags/feature-flags.service.ts
  - apps/api/src/modules/reservation/reservation.module.ts
  - apps/api/src/modules/reservation/reservation.service.spec.ts
  - apps/api/src/modules/reservation/reservation.service.ts
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
  - packages/shared/src/schemas/consent.schema.ts
  - packages/shared/src/schemas/user.schema.ts
  - packages/shared/src/types/auth.types.ts
  - packages/shared/src/types/i18n.types.ts
  - packages/shared/src/types/user.types.ts
finding_counts:
  critical: 2
  warning: 4
  info: 0
  total: 6
findings:
  critical: 2
  warning: 4
  info: 0
  total: 6
status: issues_found
---

# Phase 23: Code Review Report

**Reviewed:** 2026-05-06T08:03:03Z
**Depth:** standard
**Files Reviewed:** 135
**Status:** issues_found

## Summary

Phase 23 launch foundation files were reviewed at standard depth, with extra tracing through admin gates, booking disabled gates, consent audit evidence, translation review/publish, and public i18n label behavior. API admin routes are protected by the global `JwtAuthGuard` plus `RolesGuard`, and booking disabled is enforced on the main Redis/payment mutation paths. The issues below are concrete correctness and audit integrity failures that remain in changed code.

## Critical Issues

### CR-01: Consent audit records fake IP metadata for signup and social completion

**Classification:** BLOCKER
**File:** `apps/api/src/modules/auth/auth.service.ts:122`
**Issue:** `register()` and both `completeSocialRegistration()` branches call `captureConsent()` with `{ ipAddress: '0.0.0.0' }` instead of the real request IP/user-agent. The dedicated consent endpoint captures request metadata correctly, but launch signup/social consent evidence does not. Admin consent audit filtering by IP and masked IP evidence therefore become false for the highest-volume consent source, which is an audit/data-integrity failure.
**Fix:**
```ts
// AuthController
async register(@Req() req: Request, ..., @Res({ passthrough: true }) res: Response) {
  const result = await this.authService.register(dto, {
    ipAddress: this.resolveIp(req),
    userAgent: req.get('user-agent'),
  });
}

// AuthService
async register(dto: RegisterBody, meta: ConsentRequestMeta): Promise<AuthResult> {
  ...
  await this.consentService.captureConsent(user.id, { ... }, meta);
}
```
Apply the same change to `completeSocialRegistration()`.

### CR-02: Booking consent can be omitted entirely while prepare still succeeds

**Classification:** BLOCKER
**File:** `apps/api/src/modules/reservation/reservation.service.ts:331`
**Issue:** `assertBookingConsent()` returns immediately when `consentItems` is absent, `prepareReservationSchema` makes `consentItems` optional, and the confirm page sends only `orderId/showtimeId/seats/amount`. The code only rejects refused cross-border consent if a client voluntarily includes the consent array. Existing users, scripted clients, or a regressed frontend can create pending reservations without the required booking consent gate/audit.
**Fix:**
```ts
// shared schema
consentItems: z.array(consentCaptureItemSchema).min(1, '예매 동의 항목이 필요합니다'),

// service
private async assertBookingConsent(dto: PrepareReservationRequest): Promise<void> {
  await this.consentService.assertRequiredConsents({ items: dto.consentItems });
}
```
Update `apps/web/app/booking/[performanceId]/confirm/page.tsx` to send booking consent rows with `sourceFlow: 'booking'`, or explicitly verify the user already has current active consent versions before allowing prepare.

## Warnings

### WR-01: Translation queue filters are sent by the UI but ignored by the API

**Classification:** WARNING
**File:** `apps/api/src/modules/translation/translation.controller.ts:60`
**Issue:** `useTranslationQueue()` serializes `contentType`, `locale`, `status`, `updatedFrom`, and `updatedTo`, but `GET /admin/translations/queue` accepts no query object and calls `listQueue()` unconditionally. The admin translation review filters are therefore no-ops and can mislead operators during review/publish work.
**Fix:** Add a validated query schema in `TranslationController.listQueue()` and pass filters into `TranslationService.listQueue(filters)`, applying `where` predicates for source entity type, target locale, status, and updated date range.

### WR-02: Translation reviewer attribution can be forged from the request body

**Classification:** WARNING
**File:** `apps/api/src/modules/translation/translation.controller.ts:16`
**Issue:** `reviewDraftSchema` accepts `reviewerId`, and `reviewDraft()` uses `body.reviewerId ?? user.id`. Any admin caller can write another user's UUID into the reviewer audit field. Even if the endpoint is admin-only, audit attribution should come from authenticated request context, not client-controlled payload.
**Fix:**
```ts
const reviewDraftSchema = z.object({
  translatedText: z.string().min(1).optional(),
});

return this.translationService.markReviewed(draftId, user.id, body.translatedText);
```

### WR-03: Multiple published translations are allowed for the same source and locale

**Classification:** WARNING
**File:** `apps/api/src/modules/translation/translation.service.ts:208`
**Issue:** `generateDrafts()` always inserts new rows, the schema only has a non-unique `(source_id, target_locale, status)` index, and `publishDraft()` only marks the selected draft as `published`. Re-generating or re-reviewing can leave several `published` rows for one source/locale, making any current or future public lookup ambiguous.
**Fix:** Add a unique constraint or partial unique index for active/published `(source_id, target_locale)`, and in `publishDraft()` run a transaction that marks older published drafts for the same source/locale as stale/superseded before publishing the selected draft.

### WR-04: Auth registration writes user and terms rows before consent capture without a transaction

**Classification:** WARNING
**File:** `apps/api/src/modules/auth/auth.service.ts:102`
**Issue:** `register()` creates the user and terms agreement, then writes consent audit rows separately. If consent item lookup/audit insert fails after user creation, the API returns an error while leaving a registered user and terms row without the launch consent audit evidence. The social completion path has the same pattern around social account/terms writes and consent capture.
**Fix:** Wrap user creation, terms agreement, social account linking, and consent audit insertion in a single database transaction. Either make `ConsentService.captureConsent()` accept a transaction client or move the consent audit insert logic behind a transaction-aware repository.

---

_Reviewed: 2026-05-06T08:03:03Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
