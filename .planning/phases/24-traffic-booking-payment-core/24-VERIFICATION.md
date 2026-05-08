---
phase: 24-traffic-booking-payment-core
verified: 2026-05-08T10:30:38Z
status: human_needed
score: 4/6 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Cloudflare WAF/rate-limit/challenge/block rules 실제 Zone 반영 확인"
    expected: "runbook의 queue-entry/lock-seat/prepare-reservation/confirm-payment 규칙이 활성화되고 동작한다"
    why_human: "코드베이스 밖의 Cloudflare Dashboard 상태는 정적 분석으로 검증 불가"
  - test: "Toss sandbox 실결제 경로(국내카드/해외카드/Alipay+/truemoney) E2E"
    expected: "각 브랜치가 안내문구/redirect/pending/recovery 포함해 정상 완료 또는 의도된 실패 복구를 제공한다"
    why_human: "외부 PG 리다이렉트/웹훅 왕복은 로컬 정적 검증으로 완전 판정 불가"
  - test: "모바일/데스크톱 멀티층 좌석 선택 UX 최종 확인"
    expected: "층 전환 시 선택/타이머 유지, 그룹 요약 표시, 결제 진입 흐름이 실제 브라우저에서 안정 동작한다"
    why_human: "반응형/터치 UX는 코드와 단위테스트만으로 체감 품질 판정 불가"
---

# Phase 24: Traffic + Booking + Payment Core Verification Report

**Phase Goal:** 광고/티켓팅 트래픽 흡수부터 좌석 선택, 결제, 환불, QR 발급까지 사용자의 core booking path를 test-key 기준으로 완성한다.  
**Verified:** 2026-05-08T10:30:38Z  
**Status:** human_needed  
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Queue admission uses Valkey Sorted Set + batch admission, and booking APIs require valid admission | ✓ VERIFIED | `queue.service.ts`에서 `zrange/zrem/sadd` 기반 배치 admission 및 position broadcast 구현([queue.service.ts](/Users/sangwopark19/icons/grapit/apps/api/src/modules/queue/queue.service.ts:395)). `AdmissionGuard`가 booking/reservation mutation에 강제 적용([booking.controller.ts](/Users/sangwopark19/icons/grapit/apps/api/src/modules/booking/booking.controller.ts:28), [reservation.controller.ts](/Users/sangwopark19/icons/grapit/apps/api/src/modules/reservation/reservation.controller.ts:53)). |
| 2 | WAF/rate-limit/bot/macro rules and Cloud Scheduler prewarm runbook are documented and verified | ? UNCERTAIN | runbook/코드는 존재([phase24-queue-waf-prewarm.md](/Users/sangwopark19/icons/grapit/docs/runbooks/phase24-queue-waf-prewarm.md:1), [traffic-defense.service.ts](/Users/sangwopark19/icons/grapit/apps/api/src/modules/traffic/traffic-defense.service.ts:192), [prewarm.controller.ts](/Users/sangwopark19/icons/grapit/apps/api/src/modules/ops/prewarm.controller.ts:27), [prewarm.service.ts](/Users/sangwopark19/icons/grapit/apps/api/src/modules/ops/prewarm.service.ts:94)). 하지만 Cloudflare 실 Zone 적용 여부는 코드베이스에서 확인 불가. |
| 3 | Multi-floor SVG upload/render/switching works on desktop/mobile with lock/countdown/expiry/payment-failure return behavior | ? UNCERTAIN | 멀티층 상태/렌더 로직 구현([use-booking-store.ts](/Users/sangwopark19/icons/grapit/apps/web/stores/use-booking-store.ts:25), [floor-selector.tsx](/Users/sangwopark19/icons/grapit/apps/web/components/booking/floor-selector.tsx:18), [seat-map-viewer.tsx](/Users/sangwopark19/icons/grapit/apps/web/components/booking/seat-map-viewer.tsx:26), [booking-page.tsx](/Users/sangwopark19/icons/grapit/apps/web/components/booking/booking-page.tsx:97)). 다만 모바일/데스크톱 실브라우저 UX 완전 판정은 수동 필요. |
| 4 | Event-specific max tickets/policy/manual seat operation controls are configurable | ✓ VERIFIED | booking policy schema + migration + admin 서비스에서 max tickets/manual open 저장/검증([0012_phase24_booking_core.sql](/Users/sangwopark19/icons/grapit/apps/api/src/database/migrations/0012_phase24_booking_core.sql:18), [admin-booking.service.ts](/Users/sangwopark19/icons/grapit/apps/api/src/modules/admin/admin-booking.service.ts:289), [admin-booking.controller.ts](/Users/sangwopark19/icons/grapit/apps/api/src/modules/admin/admin-booking.controller.ts:53)). |
| 5 | Domestic Toss, overseas card, Alipay+, truemoney paths work with proper disclaimers | ✓ VERIFIED | 결제 분기 매트릭스 구현([payment.service.ts](/Users/sangwopark19/icons/grapit/apps/api/src/modules/payment/payment.service.ts:120)), widget 측 provider 매핑/overseas consent 처리([toss-payment-widget.tsx](/Users/sangwopark19/icons/grapit/apps/web/components/booking/toss-payment-widget.tsx:129)). webhook idempotency/순서 역전 방어([payment-webhook.controller.ts](/Users/sangwopark19/icons/grapit/apps/api/src/modules/payment/payment-webhook.controller.ts:59)). |
| 6 | Refund preview/request/state machine + random cancelled-seat hold + QR issuance + D-1 QR email scheduling work | ✓ VERIFIED | refund 상태머신/재시도/hold 구현([refund.service.ts](/Users/sangwopark19/icons/grapit/apps/api/src/modules/refund/refund.service.ts:38), [cancelled-seat-release.worker.ts](/Users/sangwopark19/icons/grapit/apps/api/src/modules/jobs/cancelled-seat-release.worker.ts:61)). QR 발급/JWT 검증/D-1 schedule 구현([qr-ticket.service.ts](/Users/sangwopark19/icons/grapit/apps/api/src/modules/ticket/qr-ticket.service.ts:98), [qr-ticket.service.ts](/Users/sangwopark19/icons/grapit/apps/api/src/modules/ticket/qr-ticket.service.ts:305)). |

**Score:** 4/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `apps/api/src/database/migrations/0012_phase24_booking_core.sql` | phase24 core schema migration | ✓ VERIFIED | floor/payment_deadline/refund/ticket/audit columns+tables+indexes 존재 |
| `apps/api/src/modules/queue/*` | queue admission runtime + guard | ✓ VERIFIED | controller/service/gateway/guard 실구현 및 spec 존재 |
| `apps/api/src/modules/payment/*` | Toss branch + webhook idempotency | ✓ VERIFIED | branch matrix + webhook ledger/중복 처리 구현 |
| `apps/api/src/modules/refund/*` | refund orchestration/state machine | ✓ VERIFIED | preview/request/retry/hold 구현 |
| `apps/api/src/modules/ticket/*` | QR issuance + token verify + schedule | ✓ VERIFIED | issue/verify/email job scheduling 구현 |
| `apps/web/components/booking/*` | floor-aware booking/payment UI | ✓ VERIFIED | floor selector, SVG viewer, payment deadline/banner/wallet 분기 구현 |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| `AdmissionGuard` | `BookingController/ReservationController` | `@UseGuards` | ✓ WIRED | lockSeat/prepare/confirm mutation 보호 확인 |
| `QueueController` | `QueueService` | enter/status API | ✓ WIRED | queueSession/position/eta/remainingSeats 전달 |
| `PaymentWebhookController` | `PaymentService` | `recordWebhookEvent` + `upsertAsyncPaymentProgress` | ✓ WIRED | duplicate/stale webhook 방어 포함 |
| `RefundService` | `CancelledSeatReleaseWorker` | pg-boss delayed release payload | ✓ WIRED | held_cancelled -> delayed reopen 경로 연결 |
| `AdminBookingController` | `AdminBookingService` | `manual-open`/`refund` endpoint | ✓ WIRED | 관리자 예외 경로 및 refund delegation |
| `TicketController` | `QrTicketService` | owned reservation ticket lookup | ✓ WIRED | 예약 상세 QR 조회 연결 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| --- | --- | --- | --- | --- |
| `queue.controller.ts` | `position/etaSeconds/remainingSeats` | `queue.service.ts` + Redis sorted set/set | Yes | ✓ FLOWING |
| `payment-webhook.controller.ts` | webhook process result | `payment_webhook_events` + `payments/reservations` DB upsert | Yes | ✓ FLOWING |
| `refund.service.ts` | `refundTimeline` + `retryEnqueued` | `refunds/payments/reservations` + Toss cancel response + pg-boss | Yes | ✓ FLOWING |
| `booking-page.tsx` | floor grouped selections | Zustand store + performance detail + seat status hooks | Yes | ✓ FLOWING |
| `qr-ticket.service.ts` | ticket token/job schedule | `tickets/reservations/payments/showtimes` + `pg-boss` | Yes | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Queue admission runtime contract tests | `pnpm --filter @grabit/api exec vitest run src/modules/queue/queue.service.spec.ts` | 3 tests passed | ✓ PASS |
| Toss webhook idempotency/stale-event handling | `pnpm --filter @grabit/api exec vitest run src/modules/payment/toss-webhook.controller.spec.ts` | 6 tests passed | ✓ PASS |
| QR issuance/scheduling core flow | `pnpm --filter @grabit/api exec vitest run src/modules/ticket/qr-ticket.service.spec.ts` | 3 tests passed | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| `TRAF-01` | 24-01/04/08 | queue admission + booking guard | ✓ SATISFIED | queue module + AdmissionGuard wiring + queue tests |
| `TRAF-02` | 24-05/08 | rate-limit/challenge/block + queue UX | ? NEEDS HUMAN | code/runbook 존재, Cloudflare 실적용은 수동 확인 필요 |
| `TRAF-03` | 24-05 | prewarm control path/runbook | ? NEEDS HUMAN | prewarm OIDC/token 검증 코드 존재, 실제 Scheduler/GCP 연동은 수동 확인 필요 |
| `BOOK-01` | 24-02/06/07/15/16 | floor-aware booking + policy | ✓ SATISFIED | floor-aware schema/service/store/UI 및 tests |
| `BOOK-02` | 24-01/03/09/10/17 | payment core + recoveries | ✓ SATISFIED | branch/webhook/deadline/recovery 구현 및 tests |
| `BOOK-03` | 24-01/02/06/07/12/15/16 | policy/manual-open/admin operations | ✓ SATISFIED | admin manual-open/policy checks/audit row 구현 |
| `PAY-02` | 24-01/03/09/10/17 | Toss sync/async + foreign flows | ✓ SATISFIED | payment branch + webhook idempotency + widget mapping |
| `REFUND-01` | 24-01/02/03/11/14 | refund preview/timeline/state | ✓ SATISFIED | refund service/timeline UI/tests |
| `REFUND-02` | 24-01/02/03/11/12 | delayed reopen + manual-open exception | ✓ SATISFIED | cancelled-seat worker + admin manual-open |
| `QR-01` | 24-01/02/03/13 | QR issue/verify/D-1 schedule | ✓ SATISFIED | qr-ticket service/controller/schema/tests |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| N/A | - | blocker-level TODO/placeholder/stub not found in sampled phase-critical files | ℹ️ Info | 핵심 경로에서 placeholder 구현 징후 미발견 |

### Human Verification Required

### 1. Cloudflare Rule Activation

**Test:** Cloudflare Dashboard에서 queue-entry/booking mutation rule 그룹이 runbook대로 활성화되어 있는지 확인  
**Expected:** retry/challenge/block 분기가 실제 zone에서 적용  
**Why human:** 외부 SaaS 설정 상태는 repo 정적 분석 불가

### 2. Real Toss Sandbox Round-Trip

**Test:** 국내카드/해외카드/Alipay+/truemoney 시나리오를 sandbox에서 실제 결제-리턴-웹훅까지 실행  
**Expected:** sync/pending/recovery 분기와 안내문구가 의도대로 동작  
**Why human:** PG redirect/webhook 외부 왕복은 로컬 코드만으로 최종 판정 불가

### 3. Responsive Booking UX

**Test:** mobile viewport + desktop viewport에서 floor switching/seat grouping/timer/expiry 경로 수동 점검  
**Expected:** 선택 보존, 요약 정확성, 결제 진입 안정성 확보  
**Why human:** 반응형·터치 UX 완성도는 자동 테스트만으로 충분히 보장 불가

### Gaps Summary

코드베이스 기준으로 Phase 24 핵심 구현(큐, 결제 분기/웹훅, 환불 상태머신, 관리자 예외경로, QR 발급, 스키마/마이그레이션, 핵심 테스트)은 확인됨. 다만 Cloudflare/GCP/Toss 외부 시스템과 실제 브라우저 UX는 자동 검증 한계를 가지므로 human UAT가 필요하다.

---

_Verified: 2026-05-08T10:30:38Z_  
_Verifier: the agent (gsd-verifier)_
