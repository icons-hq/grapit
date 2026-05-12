---
quick_id: 260512-kjs
slug: footer-02-325-1794
status: planned
date: 2026-05-12
---

# Quick Task 260512-kjs: Footer Customer Center Phone Fix

## Goal

Footer compliance surface에 표시되는 고객센터 전화번호를 `02-325-1794`로 수정하고, 프로덕션 배포 후 실제 사이트에서 보이는지 확인한다.

## Findings

- 현재 footer는 `apps/web/components/layout/footer.tsx`에서 고객센터 번호를 `02-325-179`로 렌더링해 끝 한 자리가 누락되어 있다.
- 기존 footer test는 `고객센터: 02-325-179` 부분 문자열만 확인하므로 `02-325-1794` 회귀를 정확히 잡지 못한다.
- repo root에는 SMS 관련 미커밋 변경이 있어, 이 quick task는 별도 clean worktree/branch에서 진행한다.

## Plan

### Task 1: Footer customer center number를 수정한다

**Files**

- Modify: `apps/web/components/layout/footer.tsx`

**Action**

- 고객센터 번호를 `02-325-1794`로 교체한다.

**Done when**

- footer 렌더링 문자열이 정확히 `고객센터: 02-325-1794`를 포함한다.

### Task 2: Footer regression test를 정확한 번호로 고정한다

**Files**

- Modify: `apps/web/components/layout/__tests__/footer.test.tsx`

**Action**

- compliance surface test가 `02-325-1794` 전체 번호를 검증하도록 업데이트한다.

**Done when**

- 누락된 끝자리로 되돌리면 footer test가 실패한다.

### Task 3: 검증, PR, 프로덕션 배포 확인

**Files**

- No code changes expected

**Action**

- footer unit test와 web build를 실행한다.
- 변경 커밋을 PR로 올리고, CI green 후 merge한다.
- `main` merge 후 downstream `Deploy` workflow가 성공했는지 확인하고, `https://heygrabit.com` production HTML에서 `02-325-1794`가 보이는지 확인한다.

**Done when**

- 테스트와 build가 통과한다.
- PR이 merge되고 production deploy가 성공한다.
- production footer에서 `02-325-1794`가 확인된다.

## Verification

- `pnpm --filter @grabit/web test -- components/layout/__tests__/footer.test.tsx`
- `pnpm --filter @grabit/web build`
- `gh pr checks`
- `gh run list --workflow Deploy --branch main`
- `curl -fsSL https://heygrabit.com | rg "02-325-1794"`
