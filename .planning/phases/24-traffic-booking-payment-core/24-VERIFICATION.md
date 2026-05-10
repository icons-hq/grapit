---
phase: 24-traffic-booking-payment-core
verified: 2026-05-10T13:35:20Z
status: human_needed
score: 4/6 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 4/6
  gaps_closed:
    - "Cloud Scheduler → prewarm API(OIDC+control-token) 실제 호출 검증"
    - "모바일/데스크톱 멀티층 좌석 선택 UX 수동 점검"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Cloudflare WAF/rate-limit/challenge/block rules 실제 Zone 반영 확인"
    expected: "queue-entry/lock-seat/prepare-reservation/confirm-payment 규칙이 활성화되고 동작한다"
    why_human: "CLI API와 Chrome Dashboard 모두 현재 Cloudflare 계정의 zone/domain 목록이 비어 있음을 확인했다. Grapit zone을 추가하고 ruleset/rate-limit/challenge/block rules를 반영해야 통과 판정 가능"
  - test: "Toss sandbox 실결제 경로(국내카드/해외카드/Alipay+/truemoney) 실제 redirect/webhook 왕복 확인"
    expected: "sync/pending/recovery 분기와 안내 문구가 실제 PG round-trip 결과와 일치한다"
    why_human: "실제 Toss sandbox merchant 세션/외부 webhook 연동은 정적 분석·mock 테스트로 대체 불가"
---

# Phase 24: Traffic + Booking + Payment Core Verification Report

**Phase Goal:** 광고/티켓팅 트래픽 흡수부터 좌석 선택, 결제, 환불, QR 발급까지 사용자의 core booking path를 test-key 기준으로 완성한다.  
**Verified:** 2026-05-10T13:27:50Z  
**Status:** human_needed  
**Re-verification:** Yes — gap closure(24-21/24-22 포함) 이후 재검증

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Queue admission uses Valkey Sorted Set and batch admission; booking APIs require valid admission | ✓ VERIFIED | `zrange/zrem/sadd` 기반 batch admission과 snapshot 계산이 구현됨 (`apps/api/src/modules/queue/queue.service.ts`), booking/reservation mutation에 `AdmissionGuard`가 강제됨 (`apps/api/src/modules/booking/booking.controller.ts`, `apps/api/src/modules/reservation/reservation.controller.ts`). |
| 2 | WAF/rate-limit/bot/macro rules and Cloud Scheduler prewarm runbook are documented and verified | ? UNCERTAIN (WARNING) | app-layer traffic policy/decision + prewarm OIDC/control-token 검증 + runbook은 확인됨 (`apps/api/src/modules/traffic/traffic-defense.service.ts`, `apps/api/src/modules/ops/prewarm.service.ts`, `docs/runbooks/phase24-queue-waf-prewarm.md`). Cloud Scheduler prewarm live 호출은 HUMAN-UAT test 2에서 PASS. Cloudflare는 CLI API와 Chrome Dashboard에서 현재 계정의 zone/domain 목록이 비어 있어 HUMAN-UAT test 1이 still blocked. |
| 3 | Multi-floor SVG upload/render/switching works on desktop/mobile with lock/countdown/expiry/recovery behavior | ✓ VERIFIED | floor-aware seat identity/selector/summary wiring (`apps/web/components/booking/booking-page.tsx`, `apps/web/components/booking/floor-selector.tsx`) + overlay hit-target 보정(`apps/web/components/booking/seat-map-viewer.tsx`) + browser 회귀 테스트 PASS(`apps/web/e2e/booking-floor-selection.spec.ts`). |
| 4 | Event-specific max tickets, cancellation/change policy, and manual seat operation controls are configurable | ✓ VERIFIED | `booking_policies` + migration 확장(`apps/api/src/database/schema/booking-policies.ts`, `apps/api/src/database/migrations/0012_phase24_booking_core.sql`) 및 `maxTicketsPerUser` 서버 enforcement(`apps/api/src/modules/booking/booking.service.ts`), manual-open audit/처리(`apps/api/src/modules/admin/admin-booking.service.ts`). |
| 5 | Domestic Toss, overseas card, Alipay+, and truemoney paths work with proper disclaimers | ? UNCERTAIN (WARNING) | provider 분기/consent/schema/webhook idempotency 구현 및 mocked browser tests PASS(`apps/web/components/booking/toss-payment-widget.tsx`, `apps/api/src/modules/payment/payment.service.ts`, `apps/api/src/modules/payment/payment-webhook.controller.ts`, `apps/web/e2e/toss-payment-phase24.spec.ts`). 하지만 실제 Toss sandbox redirect/webhook 왕복 증거는 HUMAN-UAT test 3에서 blocked. |
| 6 | Refund preview/request/state machine, random cancelled-seat holding, QR JWT/HMAC issuance, and D-1 QR email scheduling work | ✓ VERIFIED | refund 상태머신/재시도/hold+release worker(`apps/api/src/modules/refund/refund.service.ts`, `apps/api/src/modules/jobs/refund-cancel-retry.worker.ts`, `apps/api/src/modules/jobs/cancelled-seat-release.worker.ts`) + QR JWT/HMAC 발급/검증 및 D-1 email scheduling(`apps/api/src/modules/ticket/qr-ticket.service.ts`). |

**Score:** 4/6 truths verified

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

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| `TRAF-01` | 24-01/04/08/20 | queue admission + booking guard + queue UX | ✓ SATISFIED | queue service + AdmissionGuard + booking-queue e2e |
| `TRAF-02` | 24-05/08/20 | WAF/rate-limit/challenge/block | ? NEEDS HUMAN | app-layer 구현/테스트 및 runbook 있음. CLI API + Chrome Dashboard 확인 결과 현재 Cloudflare 계정에 zone/domain이 없어 실제 zone rule 활성 증거를 만들 수 없음 |
| `TRAF-03` | 24-05/21 | Cloud Scheduler prewarm scale-up/step-down | ✓ SATISFIED | prewarm service/runbook + HUMAN-UAT test 2 live run PASS |
| `BOOK-01` | 24-02/06/07/15/16/19/22 | multi-floor seat selection/lock | ✓ SATISFIED | floor-aware seatKey + seat-map hit-target fix + floor browser e2e |
| `BOOK-02` | 24-01/03/09/10/17/22 | countdown/expiry/recovery | ✓ SATISFIED | confirm/complete recovery UI + e2e + lock failure 분기 |
| `BOOK-03` | 24-01/02/06/07/12/15/16/19 | policy/manual controls | ✓ SATISFIED | booking policy schema + maxTickets enforcement + manual open audit |
| `PAY-02` | 24-01/03/09/10/17/18 | Toss domestic/overseas 분기 | ? NEEDS HUMAN | provider/disclaimer/webhook 로직 + mocked e2e PASS, 실 PG round-trip 증거 미확정 |
| `REFUND-01` | 24-01/02/03/11/14/18 | refund request/timeline/state | ✓ SATISFIED | refund service state machine + timeline UI |
| `REFUND-02` | 24-01/02/03/11/12/18 | delayed reopen + manual-open exception | ✓ SATISFIED | held_cancelled + release worker + manual open override |
| `QR-01` | 24-01/02/03/13/18 | QR issue/verify/D-1 scheduling | ✓ SATISFIED | QR JWT/HMAC + reminder schedule worker |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| `apps/api/src/modules/payment/toss-payments.client.ts` | 69 | `TODO: zod schema runtime validation` | ⚠️ Warning | 런타임 payload 강건성 개선 여지 (현 시점 blocker 아님) |

### Human Verification Required

### 1. Cloudflare Rule Activation

**Test:** Cloudflare Dashboard/API에서 Grapit zone의 queue-entry/booking mutation 규칙 활성 상태 확인  
**Expected:** challenge/block/rate-limit 분기가 실제 zone에서 동작  
**Why human:** 2026-05-10 CLI API와 Chrome Dashboard로 현재 인증 계정의 zone/domain 목록이 비어 있음을 확인했다. `Domains > Overview`는 "도메인 또는 하위 도메인을 찾을 수 없습니다"를 표시했고, `Application Security > WAF`는 account-level WAF Enterprise upsell만 표시했다. Grapit zone을 Cloudflare에 추가하고 runbook rules를 반영한 뒤 재확인이 필요하다.

### 2. Toss Sandbox Round-Trip

**Test:** 국내카드/해외카드/Alipay+/truemoney 실결제 redirect + webhook 왕복 수행  
**Expected:** pending/failed/expired/success 분기와 DB/UI 상태가 일치  
**Why human:** 외부 PG 세션/웹훅 네트워크 왕복은 mock으로 대체 불가

### Gaps Summary

코드 내부 구현/테스트 기준의 BLOCKER gap은 확인되지 않았다. 다만 success criteria #2(Cloudflare 실 zone 적용)는 현재 Cloudflare 계정에 zone/domain이 없어 운영 반영이 확인되지 않았고, #5(실 Toss sandbox round-trip)도 외부 운영 증거가 미완료라 `status: human_needed`를 유지한다.

---

_Verified: 2026-05-10T13:35:20Z_
_Verifier: the agent (gsd-verifier)_
