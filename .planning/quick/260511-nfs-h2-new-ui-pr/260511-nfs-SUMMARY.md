---
quick_id: 260511-nfs
slug: h2-new-ui-pr
status: complete
completed_at: 2026-05-11T17:28:22+09:00
branch: quick/h2-new-ui-pr
---

# Quick Task 260511-nfs - Summary

## Completed

- Launch locale matrix를 `ko/en/th/zh-CN/ja`로 교체하고 `zh-TW` 지원을 shared, API, web, tests 전반에서 제거했다.
- `0014_locale_ja_drop_zh_tw.sql` migration을 추가해 persisted `zh-TW` 값을 `zh-CN`으로 정리하고, Japanese consent rows를 새 locale contract에 맞게 seed했다.
- `ja.json`을 추가하고 locale selector, routing, DeepL target mapping, email/SMS copy, admin translation/consent UI, phone input, status badge, sitemap, smoke tests를 `ja` 기준으로 맞췄다.
- 메인 홈 `NewSection` H2를 locale과 무관한 literal `New`로 고정했고, 카드 wrapper를 `flex-wrap + justify-center`로 바꿔 sparse row가 가운데 정렬되도록 수정했다.
- 로컬 verification 환경에서 Japanese translated search result를 확인할 수 있도록 dev DB seed를 다시 적용했다.

## Commit

| Hash | Message |
|------|---------|
| 9ef3037 | feat(quick-260511-nfs): swap launch locale matrix to ja |

## Verification

- PASS: `pnpm --filter @grabit/shared test -- src/constants/locales.test.ts src/i18n/launch-copy-keys.test.ts`
- PASS: `pnpm --filter @grabit/api test -- src/database/schema/launch-foundation.schema.spec.ts src/modules/user/user.controller.spec.ts src/modules/user/user.service.spec.ts src/modules/translation/translation.service.spec.ts src/modules/translation/deepl.client.spec.ts src/modules/sms/sms-copy.spec.ts src/modules/auth/email/templates/email-verification.copy.spec.ts src/modules/auth/email/email.service.spec.ts`
- PASS: `DOTENV_CONFIG_PATH=../../.env pnpm --filter @grabit/api exec drizzle-kit migrate`
- PASS: `pnpm --filter @grabit/web test -- i18n/routing.test.ts app/__tests__/home-i18n.test.tsx app/__tests__/sitemap.test.ts app/legal/__tests__/legal-fallback.test.tsx components/i18n/__tests__/automatic-translation-label.test.tsx components/ui/__tests__/phone-input-i18n.test.tsx components/performance/__tests__/status-badge.test.tsx components/auth/__tests__/auth-email-verification.test.tsx components/auth/__tests__/phone-verification-i18n.test.tsx components/admin/__tests__/translation-review.test.tsx`
- PASS: `pnpm typecheck`
- PASS: `pnpm exec turbo typecheck --force`
- PASS: `CI=1 pnpm --filter @grabit/web exec playwright test e2e/i18n-smoke.spec.ts --project=chromium --workers=1 --reporter=line`
- PASS: Browser spot check on `/`, `/ja`, `/zh-CN`

## Notes

- Playwright smoke의 일본어 search-result title 검증은 코드 수정 후에도 기존 dev DB seed가 남아 있으면 실패한다. 이번 실행에서는 루트 `.env`를 export한 뒤 `pnpm --filter @grabit/api seed`로 verification fixture를 최신 locale contract에 맞춰 재생성했다.
- Orchestrator 재검증 중 첫 Playwright smoke는 API 서버가 꺼져 있어 `ECONNREFUSED localhost:8080`로 실패했다. 루트 `.env`를 export해 `pnpm --filter @grabit/api dev`를 별도 실행한 뒤 같은 Playwright command를 재실행했고 `1 passed`로 확인했다.
- Browser spot check 중 anonymous 세션의 `/api/v1/auth/refresh` 401과 `favicon.ico` 404가 console에 보였지만, 이번 quick task의 locale/UI 변경과 직접 관련된 blocker는 아니었다.
