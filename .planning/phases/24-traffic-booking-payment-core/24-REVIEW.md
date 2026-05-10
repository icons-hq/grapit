---
phase: 24-traffic-booking-payment-core
reviewed: 2026-05-10T13:06:53Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - .github/workflows/deploy.yml
  - docs/runbooks/phase24-queue-waf-prewarm.md
  - apps/api/src/modules/ops/prewarm.service.ts
  - apps/api/src/modules/ops/prewarm.service.spec.ts
  - apps/web/components/booking/seat-map-viewer.tsx
  - apps/web/components/booking/__tests__/seat-map-viewer.test.tsx
  - apps/web/e2e/booking-floor-selection.spec.ts
findings:
  critical: 2
  warning: 4
  info: 0
  total: 6
status: issues_found
---

# Phase 24: Code Review Report

**Reviewed:** 2026-05-10T13:06:53Z
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Phase 24 gap-closure 범위의 deploy workflow, prewarm runbook/service/spec, seat-map viewer, unit/e2e tests를 표준 깊이로 검토했다. live prewarm route는 public route 위에서 동작하므로 비용성 scale change와 원격 OIDC 검증 순서가 안전해야 하는데, 현재 구현에는 출시 전 수정이 필요한 route-safety blocker가 있다. SVG hit-target 변경 자체는 방향이 맞지만, 특수 seat id 처리와 모바일 e2e 검증에 테스트 공백이 남아 있다.

## Critical Issues

### CR-01 [BLOCKER]: Control token 검증 전에 Google OIDC/JWKS 네트워크 검증이 실행됨

**File:** `apps/api/src/modules/ops/prewarm.service.ts:84`

**Issue:** `authorizeSchedulerRequest()`가 `extractBearerToken()`과 `verifyGoogleSignedIdToken()`을 먼저 실행한 뒤 line 89에서야 `x-prewarm-control-token`을 검증한다. 이 route는 controller에서 public route로 열려 있으므로, control token이 없는 외부 요청도 syntactically valid JWT와 임의 `kid`만 보내면 Google discovery/JWKS fetch 및 line 240-244의 cache refresh 경로를 유발할 수 있다. 두 번째 factor가 expensive remote verification 앞에 오지 않아 launch window에서 공개 endpoint를 통한 resource exhaustion 경로가 생긴다.

**Fix:**

```ts
private async authorizeSchedulerRequest(req: PrewarmRequestLike): Promise<PrewarmTokenClaims> {
  this.assertControlToken(req);

  const oidcToken = this.extractBearerToken(req);
  const claims = await this.verifyGoogleSignedIdToken(oidcToken);
  this.assertExpectedClaims(claims);

  return claims;
}
```

추가로 missing/wrong `x-prewarm-control-token` 요청에서는 `global.fetch`가 호출되지 않는 regression spec을 넣어야 한다.

### CR-02 [BLOCKER]: serviceName과 minInstances가 allowlist 없이 Cloud Run Admin API로 전달됨

**File:** `apps/api/src/modules/ops/prewarm.service.ts:135`

**Issue:** route path의 `:serviceName`은 pattern만 확인되고, line 147-149에서 그대로 Cloud Run service path에 들어간다. `minInstances`도 line 139-140에서 non-negative integer만 확인한다. 현재 runtime principal은 run.admin 권한을 요구하므로, 유효한 Scheduler token/control token을 가진 호출자가 `grabit-api` 외의 같은 project/region Cloud Run service를 scale하거나 과도한 min instance 값을 시도할 수 있다. runbook은 live Phase 24에서 `grabit-api`와 `minInstances=100/0`만 전제로 하는데 코드가 이 contract를 강제하지 않는다.

**Fix:**

```ts
const PREWARM_ALLOWED_SERVICE_NAME = 'PREWARM_ALLOWED_SERVICE_NAME';
const PREWARM_MAX_MIN_INSTANCES = 'PREWARM_MAX_MIN_INSTANCES';

const allowedServiceName = this.getRequiredEnv(PREWARM_ALLOWED_SERVICE_NAME);
if (serviceName !== allowedServiceName) {
  throw new ForbiddenException('PREWARM_SERVICE_NOT_ALLOWED');
}

const maxMinInstances = Number.parseInt(this.getRequiredEnv(PREWARM_MAX_MIN_INSTANCES), 10);
if (
  !Number.isInteger(minInstances) ||
  minInstances < 0 ||
  !Number.isInteger(maxMinInstances) ||
  minInstances > maxMinInstances
) {
  throw new BadRequestException('PREWARM_INVALID_MIN_INSTANCES');
}
```

deploy/runbook에도 `PREWARM_ALLOWED_SERVICE_NAME=grabit-api`와 `PREWARM_MAX_MIN_INSTANCES=100`을 같은 invariant로 추가한다.

## Warnings

### WR-01 [WARNING]: deploy workflow가 concurrent workflow_run 배포를 직렬화하지 않음

**File:** `.github/workflows/deploy.yml:16`

**Issue:** workflow는 CI `workflow_run` 성공마다 deploy를 시작하지만 top-level `concurrency`가 없다. main에 연속 push가 들어오면 두 deploy가 병렬로 image build, migration, Cloud Run deploy를 수행할 수 있고, 느린 이전 SHA가 늦게 끝나면 최신 SHA 배포 후 다시 오래된 revision이 live traffic을 받을 수 있다. DB migration이 forward-only인 상태에서 older app revision이 마지막에 배포되는 것은 production rollback/compatibility risk다.

**Fix:**

```yaml
concurrency:
  group: deploy-${{ github.event.workflow_run.head_branch }}
  cancel-in-progress: false
```

main deploy는 하나씩만 진행되게 하고, running deploy 중 새 push가 오면 GitHub의 pending replacement 동작으로 최종적으로 최신 pending deploy만 남도록 구성한다.

### WR-02 [WARNING]: CSS selector에 raw seatId를 삽입해 특수 seat id에서 viewer가 crash할 수 있음

**File:** `apps/web/components/booking/seat-map-viewer.tsx:408`

**Issue:** selected/pending seat effect에서 `querySelector(`[data-seat-id="${seatId}"]`)`를 직접 만든다. SVG 좌석맵은 외부 제작 SVG 업로드 방식이고 `data-seat-id`는 XML entity decode 후 `"`나 `\` 같은 CSS selector 특수 문자를 포함할 수 있다. 그런 좌석이 선택되면 `querySelector`가 `SyntaxError`를 던져 seat map 렌더가 깨진다. 같은 파일에 이미 attribute equality로 찾는 `findSeatElementById()` helper가 있어 이 동적 selector가 불필요하다.

**Fix:**

```ts
const el = findSeatElementById(root, seatId);
if (!el) return;
```

line 408-420과 line 417-420의 두 selector 모두 helper 또는 `CSS.escape(seatId)` 기반 selector로 바꾼다.

### WR-03 [WARNING]: 모바일 e2e가 tap 성공을 검증하지 못하는 false-positive assertion을 사용함

**File:** `apps/web/e2e/booking-floor-selection.spec.ts:382`

**Issue:** 모바일 테스트는 tap 이후 `page.getByRole('radio', { name: '1층' }).getByText('1')`만 확인한다. 이 텍스트는 좌석을 선택하지 않아도 floor radio label 자체에 이미 존재할 수 있으므로, `tapSeatLabelCenter()`가 아무 동작을 하지 않아도 테스트가 통과할 수 있다. SVG hit-target behavior를 막아야 하는 테스트가 실제 selection summary, timer, CTA enablement를 검증하지 않는다.

**Fix:**

```ts
await tapSeatLabelCenter(page);

await expect(page.getByText('A열 1번')).toBeVisible();
await expect(page.getByLabel(/남은 시간 \d+분 \d+초/)).toBeVisible();
await expect(getNextButton(page)).toBeEnabled();
```

모바일 layout에서 sidebar가 숨겨진다면 mobile-specific selected-seat surface를 locator로 잡아야 한다.

### WR-04 [WARNING]: prewarm route wiring test가 source 문자열만 검사해 routing regression을 놓칠 수 있음

**File:** `apps/api/src/modules/ops/prewarm.service.spec.ts:249`

**Issue:** controller route test가 `prewarm.controller.ts` 파일을 문자열로 읽고 decorator text 포함 여부만 확인한다. decorator가 comment에 남거나 controller method가 Nest app에 등록되지 않아도 테스트가 통과할 수 있고, body schema와 status code도 검증하지 않는다. live prewarm route safety를 보장해야 하는 범위에서 source-string assertion은 신뢰도가 낮다.

**Fix:**

```ts
const moduleRef = await Test.createTestingModule({
  controllers: [PrewarmController],
  providers: [
    {
      provide: PrewarmService,
      useValue: {
        scaleUp: vi.fn().mockResolvedValue({ operation: 'scale-up' }),
        stepDown: vi.fn().mockResolvedValue({ operation: 'step-down' }),
      },
    },
  ],
}).compile();
const app = moduleRef.createNestApplication();
await app.init();

await request(app.getHttpServer())
  .post('/internal/prewarm/services/grabit-api')
  .send({ minInstances: 100 })
  .expect(202);
await request(app.getHttpServer())
  .post('/internal/prewarm/services/grabit-api/step-down')
  .send({})
  .expect(202);
```

이 방식으로 실제 Nest route registration, method, path, zod body contract를 검증한다.

---

_Reviewed: 2026-05-10T13:06:53Z_  
_Reviewer: the agent (gsd-code-reviewer)_  
_Depth: standard_
