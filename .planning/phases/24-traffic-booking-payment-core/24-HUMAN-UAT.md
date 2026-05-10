---
status: partial
phase: 24-traffic-booking-payment-core
source: [24-VERIFICATION.md]
started: 2026-05-08T10:32:42Z
updated: 2026-05-10T19:24:30+09:00
---

# Phase 24: Human UAT

## Current Test

[testing complete - 2 issues, 2 blocked external/operational gates]

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
result: issue
reported: "GCP project grapit-491806 is authenticated, but Cloud Scheduler API is disabled, no scheduler jobs can be listed, deployed API prewarm endpoints return 404, and deployed Cloud Run env does not expose PREWARM_* configuration names."
severity: blocker
evidence:
  - command: gcloud auth list && gcloud config list
    result: PASS, active account sangwopark19icons@gmail.com, project grapit-491806
  - command: gcloud scheduler jobs list --location=asia-northeast3
    result: FAIL, cloudscheduler.googleapis.com SERVICE_DISABLED
  - command: gcloud services list --enabled --filter='name:(cloudscheduler.googleapis.com OR run.googleapis.com)'
    result: PASS, run.googleapis.com enabled; cloudscheduler.googleapis.com absent
  - command: curl -X POST https://grabit-api-d3c6wrfdbq-du.a.run.app/api/v1/internal/prewarm/services/grabit-api
    result: FAIL, 404 Cannot POST /api/v1/internal/prewarm/services/grabit-api
  - command: curl -X POST https://grabit-api-d3c6wrfdbq-du.a.run.app/api/v1/internal/prewarm/services/grabit-api/step-down
    result: FAIL, 404 Cannot POST /api/v1/internal/prewarm/services/grabit-api/step-down
  - command: gcloud run services describe grabit-api --region=asia-northeast3
    result: PASS, deployed revision grabit-api-00029-tsx; env names include TOSS/GOOGLE keys but no PREWARM_* names

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
passed: 0
issues: 2
pending: 0
skipped: 0
blocked: 2

## Gaps

- truth: "Cloud Scheduler scale-up and step-down jobs successfully call the deployed prewarm API with OIDC and control-token protection."
  status: failed
  reason: "GCP project grapit-491806 has Cloud Scheduler API disabled, deployed prewarm routes return 404, and deployed API env names do not include PREWARM_* settings."
  severity: blocker
  test: 2
  root_cause: "Prewarm code exists locally and unit tests pass, but the deployed Cloud Run revision and GCP project are not operationally configured for Phase 24 prewarm: Scheduler API is disabled, jobs are absent/unlistable, deployed routes are unavailable, and PREWARM_* environment configuration is absent."
  artifacts:
    - path: "docs/runbooks/phase24-queue-waf-prewarm.md"
      issue: "Documents required Scheduler jobs and prewarm endpoint contract, but external project state does not satisfy it."
    - path: "apps/api/src/modules/ops/prewarm.controller.ts"
      issue: "Local route contract exists for /internal/prewarm/services/:serviceName and /step-down."
    - path: "apps/api/src/app.module.ts"
      issue: "Local AppModule imports PrewarmModule, while deployed API returned 404 for the expected routes."
  missing:
    - "Enable cloudscheduler.googleapis.com for grapit-491806."
    - "Deploy an API revision that exposes the prewarm routes."
    - "Set PREWARM_CONTROL_TOKEN, PREWARM_PROJECT_ID, PREWARM_REGION, PREWARM_ALLOWED_SCHEDULER_EMAIL, and PREWARM_ALLOWED_AUDIENCE on the deployed API service."
    - "Create and run the scale-up and step-down Cloud Scheduler jobs with OIDC and x-prewarm-control-token."
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
