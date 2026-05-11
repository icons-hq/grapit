---
quick_id: 260511-nfs
slug: h2-new-ui-pr
status: planned
date: 2026-05-11
---

# Quick Task 260511-nfs: Add Japanese, remove Traditional Chinese, and lock the home `New` exception

## Goal

- launch locale matrix를 `ko/en/th/zh-CN/ja`로 바꾼다.
- `zh-TW` 지원은 제거하고, 기존 `zh-TW` persisted data는 `zh-CN`으로 정리한다.
- 메인 홈 `NewSection` H2만 literal `New`로 고정하고, 다른 UI copy는 계속 locale source에서 가져온다.
- `New` heading 바로 아래 카드 리스트를 가운데 정렬한다.
- 검증 후 PR까지 생성한다.

## Findings

- 현재 locale contract는 `messages/`만의 문제가 아니다. `@grabit/shared`, Next Intl routing/proxy, API DTO validation, translation target locale, email/SMS copy, admin locale selector, sitemap, Playwright smoke까지 모두 `ko/en/th/zh-CN/zh-TW`를 전제로 묶여 있다.
- 이 앱은 `[locale]` segment가 아니라 flat App Router + proxy rewrite로 locale을 처리한다. 이번 변경도 prefixless Korean과 foreign-locale prefix contract를 유지해야 한다.
- `apps/web/components/home/new-section.tsx`는 지금 `copy.home.newOpen`을 읽고 있고 카드 wrapper도 sparse row를 가운데로 모으지 않는다. 사용자 요청상 exception은 이 H2의 literal `New` 하나뿐이다.

## Plan

### Task 1: shared/API locale source-of-truth를 `ja` 기준으로 교체하고 `zh-TW` persisted data를 안전하게 정리한다

**Files**

- Modify: `packages/shared/src/constants/locales.ts`
- Modify: `packages/shared/src/constants/locales.test.ts`
- Modify: `packages/shared/src/i18n/launch-copy-keys.ts`
- Modify: `packages/shared/src/i18n/launch-copy-keys.test.ts`
- Modify: `apps/web/i18n/routing.ts`
- Modify: `apps/web/i18n/routing.test.ts`
- Modify: `apps/api/src/database/schema/users.ts`
- Modify: `apps/api/src/database/schema/launch-foundation.schema.spec.ts`
- Modify: `apps/api/src/modules/auth/auth.controller.ts`
- Modify: `apps/api/src/modules/consent/consent.service.ts`
- Modify: `apps/api/src/modules/user/user.controller.spec.ts`
- Modify: `apps/api/src/modules/user/user.service.spec.ts`
- Modify: `apps/api/src/modules/translation/translation.service.ts`
- Modify: `apps/api/src/modules/translation/translation.service.spec.ts`
- Modify: `apps/api/src/modules/translation/deepl.client.ts`
- Modify: `apps/api/src/modules/translation/deepl.client.spec.ts`
- Modify: `apps/api/src/modules/sms/sms-copy.ts`
- Modify: `apps/api/src/modules/sms/sms-copy.spec.ts`
- Modify: `apps/api/src/modules/auth/email/templates/email-verification.copy.ts`
- Modify: `apps/api/src/modules/auth/email/templates/email-verification.copy.spec.ts`
- Modify: `apps/api/src/modules/auth/email/email.service.spec.ts`
- Modify: `apps/api/src/database/seed.mjs`
- Create: `apps/api/src/database/migrations/0014_locale_ja_drop_zh_tw.sql`
- Modify: `apps/api/src/database/migrations/meta/_journal.json`
- Create: `apps/api/src/database/migrations/meta/0014_snapshot.json`

**Action**

- 모든 launch-locale source of truth를 `['ko', 'en', 'th', 'zh-CN', 'ja']`로 교체한다.
- Korean은 계속 prefixless default로 두고, foreign locale은 `/en`, `/th`, `/zh-CN`, `/ja`만 허용한다. `/ko` route나 `[locale]` segment를 다시 도입하지 않는다.
- Postgres `locale` enum에서 `zh-TW`를 제거하기 전에, 기존 `preferred_locale`, translation-related row, seed data 등 persisted `zh-TW` 값은 `zh-CN`으로 rewrite한 뒤 enum swap을 수행한다. 삭제만 하고 orphan row를 남기는 방식은 금지한다.
- translation target locale, API validation enum, email/SMS copy table, consent language union, DeepL target mapping을 모두 `ja` 기준으로 바꾸고, 서버 코드에서 `zh-TW`를 supported locale로 간주하는 경로를 제거한다.

**Done when**

- shared constants, routing helpers, API DTO validation, translation pipeline, email/SMS copy, DB schema가 모두 `ko/en/th/zh-CN/ja`로 일치한다.
- persisted `zh-TW` 값의 migration path가 `zh-CN`으로 고정되고, 테스트는 `ja`를 supported locale로 인정하며 `zh-TW`는 거부한다.

### Task 2: web locale bundle과 selector를 `ja`로 교체하고, 홈 `New` exception 및 카드 가운데 정렬을 구현한다

**Files**

- Create: `apps/web/messages/ja.json`
- Modify: `apps/web/messages/ko.json`
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/th.json`
- Modify: `apps/web/messages/zh-CN.json`
- Delete: `apps/web/messages/zh-TW.json`
- Modify: `apps/web/lib/i18n/visible-copy.ts`
- Modify: `apps/web/components/auth/auth-launch-copy.ts`
- Modify: `apps/web/components/auth/__tests__/auth-email-verification.test.tsx`
- Modify: `apps/web/components/auth/__tests__/phone-verification-i18n.test.tsx`
- Modify: `apps/web/components/legal/legal-fallback-label.tsx`
- Modify: `apps/web/components/i18n/locale-suggestion.tsx`
- Modify: `apps/web/components/i18n/automatic-translation-label.tsx`
- Modify: `apps/web/components/i18n/__tests__/automatic-translation-label.test.tsx`
- Modify: `apps/web/components/ui/phone-input.tsx`
- Modify: `apps/web/components/ui/__tests__/phone-input-i18n.test.tsx`
- Modify: `apps/web/components/performance/status-badge.tsx`
- Modify: `apps/web/components/performance/__tests__/status-badge.test.tsx`
- Modify: `apps/web/components/booking/toss-payment-widget.tsx`
- Modify: `apps/web/components/admin/consent-audit-table.tsx`
- Modify: `apps/web/components/admin/translation-review-table.tsx`
- Modify: `apps/web/components/admin/translation-source-form.tsx`
- Modify: `apps/web/components/admin/__tests__/translation-review.test.tsx`
- Modify: `apps/web/app/admin/translations/page.tsx`
- Modify: `apps/web/app/legal/terms/page.tsx`
- Modify: `apps/web/app/legal/privacy/page.tsx`
- Modify: `apps/web/app/legal/marketing/page.tsx`
- Modify: `apps/web/app/legal/__tests__/legal-fallback.test.tsx`
- Modify: `apps/web/app/sitemap.ts`
- Modify: `apps/web/app/__tests__/sitemap.test.ts`
- Modify: `apps/web/app/__tests__/home-i18n.test.tsx`
- Modify: `apps/web/e2e/i18n-smoke.spec.ts`
- Modify: `apps/web/components/home/new-section.tsx`

**Action**

- `ja.json`을 추가하고 `zh-TW.json`은 제거한다. locale switcher, admin locale selector/filter, legal fallback, automatic translation label, phone-input labels, payment widget locale adapter, sitemap alternates, i18n smoke expectations까지 전부 `ko/en/th/zh-CN/ja` 기준으로 맞춘다.
- 일본어 전용 copy가 아직 없는 legal/translation fallback surface는 현재 foreign-locale fallback 패턴을 재사용하되, blank state나 broken import를 남기지 않는다.
- `NewSection` heading은 모든 locale에서 literal `New`를 직접 렌더링한다. 이 외 nav/search/auth/legal/admin/performance/booking copy는 기존처럼 message JSON 또는 locale map에서 읽어야 하며, 다른 English hardcode를 추가하면 안 된다.
- `NewSection` 카드 wrapper는 incomplete row가 left-stuck 되지 않도록 container layout 자체를 바꿔 sparse row를 가운데 정렬한다. per-card margin patch 대신 row-level layout을 수정하고, 모바일/데스크톱 카드 밀도는 유지한다.
- home/i18n test는 `New`를 의도된 exception으로 고정하고, 나머지 locale-visible copy와 Japanese selector 노출은 message-driven contract로 검증한다.

**Done when**

- web UI는 `ko/en/th/zh-CN/ja`만 노출하고 `zh-TW` option이나 label을 더 이상 보여주지 않는다.
- 메인 홈 `NewSection` H2는 어떤 locale에서도 `New`로 보이되, 다른 visible copy는 locale source에서 계속 바뀐다.
- `New` heading 아래 카드 리스트가 가운데 정렬된다.

### Task 3: focused verification을 돌리고 locale swap + home UI exception을 설명하는 PR을 만든다

**Files**

- No code changes expected

**Action**

- shared/API/web targeted tests를 돌려 locale matrix, DB migration, routing, home i18n, Japanese message load, admin locale selector, legal fallback, i18n smoke를 검증한다.
- browser로 `/`, `/ja`, `/zh-CN`을 열어 locale switcher label(`한국어`, `日本語`, `简体中文`), literal `New`, 카드 가운데 정렬이 실제 렌더에서 보이는지 확인한다.
- green 확인 후 locale/home UI 범위만 commit하고 PR을 생성한다. PR body에는 `zh-TW` 제거, `ja` 추가, persisted `zh-TW -> zh-CN` migration, home `New` hardcode exception, card-centering 변경을 명시한다.

**Done when**

- targeted verification이 통과한다.
- browser spot check에서 요청한 locale/UI 동작이 보인다.
- PR URL이 생성된다.

## Verification

- `pnpm --filter @grabit/shared test -- src/constants/locales.test.ts src/i18n/launch-copy-keys.test.ts`
- `pnpm --filter @grabit/api test -- src/database/schema/launch-foundation.schema.spec.ts src/modules/user/user.controller.spec.ts src/modules/user/user.service.spec.ts src/modules/translation/translation.service.spec.ts src/modules/translation/deepl.client.spec.ts src/modules/sms/sms-copy.spec.ts src/modules/auth/email/templates/email-verification.copy.spec.ts src/modules/auth/email/email.service.spec.ts`
- `DOTENV_CONFIG_PATH=../../.env pnpm --filter @grabit/api exec drizzle-kit migrate`
- `pnpm --filter @grabit/web test -- i18n/routing.test.ts app/__tests__/home-i18n.test.tsx app/__tests__/sitemap.test.ts app/legal/__tests__/legal-fallback.test.tsx components/i18n/__tests__/automatic-translation-label.test.tsx components/ui/__tests__/phone-input-i18n.test.tsx components/performance/__tests__/status-badge.test.tsx components/auth/__tests__/auth-email-verification.test.tsx components/auth/__tests__/phone-verification-i18n.test.tsx components/admin/__tests__/translation-review.test.tsx`
- `pnpm typecheck`
- `CI=1 pnpm --filter @grabit/web exec playwright test e2e/i18n-smoke.spec.ts --project=chromium --workers=1 --reporter=line`
- `gh pr create --fill`
