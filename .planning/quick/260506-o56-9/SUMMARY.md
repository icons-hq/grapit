---
status: complete
completed: 2026-05-06
---

# Summary

Completed:
- Hid the public performance detail casting tab; only 상세정보 and 판매정보 remain.
- Fixed admin performance date parsing so timezone-less admin datetime values are interpreted as KST.
- Added admin edit formatting helpers so persisted UTC instants display as KST wall time in the admin form.
- Corrected the production Girl Rules showtime row from `2026-07-18 23:00 KST` to `2026-07-18 14:00 KST`.

Verification:
- `pnpm --filter @grabit/api exec vitest run modules/admin/admin-date.util.spec.ts`
- `pnpm --filter @grabit/web exec vitest run 'app/performance/[id]/__tests__/performance-detail-formatting.test.tsx' lib/admin-datetime.test.ts`
- `pnpm --filter @grabit/api exec tsc --noEmit --pretty false`
- `pnpm --filter @grabit/web exec tsc --noEmit --pretty false`
- `pnpm --filter @grabit/api lint` passed with existing warnings.
- `pnpm --filter @grabit/web lint` passed with existing warnings.
- Production API and browser booking flow show `14:00`, not `23:00`.

Note:
- Local rendered detail-page validation was blocked by the existing locale middleware rewrite to `/ko/...`, which returns the app not-found page in local dev.
- Browser screenshot capture timed out in the in-app browser, so DOM evidence was used for browser verification.
