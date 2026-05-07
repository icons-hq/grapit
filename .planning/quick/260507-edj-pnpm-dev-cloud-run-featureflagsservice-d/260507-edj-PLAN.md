---
phase: quick-260507-edj
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/api/src/modules/feature-flags/feature-flags.service.ts
  - apps/api/src/modules/feature-flags/feature-flags.module.ts
  - apps/api/src/modules/feature-flags/feature-flags.service.spec.ts
autonomous: true
requirements:
  - LOCAL-DEV-PROD-PARITY
---

# Quick Task 260507-edj: pnpm dev FeatureFlagsService DI fix

<objective>
`pnpm dev`로 API를 실행할 때 `FeatureFlagsService` 생성자 인자가 `Function`으로 Nest metadata에 기록되어 `UnknownDependenciesException`이 발생하는 문제를 수정한다. 동일 소스 기준 `pnpm --filter @grabit/api build && pnpm --filter @grabit/api start:prod`도 같은 오류로 실패하므로, dev와 Cloud Run 이미지 실행 경로 모두 Nest DI가 같은 방식으로 부팅되도록 만든다.
</objective>

<root_cause>
`FeatureFlagsService`는 테스트 편의를 위해 생성자 기본값 `runtimeEnvProvider: () => RuntimeEnv = () => process.env`를 사용했다. 하지만 `emitDecoratorMetadata`/SWC `decoratorMetadata`가 이 생성자 파라미터를 `Function`으로 기록하고, Nest는 기본값 여부와 무관하게 `Function` provider를 DI에서 resolve하려고 한다. `FeatureFlagsModule`에는 `Function` provider가 없어서 부팅이 중단된다.
</root_cause>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: FeatureFlagsModule DI 회귀 테스트 추가</name>
  <files>apps/api/src/modules/feature-flags/feature-flags.service.spec.ts</files>
  <action>
  `@nestjs/testing`으로 `FeatureFlagsModule`을 compile하고 `FeatureFlagsService`를 resolve하는 테스트를 추가한다. 이 테스트는 현재 코드에서 `Function` provider resolve 실패로 RED가 되어야 한다.
  </action>
  <verify>
  `pnpm --filter @grabit/api exec vitest run src/modules/feature-flags/feature-flags.service.spec.ts`
  </verify>
</task>

<task type="auto">
  <name>Task 2: runtime env provider를 명시 DI token으로 전환</name>
  <files>apps/api/src/modules/feature-flags/feature-flags.service.ts, apps/api/src/modules/feature-flags/feature-flags.module.ts</files>
  <action>
  `FEATURE_FLAGS_ENV_PROVIDER` token과 `RuntimeEnvProvider` 타입을 export하고, `FeatureFlagsModule`에서 `{ provide: FEATURE_FLAGS_ENV_PROVIDER, useValue: () => process.env }`를 등록한다. `FeatureFlagsService` 생성자에는 `@Inject(FEATURE_FLAGS_ENV_PROVIDER)`를 붙여 metadata의 `Function` 타입 대신 명시 token을 사용한다.
  </action>
  <verify>
  Feature flag 단위 테스트, API build, API start:prod 부팅 로그를 확인한다.
  </verify>
</task>

<task type="auto">
  <name>Task 3: dev/prod parity 검증</name>
  <files>none</files>
  <action>
  `pnpm --filter @grabit/api build`, `pnpm --filter @grabit/api start:prod`, `pnpm --filter @grabit/api dev`를 실행해 DI 오류가 사라졌는지 확인한다. 장기 실행 서버는 readiness 로그 확인 후 종료한다.
  </action>
  <verify>
  `FeatureFlagsService` 관련 `UnknownDependenciesException`이 재발하지 않아야 한다.
  </verify>
</task>

</tasks>
