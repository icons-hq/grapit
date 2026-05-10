---
phase: 24-traffic-booking-payment-core
verified: 2026-05-10T10:03:16Z
status: human_needed
score: 4/6 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 4/6
  gaps_closed: []
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Cloudflare WAF/rate-limit/challenge/block rules 실제 Zone 반영 확인"
    expected: "runbook의 queue-entry/lock-seat/prepare-reservation/confirm-payment 규칙이 활성화되고 동작한다"
    why_human: "Cloudflare Dashboard/Zone 설정은 코드베이스 정적 분석으로 검증 불가"
  - test: "Cloud Scheduler → prewarm API(OIDC+control-token) 실제 호출 검증"
    expected: "scale-up/step-down job이 의도한 서비스에 성공하고 감사 가능한 실행 로그가 남는다"
    why_human: "GCP Scheduler/Cloud Run IAM 연동은 로컬 코드만으로 완전 검증 불가"
  - test: "Toss sandbox 실결제 경로(국내카드/해외카드/Alipay+/truemoney) E2E"
    expected: "sync/pending/recovery 분기와 안내문구가 실제 redirect/webhook 왕복에서 일치한다"
    why_human: "외부 PG 네트워크 왕복은 정적 분석/단위테스트만으로 최종 판정 불가"
  - test: "모바일/데스크톱 멀티층 좌석 선택 UX 수동 점검"
    expected: "층 전환 시 선택/타이머/복구 흐름이 실제 브라우저에서 안정 동작한다"
    why_human: "반응형/터치 UX는 코드 판독만으로 체감 품질 판정 불가"
---

# Phase 24: Traffic + Booking + Payment Core Verification Report

**Phase Goal:** 광고/티켓팅 트래픽 흡수부터 좌석 선택, 결제, 환불, QR 발급까지 사용자의 core booking path를 test-key 기준으로 완성한다.  
**Verified:** 2026-05-10T10:03:16Z  
**Status:** human_needed  
**Re-verification:** Yes — gap closure(24-18/24-19/24-20) 이후 재검증

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Queue admission uses Valkey Sorted Set + batch admission, and booking APIs require valid admission | ✓ VERIFIED | 배치 admission 로직 `zrange/zrem/sadd` 확인([queue.service.ts](/Users/sangwopark19/icons/grapit/apps/api/src/modules/queue/queue.service.ts:395)). booking/reservation mutation 가드 강제 적용([booking.controller.ts](/Users/sangwopark19/icons/grapit/apps/api/src/modules/booking/booking.controller.ts:28), [reservation.controller.ts](/Users/sangwopark19/icons/grapit/apps/api/src/modules/reservation/reservation.controller.ts:53)). |
| 2 | WAF/rate-limit/bot/macro rules and Cloud Scheduler prewarm runbook are documented and verified | ? UNCERTAIN | runbook/코드 구현 존재([phase24-queue-waf-prewarm.md](/Users/sangwopark19/icons/grapit/docs/runbooks/phase24-queue-waf-prewarm.md:1), [traffic-defense.service.ts](/Users/sangwopark19/icons/grapit/apps/api/src/modules/traffic/traffic-defense.service.ts:50), [prewarm.controller.ts](/Users/sangwopark19/icons/grapit/apps/api/src/modules/ops/prewarm.controller.ts:28), [prewarm.service.ts](/Users/sangwopark19/icons/grapit/apps/api/src/modules/ops/prewarm.service.ts:118)). 다만 실제 Zone/Scheduler 적용은 코드 외부 검증 필요. |
| 3 | Multi-floor SVG upload/render/switching works on desktop and mobile, with lock/countdown/expiry/payment-failure return behavior | ? UNCERTAIN | floor-aware 상태/컴포넌트와 queue metric locator 안정화 반영([queue-waiting.tsx](/Users/sangwopark19/icons/grapit/apps/web/components/booking/queue-waiting.tsx:145), [booking-queue.spec.ts](/Users/sangwopark19/icons/grapit/apps/web/e2e/booking-queue.spec.ts:31)). 실기기/실브라우저 UX 최종 판정은 수동 필요. |
| 4 | Event-specific max tickets, cancellation/change policy, and manual seat operation controls are configurable | ✓ VERIFIED | migration 및 정책/수동오픈 경로 존재([0012_phase24_booking_core.sql](/Users/sangwopark19/icons/grapit/apps/api/src/database/migrations/0012_phase24_booking_core.sql:129), [booking.service.ts](/Users/sangwopark19/icons/grapit/apps/api/src/modules/booking/booking.service.ts:271)). |
| 5 | Domestic Toss, overseas card, Alipay+, and truemoney paths work with proper disclaimers | ✓ VERIFIED | provider/branch 및 consent 분기 구현([payment.service.ts](/Users/sangwopark19/icons/grapit/apps/api/src/modules/payment/payment.service.ts:185), [toss-payment-widget.tsx](/Users/sangwopark19/icons/grapit/apps/web/components/booking/toss-payment-widget.tsx:19), [payment-webhook.controller.ts](/Users/sangwopark19/icons/grapit/apps/api/src/modules/payment/payment-webhook.controller.ts:59)). |
| 6 | Refund preview/request/state machine, random cancelled-seat holding, QR JWT/HMAC issuance, and D-1 QR email scheduling work | ✓ VERIFIED | refund 상태머신/재시도/hold 및 release worker 구현([refund.service.ts](/Users/sangwopark19/icons/grapit/apps/api/src/modules/refund/refund.service.ts:214), [refund-cancel-retry.worker.ts](/Users/sangwopark19/icons/grapit/apps/api/src/modules/jobs/refund-cancel-retry.worker.ts:84), [cancelled-seat-release.worker.ts](/Users/sangwopark19/icons/grapit/apps/api/src/modules/jobs/cancelled-seat-release.worker.ts:125)). QR 발급/검증/스케줄 구현([qr-ticket.service.ts](/Users/sangwopark19/icons/grapit/apps/api/src/modules/ticket/qr-ticket.service.ts:91), [qr-ticket.service.ts](/Users/sangwopark19/icons/grapit/apps/api/src/modules/ticket/qr-ticket.service.ts:325)). |

**Score:** 4/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `apps/api/src/modules/jobs/pgboss.module.ts` | PG_BOSS leaf module | ✓ VERIFIED | provider-only leaf module 생성, `ticket/refund`에서 직접 import |
| `apps/api/src/modules/jobs/jobs.module.ts` | worker registration 분리 | ✓ VERIFIED | `PaymentModule` 의존은 유지하되 request path와 분리 |
| `apps/api/src/modules/ticket/ticket.module.ts` | ticket ↔ pgboss leaf 연결 | ✓ VERIFIED | `PgbossModule` import로 bootstrap cycle 경감 |
| `apps/api/src/modules/refund/refund.module.ts` | refund service PG_BOSS 해석 가능 | ✓ VERIFIED | `PgbossModule` + `JobsModule` 동시 import로 service/worker 경로 분리 유지 |
| `apps/api/src/modules/booking/__tests__/booking.service.integration.spec.ts` | floor-aware fixture + leftJoin 대응 | ✓ VERIFIED | `encodeURIComponent`, `leftJoin` query shape 기반 fixture 반영 |
| `apps/api/test/booking-cluster-lua.integration.spec.ts` | cluster fixture 동기화 | ✓ VERIFIED | runtime seat key 인코딩 경로 확인 |
| `apps/api/src/database/migrations/0012_phase24_booking_core.sql` | fresh migration 안전성 | ✓ VERIFIED | `idx_translation_drafts_one_published_per_source_locale` 중복 생성 제거, floor key index 유지 |
| `apps/web/components/booking/queue-waiting.tsx` | stable queue metric selector | ✓ VERIFIED | `queue-metric-position/eta/remaining-seats` contract 존재 |
| `apps/web/e2e/booking-queue.spec.ts` | strict-safe metric scoped assertion | ✓ VERIFIED | page-wide text 대신 testid 기반 검증 |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| `ticket.module.ts` | `pgboss.module.ts` | shared PG_BOSS provider import | ✓ WIRED | `PgbossModule` import 확인 |
| `jobs.module.ts` | `payment.module.ts` | worker-only runtime dependency | ✓ WIRED | worker bootstrap 경로에서만 결합 |
| `booking.service.integration.spec.ts` | `booking.service.ts` | `getMaxTicketsPerUser()` query shape | ✓ WIRED | `leftJoin` 계약 반영 |
| `booking-cluster-lua.integration.spec.ts` | `booking.service.ts` | encoded runtime seat keys | ✓ WIRED | `encodeURIComponent` 계약 반영 |
| `booking-queue.spec.ts` | `queue-waiting.tsx` | stable metric locator contract | ✓ WIRED | 동일 `queue-metric-*` 식별자 사용 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| --- | --- | --- | --- | --- |
| `queue.service.ts` | `position/etaSeconds/remainingSeats` | Valkey sorted set + availability 계산 | Yes | ✓ FLOWING |
| `payment-webhook.controller.ts` | webhook 반영 상태 | `recordWebhookEvent` + `upsertAsyncPaymentProgress` + DB | Yes | ✓ FLOWING |
| `refund.service.ts` | `refundTimeline/retryEnqueued` | refunds/payments/reservations + pg-boss enqueue 결과 | Yes | ✓ FLOWING |
| `qr-ticket.service.ts` | QR token/email schedule | tickets/showtimes/users + pg-boss/email | Yes | ✓ FLOWING |
| `queue-waiting.tsx` | metric tile 값 | queue session API snapshot | Yes | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Monorepo build | `pnpm build` | passed | ✓ PASS |
| Full test suite | `pnpm test` | api 599 + web 348 + shared 37 passed | ✓ PASS |
| API type/lint gate | `pnpm --filter @grabit/api typecheck` / `pnpm --filter @grabit/api lint` | typecheck pass, lint warning-only(0 error) | ✓ PASS |
| Schema drift | `verify.schema-drift 24` | `drift_detected=false` | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| `TRAF-01` | 24-01/04/08/20 | queue admission + booking guard + queue UX | ✓ SATISFIED | queue service + AdmissionGuard + queue e2e locator 안정화 |
| `TRAF-02` | 24-05/08/20 | WAF/rate-limit/challenge/block | ? NEEDS HUMAN | runbook + traffic-defense 코드 확인, Zone 적용은 외부 검증 필요 |
| `TRAF-03` | 24-05 | prewarm scheduler path | ? NEEDS HUMAN | prewarm controller/service 및 토큰 검증 코드 존재, 실제 GCP wiring 확인 필요 |
| `BOOK-01` | 24-02/06/07/15/16/19 | floor-aware seat selection/lock | ✓ SATISFIED | runtime seatKey/encoded lock + integration fixture 갱신 |
| `BOOK-02` | 24-01/03/09/10/17 | deadline/expiry/recovery | ✓ SATISFIED | payment async/recovery 구현 + 테스트 통과 |
| `BOOK-03` | 24-01/02/06/07/12/15/16/19 | policy/manual controls | ✓ SATISFIED | maxTickets 정책 lookup + 수동 운영 경로 유지 |
| `PAY-02` | 24-01/03/09/10/17/18 | Toss domestic/overseas 분기 | ✓ SATISFIED | provider 분기 + webhook idempotency + bootstrap cycle 해소 |
| `REFUND-01` | 24-01/02/03/11/14/18 | refund request/timeline/state | ✓ SATISFIED | refund service 상태머신 + retry worker + tests |
| `REFUND-02` | 24-01/02/03/11/12/18 | delayed reopen + manual-open exception | ✓ SATISFIED | held_cancelled + release job + admin path |
| `QR-01` | 24-01/02/03/13/18 | QR issue/verify/D-1 scheduling | ✓ SATISFIED | qr-ticket JWT/HMAC + email resend schedule + PG_BOSS wiring 유지 |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| `apps/api/src/modules/refund/refund.service.ts` | 201 | `return null` | ℹ️ Info | metadata/queue enqueue 실패 처리용 정상 분기, stub 아님 |
| `apps/api/src/modules/jobs/refund-cancel-retry.worker.ts` | 196 | `return null` | ℹ️ Info | context 부재/스킵 시 안전 종료 분기, stub 아님 |
| `apps/api/src/modules/booking/__tests__/booking.service.integration.spec.ts` | 42 | `() => {}` | ℹ️ Info | test fixture mock no-op으로 실행 경로 영향 없음 |

### Human Verification Required

### 1. Cloudflare Rule Activation

**Test:** Cloudflare Dashboard에서 queue-entry/booking mutation 룰 그룹 활성화 상태 확인  
**Expected:** retry/challenge/block 분기가 실제 zone에서 동작  
**Why human:** 외부 SaaS 설정은 repo 정적 분석 불가

### 2. Scheduler Prewarm Runtime

**Test:** Cloud Scheduler에서 prewarm scale-up/step-down job 실제 트리거  
**Expected:** OIDC + `x-prewarm-control-token` 검증을 통과하고 대상 서비스 min-instance 조정  
**Why human:** GCP IAM/실행 로그는 코드 외부 상태

### 3. Toss Sandbox Round-Trip

**Test:** 국내카드/해외카드/Alipay+/truemoney 결제-리턴-웹훅 왕복 수동 실행  
**Expected:** sync/pending/failure/expired recovery가 UI/DB 상태와 일치  
**Why human:** 외부 PG 왕복은 단위테스트만으로 완전 판정 불가

### 4. Responsive Multi-floor UX

**Test:** 모바일/데스크톱에서 floor switching + lock/countdown/recovery 흐름 수동 점검  
**Expected:** 층 전환 시 선택 보존 및 타이머/복구 흐름 안정 동작  
**Why human:** 터치/레이아웃 체감 품질은 자동화로 충분히 대체 불가

### Gaps Summary

코드 기준 BLOCKER gap은 확인되지 않았다. 다만 성공기준 #2, #3의 일부는 외부 인프라/실브라우저 행태 검증이 필요하므로 상태는 `human_needed`다.

---

_Verified: 2026-05-10T10:03:16Z_  
_Verifier: the agent (gsd-verifier)_
