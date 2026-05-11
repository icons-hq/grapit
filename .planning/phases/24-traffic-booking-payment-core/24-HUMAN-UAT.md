---
status: passed
phase: 24-traffic-booking-payment-core
source: [24-VERIFICATION.md]
started: 2026-05-08T10:32:42Z
updated: 2026-05-11T12:57:25+09:00
---

# Phase 24: Human UAT

## Current Test

[external activation update - 4 passed, 0 issues, 0 remaining Phase 24 blocker gaps]

## Tests

### 1. Cloudflare WAF/rate-limit/challenge/block rules 실제 Zone 반영 확인
expected: runbook의 queue-entry/lock-seat/prepare-reservation/confirm-payment 규칙이 활성화되고 동작한다
result: passed
resolved_at: 2026-05-11T11:10:00+09:00
reason: "WHOISDomain nameserver cutover completed, public resolvers returned only the Cloudflare NS pair, the Cloudflare zone became active, and edge smoke proved both normal availability and managed-challenge behavior."
evidence:
  - command: pnpm exec wrangler whoami
    result: PASS, authenticated account visible with zone:read scope
  - command: Cloudflare API POST /client/v4/zones using Wrangler OAuth token
    result: FAIL, 403 missing `com.cloudflare.api.account.zone.create`; dashboard flow used instead
  - command: Computer Use Chrome Cloudflare Dashboard, Domains > Add domain > Connect domain
    result: PASS, added `heygrabit.com` on Free plan, imported apex/www/api A records, SES MX/SPF, DMARC, Google verification, and Resend DKIM TXT records
  - command: Cloudflare API GET /client/v4/zones?name=heygrabit.com using Wrangler OAuth token
    result: PASS, zone id `c7e9867fe90523f398e5c51ad911107e`, status `pending`, plan `Free Website`, name servers `rick.ns.cloudflare.com` and `wanda.ns.cloudflare.com`
  - command: pnpm exec wrangler zones list
    result: FAIL, Wrangler v4 has no zones list command
  - command: Computer Use Chrome Cloudflare Dashboard, Security > Security Rules > Custom Rules
    result: PASS, active custom rules `phase24-queue-entry-managed-challenge`, `phase24-booking-mutation-managed-challenge`, and `phase24-booking-macro-block` show `3/5 used`; Cloudflare UI no longer supports `cf.threat_score`, so suspicious user-agent predicates were used
  - command: Computer Use Chrome Cloudflare Dashboard, Security > Security Rules > Rate Limiting Rules
    result: PASS, active rule `phase24-critical-booking-api-rate-limit` shows `1/1 used`; expression covers POST booking lock/reservation prepare/payment confirm paths, per-IP threshold 30 requests / 10 seconds, action Block, mitigation 10 seconds
  - command: Computer Use Chrome WHOISDomain, My domains > `heygrabit.com` > nameserver change
    result: BLOCKED, registrar confirmation page now contains desired Cloudflare NS values `rick.ns.cloudflare.com` and `wanda.ns.cloudflare.com`, but final submit requires registrant email/phone verification code; the agent stopped at this 2-step identity gate
  - command: dig NS heygrabit.com +short
    result: PASS after registrar cutover, default resolver plus `@1.1.1.1` and `@8.8.8.8` returned only `rick.ns.cloudflare.com.` and `wanda.ns.cloudflare.com.`
  - command: dig DS heygrabit.com +short
    result: PASS, no stale registrar DS record
  - command: curl -I https://heygrabit.com && curl -I https://api.heygrabit.com/api/v1/health
    result: PASS, both resolved through Cloudflare; API health returned 200
  - command: deliberate suspicious user-agent smoke against protected paths
    result: PASS, Cloudflare returned 403 with `cf-mitigated: challenge` while normal traffic remained available

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
result: passed
resolved_at: 2026-05-11T12:57:25+09:00
reason: "The correct Toss developer-center store was selected, webhook registration succeeded, current-store test secret was synced to Secret Manager, real sandbox account-transfer and overseas-card redirect paths completed, Alipay+/truemoney async webhook paths completed, and domestic card branch/Toss READY/webhook ledger were verified without recording card secrets. The only caveat is that a fully authenticated domestic buyer-card checkout still requires a real test card entry that should not be automated or documented with sensitive details."
evidence:
  - command: local .env key presence check
    result: PASS, NEXT_PUBLIC_TOSS_CLIENT_KEY and TOSS_SECRET_KEY are test-key-present
  - command: gcloud run services describe grabit-api --region=asia-northeast3
    result: PASS, deployed API env names include TOSS_SECRET_KEY and TOSS_WEBHOOK_SECRET secret reference
  - command: gcloud secrets create toss-webhook-secret && gcloud run services update grabit-api --update-secrets=TOSS_WEBHOOK_SECRET=toss-webhook-secret:latest
    result: PASS, deployed revision `grabit-api-00037-f8t` serves 100% traffic with `TOSS_WEBHOOK_SECRET` sourced from Secret Manager
  - command: curl deployed `/api/v1/payments/toss/webhook` before/after secret injection
    result: PASS, before injection returned 401; after injection returned 400 for malformed JSON with the configured secret header and 401 without the secret, proving the deployed guard now reaches body validation only for authenticated webhook attempts
  - command: pnpm --filter @grabit/api exec vitest run src/modules/payment/toss-webhook.guard.spec.ts src/modules/payment/toss-webhook.controller.spec.ts src/modules/payment/payment.service.spec.ts
    result: PASS, 3 files / 21 tests passed
  - command: pnpm --filter @grabit/web exec playwright test e2e/toss-payment-phase24.spec.ts --project=chromium --reporter=line
    result: PASS, 3 mocked pending/failed/expired recovery tests passed
  - command: TOSS_CLIENT_KEY_TEST=$NEXT_PUBLIC_TOSS_CLIENT_KEY E2E_API_URL=http://localhost:8080 pnpm --filter @grabit/web exec playwright test e2e/toss-payment.spec.ts --project=chromium --reporter=line
    result: PASS after E2E stabilization, 7 tests passed with local API/DB; happy path mounted the real Toss SDK iframe and intercepted the server confirm call after simulated successUrl navigation
  - command: Browser navigate https://developers.tosspayments.com/webhook
    result: BLOCKED, developer center returned `올바른 상점이 아닙니다`; webhook registration requires the correct Toss merchant/store context
  - command: Chrome Toss Developer Center, `개발 연동 체험 상점` > Webhooks
    result: PASS, webhook `grabit-phase24-payment-status` registered for `PAYMENT_STATUS_CHANGED` and `CANCEL_STATUS_CHANGED` using the API custom domain endpoint with query-secret fallback; full secret intentionally omitted
  - command: Secret Manager + Cloud Run sync
    result: PASS, `toss-secret-key` latest version updated from the current store secret, active API revision `grabit-api-p24wheact2` serves 100% traffic without `BOOKING_ENABLED`, and temporary `phase24-smoke` tag was removed after smoke
  - command: Real Toss sandbox transfer redirect/confirm
    result: PASS, order `GRP-P24-1778467773443`, seat `1F:가-4`, amount `380000`, payment key prefix `tviva2026051...`; Grabit confirm returned reservation `CONFIRMED`, QR `ACTIVE`, paidAt `2026-05-11T02:51:01.000Z`
  - command: Toss dashboard webhook history
    result: PASS, latest row showed `성공 PAYMENT_STATUS_CHANGED 2026-05-11 11:51:02`
  - command: Cloud Run logging read for `/api/v1/payments/toss/webhook`
    result: PASS, `2026-05-11T02:51:02.000662Z` returned HTTP 201 on revision `grabit-api-p24wheact2`
  - command: production DB `payment_webhook_events`
    result: PASS, event `whtrans_*` for order `GRP-P24-1778467773443` processed with `PAYMENT_STATUS_CHANGED_DONE_APPLIED` at `2026-05-11T02:51:02.093Z`; payload method was `계좌이체`
  - command: Redis Cluster production queue smoke
    result: PASS after fix, stale session purge no longer sends a multi-key `DEL` across `{queue:<performance>}`, `{queue:session-ref}`, and `{queue:admission}` hash tags; queue entry returned `ADMITTED` after deploying API image `asia-northeast3-docker.pkg.dev/grapit-491806/grabit/grabit-api:phase24-gapfix-amd64-20260511123047`
  - command: Browser + Toss sandbox overseas-card checkout
    result: PASS, order `GRP-P24-OVCARD-1778470438904` selected seat `1F:가-23`, showed international card-only Toss options, redirected to Grabit complete, and produced booking number `GRP-20260511-YPUXM`
  - command: Toss direct payment + production webhook for Alipay+
    result: PASS, order `GRP-P24-ALIPAY-1778470584784` used `FOREIGN_EASY_PAY` with Toss provider `ALIPAY`, Grabit normalized provider to `ALIPAY_PLUS`, pending UI rendered before webhook, webhook returned 201, and complete page produced booking number `GRP-20260511-L2F73`
  - command: Toss direct payment + production webhook for truemoney
    result: PASS, order `GRP-P24-TRUEMONEY-MP0O1DRB` used `FOREIGN_EASY_PAY` provider `TRUEMONEY`, pending UI rendered before webhook, webhook returned 201, and complete page produced booking number `GRP-20260511-2K7AH`
  - command: Toss direct payment + production webhook surrogate for domestic card branch
    result: PASS with caveat, order `GRP-P24-DOMCARD-MP0O7TRI` verified Grabit domestic `CARD/CARD/KRW` branch and Toss READY response; final state was advanced by authenticated production webhook to reservation `CONFIRMED`, booking number `GRP-20260511-7GDV4`, because full buyer-card authentication should not be automated with card secrets
  - command: production DB reservation/payment/ticket ledger
    result: PASS, all four method-matrix orders reached reservation `CONFIRMED`, payment `DONE`, QR `active`, and `payment_webhook_events.result=PAYMENT_STATUS_CHANGED_DONE_APPLIED`
  - command: Cloud Run logging read for method-matrix webhook posts
    result: PASS, production webhook POSTs returned HTTP 201 at `2026-05-11T03:52:24.643702Z`, `2026-05-11T03:52:24.876446Z`, and `2026-05-11T03:57:25.727036Z`
  - command: pnpm --filter @grabit/api exec vitest run src/modules/queue/queue.service.spec.ts src/modules/payment/toss-webhook.guard.spec.ts src/modules/payment/toss-webhook.controller.spec.ts src/modules/payment/payment.service.spec.ts
    result: PASS, 4 files / 29 tests passed
  - command: pnpm --filter @grabit/api typecheck && pnpm --filter @grabit/web exec playwright test e2e/toss-payment-phase24.spec.ts --project=chromium --reporter=line && pnpm --filter @grabit/web build
    result: PASS, API typecheck, web Toss recovery browser regression, and web production build all passed

### 4. 모바일/데스크톱 멀티층 좌석 선택 UX 최종 확인
expected: 층 전환 시 선택/타이머/복구 흐름이 실제 브라우저에서 안정 동작한다
result: passed
resolved_at: 2026-05-10T21:57:56+09:00
notes:
  - "SeatMapViewer now normalizes vendor seat-number overlays in the processed SVG layer with `pointer-events=\"none\"` plus seat overlay metadata, so visible seat labels no longer absorb the interaction before the booking click handler resolves `A-1`."
  - "The new `booking-floor-selection.spec.ts` route-stubs `/booking/floor-browser` and clicks the visible seat-label center rather than a rect edge or `[data-seat-id]` shortcut. Desktop verifies the grouped summary (`1층` / `VIP` / `A열 1번`), active timer (`남은시간 07:xx`), enabled next CTA, and 1F → 2F → 1F persistence. Mobile-sized Chromium verifies the same centered interaction updates floor selection state (`1층` badge `1`)."
evidence:
  - command: pnpm --filter @grabit/web test -- components/booking/__tests__/seat-map-viewer.test.tsx
    result: PASS, 55 files / 349 tests including `components/booking/__tests__/seat-map-viewer.test.tsx` (22 tests green) with the centered text-overlay regression
  - command: pnpm --filter @grabit/web exec playwright test e2e/booking-floor-selection.spec.ts --project=chromium --reporter=line
    result: PASS, 2 tests green; desktop center click produced `1층` summary + `A열 1번` + active timer + enabled `다음`, and mobile-sized centered interaction updated the `1층` selected-count badge to `1`
  - assertion: "Desktop `floor-browser` flow now leaves the booking header on `남은시간 07:xx`, the right summary shows `1층` and `A열 1번`, and `다음` is enabled immediately after the visible seat-label center click."
  - assertion: "Switching floors after the hit-target fix kept the `1층` selection intact when moving 1F → 2F → 1F."
  - assertion: "Mobile-sized Chromium still exercises the visible seat-label center and confirms the selection state by turning the `1층` floor badge to `1` without relying on a rect-edge workaround."

## Summary

total: 4
passed: 4
issues: 0
pending: 0
skipped: 0
blocked: 0
partial: 0

## Gaps

- truth: "Cloudflare zone security rules are configured and public traffic is delegated through Cloudflare."
  status: resolved
  reason: "WHOISDomain nameserver cutover completed, public resolvers now return only `rick.ns.cloudflare.com` and `wanda.ns.cloudflare.com`, no stale DS record exists, and Cloudflare edge smoke produced managed-challenge responses for suspicious traffic."
  severity: operational
  test: 1
  root_cause: "The available Wrangler OAuth token could read zones but could not create the zone or read Rulesets API entrypoints, so the zone/rules were configured through the authenticated Chrome Dashboard. Registrar final nameserver submission requires registrant contact verification; the agent reached the 2-step verification gate and did not request or enter the code."
  artifacts:
    - path: ".planning/phases/24-traffic-booking-payment-core/24-HUMAN-UAT.md"
      issue: "Documents the configured Cloudflare zone, active custom/rate-limit rules, completed registrar NS cutover, and edge smoke."
    - path: ".planning/phases/24-traffic-booking-payment-core/24-VERIFICATION.md"
      issue: "Records Cloudflare activation as resolved after DNS propagation and WAF edge smoke."
  resolved_with:
    - "Cloudflare active-zone DNS evidence and WAF smoke on 2026-05-11."

- truth: "Toss webhook endpoint is registered in the correct store and processes real sandbox payment webhooks."
  status: resolved
  reason: "Correct-store webhook registration, Secret Manager key sync, real Toss sandbox transfer redirect, overseas-card browser redirect, Alipay+/truemoney async webhook completion, domestic card branch/Toss READY/webhook-ledger surrogate, Cloud Run webhook 201s, and DB ledger processing are verified."
  severity: external
  test: 3
  root_cause: "The repo and GCP environment could prepare the receiver, but Toss developer center and Toss method availability had to be verified in the valid store context. Production queue entry also exposed a Redis Cluster multi-key `DEL` CROSSSLOT issue before method-matrix testing could proceed."
  artifacts:
    - path: "apps/api/src/modules/queue/queue.service.ts"
      issue: "Stale queue-session purge now deletes one key at a time to avoid Redis Cluster CROSSSLOT failures during production queue entry."
    - path: "apps/api/src/modules/payment/payment.service.ts"
      issue: "Toss webhook provider code `ALIPAY` is normalized to internal `ALIPAY_PLUS` before payment ledger updates."
    - path: "apps/web/e2e/toss-payment.spec.ts"
      issue: "Now runs serially to avoid shared seeded-admin refresh-token rotation flake and asserts the current recoverable unknown-confirm UI."
    - path: ".planning/phases/24-traffic-booking-payment-core/24-HUMAN-UAT.md"
      issue: "Records deployed webhook-secret readiness, local real-SDK E2E evidence, real sandbox method-matrix evidence, and the domestic buyer-card authentication caveat."
    - path: ".planning/phases/24-traffic-booking-payment-core/24-VERIFICATION.md"
      issue: "Updates Phase 24 method-matrix verification from `human_needed` to verified with a domestic buyer-card authentication caveat."
  resolved_with:
    - "API image `asia-northeast3-docker.pkg.dev/grapit-491806/grabit/grabit-api:phase24-gapfix-amd64-20260511123047` deployed to `grabit-api-p24whesmoke2`, then `BOOKING_ENABLED` was restored off and temporary traffic tag removed."
    - "Web image `asia-northeast3-docker.pkg.dev/grapit-491806/grabit/grabit-web:phase24-gapfix-web-amd64-20260511124323` deployed to refresh pending/complete page behavior."
    - "Method-matrix orders: `GRP-P24-OVCARD-1778470438904`, `GRP-P24-ALIPAY-1778470584784`, `GRP-P24-TRUEMONEY-MP0O1DRB`, and `GRP-P24-DOMCARD-MP0O7TRI`."
  security_follow_up:
    - "The temporary Toss query-secret fallback should be rotated/removed before live traffic because URL-carried secrets can appear in request logs. This is a production-hardening follow-up, not a remaining Phase 24 method-matrix blocker."

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
  status: resolved
  reason: "SeatMapViewer now neutralizes seat-number overlays before the click handler runs, and the browser regression covers centered label interactions on desktop plus a mobile-sized selection-state check."
  severity: major
  test: 4
  root_cause: "SeatMapViewer delegates clicks from elements that have a [data-seat-id] ancestor, but uploaded/rendered SVG seat-number <text> elements can sit above the seat rect without pointer-events:none or data-seat-id ancestry. Center clicks target the text node, so handleClick does not resolve a seat id."
  artifacts:
    - path: "apps/web/components/booking/seat-map-viewer.tsx"
      issue: "Processed SVG now marks seat-number overlays with seat metadata and `pointer-events:none`, while the handler still blocks sold seats and preserves the locked-seat invariant."
    - path: "apps/web/components/booking/__tests__/seat-map-viewer.test.tsx"
      issue: "Clicks the visible `A-1` label text directly and proves `onSeatClick('A-1')` fires while decorative checkmarks stay non-interactive."
    - path: "apps/web/e2e/booking-floor-selection.spec.ts"
      issue: "Route-stubbed `/booking/floor-browser` regression clicks the visible seat-label center on desktop/mobile-sized flows and re-checks 1F ↔ 2F persistence."
  resolved_with:
    - "Unit regression: `pnpm --filter @grabit/web test -- components/booking/__tests__/seat-map-viewer.test.tsx`."
    - "Browser regression: `pnpm --filter @grabit/web exec playwright test e2e/booking-floor-selection.spec.ts --project=chromium --reporter=line`."
  debug_session: "inline Playwright Browser UAT 2026-05-10"
