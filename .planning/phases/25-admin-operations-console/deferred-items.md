# Phase 25 Deferred / Split-Plan Items

## 25-01 out-of-scope verification observations

- `pnpm --filter @grabit/web test -- components/auth/__tests__/auth-email-verification.test.tsx` runs the full web Vitest suite because the extra `--` separator is passed through to Vitest. After 25-01 switches shared locale constants to `zh-TW`, the full suite still has expected stale `ja` failures in files owned by split locale plans:
  - `apps/web/components/ui/__tests__/phone-input-i18n.test.tsx`
  - `apps/web/components/auth/__tests__/phone-verification-i18n.test.tsx`
  - `apps/web/i18n/routing.test.ts`
  - `apps/web/app/__tests__/sitemap.test.ts`
- These are intentionally not fixed in 25-01 because Roadmap Wave 0 assigns routing/formatting/auth-phone/sitemap drift to `25-16` and `25-17`.
