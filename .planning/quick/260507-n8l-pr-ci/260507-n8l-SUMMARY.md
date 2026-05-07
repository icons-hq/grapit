# Quick Task 260507-n8l Summary

## Objective

PR #33의 CI `check` 실패를 로컬에서 재현하고, 실제 회귀만 수정해 CI 동등 검증을 다시 green 상태로 만들었다.

## Result

- `apps/web/e2e/i18n-smoke.spec.ts`
  - Korean home smoke copy를 hardcoded `HOT 공연`에서 `apps/web/messages/ko.json`의 `home.hot` source-of-truth로 전환했다.
- `apps/web/hooks/use-runtime-flags.ts`
  - `initialData`가 30초 동안 fresh로 취급되어 booking flag가 `true`여도 first mount에서 refetch되지 않던 문제를 `initialDataUpdatedAt: 0`으로 수정했다.
- `apps/web/e2e/toss-payment.spec.ts`
  - confirm-page 기반 Toss scenarios가 launch-disabled runtime flag와 결합되지 않도록 test-local `bookingEnabled=true` override를 추가했다.
- `apps/web/hooks/__tests__/booking-disabled-runtime.test.tsx`
  - required agreement 이후 CTA가 `결제하기`로 전이되는지, `prepare 409`에서 recovery UI가 뜨고 `requestPayment`가 호출되지 않는지를 focused regression으로 고정했다.

## Commit

- `85b81c3` `fix(260507-n8l): restore CI booking checks`

## Verification

- `pnpm --filter @grabit/web test -- booking-disabled-runtime.test.tsx` — PASS
- `pnpm --filter @grabit/web exec playwright test e2e/i18n-smoke.spec.ts --project=chromium --reporter=line` — PASS
- `pnpm --filter @grabit/web exec playwright test e2e/toss-payment.spec.ts --project=chromium --grep 'lock ownership: prepare 409' --reporter=line` — PASS
- `pnpm typecheck` — PASS
- `pnpm test` — PASS
- `CI=1 pnpm --filter @grabit/web test:e2e` — PASS

## Notes

- local 재현은 CI와 분리된 임시 Postgres 컨테이너(`localhost:55432/grabit_test`)와 별도 API session으로 수행했다.
- plain local `pnpm --filter @grabit/web test:e2e`는 Playwright 기본 8-worker 실행이라 CI와 worker/retry 조건이 달라졌다. 최종 판정은 workflow와 동일한 `CI=1` 조건으로 확인했다.
