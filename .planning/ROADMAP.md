# Roadmap: Grapit

## Milestones

- ✅ **v1.0 MVP** -- Phases 1-5 (shipped 2026-04-09)
- 🚧 **v1.1 안정화 + 고도화** -- Phases 6-24 (in progress)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-5) -- SHIPPED 2026-04-09</summary>

- [x] Phase 1: Foundation + Auth (5/5 plans) -- completed 2026-03-30
- [x] Phase 2: Catalog + Admin (6/6 plans) -- completed 2026-03-31
- [x] Phase 3: Seat Map + Real-Time (4/4 plans) -- completed 2026-04-02
- [x] Phase 4: Booking + Payment (3/3 plans) -- completed 2026-04-07
- [x] Phase 5: Polish + Launch (5/5 plans) -- completed 2026-04-08

Full details: [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)

</details>

### 🚧 v1.1 안정화 + 고도화 (In Progress)

**Milestone Goal:** 인프라 안정화(Redis->Valkey 전환, R2 연동, 기술부채 청산, SMS 실연동)를 완료하고, 어드민 고도화 및 UX 현대화로 서비스 품질을 끌어올린다.

- [x] **Phase 6: 소셜 로그인 버그 수정** - 소셜 로그인 재로그인 실패 버그 해결 (completed 2026-04-09, PR #11/#12)
- [x] **Phase 7: Valkey 마이그레이션** - Upstash Redis 제거, ioredis 단일 클라이언트로 Google Valkey 전환 (completed 2026-04-13, CLUSTER 모드/idle 재연결 장기 모니터링은 VALK-03 로 추적)
- [x] **Phase 8: R2 프로덕션 연동** - Cloudflare R2 키 발급부터 CDN 서빙까지 프로덕션 파일 스토리지 완성 (completed 2026-04-13)
- [x] **Phase 9: 기술부채 청산** - v1.0에서 누적된 stub/회귀/미검증 6건 해소 (completed 2026-04-15)
- [x] **Phase 10: SMS 인증 실연동** - dev mock을 실제 SMS 발송/검증으로 전환 (completed 2026-04-16, Phase 10.1 Infobip v3 재작업 shipped 2026-04-20 PR #16)
- [x] **Phase 11: 어드민 대시보드** - 통계 대시보드 + Valkey 캐싱으로 어드민 고도화 (completed 2026-04-20, 수동 QA 유예 — 11-HUMAN-UAT.md 참조)
- [x] **Phase 12: UX 현대화** - 디자인 트렌드 반영 + SVG 좌석맵 UX 개선 (completed 2026-04-21)
- [x] **Phase 13: 브랜드 grapit→grabit rename** - 코드/설정/사용자 노출 카피/도메인 식별자 전환 (completed 2026-04-22)
- [x] **Phase 14: SMS OTP CROSSSLOT fix** - Valkey Cluster hash tag 적용과 프로덕션 SMS OTP 회귀 방어 (completed 2026-04-24)
- [x] **Phase 15: Resend heygrabit.com cutover** - transactional email 발송 도메인과 Secret Manager 값 전환 (completed 2026-04-27)
- [ ] **Phase 16: Legal pages launch** - legal 공개 URL cutover와 외부 sign-off 완료 (in progress)
- [x] **Phase 17: Local dev health indicator fix** - InMemoryRedis ping parity와 health capability probe 보강 (completed)
- [x] **Phase 18: Password reset production API origin fix** - password reset confirm의 production API origin break 해소 (gap closure) (completed 2026-04-29)
- [x] **Phase 19: Seat lock ownership enforcement** - reservation/payment 경계에서 Valkey lock ownership 강제 (gap closure) (completed 2026-04-29)
- [ ] **Phase 20: Valkey production connectivity contract** - Cloud Run → Valkey runtime/cluster contract 검증 (gap closure)
- [x] **Phase 21: Verification artifact backfill** - missing `VERIFICATION.md`와 requirement evidence 계약 복구 (gap closure) (completed 2026-05-04)
- [ ] **Phase 22: Operator UAT gates** - SMS, legal, email operator/human gates 완료 (gap closure)
- [ ] **Phase 23: Nyquist validation backfill** - partial/missing validation artifacts 보강 (gap closure)
- [ ] **Phase 24: Operational hardening sweep** - audit tech-debt follow-up를 launch blocker로 승격해 정리 (gap closure)

## Phase Details

### Phase 6: 소셜 로그인 버그 수정
**Goal**: 카카오/네이버/구글 소셜 로그인 사용자가 로그아웃 후 재로그인할 수 있다
**Depends on**: Nothing (v1.1 첫 번째 phase, v1.0 Phase 5 완료 상태)
**Requirements**: AUTH-01
**Success Criteria** (what must be TRUE):
  1. 소셜 로그인으로 가입한 사용자가 로그아웃 후 동일 소셜 계정으로 재로그인 성공
  2. 카카오, 네이버, 구글 세 프로바이더 모두에서 재로그인 동작 확인
  3. 재로그인 후 기존 사용자 데이터(예매 내역 등)가 정상 연결
**Plans:** 2 plans
Plans:
- [x] 06-01-PLAN.md -- 백엔드 버그 수정 + 에러 핸들링 + 프론트엔드 에러 UI
- [x] 06-02-PLAN.md -- E2E 테스트 + 수동 검증

### Phase 7: Valkey 마이그레이션
**Goal**: Upstash Redis 제거, ioredis 단일 클라이언트로 Google Memorystore for Valkey에 연결하여 인프라를 단순화한다
**Depends on**: Phase 6
**Requirements**: VALK-01, VALK-02, VALK-03, VALK-04, VALK-05, VALK-06
**Success Criteria** (what must be TRUE):
  1. 좌석 잠금(SET NX + TTL)이 Valkey에서 정상 동작하고 10분 후 자동 해제
  2. Socket.IO 실시간 좌석 동기화가 Valkey pub/sub로 동작 (다중 인스턴스 포함)
  3. 공연 카탈로그 캐시가 Valkey에서 서빙되어 DB 직접 조회 대비 응답 시간 단축
  4. Cloud Run에서 Valkey로의 VPC 연결이 안정적으로 유지
  5. Lua 스크립트 3개(좌석 잠금/해제/상태 조회)가 ioredis eval() 시그니처로 정상 실행
**Plans:** 5 plans
Plans:
- [x] 07-01-PLAN.md -- @upstash/redis 제거 + ioredis 단일 provider 통합 + eval() 시그니처 변환
- [x] 07-02-PLAN.md -- 공연 카탈로그 캐시 레이어 구현 (CacheService + 무효화)
- [x] 07-03-PLAN.md -- GCP Memorystore 프로비저닝 + Cloud Run VPC Egress 설정
- [x] 07-04-PLAN.md -- 리뷰 피드백 1차: production REDIS_URL hard-fail + invalidate try/catch + adapter duplicate 옵션 + release gate 문서화
- [x] 07-05-PLAN.md -- 리뷰 피드백 2차: HealthController Valkey ping + testcontainers 실 Valkey 통합 테스트

### Phase 8: R2 프로덕션 연동
**Goal**: 포스터/SVG 좌석맵 파일이 Cloudflare R2에 업로드되고 CDN을 통해 빠르게 서빙된다
**Depends on**: Phase 7
**Requirements**: R2-01, R2-02, R2-03, R2-04
**Success Criteria** (what must be TRUE):
  1. 관리자가 포스터 이미지와 SVG 좌석맵을 업로드하면 R2 버킷에 저장
  2. 업로드된 파일이 커스텀 도메인 CDN URL로 접근 가능
  3. 브라우저에서 CORS 에러 없이 이미지/SVG 로딩 (AllowedHeaders 명시적 설정)
  4. 기존 로컬/임시 파일 참조가 R2 URL로 완전 교체
**Plans:** 3 plans
Plans:
- [x] 08-01-PLAN.md -- S3Client forcePathStyle 추가 + 검증 테스트
- [x] 08-02-PLAN.md -- Next.js remotePatterns + Dockerfile + deploy.yml R2 시크릿
- [ ] 08-03-PLAN.md -- R2 인프라 설정 (버킷/CORS/토큰) + 업로드 플로우 검증

### Phase 9: 기술부채 청산
**Goal**: v1.0에서 누적된 stub, 테스트 회귀, 미검증 항목을 해소하여 코드베이스 신뢰도를 확보한다
**Depends on**: Phase 8
**Requirements**: DEBT-01, DEBT-02, DEBT-03, DEBT-04, DEBT-05, DEBT-06
**Success Criteria** (what must be TRUE):
  1. 비밀번호 재설정 시 실제 이메일이 발송되고 링크를 통해 비밀번호 변경 완료
  2. 회원가입 시 이용약관 dialog에 실제 약관 텍스트가 표시
  3. 전체 테스트 스위트가 0 failure로 통과 (locked seat click 회귀 포함)
  4. Toss Payments 결제 플로우가 E2E로 검증 완료
  5. 타입 경고 0건 + 미사용 라우트 정리 완료
**Plans:** 3 plans
Plans:
- [x] 09-01-PLAN.md -- Quick cleanup (DEBT-03 toast 일원화 + DEBT-04 formatDateTime + DEBT-06 useShowtimes 제거)
- [x] 09-02-PLAN.md -- Terms + Email (DEBT-02 MD 약관 + DEBT-01 Resend EmailService)
- [x] 09-03-PLAN.md -- Toss E2E (DEBT-05 Playwright + CI secrets + D-13 격리)

### Phase 09.1: CI-login-E2E — Playwright login helper 가 POST /auth/login 에 body 를 전달하지 못해 401 을 받는 이슈 조사 및 해결 (INSERTED)

**Goal:** CI 환경에서만 발생하는 Playwright loginAsTestUser helper → POST /api/v1/auth/login 401 이슈의 근본 원인을 규명·해결하여 `toss-payment.spec.ts` 의 3개 test.fixme 를 복구하고 CI 에서 12/12 green 을 달성한다
**Requirements**: none (urgent tech-debt, no REQ-ID mapping)
**Depends on:** Phase 9
**Plans:** 5/5 plans complete

Plans:
- [x] 09.1-01-PLAN.md — Wave 0 진단 인프라: env-gated debug middleware + main.ts rawBody + CI DEBUG_AUTH_REQ env 주입
- [x] 09.1-02-PLAN.md — Wave 1 증거 수집: CI 에서 curl + Playwright probe 양쪽 AUTH_LOGIN_DEBUG 로그 캡처 + 원인 범주(A/B/C) checkpoint 결정
- [x] 09.1-03-PLAN.md — Wave 2 조건부 fix: 확정된 분기(A=native fetch / B=headers 교정 / C=server-side) 중 단일 적용
- [x] 09.1-04-PLAN.md — Wave 3 복구: toss-payment.spec.ts 의 3 test.fixme → test 복구 + CI 12/12 green 증거 (S4)
- [x] 09.1-05-PLAN.md — Wave 4 정리: 진단 미들웨어/env/probe 완전 제거 + Phase 09 VERIFICATION deferred closure

### Phase 10: SMS 인증 실연동
**Goal**: 회원가입 시 실제 SMS OTP가 발송되고 인증번호 검증으로 본인 확인이 완료된다
**Depends on**: Phase 9
**Requirements**: SMS-01, SMS-02, SMS-03, SMS-04
**Success Criteria** (what must be TRUE):
  1. 회원가입 시 입력한 전화번호로 실제 SMS OTP가 수신
  2. 동일 번호/IP에서 과도한 SMS 요청 시 rate limiting 적용
  3. OTP 입력 실패 횟수 초과 또는 만료 시 재발송 필요
  4. 개발 환경에서는 SMS mock 모드가 자동 적용되어 실제 발송 없이 테스트 가능
**Plans:** 9/9 plans complete
Plans:
- [x] 10-01-PLAN.md — Wave 0 테스트 스캐폴딩 + Infobip fixture (RED)
- [x] 10-02-PLAN.md — twilio 제거 + Infobip deps + .env.example + DEPLOY-CHECKLIST
- [x] 10-03-PLAN.md — parseE164 + isChinaMainland (libphonenumber-js/min, CN edge cases)
- [x] 10-04-PLAN.md — Infobip 2FA native fetch wrapper + InfobipApiError
- [x] 10-05-PLAN.md — SmsService Infobip 재작성 + Lua atomic counter + cooldown rollback + hard-fail
- [x] 10-06-PLAN.md — @Throttle IP axis + zod 국제 번호 + 429 response 통일
- [x] 10-07-PLAN.md — ThrottlerModule forRootAsync + Valkey storage + password-reset D-09
- [x] 10-08-PLAN.md — phone-verification 4-state + 30s 쿨다운 + HTTP 에러 카피 + 국제 번호
- [x] 10-09-PLAN.md — E2E + testcontainers integration + staging smoke (체크리스트)

### Phase 10.1: SMS API v3 전환 (INSERTED)

**Goal:** Infobip `/2fa/2/pin` 레거시 경로에서 `/sms/3/messages` v3로 SMS 발송을 전환하여 `INFOBIP_APPLICATION_ID` / `INFOBIP_MESSAGE_ID` 의존을 제거하고, OTP 생성·검증을 Valkey 기반 자체 구현으로 단순화한다
**Requirements**: SMS-01, SMS-02, SMS-03, SMS-04 (재검증)
**Depends on:** Phase 10
**Success Criteria** (what must be TRUE):
  1. `InfobipClient`가 `POST /sms/3/messages` 호출로 재작성되어 `applicationId`/`messageId` 필요 없이 API Key + Base URL만으로 동작
  2. 6자리 숫자 OTP 생성 + Valkey `sms:otp:{e164}` 저장 (TTL 180s) + verify 매칭이 자체 구현됨
  3. 환경변수는 `INFOBIP_API_KEY` + `INFOBIP_BASE_URL` + `INFOBIP_SENDER` 3개로 축소. `APPLICATION_ID`/`MESSAGE_ID` 제거
  4. 기존 Phase 10의 rate limiting(IP + phone axis Lua counter) + 30s resend cooldown + mock 모드 분기 모두 유지
  5. `pnpm --filter @grapit/api test`가 0 실패로 통과 (Phase 10 테스트 마이그레이션 완료)
**Plans:** 6/7 plans complete

Plans:
- [x] TBD (run /gsd-plan-phase 10.1 to break down) (completed 2026-04-17)

### Phase 11: 어드민 대시보드
**Goal**: 관리자가 대시보드에서 예매/매출/장르 통계를 한눈에 파악하고 운영 의사결정을 내릴 수 있다
**Depends on**: Phase 10
**Requirements**: ADM-01, ADM-02, ADM-03, ADM-04, ADM-05, ADM-06
**Success Criteria** (what must be TRUE):
  1. 관리자가 /admin 대시보드에서 오늘의 예매 수, 매출, 취소 건수, 활성 공연 수를 확인
  2. 일별/주별 매출 추이를 area chart로 시각화하여 트렌드 파악 가능
  3. 장르별 예매 분포(donut)와 결제수단 분포(bar)가 차트로 표시
  4. 인기 공연 Top 10 랭킹이 표시되어 운영 우선순위 판단 가능
  5. 통계 쿼리 결과가 Valkey에 캐싱되어 대시보드 로딩이 빠름
**Plans:** 4/4 plans complete
Plans:
- [x] 11-01-PLAN.md — Wave 1 RED: shared schema + service/controller skeleton + unit/controller-access/integration/E2E 테스트 스캐폴딩
- [x] 11-02-PLAN.md — Wave 2 API: kst-boundary helper + AdminDashboardService/Controller + AdminModule 등록
- [x] 11-03-PLAN.md — Wave 2 Web: shadcn chart + sidebar diff + ChartPanelState + 5 컴포넌트 + /admin/page.tsx
- [x] 11-04-PLAN.md — Wave 3 검증: 자동 테스트 풀 실행 + chart blank guard + UI-SPEC scope 스캔 + 수동 QA (HUMAN-UAT로 유예)
**UI hint**: yes

### Phase 12: UX 현대화
**Goal**: 전체 디자인을 모던 트렌드에 맞게 개선하고 SVG 좌석맵 사용성을 높여 사용자 경험을 끌어올린다
**Depends on**: Phase 11
**Requirements**: UX-01, UX-02, UX-03, UX-04, UX-05, UX-06
**Success Criteria** (what must be TRUE):
  1. 전체 UI가 모던 디자인 트렌드를 반영하여 시각적으로 개선
  2. SVG 좌석맵에서 스테이지 방향이 명확히 표시되고 등급별 색상 범례 + 가격이 보임
  3. 좌석 선택/해제 시 자연스러운 애니메이션 전환
  4. 줌 상태에서 미니맵으로 현재 위치 파악 가능
  5. 모바일에서 좌석 터치 타겟이 최소 44px로 보장되어 오탭 방지
**Plans:** 6/6 plans complete
Plans:
- [x] 12-00-test-scaffolding-PLAN.md — Wave 0 RED: svg-preview/use-is-mobile/seat-map-viewer/prefix-svg-defs-ids 테스트 (reviews revision: rapid reselect + descendant data-stage + selected+locked 회귀 + parse 실패 toast + dynamic import)
- [x] 12-01-foundation-tokens-PLAN.md — Wave 1 Foundation: globals.css shadow/radius 토큰 + seat-checkmark fade-in/out keyframe + 홈 3개 섹션 mt-12→mt-10
- [x] 12-02-hook-and-admin-validation-PLAN.md — Wave 2: useIsMobile hook + svg-preview admin 검증 (reviews revision: unified parsing contract + enum 검증 + try/catch parse 실패 toast)
- [x] 12-03-viewer-core-changes-PLAN.md — Wave 3 core: seat-map-viewer.tsx 변경 (reviews revision: per-seat timeout Map + unified parsing + viewBox min-x/min-y + D-13 BROADCAST PRIORITY) + W-2 helper 파일 분리
- [x] 12-03.5-minimap-smoke-test-PLAN.md — Wave 3 gate (reviews revision MED #5): react-zoom-pan-pinch MiniMap 런타임 contract 수동 smoke test (3 check — 축소 SVG copy / viewport rect 동기화 / 모바일 숨김) — FAIL 시 D-14 원안 fallback
- [x] 12-04-regression-and-manual-qa-PLAN.md — Wave 4: 자동 회귀 + manual QA gate (11개 항목 포함 reviews revision HIGH #1/#2/MED #4) + D-19 SECURITY DEBT PROJECT.md 기록 (reviews revision LOW #9)
**UI hint**: yes

### Phase 13: 브랜드명 grapit → grabit 일괄 rename

**Goal:** 코드/문서/설정/이메일·SMS 카피/DB/Cloud Run 서비스명을 `grapit`에서 `grabit`으로 일괄 전환하여 확정 도메인 heygrabit.com 런칭에 맞춘 브랜드 정합성 확보
**Requirements**: SC-1, SC-2, SC-3, SC-4 (Success Criteria를 REQ-ID proxy로 사용)
**Depends on:** Phase 12
**Canonical refs:** .planning/seeds/SEED-002-brand-rename-grapit-to-grabit.md
**Success Criteria** (what must be TRUE):
  1. 신규 코드/문서/설정이 `grabit`으로 통일되고 빌드·타입체크·린트 통과 (SC-1)
  2. 사용자 노출 문자열(이메일 템플릿/SMS 발신자/title/meta/UI 카피) 전부 `Grabit` (SC-2)
  3. prod DB와 Cloud Run 서비스가 `grabit` 식별자로 정상 동작 (SC-3)
  4. 과거 milestone 기록·완료된 phase 폴더·commit message는 건드리지 않음 (SC-4)
**Plans:** 4 plans

Plans:
- [x] 13-01-PLAN.md — P1 코드/설정 rename: 4 manifest + 92+ import + Dockerfile/docker-compose/ci.yml/provision-valkey.sh/seed/fixture/docs (D-01/D-03/D-05/D-06/D-07 exceptions)
- [x] 13-02-PLAN.md — P2 사용자 노출 카피: UI 로고/footer/admin + email subject + SMS body + legal MD (D-07 @heygrabit.com)
- [x] 13-03-PLAN.md — P3 인프라 식별자 생성: AR grabit + Sentry 2프로젝트 slug rename + deploy.yml env + 새 Cloud Run 서비스 기동 (D-05 SA 유지) + api.heygrabit.com via Global HTTPS LB (asia-northeast3 domain-mappings 미지원 → Plan 원안 경로 변경)
- [x] 13-04-PLAN.md — P4 도메인 cutover: heygrabit.com + www → grabit-web via LB URL Map host-rule 확장 + grabit-web-cert SNI 공존 (asia-northeast3 domain-mappings 미지원 → Wave 3 LB 전략 승계), rollback/cleanup 스크립트, HUMAN-UAT (7일 유예 cleanup + 실기기 로그인 테스트는 수동)

### Phase 14: SMS OTP CROSSSLOT fix — 프로덕션 회원가입 SMS 인증 정상화 (Valkey Cluster hash tag 적용)

**Goal:** 프로덕션 heygrabit.com 회원가입 3단계 SMS OTP 인증이 Valkey Cluster 에서 CROSSSLOT 없이 성공하고, cluster-mode 회귀 테스트가 CI 에 편입되며, 프론트가 서버 message 를 우선 표시해 시스템 에러와 오타 실패를 UX 상 구분한다
**Requirements**: SC-1, SC-2, SC-3, SC-4 (14-CONTEXT.md D-20 에서 Success Criteria 를 REQ-ID proxy 로 사용)
**Depends on:** Phase 13
**Plans:** 4/4 plans complete

Plans:
- [x] 14-01-PLAN.md — Wave 1: sms.service.ts hash-tag 적용 + 4개 심볼 (smsOtpKey/smsAttemptsKey/smsVerifiedKey/VERIFY_AND_INCREMENT_LUA) export (D-01/D-02/D-05/D-13)
- [x] 14-02-PLAN.md — Wave 2: sms-throttle.integration.spec.ts drift 제거 — Plan 01 export 를 import 해서 키 리터럴/Lua 복제 소거 (D-13 SoT)
- [x] 14-03-PLAN.md — Wave 2: sms-cluster-crossslot.integration.spec.ts 신규 — testcontainers cluster-mode + CLUSTER ADDSLOTSRANGE + 5 시나리오 (negative guard + 4분기 + KEYSLOT + pipeline + e164 variation) (D-10/D-11/D-12)
- [x] 14-04-PLAN.md — Wave 1 (병렬): phone-verification.tsx server-message 우선 패치 + 4 unit tests (D-07/D-08) + 14-HUMAN-UAT.md (SC-1 실기기 + D-17 Sentry 72h + D-19 overlap 관측) + checkpoint

### Phase 15: Resend heygrabit.com cutover — transactional email 발송 도메인 전환 + Secret Manager 값 교체

**Goal:** 프로덕션 grabit-api 의 transactional email 발송을 `no-reply@heygrabit.com` 으로 cutover 하고 (Resend 도메인 verification + 후이즈 DNS SPF/DKIM/DMARC + Secret Manager + Cloud Run redeploy + 3사 UAT), silent failure 관측성 확보를 위해 email.service.ts 의 Resend error branch 에 Sentry.captureException 을 삽입한다. Phase 13 UAT gap 9 (.planning/debug/password-reset-email-not-delivered-prod.md) 의 Resolution 을 실행하는 운영 중심 phase.
**Requirements**: CUTOVER-01 (Resend heygrabit.com Verified), CUTOVER-02 (Secret Manager resend-from-email=no-reply@heygrabit.com), CUTOVER-03 (Cloud Run 신규 revision 100% traffic), CUTOVER-04 (email.service.ts Sentry.captureException), CUTOVER-05 (3사 inbox 수신 spam 아님), CUTOVER-06 (email.service.spec 회귀 없음)
**Depends on:** Phase 14
**Plans:** 3 plans

Plans:
- [x] 15-01-PLAN.md — Wave 1 code: email.service.ts Sentry.withScope + captureException 삽입 (D-11) + email.service.spec.ts 8 테스트 (기존 6 + Sentry 호출 / PII masking 신규 2) — 2026-04-27 완료, PR #20
- [x] 15-02-PLAN.md — Wave 2 ops: Resend heygrabit.com Add Domain (Tokyo ap-northeast-1) + 후이즈 DNS 등록 (DKIM TXT + SPF MX + SPF TXT + project-defined DMARC) + dig 4/4 literal match + Resend Verified — 2026-04-27 11:41 KST 완료
- [x] 15-03-PLAN.md — Wave 3 cutover: 가정 변경 (사실관계 정정) — Secret Manager `resend-from-email` 이미 `no-reply@heygrabit.com` (Plan Tasks 1+2 NO-OP). Resend 계정에 `grapit.com` 미등록 (Task 5 N/A). 추가 발견: `resend-api-key` placeholder 였음 → 사용자 신규 키 발급 + v2 추가 + v1 disabled + Cloud Run revision 강제 롤 (`grabit-api-00013-lkx` 100% traffic, 2026-04-27 15:19 KST). Resend API direct smoke test → Gmail inbox 수신 검증 (15:25 KST). Naver/Daum 은 운영 트래픽으로 자연 검증 (48h window).

### Phase 16: Legal pages launch — 이용약관/개인정보처리방침/마케팅동의 공개 URL 구현 (개보법·정통망법 런칭 요건)

**Goal:** /legal/{terms,privacy,marketing} 3개 SSG 페이지를 신규 게시하고, Footer placeholder href 3건을 실 경로(/legal/terms, /legal/privacy, mailto:support@heygrabit.com)로 교체하며, 3개 MD 콘텐츠에 법정 필수 기재 placeholder(시행일·사업자정보·보호책임자·개정이력)를 보강하고, LegalDraftBanner 컴포넌트와 signup-step2 사용처를 제거하여 한국 개보법·정통망법 상시 공개 URL 요건과 Phase 13 UAT Gap test 11(pre-existing feature gap)을 해소한다.
**Requirements**: D-01, D-02, D-03, D-04, D-05, D-06, D-07, D-08, D-09, D-10, D-11, D-12, D-13, D-14, D-15 (CONTEXT.md 의 locked decisions — phase_req_ids 가 null 이라 D-IDs 가 acceptance 단위로 작동)
**Depends on:** Phase 15
**Plans:** 5/6 plans executed

Plans:
- [x] 16-01-PLAN.md — Wave 0: Foundation tests (terms-markdown.test, metadata.test, footer.test 3건 — RED 정상)
- [x] 16-02-PLAN.md — Wave 1: TermsMarkdown showH1 prop + table 매핑 + apps/web/app/legal/{layout,terms/page,privacy/page,marketing/page}.tsx 4 신규 + env-driven robots (GRABIT_ENV) + SSG clean build 검증
- [x] 16-03-PLAN.md — Wave 2: Footer href 3건 교체 (terms/privacy → Link 실 경로, 고객센터 → mailto)
- [x] 16-04-PLAN.md — Wave 3: 3개 MD placeholder 보강 (사업자 식별정보 + 보호책임자 + 개정 이력 GFM 표 + 시행일) + KOPICO 7 heading 회귀 가드
- [x] 16-05-PLAN.md — Wave 4: LegalDraftBanner.tsx 삭제 + signup-step2.tsx import/JSX 정리 (D-11 dialog UX 불변) + HUMAN-UAT.md 작성 (generic bracket regex gate)
- [ ] 16-06-PLAN.md — Wave 5: Cutover (autonomous: false) — human placeholder 실값 주입 + clean prod build + generic regex gate + robots/canonical 검증 + cutover commit + prod URL smoke (codex HIGH-1 atomic launch)

### Phase 17: Local dev health indicator fix — InMemoryRedis.ping() 구현 + capability probe 추가로 REDIS_URL unset 시 /health 200

**Goal:** REDIS_URL 이 unset 인 fresh local dev 환경에서 `InMemoryRedis` fallback 이 `/api/v1/health` 를 503 으로 떨어뜨리지 않도록 `ping()` surface parity 와 RedisHealthIndicator capability probe 를 추가한다.
**Requirements**: SC-1, SC-2, SC-3, SC-4 (debug artifact success criteria proxy)
**Depends on:** Phase 16
**Plans:** 2/2 plans complete

Plans:
- [x] 17-01-PLAN.md — Wave 1 RED: InMemoryRedis `ping()` parity + RedisHealthIndicator no-ping capability probe tests
- [x] 17-02-PLAN.md — Wave 2 implementation: `InMemoryRedis.ping()` + RedisHealthIndicator capability probe + focused/typecheck/lint verification

### Phase 18: Password reset production API origin fix

**Goal:** password reset email → confirm flow가 production Cloud Run에서도 `localhost:8080` rewrite에 의존하지 않고 올바른 API origin으로 submit되어 DEBT-01과 CUTOVER flow break를 해소한다.
**Requirements:** DEBT-01, CUTOVER-01, CUTOVER-02, CUTOVER-03, CUTOVER-04, CUTOVER-05, CUTOVER-06
**Gap Closure:** Closes `.planning/v1.1-MILESTONE-AUDIT.md` password reset production API origin gap.
**Depends on:** Phase 17
**Success Criteria** (what must be TRUE):
  1. password reset confirm submit이 production web에서 public API origin을 사용하고 `/api` rewrite가 `localhost:8080`으로 새지 않는다.
  2. local dev, preview, production 환경별 API base URL contract가 문서화되고 regression test로 고정된다.
  3. password reset email → confirm → login happy path smoke/UAT evidence가 phase artifact에 남는다.
**Plans:** 2/2 plans complete

Plans:
**Wave 1**
- [x] 18-01-PLAN.md — Code + regression contract: shared `apiUrl()` helper, reset confirm public API origin, dev-only localhost rewrites

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 18-02-PLAN.md — Production UAT evidence: password reset email → confirm POST to `api.heygrabit.com` → login success

### Phase 19: Seat lock ownership enforcement

**Goal:** SVG seat select → Valkey lock → reservation/payment flow에서 reservation prepare/confirm이 client-provided seats만 신뢰하지 않고 active Valkey lock ownership을 강제한다.
**Requirements:** VALK-03, UX-02, UX-03, UX-04, UX-05, UX-06
**Gap Closure:** Closes `.planning/v1.1-MILESTONE-AUDIT.md` seat selection / Valkey lock → reservation / payment gap.
**Depends on:** Phase 18
**Success Criteria** (what must be TRUE):
  1. reservation prepare가 모든 requested seat의 active lock owner를 검증하고 mismatch/expired lock을 거부한다.
  2. payment confirm이 active lock ownership 없이 sold 전환을 수행하지 않는다.
  3. expired/released/other-user lock에 대한 API and E2E regression tests가 추가된다.
**Plans:** 4/4 plans complete

Plans:
**Wave 1**
- [x] 19-01-PLAN.md — Wave 0 backend/web ownership regression tests

**Wave 2 *(blocked on Wave 1 completion)***
- [x] 19-02-PLAN.md — BookingService Valkey ownership assert/consume helpers
- [x] 19-04-PLAN.md — Confirm/complete lock rejection UX and E2E coverage

**Wave 3 *(blocked on 19-02 completion)***
- [x] 19-03-PLAN.md — Reservation prepare/confirm ownership enforcement

Cross-cutting constraints:
- Active Valkey ownership is the source of truth for prepare and confirm; client-selected seats and `locked-seats` index membership are not authorization.
- Ownership helper tests, InMemoryRedis parity, real Valkey integration, reservation service tests, and payment E2E coverage must share one tuple/error-message contract.
- Confirm/complete UI must surface server lock rejection messages and must not show false success or start Toss after prepare rejection.

### Phase 20: Valkey production connectivity contract

**Goal:** Cloud Run → Google Memorystore for Valkey production runtime contract를 cluster/standalone 설정, VPC egress, idle reconnect, Socket.IO pub/sub까지 실제 운영 조건에서 검증 가능하게 만든다.
**Requirements:** VALK-02, VALK-03, VALK-04, VALK-05, SC-1, SC-2, SC-3, SC-4
**Gap Closure:** Closes `.planning/v1.1-MILESTONE-AUDIT.md` Cloud Run → Valkey Cluster and runtime human-needed gaps.
**Depends on:** Phase 19
**Success Criteria** (what must be TRUE):
  1. production Valkey mode detection/connection config가 deployment contract로 고정된다.
  2. Cloud Run revision에서 Valkey ping, Lua lock path, Socket.IO pub/sub propagation smoke가 evidence로 남는다.
  3. idle reconnect and multi-instance propagation failure mode가 rollback/checklist에 포함된다.
**Plans:** 4/4 plans executed — phase remains `Human Needed` until production smoke evidence is recorded

Plans:
- [x] 20-01-PLAN.md — VALKEY_MODE=cluster deployment/runtime contract and REDIS_CLIENT cluster selection
- [x] 20-02-PLAN.md — Sanitized health metadata and production-visible Socket.IO Redis adapter failure
- [x] 20-03-PLAN.md — Booking Lua lock/status/unlock cluster-mode integration guard
- [x] 20-04-PLAN.md — Production smoke script, HUMAN-UAT evidence, and rollback checklist (production smoke skipped by user request; `20-VERIFICATION.md` is `human_needed`)

### Phase 21: Verification artifact backfill

**Goal:** Phase 06, 08, 13, 15의 missing `*-VERIFICATION.md`와 requirement evidence/frontmatter gap을 보강하여 AUTH-01, R2-02 orphaned 상태와 audit artifact blocker를 제거한다.
**Requirements:** AUTH-01, R2-01, R2-02, R2-03, R2-04
**Gap Closure:** Closes `.planning/v1.1-MILESTONE-AUDIT.md` missing phase verification artifact and orphaned requirement gaps.
**Depends on:** Phase 20
**Success Criteria** (what must be TRUE):
  1. `06-VERIFICATION.md`, `08-VERIFICATION.md`, `13-VERIFICATION.md`, `15-VERIFICATION.md`가 phase evidence와 일치하게 작성된다.
  2. orphaned/partial requirement rows가 verification files and SUMMARY frontmatter에서 추적 가능해진다.
  3. generated artifact는 실제 code/ops evidence를 참조하고 없는 evidence를 satisfied로 표시하지 않는다.
**Plans:** 4/4 plans complete

Plans:
- [x] 21-01-PLAN.md — Phase 06 AUTH-01 verification artifact and SUMMARY traceability backfill
- [x] 21-02-PLAN.md — Phase 08 R2 verification artifact and R2-02 SUMMARY traceability backfill
- [x] 21-03-PLAN.md — Phase 13 verification artifact with human-needed false-claim guards
- [x] 21-04-PLAN.md — Phase 15 verification artifact with human-needed and secret-leak guards

### Phase 22: Operator UAT gates

**Goal:** Phase 14 SMS OTP, Phase 15 email cutover, Phase 16 legal launch에 남은 실기기/외부 sign-off/operator smoke gate를 완료하여 launch-facing partial flows를 닫는다.
**Requirements:** SMS-02, CUTOVER-05, D-01, D-02, D-03, D-04, D-05, D-06, D-07, D-08, D-09, D-10, D-11, D-12, D-13, D-14, D-15
**Gap Closure:** Closes `.planning/v1.1-MILESTONE-AUDIT.md` SMS signup OTP, legal pages launch, and email inbox observation gaps.
**Depends on:** Phase 21
**Success Criteria** (what must be TRUE):
  1. SMS signup OTP real-device production UAT and zero-CROSSSLOT/Sentry observation window are recorded.
  2. legal factual sign-off, mailbox receipt, production URL smoke, robots/canonical checks are complete.
  3. Naver/Daum/Gmail transactional email receipt status is captured or explicitly risk-accepted.
**Plans:** 0 plans

Plans:
- [ ] TBD (run `/gsd-plan-phase 22`)

### Phase 23: Nyquist validation backfill

**Goal:** Audit가 partial/missing으로 분류한 phase validation artifacts를 보강하여 v1.1 Nyquist coverage를 milestone completion gate 수준으로 끌어올린다.
**Requirements:** R2-01, R2-02, R2-03, R2-04, DEBT-01, DEBT-02, DEBT-03, DEBT-04, DEBT-05, DEBT-06
**Gap Closure:** Closes `.planning/v1.1-MILESTONE-AUDIT.md` Nyquist validation gaps for phases 08, 09, 09.1, 10.1, 13, 16, 17.
**Depends on:** Phase 22
**Success Criteria** (what must be TRUE):
  1. `$gsd-validate-phase 08`, `09`, `09.1`, `10.1`, `13`, `16`, `17` 결과가 artifact로 남는다.
  2. validation gaps are resolved or explicitly routed to a new blocker with owner and evidence.
  3. milestone audit can distinguish implementation gaps from artifact-only gaps after validation backfill.
**Plans:** 0 plans

Plans:
- [ ] TBD (run `/gsd-plan-phase 23`)

### Phase 24: Operational hardening sweep

**Goal:** Audit tech-debt에 남은 fragile 운영 항목을 launch blocker 관점에서 정리하여 re-audit 때 반복 gap으로 남지 않게 한다.
**Requirements:** VALK-03, VALK-05, R2-02, SMS-02, CUTOVER-05, SC-4
**Gap Closure:** Closes `.planning/v1.1-MILESTONE-AUDIT.md` tech-debt follow-ups across Valkey, R2, SMS, brand cleanup, email observation, and legal operations.
**Depends on:** Phase 23
**Success Criteria** (what must be TRUE):
  1. Valkey `KEYS` invalidation risk and `getMyLocks()` TTL null edge case are either fixed or bounded with documented scale limits.
  2. production R2 misconfiguration fallback policy is hardened so production cannot silently use local upload mode.
  3. OTP verified proof binding, legacy OAuth/domain cleanup, email/legal observation leftovers are closed or explicitly deferred with owner/date.
**Plans:** 0 plans

Plans:
- [ ] TBD (run `/gsd-plan-phase 24`)

## Progress

**Execution Order:**
Phases execute in numeric order: 6 -> 7 -> 8 -> 9 -> 10 -> 11 -> 12 -> 13 -> 14 -> 15 -> 16 -> 17 -> 18 -> 19 -> 20 -> 21 -> 22 -> 23 -> 24

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation + Auth | v1.0 | 5/5 | Complete | 2026-03-30 |
| 2. Catalog + Admin | v1.0 | 6/6 | Complete | 2026-03-31 |
| 3. Seat Map + Real-Time | v1.0 | 4/4 | Complete | 2026-04-02 |
| 4. Booking + Payment | v1.0 | 3/3 | Complete | 2026-04-07 |
| 5. Polish + Launch | v1.0 | 5/5 | Complete | 2026-04-08 |
| 6. 소셜 로그인 버그 수정 | v1.1 | 2/2 | Complete | 2026-04-09 |
| 7. Valkey 마이그레이션 | v1.1 | 5/5 | Complete | 2026-04-13 |
| 8. R2 프로덕션 연동 | v1.1 | 2/3 | Partial | 2026-04-13 |
| 9. 기술부채 청산 | v1.1 | 3/3 | Complete | 2026-04-15 |
| 09.1. CI-login-E2E | v1.1 | 5/5 | Complete | 2026-04-17 |
| 10. SMS 인증 실연동 | v1.1 | 9/9 | Complete | 2026-04-16 |
| 10.1. SMS API v3 전환 | v1.1 | 6/7 | Partial | 2026-04-20 |
| 11. 어드민 대시보드 | v1.1 | 4/4 | Complete | 2026-04-20 |
| 12. UX 현대화 | v1.1 | 6/6 | Complete | 2026-04-21 |
| 13. 브랜드 grapit→grabit rename | v1.1 | 4/4 | Complete | 2026-04-22 |
| 14. SMS OTP CROSSSLOT fix | v1.1 | 4/4 | Complete | 2026-04-24 |
| 15. Resend heygrabit.com cutover | v1.1 | 3/3 | Complete (48h 관측 follow-up pending) | 2026-04-27 |
| 16. Legal pages launch | v1.1 | 5/6 | Partial | - |
| 17. Local dev health indicator fix | v1.1 | 2/2 | Complete | 2026-04-29 |
| 18. Password reset production API origin fix | v1.1 | 2/2 | Complete    | 2026-04-29 |
| 19. Seat lock ownership enforcement | v1.1 | 4/4 | Complete    | 2026-04-29 |
| 20. Valkey production connectivity contract | v1.1 | 4/4 | Human Needed |  |
| 21. Verification artifact backfill | v1.1 | 4/4 | Complete   | 2026-05-04 |
| 22. Operator UAT gates | v1.1 | 0/0 | Planned | - |
| 23. Nyquist validation backfill | v1.1 | 0/0 | Planned | - |
| 24. Operational hardening sweep | v1.1 | 0/0 | Planned | - |

## Backlog

### Phase 999.1: 홈 HOT/신규 오픈 "더보기" 전 장르 라우트 신설 (BACKLOG)

**Goal:** [Captured for future planning]
**Requirements:** TBD
**Plans:** 0 plans

**Context (from Phase 12 code review IN-06):**
- `apps/web/components/home/hot-section.tsx:22-27` 및 `new-section.tsx:18-23`의 "더보기" 링크가 `/genre/musical?sort=popular|latest`로 musical 장르에 하드코딩되어 있음.
- HOT / 신규 오픈 섹션은 전 장르 큐레이션이므로 제품 의도와 불일치. 코드만으로는 의도 여부를 확정할 수 없어 Info 레벨 finding으로 남음.
- 제품 결정 필요: (A) 전 장르 대상 `/performances?sort=popular|latest` 같은 통합 목록 라우트 신설 → 링크 교체, (B) MVP 주력이 musical인 의도적 제약 → 주석으로만 명시.

Plans:
- [ ] TBD (promote with /gsd-review-backlog when ready)
