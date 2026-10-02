# 2026-10 오픈 감사 수정의 운영 후속 조치

기준: `output/audit/grabit-open-audit-2026-09-30.md`(검증된 발견 174건)를 고친 통합 브랜치 `ps/fix/open-audit-remediation`. 코드로 할 수 없는 운영 조치만 모았다. 29개 작업 단위 보고서의 운영 후속 항목을 합치고, 통합 과정에서 코드로 해결된 항목은 뺐다. 각 항목 끝의 `#번호`는 감사 발견 번호다.

- 운영 DB 쓰기, Cloud Run·Secret Manager·repository variable 변경, 공급자 콘솔 변경은 승인된 절차로만 한다. read-only 쿼리도 승인된 접근 경로(Cloud SQL Auth Proxy)로 실행하고 고객 식별자를 문서·채팅에 옮기지 않는다.
- 자세한 절차가 다른 runbook에 있으면 링크만 둔다. 이 문서는 순서와 빠짐없는 목록을 맡는다.
- 체크한 결과는 실행 시각, 실행자, 대상 환경과 함께 [오픈 evidence gate](ticketing-open-evidence-gates-2026-06-03.md)의 증거로 남긴다. 미실행 항목은 pass가 아니다.

## 1. 배포 전

### 1.1 배포 창과 deploy 설정

- [ ] 배포 창을 판매·대기열·현장 입장·결제 피크 밖으로 잡는다. 첫 배포는 migration 0038–0046 아홉 개를 한 transaction으로 적용하며 `reservation_seats`, `payments`, `users`, `reservations`, `ticket_benefits`, `seat_inventories`, `ticket_scan_events` 쓰기를 잠시 막는다. 잠금 영향, 행 수·활성 트랜잭션 확인, `CONCURRENTLY` 선생성 선택지는 [감사 migration batch 첫 배포](show-relaunch-reliability.md#2026-10-감사-migration-batch00380046-첫-배포)를 따른다. #59 #60 #62 #68 #47 #165 #24 #113 #99
- [ ] repository variable `BOOKING_ENABLED`를 지금 live API·Web 값과 같게 맞춘다. 새 Deploy workflow는 live `false`(또는 읽을 수 없는 값)를 `true`로 바꾸는 배포를 DB 변경 전에 실패시킨다. 변수가 비어 있으면 `true`로 배포한다. #64
- [ ] 배포 서비스 계정이 `grabit-api`와 `grabit-web`을 읽을 수 있는지(`run.services.get`) 확인한다. booking gate 확인은 두 서비스의 live 값을 읽지 못하면 배포를 실패시킨다. #64
- [ ] `MIGRATION_FREEZE`가 배포 창에서 `false`인지 확인한다. 창 밖에 main merge가 일어날 수 있으면 `true`로 두어 batch가 자동 적용되지 않게 한다. #60
- [ ] Abandoned payment handoff review 첫 rollout을 단계로 나눈다: `PAYMENT_HANDOFF_ABANDON_SWEEP_ENABLED=false`로 먼저 배포하고 후보 수를 read-only로 센 뒤, Toss 키 권한을 확인하고 승인 후 해제한다. [First rollout of the review](managed-demo-cost-floor.md#relaunch-incident-regression-requirement). #9
- [ ] Edge client IP 신뢰 rollout step 0: 현재 운영 API(이전 코드)에 위조 `True-Client-IP`/`X-Forwarded-For` probe를 두 번 보낸다. 값이 계속 줄면 일반 배포로 진행하고, 값이 같으면 Worker secret과 API binding을 이번 코드와 같은 배포에 넣는다. `EDGE_PROXY_SHARED_SECRET`은 Deploy workflow에 연결돼 있지 않으므로 Secret Manager secret을 만든 뒤 API 서비스에 직접 binding한다. [Client IP trust](managed-demo-cost-floor.md#phase-4--cloudflare-edge-proxy-and-load-balancer-retirement). #152 #158

### 1.2 운영 DB read-only 점검

결과가 0행이 아니면 오른쪽 조치를 배포 전에 끝내거나, 배포 후 처리로 기록한다.

| 점검 | 쿼리·절차 | 0행이 아닐 때 | 감사 |
| --- | --- | --- | --- |
| 공연 허용 결제수단 | [결제수단 정책](show-relaunch-reliability.md#결제수단-정책-70)의 LEFT JOIN 쿼리. 먼저 Toss 위젯 `DEFAULT`·`uspay`에서 켜진 수단으로 기준 목록을 정한다(2026-09-21 기준 `CARD`·`TRANSFER`·`FOREIGN_EASY_PAY`). 이어서 공연 `booking_policies`와 미반영 `performance_drafts.data`의 `allowedPaymentMethods`에 `VIRTUAL_ACCOUNT`·`MOBILE_PHONE`이 있는지 확인한다: `SELECT performance_id, allowed_payment_methods FROM booking_policies WHERE allowed_payment_methods ? 'VIRTUAL_ACCOUNT' OR allowed_payment_methods ? 'MOBILE_PHONE';`와 `SELECT id, performance_id, owner_user_id FROM performance_drafts WHERE applied_at IS NULL AND (data->'bookingPolicy'->'allowedPaymentMethods' ? 'VIRTUAL_ACCOUNT' OR data->'bookingPolicy'->'allowedPaymentMethods' ? 'MOBILE_PHONE');` | 관리자 공연 편집에서 결제수단 저장. 정책 행이 없으면 `CARD`만 허용된다. 국내 간편결제는 배포 직후(2.2). 배포 후 서버는 관리자 화면에 없는 `VIRTUAL_ACCOUNT`·`MOBILE_PHONE`을 저장하지 않는다(400). 두 수단이 남은 공연은 다시 저장하고, 남은 초안은 작성자가 열어 다시 저장한 뒤 반영한다(그대로 반영하면 400, 화면이 두 수단을 지운다) | #70 |
| admission token 원문 | `SELECT count(*) FROM reservations WHERE admission_token IS NOT NULL AND admission_token NOT LIKE 'sha256:%';` | 많으면 승인된 DB 절차로 batch 선변환([migration 0039](show-relaunch-reliability.md#migration-0039-6268)) | #68 |
| 결제 기한이 지난 고아 handoff | [First rollout of the review](managed-demo-cost-floor.md#relaunch-incident-regression-requirement)의 후보 쿼리 | 운영자가 건수를 승인한 뒤 review 활성화 | #9 |
| 금액 불일치로 거절된 과거 async DONE | [Read-Only Query Shapes](live-foreign-payment-cancel-uat-2026-06-03.md#read-only-query-shapes)의 async DONE 쿼리(`async_status='payment_amount_mismatch'`) | Toss 조회가 `DONE`이면 수동 환불 여부 결정. 이미 처리된 ledger라 배포만으로 자동 환불되지 않는다 | #75 |
| 권리 미복원 `failed` 환불 | [Refund retry triage](ticket-cancellation-reconciliation.md#refund-retry-recovery-and-held-seats-2026-10) 첫 쿼리(`failed`, `rightsRestoredAt` 없음) | 건별로 관리자 `환불 처리` 재실행 여부 결정. sweep은 이전 `failed`를 자동 재개하지 않는다 | #22 #53 |
| 과거 경합으로 남은 QR | `SELECT t.id, t.ticket_item_id, ti.status FROM tickets t JOIN ticket_items ti ON ti.id = t.ticket_item_id WHERE t.status = 'active' AND ti.status <> 'active';` | [취소 대조 runbook](ticket-cancellation-reconciliation.md)으로 건별 정리 | #110 |
| QR keyring 범위 | `SELECT secret_version, status, count(*) FROM tickets WHERE status IN ('active','used') GROUP BY 1,2;` | 모든 version이 `qr-ticket-secret-keyring-json`(또는 현재 version)에 있는지, keyring의 현재 version 값이 `qr-ticket-secret`과 같은지 확인 | #109 |
| 좁힌 목록을 가진 superuser | `role='admin' AND admin_capability_bundle='admin' AND admin_capabilities <> '[]'` 계정, 특히 공용 scanner 계정 | 승인된 절차로 `scanner` 등 비-admin 번들로 변경(배포 후에는 관리자 화면에서 가능) | #42 #25 |
| 권한 위임 보유자 | `security.manage`를 가진 비-superuser 계정 | 배포 후에는 자기에게 없는 권한 부여와 superuser 변경이 막힌다. 담당자에게 알린다 | #120 |
| custom 현장 계정 | `field.scan.sync`만 있고 `field.scan.consume`이 없는 계정 | 오프라인 동기화가 403이 되므로 두 권한을 함께 부여 | #111 |
| 대시보드 권한 | 번들 없이 custom capability만 있고 `reservations.read`가 없는 관리자 | `/admin/dashboard/*`가 403이 된다. 필요하면 권한 추가 | #38 |
| 특전 상호배타 설정 | 아래 SQL | 다음 live run 전에 해당 회차 특전 설정을 다시 저장 | #130 |
| 가격·등급명 | `SELECT performance_id, tier_name, price FROM price_tiers WHERE price <= 0 OR tier_name <> btrim(tier_name);`와 `SELECT performance_id, floor_key FROM seat_maps, jsonb_array_elements(seat_config->'tiers') t WHERE t->>'tierName' <> btrim(t->>'tierName');` | 판매 보호 전에 수정. 보호된 공연은 폼에서 가격·좌석 구조를 바꿀 수 없다(422). 판매 보호 상태에서 0원 등급이 발견되면 폼으로는 어떤 편집도 저장할 수 없으므로(400/422), 승인된 DB 정정 절차(price_tiers UPDATE와 좌석 가격 영향 확인)로 가격을 바로잡은 뒤 편집한다 | #136 #124 |
| overlay 배정 누락 | 공연별 `performance_seat_assignments` 수와 `seat_maps.seat_config`의 seatIds 합계 비교 | 미보호 공연은 좌석맵을 다시 저장해 overlay 재구성 | #124 |
| 판매 시작이 지난 미게시 공연 | 미게시 공연 중 `booking_policies.booking_starts_at < now()` | 새 공개 승인 게이트가 막으므로 판매 시작을 다시 정한다 | #135 |
| 판매 시작 전인 판매 중 공연 | published이고 `status IN ('selling','closing_soon')`이며 `booking_starts_at > now()` | 배포 후 목록·검색·상세에서 `오픈예정`으로 보인다. 의도한 설정인지 운영자 확인 | #170 |
| 편집으로 바뀐 판매 상태 | `SELECT p.id, p.title, p.status, bp.booking_starts_at FROM performances p JOIN booking_policies bp ON bp.performance_id = p.id WHERE p.status = 'selling' AND bp.booking_starts_at IS NOT NULL;`. 배포 전 폼이 파생 상태 `selling`으로 저장한 미반영 초안도 찾는다: `SELECT d.id, d.performance_id, d.owner_user_id FROM performance_drafts d JOIN performances p ON p.id = d.performance_id WHERE d.applied_at IS NULL AND d.data->>'status' = 'selling' AND p.status = 'upcoming';` | `admin_audit_logs`의 `event.update`와 대조해 의도치 않은 것은 `판매 예정`으로 되돌림. 찾은 초안은 반영하면 `upcoming`이 `selling`으로 바뀌므로, 반영 전에 작성자가 판매 상태를 `판매 예정`으로 고치거나 초안을 폐기한다 | #145 |
| 배너 노출 집합 | `SELECT id, placement, status, starts_at, ends_at, is_active FROM banners ORDER BY sort_order;` | 배포 후 paused/draft/expired·기간 밖·홈 외 placement는 사라지고, 시작 시각이 지난 `scheduled`는 새로 보인다. 운영자 확인 | #51 |
| 원문 복사 번역 초안 | 아래 SQL | `published` 원문 복사본(marker 없음)을 먼저 다시 번역해 게시. marker 초안은 공개 화면에서 무시되고 한국어가 보인다 | #149 |

```sql
-- 특전: runner가 이제 거부하는 상호배타 설정
SELECT c.showtime_id, b.identity, b.kind, b.mutual_exclusion_group
FROM ticket_benefits b
JOIN ticket_benefit_configurations c ON c.id = b.configuration_id
WHERE b.mutual_exclusion_group IS NOT NULL
  AND (b.kind = 'included' OR EXISTS (
    SELECT 1 FROM ticket_benefits o
    WHERE o.configuration_id = b.configuration_id
      AND o.kind = 'included'
      AND o.identity = ANY(string_to_array(b.mutual_exclusion_group, ','))));

-- 번역: 원문 복사본 또는 manual-review marker 초안
SELECT d.id, d.status, d.target_locale, s.entity_type, s.entity_id, s.field
FROM translation_drafts d
JOIN translation_sources s ON s.id = d.source_id
WHERE (d.translated_text = s.source_text OR d.translated_text LIKE '[manual-review:%')
  AND d.status IN ('draft', 'review', 'published');
```

### 1.3 공급자 콘솔과 알림

- [ ] Toss: 국내·해외카드·해외간편결제 MID 모두에 `PAYMENT_STATUS_CHANGED` webhook URL과 서명 secret이 등록·일치하는지, 최근 `EXPIRED/ABORTED` 이벤트가 `payment_webhook_events`에 처리 완료로 쌓이는지 확인한다. 고아 handoff review의 45분 grace는 이 webhook을 전제로 한다. #73 #9
- [ ] Toss: 위젯 variant(`DEFAULT`, `uspay`)에 가상계좌 등 비동기 입금 수단을 켜지 않는다. `uspay`의 TrueMoney·PayPay는 비활성으로 둔다. #74 #86
- [ ] Toss: 설정된 모든 secret key(`TOSS_SECRET_KEY`, `TOSS_OVERSEAS_CARD_SECRET_KEY`, `TOSS_FOREIGN_EASY_PAY_SECRET_KEY`)로 `GET /v1/transactions`가 200 배열과 응답 시간을 돌려주는지 테스트 상점에서 확인한다. 권한이 없으면 review는 아무 주문도 실패 처리하지 않고 30분마다 미루기만 한다. #9
- [ ] Toss에 문의해 기록한다: ABORTED된 해외간편결제 취소를 새 `cancelRequestId`(`-r<n>`)로 다시 요청해도 되는지, 한 orderId에 서로 다른 paymentKey 두 건이 승인될 수 있는지. #76 #85
- [ ] Twilio: Verify rate limit, 잔액·사용량·비용 알림, 상한 있는 자동 충전, 좁은 Geo Permissions를 확인한다. #36
- [ ] Cloudflare: `/api/v1/auth/*`(login, register, password-reset, email-verification/*)와 `/api/v1/sms/send-code`에 rate-limit 규칙 또는 Turnstile을 검토한다. 공개 카탈로그 read(`/api/v1/performances*`, `/api/v1/home/*`)는 NAT를 고려한 높은 한도로 검토한다. Resend 발송량·429 알림을 건다. #5 #12 #36 #52
- [ ] Cloudflare: `heygrabit.com/api/runtime-flags`를 캐시하지 않는지 확인한다(`Age` 없음, `cf-cache-status`가 `HIT` 아님). 캐시되면 브라우저 시계 보정이 꺼진다. #67 #95 #97
- [ ] Sentry(API·Web 프로젝트): Data Scrubber와 Default Scrubbers를 켜고 Additional Sensitive Fields에 `phone`, `paymentKey`, `refreshToken`, `tossWebhookSecret`, `ticket`을 넣는다. 새 `http.status_code:500` 이벤트와 `toss.code` 502 급증 alert rule을 만들고 dry-run한다. spike protection과 rate limit을 확인한다. #155 #156 #118
- [ ] Cloud Monitoring: Cloud Run API 5xx 비율 알림 정책을 Sentry와 별도로 만든다. #156
- [ ] Cloud Logging log-based alert를 아래 문자열에 건다. 결제 계열은 [결제 승인 확인 계약](show-relaunch-reliability.md#결제-승인-확인-계약-2026-09-30-오픈-감사-반영)과 [handoff review](managed-demo-cost-floor.md#relaunch-incident-regression-requirement)에 대응 절차가 있다. #1 #18 #72 #73 #75 #76 #85 #9 #146 #109
  - `PAYMENT_CONFIRM_OUTCOME_UNKNOWN`(reason에 `closed_showtime_lookup_failed`, `pre_approval_<gate>_lookup_failed`, `finalization_commit_unverified` 포함)
  - `CRITICAL: provider approval does not match the order`, `CRITICAL: order committed with another payment`, `CRITICAL: compensation cancel failed`
  - `CRITICAL: payment confirm reconcile not scheduled`, `CRITICAL: payment confirm reconcile enqueue failed`, `CRITICAL: PAYMENT_CONFIRM_RECONCILE_EXHAUSTED`
  - `Async DONE compensation needs operator reconciliation`, `Duplicate DONE payment for an already settled order`, `PayPal DONE webhook charge does not match`, warn `Async DONE compensation provider query failed`
  - `CRITICAL: provider transaction exists for an unrecorded payment handoff`
  - `catalog cache generation bump failed after retry`(발생하면 Valkey 복구 뒤 해당 공연·배너를 관리자 화면에서 다시 저장)
  - `missing secret versions still used by issued tickets`, `differs from QR_TICKET_SECRET`, `QR secret keyring coverage check failed`, `QR secret keyring conflict check failed`
- [ ] Memorystore 유지보수 알림을 on-call 주소로 구독한다. 공지는 구독자에게만 최소 1주 전에 온다. #63

### 1.4 CS·운영 안내

- [ ] CS 문구를 준비한다: 결제 대기·예정 공연 예매가 있는 회원은 취소·환불 뒤에만 탈퇴된다(API 409). 같은 인증 휴대폰의 다른 계정 구매·결제 대기도 1인 매수 제한에 합산된다(409). Naver로 새로 가입한 실제 이메일 계정과 provider 이메일이 다른 연결 계정은 예매 전에 `/auth/verify-email`을 거친다. #44 #62 #100
- [ ] 현장 책임자에게 결과 제목 `취소 처리 중 · 입장 불가`의 의미(환불 미확정, 입장 금지, 예매번호·좌석 기록 후 책임자 연결)를 공유한다. [좌석별 현장 검표](seat-level-field-operations.md). #115

## 2. 배포 직후

### 2.1 배포 결과 확인

- [ ] 첫 Deploy run의 `Guard sitewide booking gate`, `Database preflight`(PGOPTIONS readback, freeze, connection budget), deploy-api·deploy-web의 `Re-check sitewide booking gate before deploy` 결과와 step summary를 확인한다. #60 #64
- [ ] edge secret을 이번 배포에 넣었거나 IP 신뢰 코드가 처음 나간 경우, 새 API revision이 트래픽을 받자마자 two-network check와 위조 header probe를 실행한다. 실패하면 즉시 `gcloud run services update-traffic grabit-api --to-revisions=<이전 revision>=100`. 이후 회전·rollback 순서는 [Client IP trust](managed-demo-cost-floor.md#phase-4--cloudflare-edge-proxy-and-load-balancer-retirement)를 따른다. Worker rollback이나 LB fallback 전에는 API binding을 먼저 제거한다. #152 #158
- [ ] API·worker 기동 로그와 Sentry에 QR keyring 경고(1.3의 마지막 네 문자열)가 없는지 확인한다. #109

### 2.2 DB 후속 (승인된 운영 DB 절차)

- [ ] 새 API revision이 트래픽 100%를 받은 뒤 0039의 admission token `UPDATE`를 한 번 더 실행하고 1.2의 확인 쿼리가 0인지 본다. 이어서 `VACUUM (ANALYZE) reservations;`. [migration 0039](show-relaunch-reliability.md#migration-0039-6268). #68
- [ ] `pg_indexes`에서 `idx_users_verified_phone_suffix`와 `idx_reservation_seats_reservation_id` 2행을 확인한다. `EXPLAIN SELECT * FROM reservation_seats WHERE reservation_id = $1`이 그 인덱스를 쓰는지 본다. #62 #59
- [ ] 0044 적용 후 배포 전 행 중 `ticket_scan_events.requested_showtime_id`가 NULL인 행이 없는지 확인한다(rollout 중 이전 API가 쓴 행만 NULL일 수 있고 조회는 `showtime_id`로 대체한다). #113 #114
- [ ] 기준 결제수단 목록에 `SIMPLE_PAY`가 있으면 공연마다 관리자 공연 편집에서 `국내 간편결제`를 체크해 저장하고 1.2의 결제수단 쿼리를 다시 실행해 0행을 확인한다. #70
- [ ] 0041 적용 후 예전 편집·검수 동작으로 숨겨진 공지를 찾아 게시할 것은 다시 게시한다: `SELECT id, locale, category, title FROM support_notices WHERE status='published' AND review_state<>'published';`. FAQ는 탐지할 수 없으므로 관리자에서 `게시 가능`으로 보이는 FAQ를 검토한다. #48
- [ ] 기존 공지는 번역 그룹이 없어 언어 대체가 되지 않는다. 오픈용 긴급·결제·점검 공지는 `번역본 등록`으로 en·th·zh-CN을 연결한다. #168
- [ ] quote 없이 들어온 PG 취소의 차액 기록(`provider_metadata ? 'quotelessCancellationReconciliation'`, [triage 쿼리](ticket-cancellation-reconciliation.md#refund-retry-recovery-and-held-seats-2026-10))을 재무가 `UNATTRIBUTED`/`UNVERIFIED`별로 귀속한다. #81
- [ ] [미인증 소셜 계정 점검](auth-session-operations.md#read-only-unverified-social-account-check)을 실행해 기준값을 남긴다. `placeholder_repaired_on_login`과 `social_only_real_email`은 로그인할 때 줄어든다. #100
- [ ] Cloud Run API에 `DEEPL_AUTH_KEY`가 있는지 확인한다(Deploy workflow에 연결돼 있지 않다). 자동 번역이 필요하면 DeepL Free 키(`:fx`)를 Secret Manager로 API 서비스에 binding한다. 없으면 초안마다 직접 번역해야 한다. #149

### 2.3 live smoke

- [ ] 지난 회차의 seat lock·prepare가 403이다. #2
- [ ] 정책에 없는 결제수단을 고르면 좌석을 유지한 채 결제 단계 안내가 나오고 다른 수단으로 결제할 수 있다. 관리자 공연 편집에 결제수단 체크박스가 4개(국내 간편결제 포함)다. #70
- [ ] 같은 인증 휴대폰의 두 번째 계정은 첫 계정이 결제 진행 중일 때 lock이 409다. #62
- [ ] `/th` 경로 confirm 결과 화면에 번역된 공연명이 보인다. #88
- [ ] 판매 전 공용 scanner 계정의 `POST /api/v1/queue/performances/:id/enter`가 403이다. Admin Pre-Open Booking Smoke 계정은 `admin` 번들이거나 번들·명시 capability가 없는 legacy admin이다. #25
- [ ] `curl -sSI https://heygrabit.com/api/runtime-flags`가 `cache-control: no-store`이고 본문에 `serverNow`가 있다. #67 #97
- [ ] 관리자 Sentry 테스트 endpoint(`GET /api/v1/admin/_sentry-test`)로 이벤트를 보내 Sentry UI에서 `Authorization`·`Cookie`가 `[Filtered]`이고 DB 오류 이벤트 값이 `params: [Filtered]`로 끝나는지 확인한다. #155 #156

### 2.4 1–2일 관찰

- [ ] 첫 worker 실행 로그에서 `Released held_cancelled seats whose release job did not run`과 `Recovered stale refunds`를 확인한다. 기존 `JOB_ENQUEUE_FAILED` 좌석과 고아 환불이 자동 처리된다. #24 #53
- [ ] background worker Job 실행 시간을 본다. 고아 handoff 검토 예산 65초와 처리 창 30초가 Job timeout 120초 안에 들어가도록 설계됐다. #9 #154
- [ ] 429 비율과 `Retry-After` 분포, 대기열 진입 400/404/403 `errorCode` 분포를 본다. 잘못된 ID가 더 이상 500을 내지 않아야 한다. `/api/v1/support-content`(추적 단위당 분당 120회)의 공유 NAT 사용자 429도 본다. #5 #158 #90 #132
- [ ] `<provider> OAuth callback rejected: <reason>` warn 로그를 reason별로 본다. 모바일에서 `missing_nonce_cookie` 비중이 계속 높으면 인앱 브라우저 전환이 로그인을 깨는 것이다. #37
- [ ] `GET /api/v1/admin/bookings`의 503과 지연을 본다. 조건 없는 조회가 자주 503이면 운영자에게 공연·회차를 먼저 고르도록 안내한다. #127
- [ ] Valkey active set 크기와 confirm 403 비율이 줄었는지, 이전 build의 `{queue:*}:eta-origin:*` 키가 남지 않았는지 본다(남아도 2시간 안에 만료). #4 #26 #91
- [ ] worker 로그에서 같은 jobId의 `QR reminder claimed` 뒤에 `QR reminder sent`가 없는 건(유실된 reminder)을 본다. `superseded job`, `claimed by another worker` skip은 무해하다. #107
- [ ] Valkey 메모리: `{payment-confirm-attempt}:*`(confirm마다 30분), `{payment-handoff-review}:*`, `cache:admin:bookings:aggregates:v1:*`(30초), `seat-status-cache:*`(1초) 키와 seat-status 재계산 빈도(인스턴스·회차당 초당 1회 이하)를 지표에 넣는다. #9 #127 #8

## 3. 오픈 리허설

판매 용량 복원 순서와 명령은 [Restore for an actual ticket opening](managed-demo-cost-floor.md#restore-for-an-actual-ticket-opening)을 따른다. 여기서는 감사 수정으로 생긴 조건을 덧붙인다.

### 3.1 용량과 설정

- [ ] 시작할 때 [kill switch](managed-demo-cost-floor.md#sitewide-booking-kill-switch)로 sitewide gate를 닫는다: variable `BOOKING_ENABLED=false` 먼저, 그다음 live API → Web → worker. 진행 중 Deploy run이 있으면 끝난 뒤 runtime flag와 403을 다시 확인한다. #64
- [ ] 대상 Cloud SQL에서 `SHOW max_connections;`와 `SHOW superuser_reserved_connections;`를 읽어 [connection budget](managed-demo-cost-floor.md#postgresql-connection-budget)에 넣는다. `DB_POOL_MAX`, `PGBOSS_POOL_MAX`, `DB_CONNECTION_RESERVE`(rollout 중첩분 포함)를 정하고 `DB_CONNECTION_BUDGET_ENFORCE=true`로 둔다. #17 #54 #58
- [ ] `DB_STATEMENT_TIMEOUT_MS`·`DB_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS`를 부하 근거로 정한다. idle 한도는 트랜잭션 안 Toss 호출보다 길게(시작값 `120000`), statement 한도는 가장 느린 export와 특전 변경의 30초 이상으로 둔다. 근거가 없으면 비워 둔다. #57 #58
- [ ] Valkey 판매 posture: replica 1개 이상, `MULTI_ZONE`, 오픈·입장일을 피한 weekly window, `maxmemory-policy=noeviction`. `verify-valkey-sale-posture.mjs` 결과를 Gate 5 증거로 남기고, 겹치는 `maintenanceSchedule`은 reschedule한다. Valkey smoke를 돌리는 운영자 계정에는 `redis-url` secret 버전 읽기 권한(`secretmanager.versions.access`)이 필요하다. 메모리 경보도 건다. #63 #160 #52
- [ ] WebSocket을 포함해 API 용량을 정한다: `API_MAX_INSTANCES × API_CONCURRENCY ≥ 1.5 × (대기 인원 + 2 × 입장 인원 + 최대 동시 HTTP)`. #61
- [ ] SMS: API 서비스에 `SMS_ALLOWED_COUNTRIES`(현재 `KR,TH,CN`과 새 지원 국가), `SMS_GLOBAL_SEND_LIMIT_PER_MINUTE`·`SMS_GLOBAL_SEND_LIMIT_PER_HOUR`(기본 300/분, 3000/시간)를 예상 신규 가입량에 맞춰 repository variable로 둔다. 기동 로그 `sms.allowed_countries_unset`이 없어야 한다. 장애 때 번호별 제한만 끄는 스위치는 `SMS_LOCAL_RATE_LIMITS_ENABLED=false`다. #36
- [ ] 대형 판매는 `booking_policies.booking_starts_at`을 지정한다. 판매 시각 없이 수동으로 열면 오픈 전 페이지가 약 15초마다 대기열 진입을 다시 시도한다. #33
- [ ] `ASYNC_DONE_COMPENSATION_RECOVERY_INTERVAL_MS`(기본 60000)를 판매 posture에서도 유지할지 정한다. Deploy workflow에 연결돼 있지 않으므로 바꾸려면 API 서비스에 직접 설정한다. #76

### 3.2 Prewarm과 Gate Ledger

- [ ] PAUSED 상태의 `grabit-prewarm-scale-up`·`grabit-prewarm-step-down` Scheduler job body에 남은 `minInstances`(과거 상한 100 기준)를 `API_MAX_INSTANCES` 이하로 고친다. 넘으면 이제 400으로 거부된다. #150
- [ ] 한산한 시간에 [prewarm live verification](managed-demo-cost-floor.md#prewarm-live-verification)을 한다: Cloud Audit의 `UpdateService`에 `scaling.minInstanceCount`가 기록되고 새 revision이 없으며 v2 API readback이 맞는지. 거부되면(`503 PREWARM_SCALE_UPDATE_FAILED:400`) `PREWARM_SCALING_SCOPE=template`으로 재배포하고 service-level 최소값을 `--min=0`으로 정리한다. #150
- [ ] `/admin/cutover`를 go/no-go에 쓰려면 이번 오픈을 지정한 새 ledger를 Secret Manager에 넣고 `/secrets/grabit-cutover/ledger.json`에 mount한 뒤, `--no-traffic --tag=ledger-check` revision에서 `opening.id`와 `freshness.state: fresh`를 확인하고 트래픽을 옮긴다. 그다음 repository variable `CUTOVER_GATE_LEDGER_PATH`를 설정한다. 쓰지 않으면 공연별 공개·판매 상태·판매 시각 확인과 owner 승인을 Gate 1 waiver로 기록한다. [절차](managed-demo-cost-floor.md#restore-for-an-actual-ticket-opening) 12단계. #137 #142

### 3.3 부하 리허설

- [ ] [전용 테스트 공연 부하 gate](phase26-cutover-ops.md#dedicated-test-event-load-gate)를 준비한다: 목표 VU 이상의 합성 구매자(`provision-load-buyers.mjs`, 실행 직전 발급), VU별 좌석 풀(pg-stub이면 VU × 구매 수 이상), 남은 좌석 1,000석 이상인 테스트 공연, marker로 시작하는 공연명. 실제 구매자 계정을 쓰지 않는다. #65 #167
- [ ] confirm을 측정하려면 `scripts/revamp/pg-stub-preload.mjs`(`GRABIT_PG_STUB=isolated-load-test-only`)를 preload한 운영 동등 격리 배포가 필요하다. 현재 API 이미지에는 `scripts/`가 없을 수 있다. 대상이 없으면 LOAD gate는 `BLOCKED`이고 owner의 `ACCEPTED_RISK`가 필요하다. #65
- [ ] 같은 회차 동시 confirm 시나리오에서 `application_name`별 `pg_stat_activity`, `timeout exceeded when trying to connect` 로그 0건, `wait_event`(`Lock:tuple`/`transactionid`), confirm p95를 기록한다. 로컬 isolated-capacity 1,100세션에서 드러난 같은 회차 confirm 직렬화(p95 5.1s, pool 2)를 운영 동등 환경에서 다시 판정한다. #17 #54 #56 #58 #167
- [ ] 30분이 넘는 대기 시나리오(목표 동시 대기 인원·회차별 좌석 수)에서 sliding 세션 유지, 구매 후 slot 반환 처리량, 초당 1회 reconcile 아래 입장 속도, 대기 WebSocket 동시 연결 수를 확인한다. 판매 시각 없는 수동 오픈 모드도 포함한다. #4 #61 #89 #33
- [ ] 부하 후 즉시 `provision-load-buyers.mjs cleanup`, 테스트 공연 정리 SQL(dry-run 수치 그대로) 뒤 `cleanup --delete-users`. [cleanup](phase26-cutover-ops.md#dedicated-test-event-cleanup). #164
- [ ] privacy·pipa_required `2026-04-28` 동의 행 비활성화(4.1)는 부하 gate 뒤로 미룬다. k6 스크립트는 모든 동의 항목에 같은 version(기본 `2026-04-28`)을 보내므로 비활성화 뒤에는 prepare가 400이 된다. #65 #169
- [ ] `production-preflight` 운영 실행 환경에 cloud-sql-proxy v2와 ADC를 준비한다. 첫 실행에서 `grapit_app`이 `pg_control_system()`을 읽을 수 있는지와 `server.source`를 확인한다. postmaster 대체 식별값이면 배포 창 안에 Cloud SQL 재시작이 없어야 비교가 통과한다. baseline은 배포 직전에 같은 DB role로 다시 수집한다. 대상 instance는 스크립트에 `grabit-db-managed-demo`로 고정돼 있어, 판매 용량 복원에서 Cloud SQL을 다른 이름의 instance로 바꾸면 `unexpected_instance`로 멈춘다. 같은 instance를 resize하거나 스크립트 상수를 먼저 바꾼다. #163 #166
- [ ] 저사양 Android 실기기에서 실제 좌석맵과 초당 30건의 seat-update 아래 INP와 long task를 CPU throttling으로 측정한다. jsdom 측정(업데이트당 325ms → 0.41ms)만 있다. #11

### 3.4 결제 UAT

- [ ] 명시 승인된 계정·금액으로 해외카드·PayPal의 승인·조회 응답 currency 표기(USD/`MUSD`)와 조회 API의 `NOT_FOUND_PAYMENT` 응답 형식을 실측한다. 코드는 USD와 `MUSD`를 모두 받는다. [결제 운영 UAT](live-foreign-payment-cancel-uat-2026-06-03.md). #1 #18
- [ ] Toss sandbox 실기기(데스크톱·모바일)에서 카드사를 고르지 않고 결제하기(`NEED_CARD_PAYMENT_DETAIL`) → handoff 해제 → 같은 주문 재결제를 확인한다. #9
- [ ] 판매 중 수동 대조 기준을 정한다: `checkout_started_at` 이후 30분 넘게 결제 행이 없는 `PENDING_PAYMENT` 예약은 먼저 `payment-confirm-reconcile` job이 맡고 있는지 확인하고, 아니면 orderId로 국내·외화 상점 키 각각 Toss 주문 조회를 한다. [남은 gate](show-relaunch-reliability.md#새-공연-오픈의-남은-gate). #18 #73

### 3.5 현장 실기기

- [ ] 공연장에서 휴대폰 2대 이상, 공용 scanner 계정 하나로 OS 카메라 연속 스캔을 한다: 새 탭마다 회차 유지, 단절 중 새 QR의 예외 원장 처리, 복구 후 자동 동기화. iOS Safari와 Android Chrome 모두. #39 #40 #116 #117
- [ ] 같은 계정·네트워크에서 분당 약 300명 입장 처리량과 `GET /users/me` 429 없음, 로그인 15분 30회 한도를 확인한다. 검표 기기는 관객 공용 Wi-Fi 대신 LTE/5G나 스태프 전용 네트워크를 쓴다. 분당 300명이나 기기 30대를 넘으면 계정을 나눈다. [요청 한도와 현장 계정 배치](seat-level-field-operations.md#요청-한도와-현장-계정-배치). #15
- [ ] 공용 검표 기기는 근무가 끝나면 브라우저 방문 기록을 지운다. 처음 연 `?ticket=` 주소가 기록 목록에 남을 수 있다. #118

### 3.6 오픈 전날과 당일

- [ ] 오픈 전날부터 입장 종료까지 `MIGRATION_FREEZE=true`. #60
- [ ] Cloud SQL maintenance deny period로 판매·입장 시간대를 덮는다. #57
- [ ] `verify-valkey-sale-posture.mjs`를 다시 실행해 Valkey 유지보수 예정이 오픈·입장 보호 구간과 그 앞뒤 6시간 안에 없는지 확인한다. #63
- [ ] Prewarm을 쓰면 scale-up은 판매 15분 전 이상, step-down은 대기열이 비고 트래픽이 줄어든 뒤. #150
- [ ] 재개방은 evidence gate 통과 후 variable을 먼저 `true`로 바꾸고 gcloud로 열거나, 수동 Deploy dispatch에서 `allow_booking_reopen=true`로 연다. #64

## 4. 결정이 필요한 항목

### 4.1 정해진 조건이 되면 실행

- [ ] privacy·pipa_required `2026-04-28` 동의 행 비활성화: web 배포 후 24시간 이상, 티켓 오픈 창 밖, 3.3의 부하 gate 뒤에 별도 migration으로 [고정된 SQL](consent-document-versions.md#bumping-a-document-version)만 쓴다. `version`만으로 거르면 terms·marketing도 꺼져 모든 가입과 prepare가 400이 된다. DELETE는 금지다. #169 #106
- [ ] 이 release 이전으로 API를 되돌릴 때는 web을 먼저 또는 함께 되돌린다. API만 되돌리면 동의(pipa 없는 예매 payload 400)와 현장 verify(`deviceAttemptId` 400)가 모두 막힌다. web만 되돌리는 것은 안전하다. [동의 rollback](consent-document-versions.md#rollback), [현장 rollback](seat-level-field-operations.md#배포-rollback-순서). #98 #113
- [ ] 이후 `UNIQUE(lower(email))`이나 소문자 backfill을 하기 전에 [중복 점검 쿼리](auth-session-operations.md#read-only-duplicate-check-run-before-adding-a-unique-constraint)를 실행하고 중복을 병합 runbook으로 해결한다. `JWT_REFRESH_SECRET`과 `JWT_SECRET`은 오픈 창 동안 회전하지 않는다. #99 #13
- [ ] QR secret을 교체할 때는 [pinned-version 절차](qr-ticket-secret-rotation.md#교체-절차)를 따른다(main merge 일시 중지, 명시 version으로 `--update-secrets`). #109
- [ ] `FRONTEND_URL`을 여러 origin으로 바꿀 때는 첫 항목이 소셜 redirect·QR 이메일 링크의 기준이 되도록 순서를 정한다. #93
- [ ] 계정 병합 운영자는 환경별 `databaseServer` fingerprint를 보호된 운영 메모에 기록하고, apply에 `--expected-server`, `--expected-db`, `--allowlist-hash`를 넘긴다. 오픈 중에는 `--allow-active-sales`를 쓰지 않는다. dry-run마다 `payment_in_flight`인 그룹은 결제를 먼저 정리한다. [병합 runbook](social-account-merge.md). #104 #105 #159
- [ ] `included-benefit-repair` apply에는 `--operator-user-id`(benefits.manage 보유 관리자)와 `--reason`이 필요하며 한산한 시간에만 실행한다. [기본 베네핏 누락 복구](show-relaunch-reliability.md#기본-베네핏-누락-복구). #162 #165

### 4.2 제품·법무·보안 판단

- [ ] provider가 이메일을 확인하지 않은 소셜 전용 가입(예: Naver)에 이메일 인증을 요구할지. 2026-05-17 운영 hotfix 정책과 충돌하므로 이번에는 적용하지 않았다. 바꾸려면 가입과 로그인 보정을 함께 바꾼다. #100
- [ ] 가입 때 `pipa_required` 동의 기록이 없는 활성 계정 수를 [쿼리](consent-document-versions.md#accounts-without-signup-pipa-evidence)로 세고, 그 계정에만 checkout에서 동의를 받을지 정한다(API 변경 필요). #98
- [ ] 동의 분쟁 대응: privacy·pipa_required 행이 어떤 v1.2 본문을 보여줬는지는 `agreed_at`을 `37b23f2a` release의 실제 배포 시각과 비교해야 한다. 배포 기록에서 그 시각을 찾아 [Reading Historical Rows](consent-document-versions.md#reading-historical-rows)에 남긴다. #169
- [ ] 관리자 IP allowlist를 강제할지: guard 또는 edge 규칙, deploy에 `ADMIN_IP_ALLOWLIST_CIDRS` 반영, IP가 바뀌는 현장 scanner 경로(`/field`, `field.scan.*`) 예외 정책을 먼저 정한다. 그 전까지 관리자 계정은 비밀번호와 감사 모니터링으로만 보호되며 MFA는 수용된 위험이다. #43
- [ ] `run.app` 직접 접근 차단(ingress 제한 또는 edge secret 없는 요청 403). 먼저 OAuth callback(`CLOUD_RUN_API_URL` 기반), Toss webhook URL, Scheduler·prewarm, smoke script가 `run.app`을 쓰지 않는지 확인한다. #152
- [ ] Cloud Run·LB 요청 로그가 최초 `GET /field/check-in?ticket=...`의 query를 그대로 남긴다. 로그 보존·접근 범위를 점검하고, QR URL을 fragment(`#ticket=`)로 바꾸는 안을 ADR로 검토한다(기존 `?ticket=` QR은 계속 지원). 단절 중 새 QR까지 검증하려면 공개키 기반 로컬 검증 ADR이 필요하다. #118 #40
- [ ] 기존 `seat_maps.svg_url`·`venue_layout_floors.svg_url` SVG를 운영 DB·R2에서 모두 받아 `hasUnsafeSvgPayload` 기준(주석, PI, `<`/`>`가 든 CDATA, HTML breakout tag, SMIL, `on*` 속성)으로 점검하고, 걸리면 교체한다. 렌더 sanitizer가 막지만 변조 파일은 찾아야 한다. `svgUrl`을 `R2_PUBLIC_URL` 도메인으로 제한할지는 기존 행의 host·상대 경로를 확인한 뒤 정한다. #49
- [ ] 선택: 판매 중인 공연에서 같은 인증 휴대폰을 쓰는 다계정의 과거 구매를 조회한다. 기존 확정 구매는 소급 취소하지 않고 새 구매부터 합산 제한이 적용된다. #62

## 5. 운영 조치로 해결되지 않는 잔여 위험

코드 후속이 필요하다. 오픈 판단 때 수용 여부를 기록한다.

- confirm은 Toss 승인 응답의 실제 결제수단을 공연 정책과 대조하지 않고, 웹은 위젯의 가상계좌·휴대폰 결제를 `CARD`로 분류한다. 이 수단을 위젯에 켜지 않는 것(1.3)이 현재 방어선이다. #70 #74
- QR reminder의 `email_sent_at`이 claim을 겸해, claim 뒤 프로세스가 죽으면 그 reminder는 유실된다. 다음 migration에서 claim/lease 컬럼과 stale claim sweep이 필요하다(2.4에서 관찰). #107
- seat-update 수신은 아직 이벤트마다 좌석 상태 cache를 갱신한다(rAF 또는 100–200ms 묶음 처리 미적용). web에는 `script-src` CSP가 없다. #11 #49
- `scripts/phase26/infra-evidence.mjs`의 연결 수 추정은 pg-boss pool을 빼고 계산하며 템플릿 값(`${{ env.DB_POOL_MAX }}`)을 읽지 못한다. 연결 예산은 Deploy workflow의 database preflight 결과를 쓴다. #54
- 새 runtime env 예시(`PGBOSS_POOL_MAX`, `PGBOSS_START_MAX_ATTEMPTS`, `DB_APPLICATION_NAME`, `DB_STATEMENT_TIMEOUT_MS`, `DB_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS`)를 `.env.example`에 넣는 작업은 감사 작업 환경에서 `.env*` 접근이 막혀 하지 못했다. 로컬 설정 담당자가 확인한다. 기본값과 의미는 [Architecture 8.4](../03-ARCHITECTURE.md#84-runtime-configuration)와 [Optional runtime settings](managed-demo-cost-floor.md#optional-runtime-settings)에 있다. #54 #55
