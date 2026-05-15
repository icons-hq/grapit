---
quick_id: 260515-ldb
slug: seat-map-center
status: planned
date: 2026-05-15
---

# Quick Task 260515-ldb: Seat Map Center Alignment

## Goal

티켓 좌석 선택 화면에서 SVG 좌석맵이 viewer 영역 안에서 상하좌우 가운데 정렬되도록 고정한다. 좌석 선택, 확대/축소, MiniMap, SVG sanitization 동작은 그대로 유지한다.

## Findings

- 중심 구현 surface는 `apps/web/components/booking/seat-map-viewer.tsx`이다.
- 현재 `TransformComponent`는 `wrapperClass="w-full min-h-[300px] lg:min-h-[500px]"`, `contentClass="w-full"`만 사용하므로 viewer 높이보다 SVG가 작을 때 세로/가로 중앙 정렬 contract가 명시되어 있지 않다.
- 기존 `apps/web/components/booking/__tests__/seat-map-viewer.test.tsx`는 `TransformWrapper` props만 spy하고 `TransformComponent` layout props는 검증하지 않는다.

## Source Audit

- GOAL: 좌석맵 이미지를 상하좌우 가운데 정렬해 사용성을 개선한다. Covered by Task 1 and Task 2.
- REQ: Quick task에는 ROADMAP requirement ID가 없다. No phase requirement applies.
- RESEARCH: No research phase requested. Existing stack uses React, Tailwind CSS, Vitest, and `react-zoom-pan-pinch`.
- CONTEXT: Single plan, 1-3 tasks, no implementation edits during planning, expected files limited to `seat-map-viewer.tsx` and related tests. Covered.

## Plan

### Task 1: Seat map centering regression test를 추가한다

**Files**

- Modify: `apps/web/components/booking/__tests__/seat-map-viewer.test.tsx`

**Action**

- `react-zoom-pan-pinch` mock에 `TransformComponent` props를 기록하는 spy를 추가한다.
- `SeatMapViewer` 렌더 후 `TransformComponent`가 viewer wrapper와 transform content를 수평/수직 중앙 정렬하는 class/style contract를 받는지 검증하는 test를 추가한다.
- test는 layout contract만 검증하고, seat identity, SVG sanitization, click delegation, selected-seat animation, MiniMap 분기 테스트는 변경하지 않는다.

**Verify**

- Automated: `pnpm --filter @grabit/web test -- components/booking/__tests__/seat-map-viewer.test.tsx`

**Done when**

- 중앙 정렬 class/style이 빠지면 새 test가 실패한다.
- 기존 `SeatMapViewer` behavior tests가 계속 통과한다.

### Task 2: Seat map viewer layout을 가운데 정렬로 고정한다

**Files**

- Modify: `apps/web/components/booking/seat-map-viewer.tsx`

**Action**

- `TransformComponent`의 wrapper/content layout을 조정해 SVG 좌석맵이 viewer의 `min-h-[300px] lg:min-h-[500px]` 영역 안에서 수평과 수직 모두 가운데 놓이게 한다.
- Tailwind utility 또는 existing inline style만 사용하고 새 dependency, global CSS, booking page layout 변경은 추가하지 않는다.
- `centerOnInit`, mobile `initialScale={1.4}`, `minScale`, `maxScale`, `SeatMapControls`, desktop `MiniMap`, `containerRef`, `role="grid"`, SVG sanitization path는 유지한다.
- `svgEl` responsive style은 좌석맵이 container 폭을 넘지 않도록 유지하되, 중앙 정렬을 방해하는 full-width-only content contract는 교정한다.

**Verify**

- Automated: `pnpm --filter @grabit/web test -- components/booking/__tests__/seat-map-viewer.test.tsx`
- Automated: `pnpm --filter @grabit/web lint -- components/booking/seat-map-viewer.tsx components/booking/__tests__/seat-map-viewer.test.tsx`

**Done when**

- 좌석맵 SVG가 desktop/mobile viewer 영역에서 상하좌우 가운데 정렬된다.
- 확대/축소, 좌석 클릭, 선택 표시, unavailable/excluded seat handling이 기존 테스트 기준으로 회귀하지 않는다.

## Threat Model

| Boundary | Description |
|----------|-------------|
| Remote SVG -> inline DOM | `svgUrl`에서 가져온 SVG가 sanitizer를 거쳐 `dangerouslySetInnerHTML`로 렌더링된다. |

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-260515-ldb-01 | I/T | `seat-map-viewer.tsx` SVG rendering | mitigate | Layout 변경 중 `sanitizeParsedSvg`, `prefixSvgDefsIds`, `dangerouslySetInnerHTML` data path를 변경하지 않는다. |
| T-260515-ldb-02 | D | `TransformComponent` layout | accept | 단순 flex/layout 변경이며 network, storage, auth, payment 경계가 없다. Unit test로 viewer behavior regression을 방지한다. |

## Verification

- `pnpm --filter @grabit/web test -- components/booking/__tests__/seat-map-viewer.test.tsx`
- `pnpm --filter @grabit/web lint -- components/booking/seat-map-viewer.tsx components/booking/__tests__/seat-map-viewer.test.tsx`

## Success Criteria

- `apps/web/components/booking/seat-map-viewer.tsx`가 좌석맵 transform wrapper/content를 중앙 정렬한다.
- `apps/web/components/booking/__tests__/seat-map-viewer.test.tsx`가 중앙 정렬 layout contract를 회귀 방지한다.
- 구현 변경은 좌석맵 viewer와 해당 test에만 한정된다.
