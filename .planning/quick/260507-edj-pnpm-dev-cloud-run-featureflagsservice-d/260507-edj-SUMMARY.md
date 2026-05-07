---
phase: quick-260507-edj
status: complete
completed: 2026-05-07
commit: 0275799
---

# Quick Task 260507-edj: pnpm dev FeatureFlagsService DI fix Summary

## Objective

`pnpm dev` 실행 시 API가 `FeatureFlagsService` 의존성 resolve 단계에서 `UnknownDependenciesException`으로 중단되는 문제를 수정했다. 같은 소스 기준 `pnpm --filter @grabit/api build && pnpm --filter @grabit/api start:prod` 경로도 동일한 DI 오류가 재현되어, dev/prod 실행 경로 모두에서 Nest DI가 안정적으로 부팅되도록 맞췄다.

## Root Cause

`FeatureFlagsService` 생성자에 `runtimeEnvProvider: () => RuntimeEnv = () => process.env` 기본값을 둔 상태였다. TypeScript 타입은 함수 타입이고 기본값도 존재하지만, Nest는 decorator metadata의 `design:paramtypes`를 기준으로 생성자 의존성을 resolve한다. SWC `decoratorMetadata`가 이 파라미터를 `Function`으로 기록하면서 Nest가 `Function` provider를 찾게 되었고, `FeatureFlagsModule`에는 해당 provider가 없어 부팅이 중단됐다.

## What Changed

### apps/api/src/modules/feature-flags/feature-flags.service.ts

- `FEATURE_FLAGS_ENV_PROVIDER` symbol token을 추가했다.
- 생성자 파라미터에 `@Inject(FEATURE_FLAGS_ENV_PROVIDER)`를 명시했다.
- 기존 테스트에서 쓰는 직접 생성 방식 `new FeatureFlagsService(() => ({ ... }))`는 유지된다.

### apps/api/src/modules/feature-flags/feature-flags.module.ts

- `FEATURE_FLAGS_ENV_PROVIDER` provider를 등록했다.
- 기본 runtime env provider는 `() => process.env`로 유지해 Cloud Run/로컬 모두 실제 runtime env를 읽는다.

### apps/api/src/modules/feature-flags/feature-flags.service.spec.ts

- `FeatureFlagsModule` compile + service resolve 테스트를 추가했다.
- `SELF_DECLARED_DEPS_METADATA`에 explicit token이 기록되는지 검증해 `Function` metadata 회귀를 막는다.

## Verification Results

| Check | Command | Result |
|-------|---------|--------|
| RED | `pnpm --filter @grabit/api exec vitest run src/modules/feature-flags/feature-flags.service.spec.ts` | explicit token metadata 테스트 1건 실패 확인 |
| Feature flag spec | `pnpm --filter @grabit/api exec vitest run src/modules/feature-flags/feature-flags.service.spec.ts` | 13/13 passed |
| Typecheck | `pnpm --filter @grabit/api typecheck` | passed |
| API tests | `pnpm --filter @grabit/api test` | 41 files, 493 tests passed |
| API lint | `pnpm --filter @grabit/api lint` | 0 errors, existing 42 warnings |
| API build | `pnpm --filter @grabit/api build` | TSC 0 issues, SWC compiled 160 files |
| Prod smoke | `pnpm --filter @grabit/api start:prod` wrapper | `FeatureFlagsModule dependencies initialized`, `Nest application successfully started`, `API server running on http://localhost:8080` |
| Dev smoke | `pnpm --filter @grabit/api dev` wrapper | SWC watch compiled, `FeatureFlagsModule dependencies initialized`, `API server running on http://localhost:8080` |

## Notes

- 루트 `pnpm dev` 전체 재실행은 기존 `next-server`가 `:3000`을 점유 중이라 web port conflict가 섞일 수 있어 새로 띄우지 않았다. 실패 지점이던 API dev watch는 단독으로 검증했다.
- 중간에 build/test를 병렬 실행한 직후 `start:prod`에서 dist 레이아웃 transient 실패가 한 번 있었고, dist 확인 후 순차 start로 정상 부팅을 재확인했다.

## Commits

| Hash | Message |
|------|---------|
| 0275799 | fix(quick-260507-edj): make feature flags env provider explicit |
