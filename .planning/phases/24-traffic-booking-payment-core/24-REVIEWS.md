---
phase: 24
reviewers:
  - claude
failed_reviewers:
  - cursor
skipped_reviewers:
  - codex # skipped because current runtime is Codex; review would not be independent
reviewed_at: 2026-05-08T04:38:09Z
plans_reviewed:
  - .planning/phases/24-traffic-booking-payment-core/24-01-PLAN.md
  - .planning/phases/24-traffic-booking-payment-core/24-02-PLAN.md
  - .planning/phases/24-traffic-booking-payment-core/24-03-PLAN.md
  - .planning/phases/24-traffic-booking-payment-core/24-04-PLAN.md
  - .planning/phases/24-traffic-booking-payment-core/24-05-PLAN.md
  - .planning/phases/24-traffic-booking-payment-core/24-06-PLAN.md
  - .planning/phases/24-traffic-booking-payment-core/24-07-PLAN.md
  - .planning/phases/24-traffic-booking-payment-core/24-08-PLAN.md
  - .planning/phases/24-traffic-booking-payment-core/24-09-PLAN.md
  - .planning/phases/24-traffic-booking-payment-core/24-10-PLAN.md
  - .planning/phases/24-traffic-booking-payment-core/24-11-PLAN.md
  - .planning/phases/24-traffic-booking-payment-core/24-12-PLAN.md
  - .planning/phases/24-traffic-booking-payment-core/24-13-PLAN.md
  - .planning/phases/24-traffic-booking-payment-core/24-14-PLAN.md
  - .planning/phases/24-traffic-booking-payment-core/24-15-PLAN.md
  - .planning/phases/24-traffic-booking-payment-core/24-16-PLAN.md
  - .planning/phases/24-traffic-booking-payment-core/24-17-PLAN.md
---

# Cross-AI Plan Review — Phase 24

## Review Run Notes

- `claude` completed successfully. The first full-content stdin prompt was stopped after prolonged no-output processing; the successful retry used the same review scope via file-path prompt in read-only plan mode.
- `cursor` was detected but failed before review because `cursor agent` is not authenticated in this environment.
- `codex` was available but skipped because this session is already Codex, so invoking Codex would not provide an independent reviewer.
- `gemini`, `coderabbit`, `opencode`, `qwen`, `ollama`, `lm_studio`, and `llama_cpp` were not available or not running.

## Claude Review

# Cross-AI Plan Review — Phase 24: Traffic + Booking + Payment Core

**Reviewed:** 2026-05-08
**Scope:** 17 plans, 10 waves, requirements TRAF-01/02/03 · BOOK-01/02/03 · PAY-02 · REFUND-01/02 · QR-01
**Reviewer:** Claude (Opus 4.7) — independent cross-AI review

---

## 1. Summary

Phase 24의 17개 플랜은 v2.0 Fanmeet Launch의 사용자 critical path (queue → multi-floor seat → 4-method payment → refund → QR)를 wave-based 의존성 그래프로 잘 직조했다. RESEARCH가 식별한 4개 핵심 위험 (admission bypass, seat-key collision, async Toss branch, idempotent webhook)이 24-04/24-07/24-09/24-11에 명시적으로 매핑되었고, 24-01의 RED contract gate와 24-03의 expand-only migration gate가 downstream 안전성을 강제한다. 다만 (a) 24-13 (QR)이 24-17 (payment recovery UI)에 의존하는 부적절한 ordering, (b) admission token transport/cookie 정책과 queue progress transport (Socket.IO vs polling) 미결정, (c) 7분 payment deadline ↔ 10분 lock TTL ↔ admission window 3종 timer 동기화 spec 부재, (d) Toss cancel timeout/재시도 및 amount tampering 방어가 plan-level 누락 등 MEDIUM-HIGH 위험 영역이 있다. 전반적으로 강한 contract-first 설계지만 plan간 boundary가 일부 흐려져 실행 시 deviation 위험이 있다.

---

## 2. Strengths

- **Contract-first wave 1 (24-01)**: shared DTO/zod에 `floorKey`/`seatKey`/`paymentDeadlineAt`/`refundTimeline`/`qrTicket`을 RED test로 강제하여 downstream의 single-floor·single-timer 가정 재발을 차단. RESEARCH의 Pitfall 2/3을 가장 일찍 닫는다.
- **Expand-only migration gate (24-03)**: `DROP TABLE|DROP COLUMN|...` rg 가드 + 정확한 `DOTENV_CONFIG_PATH=../../.env` 명령 강제. Phase 23의 expand-only 정책과 일관됨.
- **Admission as authorization boundary (24-04)**: `lockSeat`/`prepareReservation`/`confirmPayment` 모두에 `AdmissionGuard` 적용 — D-02의 "API-side authorization, not route guard"를 구조적으로 만족.
- **Webhook idempotency first-class (24-09 + 24-02)**: `payment_webhook_events` ledger와 `PAYMENT_STATUS_CHANGED`/`CANCEL_STATUS_CHANGED` 분기, duplicate replay test가 명시. Toss 7회 retry policy 대비.
- **Sync/async branch 분리 (24-09)**: `CARD + useInternationalCardOnly` 와 `FOREIGN_EASY_PAY + pendingUrl`을 명확히 구분 — RESEARCH Pitfall 1의 "보이지만 confirm 안되는" foreign easy-pay 함정 회피.
- **Held-cancelled + delayed reopen (24-11)**: D-17의 1-10분 randomized hold가 pg-boss 기반으로 durable하게 설계. 즉시 reopen 회귀 방지.
- **Manual-open isolation (24-12)**: Phase 25 console UI와 분리하여 Phase 24에서 backend exception path만 닫음 — scope creep 방지의 좋은 예.
- **Prewarm reality check (24-05)**: RESEARCH Pitfall 4의 "Cloud Scheduler PATCH 불가" 제약을 protected POST endpoint로 회피. CLI 한계 인정.
- **Decision coverage citations**: 모든 plan에 D-XX 매핑이 frontmatter+objective에 명시 — context 흐름 추적 가능.
- **STRIDE threat register**: plan별 T-24-XX 등록과 mitigation task 링크가 일관된다.

---

## 3. Concerns

### HIGH

- **[24-13] QR plan이 24-17 (payment recovery UI)에 부적절하게 의존** — `depends_on: ["24-11", "24-17"]`. QR 발행은 payment confirm backend (24-09) 직후가 논리적이고, 24-17은 web complete-page recovery UI일 뿐이다. 이 의존은 wave 9를 wave 8 (24-17) 뒤로 강제하여 QR을 비합리적으로 늦춘다. **권장**: `depends_on: ["24-09", "24-11"]`로 수정, 24-13을 wave 7 또는 8로 당김. complete-page UI에 QR 표시는 24-17 task 또는 24-13 task 2의 separate UI piece로 처리.

- **[24-08] verify 명령이 잘못된 hook 파일을 가리킴** — Task 1 `<verify>`가 `hooks/__tests__/use-booking.test.tsx`인데, 만들려는 hook은 `use-queue.ts`. 새 hook의 unit test 자체가 plan에 없음. **권장**: `apps/web/hooks/__tests__/use-queue.test.tsx`를 files_modified에 추가하고 task 1 verify로 사용.

- **[24-04] Admission token transport/cookie 정책 미정** — `grabit_queue_admission` cookie라고만 명시됨. (a) JWT vs opaque token, (b) httpOnly/Secure/SameSite, (c) lifetime은 D-04의 10분 active와 어떻게 동기화되는지, (d) Set-Cookie vs Authorization header가 cross-domain (heygrabit.com vs api 서브도메인)에서 어떻게 작동하는지 미정. STRIDE T-24-07 mitigation은 "bind to userId+family+session" 수준에 머문다. **권장**: token shape/transport와 cookie attribute spec을 24-04 task 1 acceptance에 추가.

- **[24-09 + 24-10] 3종 timer 동기화 spec 부재** — payment deadline 7분 (D-04, REQUIREMENTS BOOK-02), seat lock TTL 10분 (기존 BookingService), admission active window 10분 (D-04) 세 개가 서로 다르게 만료 가능. 7분 deadline 만료 시 lock 자동 해제? in-flight payment confirm 중 7분 초과하면? 24-09 task 2의 "extend payment/admission progress window" 가 있지만 lock TTL extend는 미언급. RESEARCH Pitfall 3가 정확히 이 영역을 경고한다. **권장**: `(deadline ≤ lockTTL ≤ admission window)` 불변식과 만료 시 cascade 정책을 24-09 task 2 또는 새 plan에 명시.

- **[24-09] 단일 task에 너무 많은 변경** — Task 1이 (i) sync/async branch, (ii) `useInternationalCardOnly` 라우팅, (iii) `FOREIGN_EASY_PAY` + `pendingUrl`, (iv) 두 종류 webhook + idempotency ledger를 모두 포함. RESEARCH가 식별한 가장 위험한 영역인데 acceptance가 grep 4개로만 검증. **권장**: webhook controller와 payment service branching을 별도 task로 분리하고, idempotency replay/out-of-order 테스트를 별도 acceptance로 격상.

### MEDIUM

- **[24-04 / 24-08] Queue progress transport 미결정** — 24-04는 `queue.gateway.ts` (Socket.IO) 파일을 만들지만 24-08의 `use-queue.ts`가 어떻게 position/ETA를 받는지 (Socket.IO subscribe? polling? SSE?) 미명시. RESEARCH는 Socket.IO 재사용을 권장하지만 plan에는 그 결정이 lock 안 됨. autoEnter signal의 source도 불명확. **권장**: 24-04 acceptance에 transport 결정 (예: Socket.IO `queue` namespace + `position-changed`/`admitted` events)을 추가하고, 24-08이 이를 구독하도록 명시.

- **[24-09] Toss redirect amount tampering 방어 누락** — RESEARCH의 Known Threat Patterns에 "Amount tampering on redirect return — compare redirect `amount` against original request and prepared reservation amount before confirm"이 있는데 plan에 mapping 없음. 기존 reservation.service가 canonical amount check를 하지만 Phase 24의 추가 분기 (overseas card, foreign easy-pay)가 같은 보호를 받는지 검증 부재. **권장**: 24-09 task 2 acceptance에 "redirect amount vs prepared amount equality assertion test"를 추가.

- **[24-11] Toss cancel API timeout/retry 정책 미명시** — refund state machine이 `sent_to_pg` → `processing_at_pg` → `completed`/`failed`인데, Toss cancel HTTP timeout/network error 시 어느 상태로? 재시도? RESEARCH의 V5/V6에는 idempotency 언급되지만 transient failure 정책은 없음. **권장**: 24-11 task 1에 "Toss cancel transient failure에서 idempotent retry 또는 manual reconciliation 진입"을 명시. pg-boss retry는 worker용이므로 controller-side 처리도 별도.

- **[24-11] Showtime 직전 cancel의 delayed reopen edge case** — D-17의 60-600s random delay 가 showtime 이후로 떨어질 수 있음. show 시작 후 reopen 하면 표 못 가는 사용자 발생. **권장**: 24-11 worker spec에 "delay 만료 시점이 showtime 5분 전 이후이면 reopen 보류" 정책을 acceptance로 추가.

- **[24-05] Prewarm endpoint 단일 secret 보호** — `PREWARM_CONTROL_TOKEN` 한 개로만 보호. 토큰 누출 시 누구나 production scale up/step-down 가능 (DoS·비용 폭주 위험). RESEARCH의 Open Question 4 RESOLVED는 "IAM은 environment-specific user_setup"이라 했지만 plan은 token 외 layer 미강제. **권장**: Cloud Scheduler OIDC service account binding을 dashboard_config에 명시하고, app-layer에서 service account 검증 (Bearer JWT 의 `email` claim 화이트리스트)을 task 2 acceptance로 추가.

- **[24-04] Queue 자체 endpoint의 layered defense** — `/queue/...:enter`가 24-05의 traffic-defense 정책 (`queue-entry` named limit) 적용 대상이지만, queue 진입 전에는 admission token도 없음. user-id-only 또는 IP-only fallback 시 large fandom traffic 효과 떨어짐. **권장**: 24-05 task 1 acceptance에 "queue-entry는 인증된 userId 우선, fallback으로 session cookie + IP combined"를 명시.

- **[24-13] QR JWT secret rotation 정책 미정** — `qrTokenJti` + `secretVersion` 칼럼은 있지만 rotation 절차 없음. 회전 후 기존 QR invalid 되면 사용자 D-1 email 깨질 수 있음. **권장**: 24-13 task 1에 "verify는 secretVersion 별 키링에서 lookup, issue는 latest secret 만 사용" 정책을 acceptance에 명시.

- **[24-15] floor SVG upload 시 unique constraint 검증 누락** — admin이 같은 floorKey를 여러 row로 업로드하는 시나리오 방어 미명시. 24-02 schema는 `(performanceId, floorKey)` unique를 암시하지만 plan acceptance에는 admin UX-level 가드 없음. **권장**: `floor-seat-map-editor.tsx`에서 floorKey 중복 client-side validation, server-side는 24-06 task 2에서 unique violation 매핑.

- **[24-02] payment_webhook_events ledger 필드 부족** — task 2 acceptance가 "unique event id" 만 요구. 표준 webhook ledger는 `eventId`, `eventType`, `payload`, `receivedAt`, `processedAt`, `processingResult` 필요. 향후 reconciliation/debug 시 부족. **권장**: 24-02 task 2에 표준 ledger 칼럼 set 명시.

- **[24-10 + 24-17] payment 복구 UI 분리의 복잡성** — payment deadline UI (24-10 wave 7) 와 recovery UI (24-17 wave 8) 가 같은 `complete/page.tsx` 와 `use-booking.ts` 를 wave 차이로 수정. 둘 다 i18n key namespace 공유. wave 7 → 8 사이 머지 충돌 위험. **권장**: 24-10 task 2가 추가하는 i18n key set를 24-17이 재사용한다는 점을 frontmatter에 명시하거나, 두 plan을 동일 wave로 묶는 것 검토.

### LOW

- **[24-02] schema 필드 naming 혼재** — `held_cancelled` (snake_case)와 `floorKey`/`seatKey` (camelCase)가 acceptance 문구에서 혼용. Drizzle은 둘 다 가능하지만 일관성 권장.
- **[24-12] admin manual-open audit 누락** — backend exception path에 audit log 미언급. Phase 25 audit가 다룰 가능성 있지만 24-12에서 최소한의 `operator_audit_log` 행 INSERT 권장 (Phase 25 console이 클릭 정보 추가).
- **[24-13] QR_TICKET_SECRET 별도 분리는 옳지만 secret 길이/엔트로피 요구 미명시** — `≥256 bits HS256` 권장 명시 가치 있음.
- **[24-16] 7층 × 다좌석 booking summary overflow** — UX-spec 부족. UI-SPEC.md를 못 봤지만 plan에 fallback 표기 없음.
- **[24-08] localized retry/challenge/blocked copy의 보안 leakage 검증** — "challenge" 와 "block"의 구분이 attacker hint 가 될 수 있음. T-24-15 mitigation에 "raw internal token 미노출" 만 있고 message wording 검토 없음.
- **[24-17] expired payment 의 사용자 경로** — recovery UI가 expired 상태를 보여주지만 다음 액션 (재예매? 환불 안내?)이 acceptance에 미명시.
- **[24-03] migration 적용 실패 시 rollback 절차** — plan은 "redacted failure record"만 명시. local rollback은 expand-only이므로 큰 위험은 아니지만 production 적용은 Phase 26 일임을 cross-ref 권장.

---

## 4. Suggestions

1. **24-13 의존성 정정**: `depends_on: ["24-09", "24-11"]`로 변경하고 wave 7 또는 8로 이동. complete-page QR UI piece는 24-17 task에 합치거나 24-13 task 2로 유지.
2. **24-09 task 분할**: (a) Toss client branching + payment.service, (b) webhook controller + idempotency ledger, (c) reservation orchestration의 3개 task로 분할. 각 task에 별도 spec.
3. **3종 timer invariant 명시**: 새 plan 24-09a 또는 24-09 task 2 확장으로 `paymentDeadlineAt`, `lockExpiresAt`, `admissionExpiresAt` 의 cascade 정책을 spec + test 로 lock.
4. **Admission token shape 결정**: 24-04 acceptance에 token type (예: opaque random + Redis lookup), cookie attributes (`HttpOnly; Secure; SameSite=Lax; Path=/`), domain scope 명시.
5. **Queue transport lock**: 24-04에 "Socket.IO `queue` namespace, events: `queue:position`, `queue:admitted`, `queue:expired`" 결정 명시. 24-08 use-queue.ts는 이 contract 구독.
6. **Amount tampering test**: 24-09 task 2에 "Toss redirect callback 의 `amount` ≠ `prepared.totalPrice` 시 confirm 거부" test case 추가.
7. **Showtime guard for delayed reopen**: 24-11 worker spec에 "if `now + delay > showtime - 5min` then mark seat as terminally held (no reopen)" 정책 추가.
8. **Prewarm IAM layered defense**: 24-05 dashboard_config에 Cloud Scheduler OIDC service account 명시 + service-side OIDC 토큰의 audience/email 검증 acceptance 추가.
9. **payment_webhook_events 표준 ledger**: 24-02 task 2에 `eventId UNIQUE`, `eventType`, `payload JSONB`, `receivedAt`, `processedAt`, `processingResultCode` 칼럼 명시.
10. **24-08 verify 정정**: `apps/web/hooks/__tests__/use-queue.test.tsx` 신규 추가 + task 1 verify에 포함.
11. **24-13 secret rotation 절차**: `secretVersion` 멀티-키 verify, latest-only sign 정책 acceptance에 명시. `QR_TICKET_SECRET_VERSION` env가 array/JSON 으로 다중 키 표현 가능하도록 명시.
12. **24-15 floorKey 중복 가드**: floor-seat-map-editor 에 client-side `floorKey` uniqueness check 추가 + server-side는 24-06 admin.service가 unique violation을 명시적 422 매핑.
13. **24-12 audit row**: `operator_audit_log` 또는 동등 테이블에 `operator_user_id`, `action="manual_open"`, `seatKey`, `reservationId`, `timestamp` 행을 INSERT 하는 acceptance 추가 (Phase 25 console이 view).
14. **i18n key namespace 정리**: 24-08 `queue.*`, 24-10 `payment.deadline.*`/`payment.disclaimer.*`, 24-17 `payment.recovery.*` 의 key 트리를 명시 — wave 7-8 동시 작업 충돌 방지.
15. **Toss cancel transient failure 정책**: 24-11 task 1에 "HTTP 5xx/timeout 시 refund state는 `sent_to_pg` 유지하고 pg-boss retry job 으로 enqueue" 정책 acceptance 추가.

---

## 5. Risk Assessment — **MEDIUM-HIGH**

### Justification

- **Surface criticality**: Phase 24가 다루는 영역은 v2.0 모든 다른 phase 가 의존하는 사용자 critical path 이며, 단 한 개의 admission bypass·duplicate refund·QR forgery 도 단일 critical incident 0건 목표 (PROJECT.md L13)와 직결된다.
- **Coupling complexity**: 17 plans × 10 waves의 복잡도는 1인 개발 컨텍스트 (PROJECT.md constraints)에서 deviation 위험이 높다. 24-09/24-13의 의존성 부정확과 task 비대화가 실행 시 wave 재정렬 또는 mid-execute checkpoint를 강제할 수 있다.
- **Mitigations**: 24-01 RED gate, 24-03 expand-only gate, 24-09 webhook idempotency, 24-11 randomized hold 등 RESEARCH의 식별된 위험에 대한 first-class 가드는 강력하다. Phase 23 launch foundation 의 모든 prerequisite는 이미 closed (`READY_WITH_ACCEPTED_RISKS`).
- **Net assessment**: 위험은 mitigations 보다 약간 우세 — Section 4의 1·3·5·6·9·15 (HIGH/MEDIUM 권장 변경)을 plan-amend 형태로 반영하면 **MEDIUM** 으로 하향 가능. 미반영 시 **HIGH** 진입 위험.

### Recommended Action Before Execution

1. Section 4의 HIGH severity 권장 (1·3·5·6) 4건을 plan-amend 라운드로 반영.
2. 3종 timer invariant 와 admission token transport spec을 별도 architecture note 로 lock — 이 두 결정은 plan 6+에서 암묵 가정되고 있다.
3. 24-09 의 webhook idempotency replay test를 Phase 24 의 phase-gate 검증에 명시적으로 포함 (Phase 24 verify-work 가 이를 강제).
4. 24-11 의 showtime guard 와 Toss transient failure 정책을 추가 후 execute.


---

## Cursor Review

Cursor review failed with exit code 1.

Error: Authentication required. Please run 'cursor agent login' first, or set CURSOR_API_KEY environment variable.


---

## Consensus Summary

Only one external reviewer completed successfully, so this is not a true multi-reviewer consensus. The items below synthesize the completed Claude review into planning feedback that should be fed into `$gsd-plan-phase 24 --reviews`.

### Agreed Strengths

- Contract-first design is strong: `24-01` establishes DTO/zod contracts before downstream implementation.
- Migration discipline is explicit: `24-03` keeps expand-only schema changes gated before runtime work.
- The plans correctly elevate admission, webhook idempotency, async payment branch handling, and delayed cancelled-seat release as first-class risks.

### Agreed Concerns

- `24-13` depends on `24-17`, delaying QR issuance behind payment recovery UI even though QR should depend primarily on payment/refund backend readiness.
- `24-04`, `24-08`, `24-09`, and `24-10` need a locked transport/timer contract for admission token, queue progress, payment deadline, seat lock TTL, and admission window.
- `24-09` is too broad for one task and needs stronger verification for sync/async Toss branching, webhook replay/idempotency, out-of-order events, and redirect amount tampering.
- `24-11` should define transient Toss cancel failure handling and showtime-adjacent delayed reopen behavior.
- `24-08` references the wrong hook test path and should add `use-queue` test coverage explicitly.

### Divergent Views

- No divergent reviewer views were available because Cursor failed authentication and no second external reviewer completed.
