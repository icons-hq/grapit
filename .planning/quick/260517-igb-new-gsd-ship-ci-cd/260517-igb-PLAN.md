---
quick_id: 260517-igb
slug: new-gsd-ship-ci-cd
status: planned
date: 2026-05-17
phase: quick-260517-igb-new-gsd-ship-ci-cd
plan: 01
type: execute
wave: 1
depends_on: []
autonomous: true
requirements:
  - QUICK-260517-IGB
files_modified:
  - apps/web/components/home/new-section.tsx
  - apps/web/components/home/__tests__/new-section-layout.test.tsx
must_haves:
  truths:
    - "홈페이지 New 섹션에 공연 카드가 1개만 있어도 카드가 섹션 중앙에 정렬된다."
    - "New 섹션에 공연 카드가 2개 이상이면 기존 2-column mobile / 4-column desktop grid layout이 유지된다."
    - "New 섹션 heading, 더보기 link, locale-aware href, PerformanceCard rendering behavior는 변경되지 않는다."
    - "변경 후 targeted test/typecheck가 통과하고 `$gsd-ship 현재 브랜치`로 CI/CD ship을 진행할 수 있다."
  artifacts:
    - path: "apps/web/components/home/new-section.tsx"
      provides: "Single-card center alignment and existing multi-card grid behavior"
      contains: "isSinglePerformance"
    - path: "apps/web/components/home/__tests__/new-section-layout.test.tsx"
      provides: "Regression coverage for single-card center alignment"
      contains: "NewSection"
  key_links:
    - from: "apps/web/components/home/new-section.tsx"
      to: "apps/web/components/performance/performance-card.tsx"
      via: "PerformanceCard remains the only card renderer"
      pattern: "PerformanceCard performance"
    - from: "apps/web/components/home/new-section.tsx"
      to: "apps/web/hooks/use-performances.ts"
      via: "useNewPerformances data length controls layout only"
      pattern: "performances.length"
---

# Quick Task 260517-igb: Home New Section Center Alignment

## Goal

메인페이지 `New` 섹션에서 공연 카드가 1개만 노출될 때 왼쪽 컬럼에 붙지 않고 섹션 가운데에 오도록 복구한다. 복구 후 targeted verification evidence를 남기고 `$gsd-ship 현재 브랜치`로 PR/CI/CD 배포를 이어갈 수 있는 상태로 만든다.

## Findings

- 중심 구현 surface는 `apps/web/components/home/new-section.tsx`이다.
- 현재 `NewSection`은 항상 `grid grid-cols-2 md:grid-cols-4`를 사용하므로 `performances.length === 1`일 때 첫 번째 grid column에만 카드가 배치된다.
- `PerformanceCard` 자체는 `block` card이며 alignment 책임은 section/grid wrapper에 있다. `apps/web/components/performance/performance-card.tsx`는 변경하지 않는다.
- 기존 `apps/web/app/__tests__/home-i18n.test.tsx`는 heading/copy만 확인하고 single-card layout contract를 검증하지 않는다.
- 이 quick plan은 source code를 직접 수정하지 않는다. 실행 단계에서만 아래 파일을 수정한다.

## Source Audit

| Source | Item | Coverage |
|--------|------|----------|
| GOAL | 메인페이지 `New` 섹션 단일 공연 카드 가운데 정렬 복구 | Task 1, Task 2 |
| GOAL | targeted verification 포함 | Task 1, Task 3 |
| GOAL | `$gsd-ship` 기반 CI/CD 배포 readiness 포함 | Task 3 |
| REQ | `QUICK-260517-IGB` quick task, ROADMAP phase requirement 없음 | This plan |
| RESEARCH | No research phase per user constraint | Existing React/Tailwind/Vitest patterns only |
| CONTEXT | Single plan, 1-3 focused tasks | This single plan has 3 tasks |
| CONTEXT | Do not modify source code during planning | This artifact only; source code changes are executor scope |

Deferred Ideas: none.

## Plan

### Task 1: New section single-card layout regression test를 추가한다

**Files**

- Create: `apps/web/components/home/__tests__/new-section-layout.test.tsx`

**Action**

- `NewSection` component-level test를 새로 만든다.
- `next-intl`의 `useLocale`은 `en`으로 mock한다.
- `@/hooks/use-performances`의 `useNewPerformances`는 test별 mutable fixture를 반환하도록 mock한다.
- `@/components/performance/performance-card`는 layout parent를 검사하기 쉽게 `data-testid="new-performance-card"`를 가진 간단한 link/card mock으로 대체한다.
- Case 1: fixture가 1개일 때 card wrapper의 parent container가 single-card center contract인 `flex justify-center`를 갖는지 검증한다. card wrapper는 `w-[calc((100%-0.75rem)/2)] md:w-[calc((100%-4.5rem)/4)]`를 가져야 한다.
- Case 2: fixture가 2개 이상일 때 기존 multi-card grid contract인 `grid grid-cols-2 md:grid-cols-4`가 유지되고 single-card-only width override가 적용되지 않는지 검증한다.
- 이 test는 `PerformanceCard` internals, i18n copy, API fetching, image rendering은 검증하지 않는다. 해당 책임은 기존 tests와 component에 남긴다.

**Verify**

- Automated: `pnpm --filter @grabit/web test -- components/home/__tests__/new-section-layout.test.tsx`

**Done when**

- 단일 카드가 왼쪽 grid column에 붙도록 회귀하면 새 test가 실패한다.
- 다중 카드 grid class를 깨뜨려도 새 test가 실패한다.

### Task 2: New section 단일 카드만 가운데 정렬한다

**Files**

- Modify: `apps/web/components/home/new-section.tsx`

**Action**

- `cn` helper를 `@/lib/cn`에서 import한다.
- `if (!performances?.length) return null;` 이후 `const isSinglePerformance = performances.length === 1;`를 정의한다.
- cards container class를 조건부로 바꾼다.
  - 단일 카드: `flex justify-center gap-x-3 gap-y-6 md:gap-6`
  - 다중 카드: 기존 `grid grid-cols-2 gap-x-3 gap-y-6 md:grid-cols-4 md:gap-6`
- card wrapper class도 조건부로 바꾼다.
  - 공통: `min-w-0`
  - 단일 카드 전용: normal grid column과 비슷한 폭을 유지하도록 `w-[calc((100%-0.75rem)/2)] md:w-[calc((100%-4.5rem)/4)]`
- `PerformanceCard`, heading text `New`, `getLocalizedPathname('/genre/artist_celebrity', activeLocale)?sort=latest`, `copy.home.more`, loading/empty behavior는 변경하지 않는다.
- `HotSection`, `PerformanceCard`, home page container, global CSS, API hook은 수정하지 않는다.

**Verify**

- Automated: `pnpm --filter @grabit/web test -- components/home/__tests__/new-section-layout.test.tsx`
- Automated: `pnpm --filter @grabit/web typecheck`

**Done when**

- `performances.length === 1`이면 `New` 섹션 카드가 section 중앙에 배치된다.
- `performances.length >= 2`이면 기존 2-column mobile / 4-column desktop card grid가 유지된다.
- 변경 범위가 `new-section.tsx`와 새 layout test에 한정된다.

### Task 3: Targeted verification evidence와 ship handoff를 준비한다

**Files**

- Create: `.planning/quick/260517-igb-new-gsd-ship-ci-cd/260517-igb-SUMMARY.md`

**Action**

- Task 1/2 automated gates를 다시 실행하고 결과를 summary에 기록한다.
- 추가로 `pnpm --filter @grabit/web lint`를 실행해 frontend lint gate를 확인한다. lint가 기존 unrelated issue로 실패하면 failure output에서 이 quick task 파일과 무관한지 분리해서 summary에 남기고, 관련 failure면 수정 후 재실행한다.
- 가능하면 local web을 띄워 desktop/mobile viewport에서 `/`를 확인하고 `New` 섹션 단일 카드가 중앙에 있는지 browser screenshot 또는 concise manual-smoke evidence를 summary에 남긴다. API data가 다중 카드로 나와 단일 카드 상태를 재현할 수 없으면 unit regression test를 canonical proof로 표시하고 그 이유를 적는다.
- `git status --short`로 source diff가 `apps/web/components/home/new-section.tsx`, `apps/web/components/home/__tests__/new-section-layout.test.tsx`, 이 quick summary에 한정되는지 확인한다.
- quick implementation commit을 만든 뒤 summary 마지막에 next command를 명시한다: `$gsd-ship 현재 브랜치`. Ship workflow가 PR creation, CI watch, merge, Deploy workflow watch, live smoke를 소유한다.

**Verify**

- Automated: `pnpm --filter @grabit/web test -- components/home/__tests__/new-section-layout.test.tsx`
- Automated: `pnpm --filter @grabit/web typecheck`
- Automated: `pnpm --filter @grabit/web lint`
- Automated: `git status --short`

**Done when**

- Targeted test, typecheck, lint evidence가 summary에 남아 있다.
- Diff scope가 이 quick task에 필요한 files로 제한되어 있다.
- `$gsd-ship 현재 브랜치`를 바로 실행할 수 있는 handoff가 summary에 명시되어 있다.

## Threat Model

| Boundary | Description |
|----------|-------------|
| API data -> home UI layout | `useNewPerformances()`에서 받은 untrusted length/data가 public home layout 분기를 결정한다. |

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-260517-igb-01 | D | `NewSection` layout | mitigate | Single-card branch only changes layout classes; empty data still returns `null` and multi-card grid remains covered by regression test. |
| T-260517-igb-02 | I | `PerformanceCard` rendering | accept | No data fields, API paths, auth, booking, or payment behavior changes; existing `PerformanceCard` renderer is reused unchanged. |

## Verification

- `pnpm --filter @grabit/web test -- components/home/__tests__/new-section-layout.test.tsx`
- `pnpm --filter @grabit/web typecheck`
- `pnpm --filter @grabit/web lint`
- `git status --short`

## Success Criteria

- 단일 `New` 공연 카드는 mobile/desktop 모두 섹션 중앙에 배치된다.
- 다중 `New` 공연 카드는 기존 grid density와 spacing을 유지한다.
- New section의 link/copy/loading/empty/rendering behavior는 변경되지 않는다.
- Quick summary에 automated verification과 `$gsd-ship 현재 브랜치` handoff가 기록된다.
