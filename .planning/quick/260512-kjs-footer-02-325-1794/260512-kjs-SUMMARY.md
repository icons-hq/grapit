---
quick_id: 260512-kjs
slug: footer-02-325-1794
status: complete
completed_at: 2026-05-12T14:50:32+09:00
branch: quick/footer-phone-1794
---

# Quick Task 260512-kjs - Summary

## Completed

- Footer compliance surface의 고객센터 전화번호를 `02-325-179`에서 `02-325-1794`로 수정했다.
- Footer regression test가 전체 번호 `고객센터: 02-325-1794`를 정확히 검증하도록 강화했다.
- 기존 root worktree의 SMS 관련 미커밋 변경과 섞이지 않도록 별도 clean worktree/branch에서 작업했다.

## Commit

| Hash | Message |
|------|---------|
| 836e2d6 | fix(quick-260512-kjs): restore footer phone number |

## Verification

- PASS: `pnpm install --offline` (new clean worktree dependency hydration)
- PASS: `pnpm --filter @grabit/web test -- components/layout/__tests__/footer.test.tsx` (script executed the web Vitest suite: 56 files / 354 tests passed)
- PASS: `pnpm --filter @grabit/shared build`
- PASS: `pnpm --filter @grabit/web build`

## Notes

- First `pnpm --filter @grabit/web test -- components/layout/__tests__/footer.test.tsx` attempt failed before running tests because the new worktree had no `node_modules`. Dependencies were installed offline from the local pnpm store, then the same verification passed.
- First `pnpm --filter @grabit/web build` attempt failed because `@grabit/shared` had not been built in the new worktree. After `pnpm --filter @grabit/shared build`, web build passed.
- `next build` temporarily changed `apps/web/next-env.d.ts` from dev route types to production route types; this generated noise was reverted because it is unrelated to the footer phone fix.
