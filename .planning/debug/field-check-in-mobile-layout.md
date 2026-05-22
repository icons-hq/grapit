---
status: investigating
trigger: "QR 코드 링크로 /field/check-in 진입 시 모바일 UI가 좁은 세로 열처럼 깨지는 문제"
created: 2026-05-22
updated: 2026-05-22
---

# Debug Session: field-check-in-mobile-layout

## Symptoms

- expected: QR 링크로 들어간 현장 check-in 화면이 모바일 viewport에서 카드와 텍스트가 정상 폭으로 렌더링되어야 한다.
- actual: 상태 배지, 제목, 티켓 정보 값, 하단 버튼이 한 글자씩 줄바꿈되며 화면 중앙의 매우 좁은 열로 찌그러진다.
- errors: 사용자 제공 screenshot 기준 framework error overlay는 보이지 않고 layout collapse만 보인다.
- timeline: 현재 local URL `http://localhost:3000/field/check-in?...`에서 재현.
- reproduction: QR 코드 스캔 후 `/field/check-in?ticket=...` 링크를 연다.

## Current Focus

- hypothesis: field check-in route 또는 `ScannerCheckIn` component가 viewport/card width를 충분히 고정하지 못하고, parent flex/grid shrink 때문에 내용이 min-content 폭으로 collapse된다.
- test: route/component CSS를 읽고 Browser에서 모바일 viewport로 재현한 뒤 computed layout과 screenshot을 비교한다.
- expecting: container/card/button에 `min-width: 0`, full-width, sensible max-width, non-shrinking action layout을 적용하면 한글이 세로로 쪼개지지 않는다.
- next_action: inspect field check-in page and scanner component styles.

## Evidence

- 2026-05-22: 사용자 screenshot에서 `입장 가능 티켓입니다`, 공연명, 날짜, 장소/좌석 값이 한 글자 단위로 줄바꿈되어 min-content width collapse 패턴을 보인다.
- 2026-05-22: Browser mobile viewport 390x844에서 `max-w-xl` wrapper computed `max-width`가 `32px`, root width가 `32px`로 확인되었다.
- 2026-05-22: `apps/web/app/globals.css`의 custom `--spacing-xl: 32px`가 Tailwind v4 `max-w-xl` utility namespace와 충돌했다.
- 2026-05-22: fix 후 같은 viewport에서 wrapper computed `max-width`가 `576px`, rendered root width가 `375px`, status/card widths가 `343px`로 회복되었다.

## Eliminated

- none yet

## Resolution

- root_cause: Tailwind v4 theme의 `--spacing-*` custom tokens가 width/max-width utility namespace에 들어가 `max-w-xl`을 32px로 생성했다.
- fix: app spacing tokens를 `--grabit-spacing-*`로 옮겨 Tailwind `--spacing-*` namespace 충돌을 제거했다.
- verification: Browser mobile viewport 390x844, `pnpm --filter @grabit/web exec vitest run components/field/__tests__/scanner-check-in.test.tsx`, `pnpm --filter @grabit/web exec playwright test e2e/phase27-qr-check-in.spec.ts --grep "scanner-only staff"`, `pnpm --filter @grabit/web typecheck`.
- files_changed: `apps/web/app/globals.css`, `apps/web/e2e/phase27-qr-check-in.spec.ts`.
