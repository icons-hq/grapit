# Grapit

## What This Is

공연·전시·스포츠 라이브 엔터테인먼트 티켓 예매 플랫폼. 장르별 큐레이션, SVG 기반 좌석 선택, Toss Payments 결제, 실시간 좌석 동기화를 갖춘 MVP가 배포되어 있다. 1인 개발, Next.js 16 + NestJS 11 모듈러 모놀리스.

## Core Value

사용자가 원하는 공연을 발견하고, 좌석을 직접 선택하여, 안정적으로 예매를 완료할 수 있는 것. 이 흐름이 끊기면 서비스의 의미가 없다.

## Current Milestone: v2.0 Fanmeet Launch

**Goal:** 2026-07-04 Girl Rules fanmeet을 무사 진행하기 위해, heygrabit.com 위에 1~2만 동접 흡수 가능한 5개국 다국어 + 4종 결제 + 운영팀 풀 콘솔을 구축하여, 2026-05-15 광고 오픈 → 2026-05-말 부하 PASS 후 결제 cutover/티켓팅 오픈 → 2026-07-04 행사 종료까지 단일 critical incident 0건으로 운영한다.

**Target features:**
- Deferred v1.1 launch-readiness gates: operator UAT, validation backfill, operational hardening
- Production-compatible feature flags, expand-only migrations, canary deploy, Cloud Run min/max/prewarm policy
- 5-locale i18n (`ko`, `en`, `th`, `zh-CN`, `zh-TW`) with Korean root URLs preserved
- LINE login, 5-country SMS verification, multinational consent/audit log, legal/footer readiness
- Queue, WAF, Cloud Run prewarm, k6 load tests, DR drills, on-call playbooks before payment cutover
- Multi-floor SVG booking, 4 payment methods, refund state machine, random cancelled-seat holding, QR issuance
- Admin event/content/CS/audit console, QR scan console, event-day operations, settlement/export/retrospective

## Requirements

### Validated

- ✓ 회원 인증 (이메일/소셜 로그인, 세션 유지, 토큰 관리) — v1.0
- ✓ 공연 카탈로그 (장르별 카테고리, 상세 정보, 포스터, 가격) — v1.0
- ✓ 통합 검색 (공연명, 장르 필터, 판매종료 토글) — v1.0
- ✓ Admin MVP (공연 CRUD, 회차 관리, SVG 좌석맵 업로드, 예매 조회/환불) — v1.0
- ✓ SVG 기반 좌석 배치도 (등급별 구분, 실시간 점유 상태, 확대/축소) — v1.0
- ✓ 예매 플로우 (날짜/회차 선택 → 좌석 선택 → 결제 → 완료) — v1.0
- ✓ 좌석 임시 점유 (Redis SET NX, 10분 TTL, 자동 해제) — v1.0
- ✓ Toss Payments 결제 연동 (카드/카카오페이/네이버페이/계좌이체) — v1.0
- ✓ 예매 확인/취소/환불 (마이페이지) — v1.0
- ✓ 모바일 반응형 + 스켈레톤 UI + 한국어 에러 핸들링 — v1.0
- ✓ CI/CD + Docker + Sentry + Cloud Run 배포 — v1.0
- ✓ Upstash Redis 제거, ioredis 단일 클라이언트로 Google Memorystore for Valkey 전환 — Phase 7 (v1.1) *(코드 레벨 완료, 런타임 검증은 07-HUMAN-UAT.md)*
- ✓ 공연 카탈로그 Redis 캐시 레이어 (read-through + admin CRUD 무효화) — Phase 7 (v1.1)
- ✓ 프로덕션 password reset email → confirm → login flow가 public API origin을 사용하고 localhost rewrite에 의존하지 않음 — Phase 18 (v1.1) *(Sentry email-service 독립 관측은 caveat로 추적)*
- ✓ 소셜 로그인 재로그인 실패 수정 증거 추적성 복구 — Phase 6 evidence backfilled in Phase 21 (v1.1)
- ✓ Cloudflare R2 API 토큰/버킷, CORS, 프로덕션 업로드/서빙 증거 추적성 복구 — Phase 8 evidence backfilled in Phase 21 (v1.1) *(custom-domain cutover R2-04는 Active로 유지)*
- ✓ SMS OTP v3 자체 구현 + Valkey hash-tag CROSSSLOT 방어 — Phase 10/10.1/14 (v1.1) *(real-device operator gate는 v2.0 preflight로 이월)*
- ✓ Admin dashboard + 통계 캐시 + 차트 UI — Phase 11 (v1.1)
- ✓ UX 현대화 + SVG 좌석맵 미니맵/터치 타겟/선택 피드백 — Phase 12 (v1.1)
- ✓ Grabit brand/domain cutover + heygrabit.com transactional email 기반 — Phase 13/15 (v1.1) *(legacy cleanup과 Naver/Daum inbox observation은 v2.0 gate로 이월)*
- ✓ Legal public pages 구현 + Footer URL 교체 — Phase 16 (v1.1) *(법무/operator sign-off는 v2.0 gate로 이월)*
- ✓ Reservation/payment lock ownership enforcement — Phase 19 (v1.1)

### Active

- [ ] v2.0 Phase 22-24 launch preflight/quality/hardening gates completed before fanmeet implementation
- [ ] M1 advertising open on 2026-05-15 with 5-language event surface, signup, admin content, queue/WAF/prewarm basics, and booking disabled
- [ ] M2 pre-cutover gates on 2026-05-22~26: k6 10k/20k PASS, DR PASS, on-call/Sentry/WAF readiness PASS
- [ ] M2 payment cutover at 2026-05-말 only after gates pass: Toss live keys + `BOOKING_ENABLED=true` + 4 payment paths + QR issuance
- [ ] M3 event operations by 2026-07-04: QR verification, duplicate/tamper detection, offline fallback, field monitoring, incident playbooks
- [ ] M4 post-event close by 2026-07-10: entry export, no-show list, settlement data, retrospective

### Out of Scope

- 대기열 시스템 — 트래픽 낮은 초기에는 불필요
- 랭킹 시스템 — 예매 데이터 축적 필요
- 오픈예정/티켓캐스트 — 사용자 기반 확보 후
- 프로모션/타임딜/쿠폰 — 마케팅 단계에서 추가
- 로터리 티켓(추첨제) — 높은 구현 복잡도
- 관람후기/기대평 — 소셜 기능은 코어 플로우 안정 후
- 다국어 지원 — 한국 시장 집중
- 모바일 앱 (Expo) — 웹 우선 검증, PMF 확인 후
- 실시간 채팅/커뮤니티 — 서비스 성격에 맞지 않음
- 본인인증(PASS) — 초기에는 불필요
- 인라인 SVG 좌석맵 편집기 — 외부 도구에서 제작 후 업로드로 충분

## Context

### Current State (v2.0 started — 2026-05-04)

- **Shipped version:** v1.1 안정화 + 고도화 archived/tagged after Phase 21. Full archive: `.planning/milestones/v1.1-ROADMAP.md`, `.planning/milestones/v1.1-REQUIREMENTS.md`, `.planning/milestones/v1.1-MILESTONE-AUDIT.md`
- **Current focus:** v2.0 Fanmeet Launch initialized from `docs/v2.0-fanmeet-milestone-spec.md`. Phase 22-24 are deferred launch preflight/quality/hardening gates, then Phase 25+ implements the Girl Rules fanmeet launch surface.
- **v1.1 milestone 완료:** Phase 6~21 closed. Phase 22-24는 v2.0 Fanmeet Launch로 이월
- **Phase 12 산출:** shadcn UI 시스템 modernize(globals.css 토큰), 좌석 선택 visual feedback(Option C useEffect fill transition + 체크마크 fade-in/out), react-zoom-pan-pinch 내장 MiniMap viewport rect 동기화, 모바일 WCAG 2.5.5 터치 타겟(44.8px first paint), admin SVG unified parsing contract (`[data-stage]` root+descendant + enum), UX-01~UX-06 6개 requirement 모두 validated
- **Tech stack:** Next.js 16 + React 19 + Tailwind CSS v4 + NestJS 11 + Drizzle ORM + PostgreSQL 16 + Google Memorystore for Valkey (ioredis) + Socket.IO + Toss Payments + Infobip SMS v3
- **배포:** Cloud Run (서울 asia-northeast3), GitHub Actions CI/CD, Sentry 에러 추적
- **테스트 (phase 12 시점):** 백엔드 63+, 프론트엔드 vitest 136/136 GREEN (20 files), typecheck 0 errors, lint 0 errors
- **알려진 기술 부채:** D-19 admin SVG client-side validation only → §Security Debt로 공식 tracked. 추후 별도 security phase에서 해소 예정
- **Phase 12 잔여 UAT:** 12-HUMAN-UAT.md 3건 (admin/dashboard 시각 톤앤매너 · 실 모바일 터치 오탭 · hydration warning 0건) — 자동 검증 PASS + plan 12-03.5 smoke test 간접 증거 완비, 추후 prod smoke로 최종 close
- **Phase 13 완료 (2026-04-23):** 브랜드 `grapit → grabit` 일괄 rename + heygrabit.com apex/www + api 라이브 (LB SNI 3-host HTTPS 200). 7-day grace cleanup + 실기기 HUMAN-UAT 수동 잔여
- **Phase 14 완료 (2026-04-24):** SMS OTP CROSSSLOT fix — `{sms:${e164}}:<role>` hash-tag 스킴으로 전환, 4-심볼 module export(smsOtpKey/smsAttemptsKey/smsVerifiedKey/VERIFY_AND_INCREMENT_LUA)를 Plan 02/03 통합 테스트의 single source of truth 로 확정, cluster-mode CROSSSLOT 회귀 가드(`sms-cluster-crossslot.integration.spec.ts`) + ci.yml `test:integration` step 추가, phone-verification server-message-priority(D-07/D-08) UX 분기. 자동 검증 8/9 (api 283/283 + web 143/143 green, typecheck 0 errors, code review 0 critical). 잔여 HUMAN-UAT 3건: SC-1 실기기 프로덕션 SMS 인증 · ci.yml integration step PR green · pre-existing `sms-throttle.integration.spec.ts` TTL 2건 (@grabit rename 여파 — deferred-items.md)
- **Phase 18 완료 (2026-04-29):** Password reset production API origin fix — production `next.config.ts` rewrites가 `[]`로 고정되어 `/api`/`socket.io`가 `localhost:8080`으로 새지 않으며, web API callers는 `apiUrl()`을 통해 `https://api.heygrabit.com` public origin을 사용한다. 최종 Cloud Run web revision `grabit-web-00023-62r`, API revision `grabit-api-00021-nnn` 기준 reset email → confirm POST 200 → login success evidence 기록. 자동 검증 web 186/186, API auth/email 323/323 green. 잔여 caveat: Sentry `component:email-service` zero-count/event-id는 독립 확인하지 않고 operator-approved caveat로 추적.
- **Phase 21 완료 (2026-05-04):** Verification artifact backfill — Phase 06 `AUTH-01`, Phase 08 `R2-01..R2-04`, Phase 13/15 missing verification artifact를 기존 evidence에 맞춰 복구. Phase 08 `R2-04` custom-domain cutover는 `PARTIAL`/Pending으로 유지했고, Phase 13/15 operator evidence는 `human_needed` caveat를 보존. `pnpm build`, `pnpm test` green.
- **v1.1 close caveat:** `audit-open` 70개 항목은 deferred로 승인 처리되어 `.planning/STATE.md` `Deferred Items`에 기록. 이 중 launch-facing operator/human-needed evidence는 v2.0 Phase 22-24에서 처리.

### 참조 사이트
NOL 티켓(nol.interpark.com/ticket)을 상세 분석한 5개 문서가 docs/에 있음:
- `01-SITE-ANALYSIS-REPORT.md` — 사이트맵, URL 패턴, GNB, 예매 플로우
- `02-PRD.md` — 기능 요구사항 (P0~P2), 사용자 페르소나, 데이터 모델
- `03-ARCHITECTURE.md` — 시스템 아키텍처, ERD, API 설계, 동시성 처리
- `04-UIUX-GUIDE.md` — 디자인 토큰, 컴포넌트, 레이아웃, 접근성
- `05-ADMIN-PREDICTION.md` — 관리자 기능 역추론

### 타겟 페르소나
1. 공연 매니아 "지현" (28세) — 월 2~3회 관람, 좌석 위치 민감, 캐스팅 체크
2. 캐주얼 관람객 "민수" (35세) — 가족 단위, 할인 관심, 모바일 우선
3. 콘서트 팬 "수진" (22세) — 티켓팅 경쟁, 간편결제 선호

## Constraints

- **1인 개발**: 모든 영역(프론트/백/인프라)을 혼자 담당 — 복잡도를 최소화하고 모놀리스 우선
- **Tech Stack**: docs/03-ARCHITECTURE.md에 정의된 스택을 그대로 따름
- **결제**: Toss Payments SDK 연동 (PG사 계약 및 사업자등록 필요)
- **인프라**: GCP 서울 리전 (asia-northeast3) 기반, 초기 min-instances=0으로 비용 최소화
- **SVG 좌석맵**: MVP부터 SVG 기반 좌석 선택 구현 (외부 제작 SVG 업로드 방식)
- **v2.0 일정**: 2026-05-15 광고 오픈, 2026-05-말 payment cutover, 2026-07-04 행사, 2026-07-10 정산/회고
- **v2.0 cutover gate**: 부하 PASS, DR PASS, on-call PASS 전에는 `BOOKING_ENABLED=true`로 전환하지 않는다
- **v2.0 기존 prod 무중단**: 회원, 예매, 세션, 한국어 root URL을 보존하고 DB 변경은 expand-then-contract로만 진행
- **v2.0 compliance trade-off**: 외부 법무 검토 없이 한국 PIPA 표준 템플릿 + 영문 일반 안내문 수준으로 진행하며, 국외이전 동의는 필수로 받는다
- **v2.0 scope exclusion**: 알림 신청, 별도 landing page, WeChat login, PASS 본인인증, LaunchDarkly, 모바일 앱은 milestone 범위에서 제외

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| NestJS 모듈러 모놀리스 | 1인 개발에서 마이크로서비스는 오버헤드 | ✓ Good — 5개 모듈 깔끔하게 분리, 배포 단순 |
| PostgreSQL 기반 검색 (ES 제거) | tsvector + pg_trgm으로 충분 | ✓ Good — <100k 규모에서 성능 문제 없음 |
| Toss Payments | SDK 기반 연동 용이, 개발자 경험 최상 | ✓ Good — SDK v2 위젯 연동 완료, 4개 결제 수단 |
| SVG 좌석맵 MVP 포함 | 핵심 차별점, 등급 자동배정은 UX 열화 | ✓ Good — react-zoom-pan-pinch로 모바일 포함 구현 |
| Cloud Run (GCP) | 서울 리전 저지연, 자동 확장 | ✓ Good — Docker 빌드 + CI/CD 파이프라인 완성 |
| Admin을 /admin 라우트로 | 별도 앱 분리 불필요 | ✓ Good — LayoutShell 조건부 렌더링으로 깔끔 분리 |
| Drizzle ORM (TypeORM/Prisma 제외) | 14x 낮은 지연, ~7kb 번들, SQL-first | ✓ Good — 스키마 기반 zod 통합, 빠른 cold start |
| Access token Zustand 메모리 저장 | OWASP XSS 방어 best practice | ✓ Good — localStorage 노출 없음, 401 자동 refresh |
| ~~Redis 이원화 (Upstash HTTP + ioredis TCP)~~ | ~~Pub/Sub는 TCP 필수, 나머지는 서버리스 HTTP~~ | ✗ Reversed in Phase 7 — ioredis 단일화 + Google Memorystore for Valkey(VPC private endpoint)로 전환. 이원화의 운영 복잡도가 Valkey 전환 비용보다 커서 `@upstash/redis` 제거 |
| ioredis 단일 클라이언트 + Memorystore Valkey | Cloud Run Direct VPC Egress로 private endpoint 직결, Lua 스크립트 호환성 + Socket.IO Redis adapter 양쪽을 동일 클라이언트로 처리 | Phase 7 — 코드 완료 (plans 01~05), 배포 후 런타임 검증 4건 대기 |
| Production REDIS_URL hard-fail + InMemoryRedis dev-only | 미설정 시 silent fallback → 조용한 운영 장애 원인이 됨. `NODE_ENV=production`이면 throw, dev/test만 mock 허용 | Phase 7 Plan 04 — cross-AI 리뷰 HIGH #1 대응 |
| CacheService invalidate best-effort | Redis 장애가 admin CRUD API를 500으로 떨어뜨리면 안 됨 → try/catch + warn 로그만 | Phase 7 Plan 04 — cross-AI 리뷰 MEDIUM #6 대응 |
| testcontainers 기반 Valkey 통합 테스트 (격리 vitest config) | Lua 스크립트가 실제 Valkey Lua 5.1 interpreter에서 돌아가는지 단위 테스트로는 검증 불가. `pnpm test:integration`으로만 실행되어 기본 피드백 루프 보호 | Phase 7 Plan 05 — cross-AI 리뷰 HIGH #2 대응 |
| HealthController Valkey ping (Terminus 11) | Cloud Run liveness probe가 Valkey 장애를 즉시 감지 → silent outage 차단 | Phase 7 Plan 05 — cross-AI 리뷰 MEDIUM #7 대응 |
| Family-based refresh token rotation | 토큰 탈취 감지 | ✓ Good — SHA-256 해시 저장, 가족 단위 무효화 |
| v2.0 i18n URL policy | 기존 SEO를 보존하면서 해외 사용자를 지원해야 함 | Pending — `localePrefix: "as-needed"`, Korean `/`, foreign `/en` `/th` `/zh-CN` `/zh-TW` |
| v2.0 payment cutover gate | 부하/DR/on-call 증거 없이 실 티켓팅을 열면 플랫폼 신뢰가 손상됨 | Pending — k6 + DR + on-call PASS 전 `BOOKING_ENABLED=true` 금지 |
| v2.0 legal translation lock | 자동 번역 legal copy는 분쟁 리스크가 큼 | Pending — 법적 고지는 한/영 수동 입력만 허용, 태/중 사용자는 영어 고지 확인 |

## Security Debt

Known security concerns deferred to a future security phase. Tracked to prevent silent accumulation.

- **Phase 12 admin SVG client-side validation only (2026-04-21, reviews revision D-19):**
  현재 `apps/web/components/admin/svg-preview.tsx`는 DOMParser 기반 stage 마커 검증을 **클라이언트에서만** 수행한다.
  Admin 계정이 탈취되거나 API가 우회되면 악성 SVG (`<script>` / event handler / XSS payload)가 R2에 업로드되어
  `dangerouslySetInnerHTML`로 viewer에서 렌더링될 수 있다.
  - Mitigation 예정: 서버측 re-validation (API DTO) + DOMPurify SVG profile + CSP strict-dynamic
  - Risk level: MEDIUM (admin 공격 surface 한정)
  - Tracking: 12-REVIEWS.md LOW #9, 12-CONTEXT.md D-19 SECURITY DEBT NOTE

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-04 after v2.0 Fanmeet Launch milestone initialization*
