---
phase: 24-traffic-booking-payment-core
verified: 2026-05-11T03:57:25Z
status: passed_with_accepted_risks
score: 6/6 must-haves verified with domestic-card authentication caveat
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 5/6
  gaps_closed:
    - "Cloud Scheduler → prewarm API(OIDC+control-token) 실제 호출 검증"
    - "모바일/데스크톱 멀티층 좌석 선택 UX 수동 점검"
    - "Cloudflare zone activation and WAF edge smoke"
    - "Correct-store Toss sandbox transfer redirect/confirm/webhook round-trip"
    - "Full Toss payment-method matrix: overseas card, Alipay+, truemoney, and domestic card branch/webhook ledger"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Cloudflare WAF/rate-limit/challenge/block rules 실제 Zone 반영 확인"
    expected: "queue-entry/lock-seat/prepare-reservation/confirm-payment 규칙이 활성화되고 동작한다"
    why_human: "Resolved on 2026-05-11. WHOISDomain nameserver cutover completed, public resolvers return Cloudflare NS only, and Cloudflare edge smoke returned managed-challenge responses for suspicious traffic."
  - test: "Toss sandbox 실결제 경로(국내카드/해외카드/Alipay+/truemoney) 실제 redirect/webhook 왕복 확인"
    expected: "sync/pending/recovery 분기와 안내 문구가 실제 PG round-trip 결과와 일치한다"
    why_human: "Correct-store Toss webhook registration, account-transfer redirect/confirm/webhook, overseas-card browser redirect/complete, Alipay+/truemoney pending-webhook-complete flows, and domestic CARD/CARD/KRW branch plus Toss READY/webhook ledger are verified. Fully authenticated domestic buyer-card entry remains an accepted operational caveat because card secrets should not be automated or documented."
---

# Phase 24: Traffic + Booking + Payment Core Verification Report

**Phase Goal:** 광고/티켓팅 트래픽 흡수부터 좌석 선택, 결제, 환불, QR 발급까지 사용자의 core booking path를 test-key 기준으로 완성한다.  
**Verified:** 2026-05-11T03:57:25Z
**Status:** passed_with_accepted_risks
**Re-verification:** Yes — gap closure(24-21/24-22 포함) 이후 재검증

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Queue admission uses Valkey Sorted Set and batch admission; booking APIs require valid admission | ✓ VERIFIED | `zrange/zrem/sadd` 기반 batch admission과 snapshot 계산이 구현됨 (`apps/api/src/modules/queue/queue.service.ts`), booking/reservation mutation에 `AdmissionGuard`가 강제됨 (`apps/api/src/modules/booking/booking.controller.ts`, `apps/api/src/modules/reservation/reservation.controller.ts`). |
| 2 | WAF/rate-limit/bot/macro rules and Cloud Scheduler prewarm runbook are documented and verified | ✓ VERIFIED | app-layer traffic policy/decision + prewarm OIDC/control-token 검증 + runbook은 확인됨 (`apps/api/src/modules/traffic/traffic-defense.service.ts`, `apps/api/src/modules/ops/prewarm.service.ts`, `docs/runbooks/phase24-queue-waf-prewarm.md`). Cloud Scheduler prewarm live 호출은 HUMAN-UAT test 2에서 PASS. Cloudflare Free zone `heygrabit.com` is active after WHOISDomain NS cutover, public resolvers return only `rick.ns.cloudflare.com`/`wanda.ns.cloudflare.com`, and WAF smoke returned Cloudflare managed challenge for suspicious traffic. |
| 3 | Multi-floor SVG upload/render/switching works on desktop/mobile with lock/countdown/expiry/recovery behavior | ✓ VERIFIED | floor-aware seat identity/selector/summary wiring (`apps/web/components/booking/booking-page.tsx`, `apps/web/components/booking/floor-selector.tsx`) + overlay hit-target 보정(`apps/web/components/booking/seat-map-viewer.tsx`) + browser 회귀 테스트 PASS(`apps/web/e2e/booking-floor-selection.spec.ts`). |
| 4 | Event-specific max tickets, cancellation/change policy, and manual seat operation controls are configurable | ✓ VERIFIED | `booking_policies` + migration 확장(`apps/api/src/database/schema/booking-policies.ts`, `apps/api/src/database/migrations/0012_phase24_booking_core.sql`) 및 `maxTicketsPerUser` 서버 enforcement(`apps/api/src/modules/booking/booking.service.ts`), manual-open audit/처리(`apps/api/src/modules/admin/admin-booking.service.ts`). |
| 5 | Domestic Toss, overseas card, Alipay+, and truemoney paths work with proper disclaimers | ✓ VERIFIED (ACCEPTED CAVEAT) | provider 분기/consent/schema/webhook idempotency 구현, deployed webhook-secret readiness, local real-SDK iframe mount + confirm intercept E2E PASS. Correct-store Toss webhook registration and real sandbox 계좌이체 redirect/confirm/webhook are verified. Method-matrix evidence now covers overseas-card browser redirect/complete (`GRP-P24-OVCARD-1778470438904`), Alipay+ pending/webhook/complete with Toss `ALIPAY` normalized to internal `ALIPAY_PLUS` (`GRP-P24-ALIPAY-1778470584784`), truemoney pending/webhook/complete (`GRP-P24-TRUEMONEY-MP0O1DRB`), and domestic CARD/CARD/KRW branch plus Toss READY/webhook ledger surrogate (`GRP-P24-DOMCARD-MP0O7TRI`). Fully authenticated domestic buyer-card entry remains an accepted caveat because card secrets should not be automated or recorded. |
| 6 | Refund preview/request/state machine, random cancelled-seat holding, QR JWT/HMAC issuance, and D-1 QR email scheduling work | ✓ VERIFIED | refund 상태머신/재시도/hold+release worker(`apps/api/src/modules/refund/refund.service.ts`, `apps/api/src/modules/jobs/refund-cancel-retry.worker.ts`, `apps/api/src/modules/jobs/cancelled-seat-release.worker.ts`) + QR JWT/HMAC 발급/검증 및 D-1 email scheduling(`apps/api/src/modules/ticket/qr-ticket.service.ts`). |

**Score:** 6/6 truths verified with accepted domestic-card authentication caveat

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `apps/api/src/modules/queue/queue.service.ts` | queue admission + metrics | ✓ VERIFIED | Sorted Set queue + `position/etaSeconds/remainingSeats` snapshot 생성 |
| `apps/api/src/modules/queue/guards/admission.guard.ts` | booking mutation guard | ✓ VERIFIED | refresh/admission cookie bound 검증 및 request context 주입 |
| `apps/api/src/modules/traffic/traffic-defense.service.ts` | route-specific rate/macro policy | ✓ VERIFIED | `queue-entry/lock-seat/prepare-reservation/confirm-payment/signup/sms` policy + challenge/block decision |
| `apps/api/src/modules/ops/prewarm.service.ts` | protected prewarm control path | ✓ VERIFIED | OIDC claims + control-token + service allowlist + minInstance cap + Cloud Run API patch |
| `apps/web/components/booking/seat-map-viewer.tsx` | multi-floor seat click reliability | ✓ VERIFIED | seat-number overlay `pointer-events:none` normalization + seat-id delegation |
| `apps/api/src/modules/payment/payment-webhook.controller.ts` | async payment webhook idempotency | ✓ VERIFIED | event ledger + stale-event ignore + status update 분기 |
| `apps/api/src/modules/refund/refund.service.ts` | refund state machine + delayed reopen | ✓ VERIFIED | requested→sent_to_pg→processing/completed/failed + hold window + pg-boss enqueue |
| `apps/api/src/modules/ticket/qr-ticket.service.ts` | QR issue/verify + D-1 schedule | ✓ VERIFIED | JWT/HMAC verification + `qr-ticket-email-resend` scheduling |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| `booking.controller.ts` | `AdmissionGuard` | `@UseGuards(AdmissionGuard)` | ✓ WIRED | lock/unlock/status endpoints 보호 |
| `reservation.controller.ts` | `AdmissionGuard` | `@UseGuards(AdmissionGuard)` | ✓ WIRED | prepare/confirm/cancel path admission 요구 |
| `PaymentWebhookController` | `PaymentService.recordWebhookEvent/upsertAsyncPaymentProgress` | webhook 처리 | ✓ WIRED | idempotency ledger + state update 연결 |
| `RefundService` | `PG_BOSS release/retry workers` | delayed jobs | ✓ WIRED | `refundCancelRetry`, `releaseCancelledSeat` enqueue 및 worker 처리 |
| `QrTicketService` | `PG_BOSS qr-ticket-email-resend` | D-1 scheduling | ✓ WIRED | `ensureReminderSchedule`와 worker registration 연결 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| --- | --- | --- | --- | --- |
| `queue.service.ts` | `position/etaSeconds/remainingSeats` | Valkey sorted set + active/waiting 계산 | Yes | ✓ FLOWING |
| `booking-page.tsx` | floor별 selected seats/summary | performance seatMaps + lock API 응답 | Yes | ✓ FLOWING |
| `payment-webhook.controller.ts` | payment progress | webhook payload + DB payments/reservations/events | Yes | ✓ FLOWING |
| `refund.service.ts` | `refundTimeline`, seat hold metadata | refunds/payments/reservations + pg-boss | Yes | ✓ FLOWING |
| `qr-ticket.service.ts` | `qrTokenJti`, email schedule | tickets/reservations/payments/showtimes + pg-boss | Yes | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Prewarm guard/service behavior | `pnpm --filter @grabit/api exec vitest run src/modules/ops/prewarm.service.spec.ts` | 8 tests passed | ✓ PASS |
| Multi-floor browser regression | `pnpm --filter @grabit/web exec playwright test e2e/booking-floor-selection.spec.ts --project=chromium --reporter=line` | 2 tests passed | ✓ PASS |
| Queue metric locator regression | `pnpm --filter @grabit/web exec playwright test e2e/booking-queue.spec.ts --project=chromium --reporter=line` | 4 tests passed | ✓ PASS |
| Toss recovery browser regression | `pnpm --filter @grabit/web exec playwright test e2e/toss-payment-phase24.spec.ts --project=chromium --reporter=line` | 3 tests passed | ✓ PASS |
| Toss full SDK browser regression | `TOSS_CLIENT_KEY_TEST=$NEXT_PUBLIC_TOSS_CLIENT_KEY E2E_API_URL=http://localhost:8080 pnpm --filter @grabit/web exec playwright test e2e/toss-payment.spec.ts --project=chromium --reporter=line` | 7 tests passed after serializing the seeded-admin auth flow | ✓ PASS |
| Toss webhook guard/service regression | `pnpm --filter @grabit/api exec vitest run src/modules/payment/toss-webhook.guard.spec.ts src/modules/payment/toss-webhook.controller.spec.ts src/modules/payment/payment.service.spec.ts` | 3 files / 25 tests passed | ✓ PASS |
| Queue Cluster stale-session purge regression | `pnpm --filter @grabit/api exec vitest run src/modules/queue/queue.service.spec.ts src/modules/payment/toss-webhook.guard.spec.ts src/modules/payment/toss-webhook.controller.spec.ts src/modules/payment/payment.service.spec.ts` | 4 files / 29 tests passed | ✓ PASS |
| API typecheck | `pnpm --filter @grabit/api typecheck` | no TypeScript errors | ✓ PASS |
| Web production build | `pnpm --filter @grabit/web build` | Next.js build passed | ✓ PASS |
| Deployed Toss webhook receiver readiness | `curl` before/after `gcloud run services update --update-secrets=TOSS_WEBHOOK_SECRET=toss-webhook-secret:latest` | before: 401 missing configured secret; after: 400 with configured secret on malformed JSON and 401 without secret; revision `grabit-api-00037-f8t` | ✓ PASS |
| Real Toss sandbox transfer + webhook | Browser Toss transfer flow + Grabit confirm + Cloud Run/DB/Toss dashboard checks | order `GRP-P24-1778467773443`; confirm `CONFIRMED`; QR `ACTIVE`; Cloud Run webhook 201; DB result `PAYMENT_STATUS_CHANGED_DONE_APPLIED`; Toss dashboard row `성공 PAYMENT_STATUS_CHANGED 2026-05-11 11:51:02` | ✓ PASS |
| Toss method matrix evidence | Browser/Toss sandbox/API/webhook/DB checks | Overseas card `GRP-P24-OVCARD-1778470438904` completed through browser; Alipay+ `GRP-P24-ALIPAY-1778470584784` and truemoney `GRP-P24-TRUEMONEY-MP0O1DRB` completed through pending URL plus webhook; domestic card branch `GRP-P24-DOMCARD-MP0O7TRI` verified through Toss READY plus webhook-ledger surrogate | ✓ PASS (CAVEAT) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| `TRAF-01` | 24-01/04/08/20 | queue admission + booking guard + queue UX | ✓ SATISFIED | queue service + AdmissionGuard + booking-queue e2e |
| `TRAF-02` | 24-05/08/20 | WAF/rate-limit/challenge/block | ✓ SATISFIED | Cloudflare Free zone and dashboard rules are configured and active: queue-entry managed challenge, booking mutation managed challenge, booking macro block, and critical booking API rate limit. Public DNS delegates to Cloudflare, and WAF smoke returned managed challenge. |
| `TRAF-03` | 24-05/21 | Cloud Scheduler prewarm scale-up/step-down | ✓ SATISFIED | prewarm service/runbook + HUMAN-UAT test 2 live run PASS |
| `BOOK-01` | 24-02/06/07/15/16/19/22 | multi-floor seat selection/lock | ✓ SATISFIED | floor-aware seatKey + seat-map hit-target fix + floor browser e2e |
| `BOOK-02` | 24-01/03/09/10/17/22 | countdown/expiry/recovery | ✓ SATISFIED | confirm/complete recovery UI + e2e + lock failure 분기 |
| `BOOK-03` | 24-01/02/06/07/12/15/16/19 | policy/manual controls | ✓ SATISFIED | booking policy schema + maxTickets enforcement + manual open audit |
| `PAY-02` | 24-01/03/09/10/17/18 | Toss domestic/overseas 분기 | ✓ SATISFIED (ACCEPTED CAVEAT) | provider/disclaimer/webhook 로직 + local real-SDK and mocked e2e PASS + deployed webhook receiver secret readiness + correct-store real 계좌이체 redirect/confirm/webhook PASS + method-matrix evidence for overseas card, Alipay+, truemoney, and domestic card branch/webhook ledger. Full buyer-entered domestic card authentication remains an accepted operational caveat. |
| `REFUND-01` | 24-01/02/03/11/14/18 | refund request/timeline/state | ✓ SATISFIED | refund service state machine + timeline UI |
| `REFUND-02` | 24-01/02/03/11/12/18 | delayed reopen + manual-open exception | ✓ SATISFIED | held_cancelled + release worker + manual open override |
| `QR-01` | 24-01/02/03/13/18 | QR issue/verify/D-1 scheduling | ✓ SATISFIED | QR JWT/HMAC + reminder schedule worker |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| `apps/api/src/modules/payment/toss-payments.client.ts` | 69 | `TODO: zod schema runtime validation` | ⚠️ Warning | 런타임 payload 강건성 개선 여지 (현 시점 blocker 아님) |

### Accepted Operational Caveat

### 1. Domestic Buyer-Card Authentication

**Test:** 국내카드 full buyer-auth checkout
**Expected:** buyer-card authentication redirects back with `paymentKey/orderId/amount`, then Grabit confirms the payment.
**Accepted caveat:** The Grabit branch, Toss READY response, webhook receiver, DB ledger, reservation confirmation, QR activation, and complete UI were verified without recording sensitive card details. A fully buyer-entered domestic card checkout should be repeated manually by an authorized operator before live payment traffic, but it is not a remaining code or Phase 24 method-matrix blocker.

### Gaps Summary

코드 내부 구현/테스트 기준의 BLOCKER gap은 확인되지 않았다. Success criteria #2는 Cloudflare activation과 WAF smoke까지 완료됐다. Success criteria #5는 correct-store Toss webhook registration, account-transfer redirect/confirm/webhook, overseas-card browser complete, Alipay+/truemoney async webhook complete, and domestic card branch/webhook ledger까지 완료됐다. Toss query-secret fallback rotation/removal and official Toss Query API verification remain production-hardening follow-ups, not Phase 24 blocker gaps.

---

_Verified: 2026-05-11T03:57:25Z_
_Verifier: the agent (gsd-verifier)_
