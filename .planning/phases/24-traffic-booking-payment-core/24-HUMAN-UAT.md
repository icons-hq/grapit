---
status: partial
phase: 24-traffic-booking-payment-core
source: [24-VERIFICATION.md]
started: 2026-05-08T10:32:42Z
updated: 2026-05-10T21:31:11+09:00
---

# Phase 24: Human UAT

## Current Test

[testing complete - 1 passed, 1 issue, 2 blocked external/operational gates]

## Tests

### 1. Cloudflare WAF/rate-limit/challenge/block rules 실제 Zone 반영 확인
expected: runbook의 queue-entry/lock-seat/prepare-reservation/confirm-payment 규칙이 활성화되고 동작한다
result: blocked
blocked_by: third-party
reason: "Wrangler OAuth login is available, but Cloudflare API zone list for the authenticated account returned zero zones. No active Grapit zone/ruleset/rate-limit/challenge/block state can be verified from this local account."
evidence:
  - command: pnpm exec wrangler whoami
    result: PASS, authenticated account visible with zone:read scope
  - command: Cloudflare API GET /client/v4/zones?per_page=50 using Wrangler OAuth token
    result: PASS request, empty zone list
  - command: pnpm exec wrangler zones list
    result: FAIL, Wrangler v4 has no zones list command

### 2. Cloud Scheduler → prewarm API(OIDC+control-token) 실제 호출 검증
expected: scale-up/step-down job이 의도한 서비스에 성공하고 감사 가능한 실행 로그가 남는다
result: passed
resolved_at: 2026-05-10T21:28:43+09:00
audience_url: "https://grabit-api-d3c6wrfdbq-du.a.run.app/api/v1/internal/prewarm/services/grabit-api"
runtime_service_account: "grapit-cloudrun@grapit-491806.iam.gserviceaccount.com"
scheduler_service_account: "scheduler-prewarm@grapit-491806.iam.gserviceaccount.com"
job_names:
  - grabit-prewarm-scale-up
  - grabit-prewarm-step-down
notes:
  - "익명 유효 JSON POST는 scale-up/step-down 모두 401을 반환해, deployed route contract가 더 이상 404나 body-validation-only 400 단계에 머물지 않음을 확인했다."
  - "첫 live rerun은 runtime service account의 self `roles/iam.serviceAccountUser` binding 누락으로 503(`iam.serviceaccounts.actAs` denied)였고, binding 추가 후 scale-up이 성공했다."
  - "직후 step-down은 in-flight scale-up과 service version이 충돌해 한 번 503이 났지만, 서비스가 settle 된 뒤 단독 재실행에서 202와 Cloud Run audit success를 확인했다."
evidence:
  - command: gcloud auth list --filter=status:ACTIVE --format='value(account)' && gcloud config get-value project
    result: PASS, active account sangwopark19icons@gmail.com, project grapit-491806
  - command: pnpm --filter @grabit/api exec vitest run src/modules/ops/prewarm.service.spec.ts
    result: PASS, 4 tests passed after switching the Cloud Run Admin API contract to `template.scaling.minInstanceCount`
  - command: pnpm --filter @grabit/api typecheck
    result: PASS, no TypeScript errors
  - command: gcloud run deploy grabit-api --project=grapit-491806 --region=asia-northeast3 --image asia-northeast3-docker.pkg.dev/grapit-491806/grabit/grabit-api:24-21-prewarm-amd64-20260510212420-30703eb --max-instances=100 --quiet
    result: PASS, deployed revision `grabit-api-00034-x9x`
  - command: gcloud run services describe grabit-api --region=asia-northeast3 --format='value(status.url)' && gcloud secrets versions access latest --secret=prewarm-allowed-audience
    result: PASS, live target URL and `PREWARM_ALLOWED_AUDIENCE` both equal `https://grabit-api-d3c6wrfdbq-du.a.run.app/api/v1/internal/prewarm/services/grabit-api`
  - command: gcloud secrets versions access latest --secret=prewarm-allowed-scheduler-email
    result: PASS, live scheduler caller remains `scheduler-prewarm@grapit-491806.iam.gserviceaccount.com`
  - command: node anonymous valid-JSON POST smoke for scale-up/step-down
    result: PASS, scale-up 401 and step-down 401 for unauthenticated requests
  - command: gcloud iam service-accounts add-iam-policy-binding grapit-cloudrun@grapit-491806.iam.gserviceaccount.com --member='serviceAccount:grapit-cloudrun@grapit-491806.iam.gserviceaccount.com' --role='roles/iam.serviceAccountUser'
    result: PASS, added the self `iam.serviceAccounts.actAs` binding required for Cloud Run UpdateService calls that preserve the runtime service account
  - command: gcloud scheduler jobs describe grabit-prewarm-scale-up --location=asia-northeast3 && gcloud scheduler jobs describe grabit-prewarm-step-down --location=asia-northeast3
    result: PASS, both jobs exist in `asia-northeast3`, use `POST`, the same shared OIDC audience, and `x-prewarm-control-token`
  - command: gcloud scheduler jobs run grabit-prewarm-scale-up --location=asia-northeast3
    result: PASS, Cloud Run request log `2026-05-10T12:27:42.740801Z` returned 202 and Cloud Audit `UpdateService` recorded `template.scaling.minInstanceCount=100` at `2026-05-10T12:27:42.805289Z`
  - command: gcloud scheduler jobs run grabit-prewarm-step-down --location=asia-northeast3
    result: PASS after sequential rerun, Cloud Run request log `2026-05-10T12:28:42.779Z` returned 202 and Cloud Audit `UpdateService` recorded `template.scaling.minInstanceCount=0` at `2026-05-10T12:28:43.279486Z`
  - command: gcloud run services describe grabit-api --region=asia-northeast3 --format='export' | rg 'autoscaling.knative.dev/minScale'
    result: PASS, observed `minScale: 100` after scale-up and `minScale: 0` after final step-down

### 3. Toss sandbox 실결제 경로(국내카드/해외카드/Alipay+/truemoney) E2E
expected: sync/pending/recovery 분기와 안내문구가 실제 redirect/webhook 왕복에서 일치한다
result: blocked
blocked_by: third-party
reason: "Local and deployed config expose Toss test-key material, and mocked Phase 24 recovery browser tests pass, but an actual Toss sandbox redirect/webhook round trip requires a live sandbox merchant session and public webhook/redirect configuration not derivable from the repo alone."
evidence:
  - command: local .env key presence check
    result: PASS, NEXT_PUBLIC_TOSS_CLIENT_KEY and TOSS_SECRET_KEY are test-key-present
  - command: gcloud run services describe grabit-api --region=asia-northeast3
    result: PASS, deployed API env names include TOSS_SECRET_KEY
  - command: pnpm --filter @grabit/web exec playwright test e2e/toss-payment-phase24.spec.ts --project=chromium --reporter=line
    result: PASS, 3 mocked pending/failed/expired recovery tests passed
  - limitation: "Domestic/overseas/Alipay+/truemoney real Toss redirects and webhooks were not executed because they require external Toss sandbox merchant flow state."

### 4. 모바일/데스크톱 멀티층 좌석 선택 UX 최종 확인
expected: 층 전환 시 선택/타이머/복구 흐름이 실제 브라우저에서 안정 동작한다
result: issue
reported: "Browser automation rendered the multi-floor booking page on desktop/mobile, but clicking the visible center of seat A-1 did not select the seat because the SVG seat-number <text> element intercepted pointer events. The summary stayed empty, timer stayed --:--, and the next CTA stayed disabled."
severity: major
evidence:
  - command: pnpm --filter @grabit/web test
    result: PASS, 55 files / 348 tests
  - command: pnpm --filter @grabit/api test
    result: PASS, 54 files / 599 tests
  - command: Playwright Browser route-stubbed desktop/mobile UAT at http://localhost:3000/booking/floor-browser
    result: FAIL, seat map rendered but center seat click left summary empty and CTA disabled
  - screenshot: /tmp/grapit-phase24-seat-desktop.png
  - screenshot: /tmp/grapit-phase24-seat-mobile.png
  - diagnostic: "Playwright click reported the seat-number <text> subtree intercepting pointer events over [data-seat-id='A-1']."
  - control_check: "After scrolling and clicking the rect edge on desktop, the summary showed VIP A열 1번 and the timer changed to 07:56, proving the state path works when the rect receives the click."

## Summary

total: 4
passed: 1
issues: 1
pending: 0
skipped: 0
blocked: 2

## Gaps

- truth: "Cloud Scheduler scale-up and step-down jobs successfully call the deployed prewarm API with OIDC and control-token protection."
  status: resolved
  reason: "2026-05-10 live redeploy, shared audience reconciliation, and runtime service-account IAM completion closed the missing-route/missing-env/live-call gap."
  severity: blocker
  test: 2
  root_cause: "The original local contract had to be made durable in deploy CI, then the live service still needed the Cloud Run v2 `template.scaling.minInstanceCount` PATCH shape plus a self `roles/iam.serviceAccountUser` binding on the runtime service account before Scheduler-triggered UpdateService calls could succeed."
  artifacts:
    - path: "docs/runbooks/phase24-queue-waf-prewarm.md"
      issue: "Now documents the shared audience, maxScale 100, runtime IAM fallback, and manual rerun conflict note used for the live fix."
    - path: "apps/api/src/modules/ops/prewarm.controller.ts"
      issue: "Route contract stayed unchanged while the live rollout was repaired around it."
    - path: "apps/api/src/app.module.ts"
      issue: "Module wiring stayed intact; the successful live fix came from deploy/runtime/IAM alignment rather than route redesign."
    - path: "apps/api/src/modules/ops/prewarm.service.ts"
      issue: "Cloud Run Admin API PATCH now uses `template.scaling.minInstanceCount`, matching the successful live audit requests."
  resolved_with:
    - "Deployed API revision `grabit-api-00034-x9x` from image `24-21-prewarm-amd64-20260510212420-30703eb`."
    - "Exact live audience URL: `https://grabit-api-d3c6wrfdbq-du.a.run.app/api/v1/internal/prewarm/services/grabit-api`."
    - "Runtime service account: `grapit-cloudrun@grapit-491806.iam.gserviceaccount.com` with `roles/run.admin` and self `roles/iam.serviceAccountUser`."
    - "Scheduler caller: `scheduler-prewarm@grapit-491806.iam.gserviceaccount.com` using jobs `grabit-prewarm-scale-up` and `grabit-prewarm-step-down`."
  debug_session: "inline automated UAT 2026-05-10"

- truth: "Mobile and desktop users can reliably select seats across floors by clicking/tapping visible seats, with timer, selection summary, and CTA updating."
  status: failed
  reason: "Browser automation showed that clicking the visible center of seat A-1 did not select the seat because SVG seat-number text intercepted pointer events."
  severity: major
  test: 4
  root_cause: "SeatMapViewer delegates clicks from elements that have a [data-seat-id] ancestor, but uploaded/rendered SVG seat-number <text> elements can sit above the seat rect without pointer-events:none or data-seat-id ancestry. Center clicks target the text node, so handleClick does not resolve a seat id."
  artifacts:
    - path: "apps/web/components/booking/seat-map-viewer.tsx"
      issue: "Click handler only searches closest('[data-seat-id]'); it does not neutralize or map seat-number text overlays."
    - path: "apps/web/public/seed/sample-seat-map.svg"
      issue: "Contains seat-number text overlay that can intercept pointer events over the clickable rect."
    - path: "/tmp/grapit-phase24-seat-desktop.png"
      issue: "Screenshot evidence after failed desktop center-click flow."
    - path: "/tmp/grapit-phase24-seat-mobile.png"
      issue: "Screenshot evidence after failed mobile center-tap flow."
  missing:
    - "Normalize processed SVG so non-seat overlays inside the seat map do not intercept pointer events, or propagate data-seat-id to the visible seat-label group."
    - "Add a browser-level regression that clicks the visible center of a numbered seat, not only the rect edge or mocked component."
    - "Re-run desktop and mobile browser UAT for 1F/2F selection persistence after the hit-target fix."
  debug_session: "inline Playwright Browser UAT 2026-05-10"
