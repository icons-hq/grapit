---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: 안정화 + 고도화
status: executing
stopped_at: Phase 20 plan 20-04 human verification checkpoint
last_updated: "2026-04-30T07:54:11.332Z"
last_activity: 2026-04-30 -- Phase 20 execution started
progress:
  total_phases: 22
  completed_phases: 15
  total_plans: 74
  completed_plans: 72
  percent: 97
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-09)

**Core value:** 사용자가 원하는 공연을 발견하고, 좌석을 직접 선택하여, 안정적으로 예매를 완료할 수 있는 것
**Current focus:** Phase 20 — valkey-production-connectivity-contract

## Current Position

Phase: 20 (valkey-production-connectivity-contract) — EXECUTING
Plan: 1 of 4
Status: Executing Phase 20
Last activity: 2026-04-30 -- Phase 20 execution started

Progress: [██████████] 99%

## Performance Metrics

**Velocity:**

- Total plans completed: 79 (v1.0)
- Average duration: ~10min
- Total execution time: ~3 hours

**By Phase (v1.0):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1. Foundation + Auth | 5 | ~57min | ~11min |
| 2. Catalog + Admin | 6 | ~14min | ~2min |
| 3. Seat Map + Real-Time | 4 | N/A | N/A |
| 4. Booking + Payment | 3 | ~16min | ~5min |
| 5. Polish + Launch | 5 | N/A | N/A |
| 07 | 5 | - | - |
| 09.1 | 5 | - | - |
| 10 | 9 | - | - |
| 10.1 | 6 | - | - |
| 11 | 4 | - | - |
| 12 | 6 | - | - |
| 14 | 4 | - | - |
| 18 | 2 | - | - |
| 19 | 4 | - | - |

**Recent Trend:**

- v1.0 completed: 27 plans across 5 phases in 13 days
- Trend: Stable

| Phase 06 P01 | 5m | 2 tasks | 12 files |
| Phase 06 P02 | 3m | 1 tasks | 5 files |
| Phase 08 P01 | 1min | 1 tasks | 2 files |
| Phase 08-r2 P02 | 1m | 2 tasks | 3 files |
| Phase 08-r2 P03 | 21min | 2 tasks | 0 files (infra) |
| Phase 16 P01 | 6min | 3 tasks | 3 files |
| Phase 16 P02 | 6min | 3 tasks | 7 files |
| Phase 16 P03 | 2min | 1 tasks | 1 files |
| Phase 16 P04 | 5min | 3 tasks | 4 files |
| Phase 16 P05 | 6min | 3 tasks | 4 files |
| Phase 17 P01 | <1min | 2 tasks | 3 files |
| Phase 17 P02 | <1min | 3 tasks | 3 files |
| Phase 18 P01 | 9min | 3 tasks | 10 files |
| Phase 18 P02 | 27min | 3 tasks | 2 files |
| Phase 19 P01 | 9min | 2 tasks | 6 files |
| Phase 19 P02 | 8min | 2 tasks | 5 files |
| Phase 19 P04 | 7min | 2 tasks | 4 files |
| Phase 19 P03 | 6min | 2 tasks | 2 files |

## Accumulated Context

### Roadmap Evolution

- Phase 09.1 inserted after Phase 09: CI-login-E2E — Playwright login helper 의 POST /auth/login 401 이슈 조사 (URGENT)
- Phase 10.1 inserted after Phase 10: SMS API v3 전환 — 2FA PIN API(/2fa/2/pin)에서 일반 SMS API(/sms/3/messages)로 리팩토링, applicationId/messageId 의존 제거, PIN 생성·검증 자체 구현 (URGENT)
- Phase 13 added: 브랜드명 grapit → grabit 일괄 rename (SEED-002 surfaced after Phase 12 ship, 2026-04-22)
- Phase 14 added (2026-04-24): SMS OTP CROSSSLOT fix — Phase 13 UAT Gap test 10. Valkey Cluster mode 에서 sms.service.ts 3개 key 공통 hash tag 없이 EVAL → CROSSSLOT. phone-verification.tsx 가 res.message 를 UX 에서 마스킹하여 "틀린 인증번호" 로 오표시. Reference: .planning/debug/signup-sms-otp-verify-wrong.md + commit b382e39 (booking.service.ts 동일 패턴 선례)
- Phase 15 added (2026-04-24): Resend heygrabit.com cutover — Phase 13 UAT Gap test 9. Plan 03/04 가 명시적으로 deferred 처리한 RESEND_FROM_EMAIL secret 값 교체 + Resend 콘솔 heygrabit.com 도메인 verification + DNS SPF/DKIM/DMARC 후이즈 등록. Reference: .planning/debug/password-reset-email-not-delivered-prod.md
- Phase 16 added (2026-04-24): Legal pages launch — Phase 13 UAT Gap test 11 (pre-existing feature gap). apps/web/app/legal/{terms,privacy,marketing} 신규 구현 + Footer href="#" 플레이스홀더 교체. 한국 개보법·정통망법 상시 공개 URL 런칭 요건. Reference: .planning/debug/legal-pages-404-heygrabit.md
- Phase 17 added (2026-04-24): Local dev health indicator fix — Phase 13 UAT Gap test 1 (pre-existing Phase 7-05 버그). InMemoryRedis mock 에 ping() 미구현 → Terminus 503. InMemoryRedis.ping() 추가 + capability probe. Reference: .planning/debug/local-api-health-503-no-redis.md

### Decisions

Full decision log in PROJECT.md Key Decisions table (10 decisions, all Good).

- [Phase 06]: Guard에서 factory 패턴 대신 개별 클래스 + 공통 헬퍼 함수 패턴으로 NestJS DI 안정성 확보
- [Phase 06]: OAuth provider 봇 감지로 callback URL 직접 접근 방식의 E2E 테스트 구성
- [Phase 08]: S3Client forcePathStyle: true 추가로 R2 path-style URL 호환성 확보
- [Phase 08-r2]: remotePatterns에 spread+조건부 패턴으로 환경변수 미설정 시 빈 배열 유지
- [Phase 08-r2]: R2 credentials를 secrets 섹션에 배치하여 T-08-04 위협 완화
- [Phase 16-01]: Wave 0 RED 상태를 artifact 생성과 behavioral GREEN 상태로 분리 추적한다 — Plan 16-01 테스트는 후속 wave 구현 전까지 실패가 정상이며, collect 성공을 완료 기준으로 삼는다
- [Phase 16-01]: metadata test는 import.meta.glob lazy lookup으로 작성한다 — Vite transform 단계에서 미생성 page literal import가 테스트 collection을 막는 것을 방지한다
- [Phase 16-02]: Legal page metadata keeps production indexing but forces non-production noindex through process.env.GRABIT_ENV === 'production'. — Prevents preview/staging placeholder indexing while preserving the production SEO/indexing contract.
- [Phase 16-02]: Public legal pages use ?raw markdown imports while preserving existing .md imports for signup dialogs. — Keeps Vitest/Vite module loading compatible for page modules without changing the existing dialog import contract.
- [Phase 16-03]: Footer exposes only terms/privacy legal pages; /legal/marketing remains hidden from global navigation. — D-04 keeps marketing consent available only through consent-specific flows, not global Footer navigation.
- [Phase 16-03]: Customer support uses native mailto anchor instead of Next.js Link. — mailto is browser/OS mail-client behavior, not internal Next.js navigation.
- [Phase 16-04]: Privacy KOPICO heading verification preserved existing '개인정보의 처리 목적' H2 rather than changing protected 1~9조 for an over-specific grep.
- [Phase 16-05]: LegalDraftBanner deleted rather than runtime-flagged. — D-05 defines launch readiness as complete removal of the draft surface.
- [Phase 16-05]: Signup dialogs keep prop-less TermsMarkdown. — DialogTitle remains the only visible title and D-11 dialog compatibility is preserved.
- [Phase 16-05]: Cutover prerequisites centralized in 16-HUMAN-UAT.md. — Business values, mailbox checks, generic placeholder grep, and post-deploy URL/Footer/dialog checks remain operational gates for Plan 16-06.
- [Phase 17]: Use a two-layer local health fix. — Add `InMemoryRedis.ping()` for ioredis surface parity and keep a RedisHealthIndicator capability probe so future local/test fallbacks without `ping()` report local fallback as up without masking real Redis ping failures.
- [Phase 18-01]: Reset confirm remains raw fetch via apiUrl so token-invalid 401 stays on invalid-link UI.
- [Phase 18-01]: Production Next rewrites return [] and localhost /api + /socket.io rewrites are development-only.
- [Phase 18-01]: deploy-web validates CLOUD_RUN_API_URL before Docker build and blocks empty or loopback origins.
- [Phase 18-02]: Use the user's checkpoint approval as the production email-to-confirm-to-login completion signal.
- [Phase 18-02]: Do not fabricate Sentry email-service zero-count; record the operator-approved evidence caveat instead.
- [Phase 18-02]: Keep no-PII redaction gates as the release evidence guard for the UAT artifact.
- [Phase 19-01]: Treat backend ownership helper and ReservationService failures as intentional RED evidence for later Phase 19 implementation plans.
- [Phase 19-01]: Keep all new tests in existing files per D-21, with only the planned new web hook test file.
- [Phase 19-01]: Do not modify runtime code in 19-01; this plan establishes the executable contract only.
- [Phase 19-02]: Assert helpers read only per-seat lock KEYS and do not mutate stale index sets; consume deletes only requested owned locks atomically.
- [Phase 19-02]: InMemoryRedis marker dispatch mirrors the Valkey ownership tuple contract while production REDIS_URL hard-fail remains unchanged.
- [Phase 19-04]: Confirm-page lock failure disables payment CTA and prevents Toss requestPayment after prepare rejection.
- [Phase 19-04]: Complete-page lock rejection bypasses orderId recovery and renders failed UI state instead of success.
- [Phase 19-04]: Preserve selected seats on prepare lock failure until the user explicitly clicks the recovery CTA.
- [Phase 19-03]: Existing pending orderId returns now require active Valkey ownership for stored reservation seats.
- [Phase 19-03]: Existing payment idempotency remains first and does not require active locks after sold transition.
- [Phase 19-03]: Post-Toss consume failure cancels the Toss payment and skips the DB sold transition.

### Pending Todos

None.

### Blockers/Concerns

- ~~AUTH-01: 소셜 로그인 재로그인 버그~~ -- RESOLVED 2026-04-09. Phase 6 VALIDATION 승인 (PR #11, #12 merged). 카카오/네이버/구글 3 provider 재로그인 E2E 검증 완료, 근본 원인은 Strategy callbackURL 의 `/social/` 세그먼트 누락 (b87001d, 87925b1).
- VALK-03: Valkey eval() 시그니처 차이 -- PARTIAL. 코드 레벨 14/14 verified (testcontainers + Lua 3개 라운드트립), 런타임 3/4 PASS (2026-04-13: /health redis up, 좌석 SET NX+TTL, 카탈로그 캐시 hit 52ms). 남은 미검증: (1) CLUSTER 모드 Valkey 호환성, (2) idle 재연결 장기 안정성. Phase 11 진행 중 관찰 후 closed 처리.
- ~~R2-02: R2 CORS AllowedHeaders 와일드카드 불가~~ -- Phase 08에서 content-type 명시적 지정으로 해결
- ADM-06: 통계 쿼리 캐싱 -- 전제조건(Phase 7 Valkey 전환) 완료. Phase 11 어드민 대시보드에서 캐시 레이어 활용 대상으로 이관.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260409-obb | CI 파이프라인 실패 수정 | 2026-04-09 | c937274 | [260409-obb-ci](./quick/260409-obb-ci/) |
| 260409-os1 | 프로덕션 소셜로그인 쿠키 SameSite 버그 수정 | 2026-04-09 | 21eb3d6 | [260409-os1-gcloud](./quick/260409-os1-gcloud/) |
| 260413-jw1 | seed.mjs에 어드민 유저(admin@grapit.test) 추가 | 2026-04-13 | 7bd1753 | [260413-jw1-admin-grapit-test](./quick/260413-jw1-admin-grapit-test/) |
| 260413-k99 | 프로덕션 어드민 접속 불가 수정 (proxy.ts 쿠키 체크 제거) | 2026-04-13 | 5f15b7a | [260413-k99-admin-grapit-test-cli](./quick/260413-k99-admin-grapit-test-cli/) |
| 260417-ghv | 국제 전화번호 입력 UX 개선 — 국가코드 선택 라이브러리 도입 (react-phone-number-input + shadcn wrapper) | 2026-04-17 | 4938d74 | [260417-ghv-ux](./quick/260417-ghv-ux/) |
| 260420-et3 | PR #16 코드리뷰 이슈 3건 수정 (sms:attempts 리셋, phone-axis send 5xx 롤백, Infobip groupId=5 검증) | 2026-04-20 | 8ad4a15 | [260420-et3-pr-16-3-sms-attempts-phone-axis-send-5xx](./quick/260420-et3-pr-16-3-sms-attempts-phone-axis-send-5xx/) |
| 260420-fi4 | Phase 10 UI-REVIEW 3건 수정 (phone-verification: button variant, text-caption 토큰, 타이머 aria-live) | 2026-04-20 | ee910f3 | [260420-fi4-phase-10-ui-review-3-phone-verification-](./quick/260420-fi4-phase-10-ui-review-3-phone-verification-/) |
| 260420-cd7 | CD 복구: Phase 10.1 이후 누락된 프로덕션 시크릿 7개 주입 (Infobip 3 + Sentry api/web + Toss secret/client key) — grapit-api-00018 기동 실패 해소 | 2026-04-20 | c84ff98 | [260420-cd7-deploy-secrets-missing-infobip-sentry-toss](./quick/260420-cd7-deploy-secrets-missing-infobip-sentry-toss/) |
| 260420-ci-toss-secrets-restore | CI 복구: 260420-cd7 에서 오판 제거된 TOSS_CLIENT_KEY_TEST / TOSS_SECRET_KEY_TEST 재등록 (D-13 격리 설계상 ci.yml 전용 — deploy.yml 기준 orphan 검사 false positive) | 2026-04-20 | a7ee3d1 | [260420-ci-toss-secrets-restore](./quick/260420-ci-toss-secrets-restore/) |
| 260420-oxe | PR #17 코드리뷰 수정: kstTodayBoundaryUtc() empty-range 버그로 오늘 KPI 3종 항상 0 반환 → kstBoundaryToUtc(1) 로 교체 + 회귀 테스트 10건 추가 | 2026-04-20 | 84a1594 | [260420-oxe-code-review-fix](./quick/260420-oxe-code-review-fix/) |
| 260422-eya | PR #18 코드리뷰 수정: seat-map-viewer handleClick maxSelect 가드가 locked 좌석 클릭을 차단해 parent toast 미발화 → state !== 'locked' 가드 추가 + 회귀 테스트 3건 (commit 45b884e invariant 복원) | 2026-04-22 | fcc6a7b | [260422-eya-seat-map-viewer-maxselect-locked](./quick/260422-eya-seat-map-viewer-maxselect-locked/) |
| 260424-l23 | Phase 14 pre-existing TTL 2건 수정: sms-throttle.integration.spec.ts 의 throttler key filter 를 실제 라이브러리 format (`{<tracker>:<throttlerName>}:hits`) 에 맞춰 `.endsWith(':hits')` 로 전환 → 28/30 → 30/30 green, Phase 14 ci.yml `test:integration` PR green 블로커 해소 | 2026-04-24 | e65fa99 | [260424-l23-sms-throttle-integration-spec-ts-l220-27](./quick/260424-l23-sms-throttle-integration-spec-ts-l220-27/) |
| 260427-kch | 회원가입 가입완료 시 410 EXPIRED 차단 핫픽스: `auth.service.ts` register/completeSocialRegistration 가 OTP 코드를 `verifyCode` 로 재호출 → Lua 가 OTP 키 DEL 후 EXPIRED 반환 → GoneException. `SmsService.isPhoneVerified` 추가 + GoneException catch fallback 으로 `{sms:{e164}}:verified` 플래그(TTL 600s) idempotency 확인 (sms.service.ts:385-403 자체 권고 반영). 8 회귀 테스트 추가, 315/315 green. main 직접 머지(PR #21) → Cloud Run 자동 배포 | 2026-04-27 | 9b38358 (hotfix/main) | [260427-kch-410-expired-auth-service-ts-verifycode](./quick/260427-kch-410-expired-auth-service-ts-verifycode/) |
| 260427-lyr | 프로덕션 소셜 로그인(Google/Kakao/Naver) 100% 실패 핫픽스 (2 라운드, ✅ verified 2026-04-27): R1 `useRef` 가드는 콜백 페이지 내부 중복만 막고 부족 — root layout `<AuthInitializer />`(`apps/web/components/auth/auth-initializer.tsx` ← `apps/web/app/layout.tsx:24`)가 매 페이지 마운트마다 `initializeAuth()`로 `/auth/refresh`를 호출, 콜백 페이지 IIFE와 cross-component race → `auth.service.ts:167-174` 토큰 도난 탐지로 family revoke → 401. R2 콜백 페이지의 `/auth/refresh`+`/users/me` IIFE 제거하고 `useAuthStore`(`user`, `isInitialized`) 관측 모델로 전환 — AuthInitializer 단일 호출자화로 race 자체 소거. `hasRedirectedRef`로 push 1회 보장. 백엔드 정책 불변. PR #23 (R1) + PR #24 (R2) 머지 후 사용자 프로덕션 검증 완료. | 2026-04-27 | 70a3f65 (R1) → 56826c6 (R2) | [260427-lyr-social-login-refresh-double-fire-fix](./quick/260427-lyr-social-login-refresh-double-fire-fix/) |
| 260427-pcf | 프로덕션 admin 포스터 업로드 100% 차단 핫픽스 (이중 결함, ✅ verified 2026-04-28): (1) `@aws-sdk/client-s3@3.1020` 이 PutObject 에 자동 부착하는 `x-amz-checksum-crc32` / `x-amz-sdk-checksum-algorithm` 두 헤더가 R2 presigned PUT 을 simple request → preflight 필요 요청으로 격상시킴, (2) `grapit-assets` 버킷 CORS 의 `allowed_headers` 가 `content-type` 하나만 등록되어 모든 `x-amz-*` 헤더 차단. 코드: `S3Client` 에 `requestChecksumCalculation: 'WHEN_REQUIRED'` + `responseChecksumValidation: 'WHEN_REQUIRED'` 추가로 헤더 제거 → 단순 PUT 복구 (회귀 테스트 1건, 321/321 green). 인프라: `wrangler r2 bucket cors set grapit-assets` 로 origins 4종(heygrabit.com 외) + headers 11종(checksum 4종 포함) 화이트리스트 확장 적용 (`grapit-assets-cors.json` 아티팩트 보존, commit 7d7ec4d). PR #26. | 2026-04-28 | 2642b24 (code) → 7d7ec4d (cors docs) | [260427-pcf-r2-cors](./quick/260427-pcf-r2-cors/) |

## Session Continuity

Last session: 2026-04-30T06:50:36.059Z
Stopped at: Phase 20 plan 20-04 human verification checkpoint
Resume file: .planning/phases/20-valkey-production-connectivity-contract/20-HUMAN-UAT.md

**Planned Phase:** 15 (resend-heygrabit-com-cutover-transactional-email-secret-mana) — 3 plans — 2026-04-24T08:54:14.266Z
