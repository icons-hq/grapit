---
quick_id: 260506-oef
status: in_progress
created: 2026-05-06
description: 7월 18일 걸룰스 팬미팅 동해문화예술관 대극장 엑셀 기반 SVG 좌석맵 생성 및 사이트 추가
---

# Quick Task 260506-oef: 7월 18일 걸룰스 팬미팅 좌석맵

## Goal

동해문화예술관 대극장 Excel 좌석 배치도를 기반으로 Grabit 예매 화면에서 사용할 SVG 좌석맵을 만들고, 2026-07-18 걸룰스 팬미팅 seed 공연 데이터에 연결한다.

## Plan

1. Excel `.xls` 좌석표를 파싱해 2층/3층 좌석 좌표와 섹션별 좌석 수를 확인한다.
   - Verify: 2층/3층 파싱 좌석 수와 요청 판매 좌석 수를 비교한다.

2. `apps/web/public/seed/`에 SVG 좌석맵을 생성한다.
   - Include: `data-seat-id`, `data-stage="top"`, floor/section labels.
   - Verify: SVG 내 판매 가능 `data-seat-id` 수가 2,000개이고 중복이 없다.

3. `apps/api/src/database/seed.mjs`에 걸룰스 팬미팅 공연, 회차, 가격 등급, 좌석맵 설정을 추가한다.
   - Include: `SVIP석` 700석 380,000원, `VIP석` 500석 260,000원, `R석` 800석 120,000원.
   - Verify: API seed syntax/test 대상이 통과하고 SVG/seatConfig count가 일치한다.

## Assumption

Excel 원본 기준 3층은 706석이다. 요청한 `R석 800석`을 맞추기 위해 R석은 3층 전체 706석과 2층 후방 잔여 94석으로 구성한다. 나머지 5개 Excel 좌석은 비판매 좌석으로 SVG에 표시하되 `data-seat-id`는 부여하지 않는다.
