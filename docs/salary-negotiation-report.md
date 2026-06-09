# Grabit 단독 개발 기여 보고서

작성일: 2026-06-08  
목적: 연봉 협상 및 개인 성과 설명용  
작성 기준: 현재 repository, `package.json`, `docs/02-PRD.md`, `docs/03-ARCHITECTURE.md`, `.github/workflows/*`, ADR, module/route/test 구조

## 1. Executive Summary

Grabit은 공연, 팬미팅, 팝업 등 live-entertainment ticketing과 현장 운영을 하나의 제품으로 묶은 예매 플랫폼이다. 본인은 이 프로젝트를 기획 단계부터 production 운영까지 단독으로 구축했다.

단순히 화면 몇 개를 구현한 수준이 아니라, 구매자 예매 흐름, 좌석 선택, 결제, 환불, QR 티켓, 현장 입장 처리, 운영자 admin, 정산 export, 보안 권한, CI/CD, production deployment, incident 대응까지 제품 전 영역을 혼자 설계하고 구현했다.

핵심 기여는 다음과 같다.

- `discover -> authenticate -> select seats -> pay -> receive QR ticket -> venue entry -> refund/settlement operations` 전체 customer journey 구현
- Next.js web, NestJS API, shared contract package로 구성된 pnpm monorepo 설계 및 운영
- PostgreSQL, Drizzle ORM, Redis/Valkey, Socket.IO, pg-boss, Cloudflare R2, Toss Payments, OAuth, Cloud Run을 조합한 production-grade architecture 구축
- 좌석 lock, queue admission, payment confirmation, QR issuance, field check-in처럼 장애 시 매출과 현장 운영에 직접 영향을 주는 핵심 경로 구현
- admin booking, admin users, settlement, support, security, audit, field monitor, cutover gate 등 운영자 도구 구축
- GitHub Actions 기반 CI/CD, migration, Docker image build/push, Cloud Run deploy, Playwright E2E, integration test 체계 구축
- production incident와 launch readiness 대응을 통해 실제 운영 가능한 수준까지 안정화

이 프로젝트에서 본인의 역할은 frontend developer, backend developer, product engineer, platform engineer, QA engineer, DevOps owner, production operator를 모두 포함한다.

## 2. 객관 지표

현재 local repository snapshot 기준으로 확인한 정량 지표다.

| 항목 | 수치 |
| --- | ---: |
| `HEAD` 기준 commit 수 | 1,973 |
| `git shortlog -sn --all` 기준 author | Sangwoo Park 단독 |
| backend business module 수 | 20 |
| web App Router page/API route 수 | 37 |
| DB schema file 수 | 42 |
| Drizzle migration file 수 | 30 |
| TS/TSX/SQL source file 수 | 740 |
| test file 수 | 223 |
| API test file 수 | 94 |
| Web test file 수 | 115 |
| Shared package test file 수 | 14 |
| Playwright E2E spec 수 | 20 |
| 지원 locale | `ko`, `en`, `th`, `zh-CN` |

이 수치는 단순 코드량이 아니라, 제품의 기능 범위와 검증 체계가 모두 단독으로 구축되었음을 보여준다.

## 3. 제품 기획 및 도메인 설계

### 3.1 제품 포지셔닝

Grabit을 단순 이벤트 목록 서비스가 아니라 live-event ticketing과 venue operations를 포함한 운영 플랫폼으로 정의했다. 구매자, 해외 구매자, 현장 scanner staff, 공연 운영자, 정산 담당자, admin/security owner까지 사용자 유형을 나누고 각 사용자 job을 제품 기능으로 연결했다.

주요 설계 내용은 다음과 같다.

- 구매자: 이벤트 탐색, 회원가입, 본인 인증, 좌석 예매, 결제, QR 티켓 확인, 취소/환불
- 해외 구매자: 다국어 UI, 국가/전화 입력, 해외 결제 안내, localized booking copy
- 현장 staff: QR verify, manual consume, duplicate scan 방지, offline pending sync
- 운영자: 공연 등록, 좌석도 관리, 예매 현황 확인, 고객 지원, banner/notice 운영
- 정산 담당자: 매출, 환불, 입장 상태, no-show, reservation/payment/refund export
- security owner: admin allowlist, permission bundle, audit, user management

### 3.2 핵심 customer journey 설계

제품의 중심 경로를 다음과 같이 정의하고 구현했다.

```text
discover -> authenticate -> select seats -> pay -> receive QR ticket -> venue entry -> refund/settlement operations
```

이 흐름은 단순 UI 흐름이 아니라 backend transaction, seat inventory, payment provider, QR credential, entry state, admin reconciliation이 모두 연결된 경로다. 본인은 이 경로 전체를 설계하고, 사용자 화면과 운영자 화면 양쪽에서 상태가 일관되도록 구현했다.

## 4. System Architecture 구축

### 4.1 Monorepo 및 package 구조

`pnpm@10.28.1`, Node.js 22, Turborepo 기반 monorepo를 구성했다.

- `apps/web`: Next.js 16 App Router web application
- `apps/api`: NestJS 11 modular monolith API
- `packages/shared`: Zod schema, TypeScript type, constants, locale, feature flag contract

이 구조를 통해 frontend와 backend가 같은 request/response contract를 공유하고, booking/payment/field/admin처럼 cross-boundary payload가 많은 기능에서 drift를 줄였다.

### 4.2 Production architecture

Production은 다음 원칙으로 설계했다.

- PostgreSQL을 durable source of truth로 사용
- Redis/Valkey는 seat lock, queue, throttling, cache, Socket.IO pub/sub처럼 low-latency state에만 사용
- API는 modular monolith로 유지하여 1인 개발 프로젝트에서 운영 복잡도를 줄임
- Cloud Run에 `grabit-web`, `grabit-api`를 분리 배포
- Cloud SQL PostgreSQL, Cloudflare R2, Toss Payments, OAuth provider, Sentry, Cloud Logging을 연결
- production startup에서 unsafe runtime configuration은 fail-closed 처리

### 4.3 기술 스택 선정 및 적용

Frontend:

- Next.js 16, React 19, TypeScript 5.9
- Tailwind CSS v4, Radix UI, lucide-react
- TanStack Query, Zustand, React Hook Form, Zod
- next-intl, Toss Payments SDK, Socket.IO client, Playwright

Backend:

- NestJS 11, Drizzle ORM, PostgreSQL
- ioredis, Socket.IO, pg-boss
- Passport JWT, local, Kakao, Naver, Google OAuth
- Sentry, Throttler, Redis-backed rate limiting
- Toss Payments client, webhook guard, payment exception filter

Shared:

- Zod schemas for auth, user, performance, booking, admin dashboard, consent, field operations, ticket items
- Locale constants and i18n contract
- Feature flag contract
- Seat identity and field check-in ingress helpers

## 5. Frontend 구현 내역

### 5.1 Public discovery

사용자가 이벤트를 찾고 상세 정보를 확인할 수 있는 public surface를 구현했다.

- home route 구현
- genre route 구현
- search route 구현
- performance detail route 구현
- banner, hot events, new events, genre entry point 구현
- performance card, pagination, status badge 구현
- localized title, venue, schedule, price tier, casting, sales status 표시
- ended-state, locale, keyword, pagination query 처리
- mobile/desktop responsive layout 구현

### 5.2 Auth UI

예매 전 인증이 필요한 서비스 특성에 맞춰 auth flow를 구현했다.

- email/password login
- registration flow
- email availability check
- email verification route
- password reset route
- signup consent step
- profile form
- phone verification UI
- Kakao/Naver/Google social callback handling
- auth guard and session recovery UI
- i18n auth copy

### 5.3 Booking UI

Grabit의 가장 중요한 buyer flow인 booking UI를 구현했다.

- `/booking/[performanceId]` seat selection page
- `/booking/[performanceId]/confirm` reservation/payment confirmation page
- `/booking/[performanceId]/complete` booking complete page
- showtime/date picker
- floor selector
- SVG seat map viewer
- seat legend
- seat map zoom/pan controls
- seat selection panel
- selected seat summary
- payment deadline/countdown
- Toss payment widget integration
- booking disabled runtime state handling
- queue admission state handling
- booking route auth guard
- mobile seat selection UX

### 5.4 Reservation/My Page UI

구매자가 예매 이후에도 필요한 정보를 확인하고 취소/환불 상태를 이해할 수 있도록 My Page와 reservation detail을 구현했다.

- My Page account hub
- reservation list
- reservation detail route
- QR ticket card
- payment information display
- refund timeline
- cancellation modal
- ticket email delivery panel
- entry status display
- QR visibility after venue entry
- localized date/time/currency formatting

### 5.5 Field operations UI

현장 입장 처리를 위한 web-first scanner surface를 구현했다.

- `/field/check-in` route
- scanner check-in panel
- QR verify result display
- manual entry consume action
- duplicate/already-used result display
- invalid/refunded/cancelled/expired result handling
- offline sync status
- field monitor UI
- scanner-only workflow design

### 5.6 Admin UI

운영자가 실제 공연 운영을 할 수 있도록 dense operational admin을 구현했다.

Admin route:

- `/admin`
- `/admin/performances`
- `/admin/performances/new`
- `/admin/bookings`
- `/admin/operations`
- `/admin/support-content`
- `/admin/banners`
- `/admin/translations`
- `/admin/seat-operations`
- `/admin/field-monitor`
- `/admin/settlement`
- `/admin/security`
- `/admin/audit`
- `/admin/consent-audit`
- `/admin/users`
- `/admin/cutover`

Admin component:

- performance form
- event publish confirmation
- floor seat map editor
- visual seat tier editor
- SVG preview and upload safety check
- booking dashboard
- reservation export panel
- seat operations panel
- operations inbox
- support content manager
- banner manager
- translation review
- field monitor
- settlement dashboard
- admin user management
- consent audit table

### 5.7 Localization

해외 구매자와 운영 상황을 고려해 다국어 UI를 구축했다.

- `ko`, `en`, `th`, `zh-CN` message file 관리
- Korean prefixless route와 foreign locale route 처리
- customer journey copy localization
- auth, booking, QR, legal, support, search, performance detail copy localization
- i18n parity test와 smoke test 구축

## 6. Backend 구현 내역

### 6.1 NestJS modular monolith

API를 business capability 기준으로 module화했다.

- `AuthModule`
- `UserModule`
- `SmsModule`
- `PerformanceModule`
- `SearchModule`
- `AdminModule`
- `BookingModule`
- `PaymentModule`
- `ReservationModule`
- `FeatureFlagsModule`
- `TranslationModule`
- `ConsentModule`
- `PrewarmModule`
- `TrafficModule`
- `QueueModule`
- `RefundModule`
- `FieldOperationsModule`
- `JobsModule`
- `PgbossModule`
- `HealthModule`

Global prefix, guard, validation, throttling, CORS, helmet, cookie parser, Sentry를 production API bootstrap에 맞춰 구성했다.

### 6.2 Auth and user

예매 자원 보호와 admin surface 보호를 위해 auth backend를 구현했다.

- email registration
- login/logout
- refresh token flow
- email verification
- password reset/recovery
- Kakao social login
- Naver social login
- Google social login
- social complete registration
- JWT guard
- social auth guard
- admin role/capability guard
- user profile read/update
- account withdrawal
- refresh token/device family management

### 6.3 SMS and consent

회원가입 및 예매 전 필수 검증을 구현했다.

- SMS send code
- SMS verify code
- phone verification state
- consent item list
- consent capture
- consent audit
- terms agreement persistence
- legal content integration

### 6.4 Performance and search

공연 catalog와 검색 backend를 구현했다.

- public performance list
- performance detail
- home banner/hot/new API
- search API
- catalog freshness service
- performance cache service
- genre, locale, ended-state, pagination handling
- performance detail image, venue, casting, showtime, price tier data model 연결

### 6.5 Booking and queue

좌석 예매는 동시성, lock ownership, queue admission이 결합된 핵심 기능이다. 본인은 이 경로를 backend transaction과 Redis/Valkey state로 구현했다.

- showtime-scoped seat lock
- lock ownership validation
- max ticket policy enforcement
- lock release and lock-all release
- active lock read
- seat status read
- Socket.IO seat status broadcast
- queue enter/session API
- queue admission guard
- booking mutation guard
- booking disabled runtime flag
- immediate booking admission optimization
- pending payment expiration worker

### 6.6 Reservation finalization

예약 생성과 결제 확정 사이의 transaction boundary를 구현했다.

- reservation prepare
- duplicate seat validation
- account verification validation
- consent validation
- booking policy validation
- lock ownership validation
- canonical seat/tier/price validation
- payment deadline persistence
- confirm lock by order ID
- amount and identity validation
- seat sold transition
- ticket item creation
- QR issuance trigger
- compensation cancellation path
- reservation list/detail API
- buyer cancellation API
- cancellation-pending handling

### 6.7 Payment integration

Toss Payments integration을 frontend widget, backend confirm, webhook, provider state reconciliation까지 구현했다.

- Toss Payments branch API
- Toss confirm API integration
- Toss webhook controller
- webhook guard
- payment provider event persistence
- idempotency handling
- payment state verification
- Korean card payment handling
- foreign easy pay handling
- PayPal/foreign payment routing
- overseas card routing
- provider charge quote model
- payment failure diagnosis support
- payment exception filter
- admin-facing payment funnel and Toss order ID exposure

### 6.8 Refund and cancellation

취소/환불이 좌석 재오픈, 정산, payment provider state와 맞물리도록 구현했다.

- refund preview
- buyer refund request
- admin refund
- refund cancellation retry worker
- cancelled seat release worker
- cancellation fee policy
- provider charge quote-aware refund path
- payment cancellation finalizer
- failed/cancelled reservation export
- audit evidence recording
- controlled seat reopen support

### 6.9 Ticket, QR, and field entry

QR credential과 venue entry state를 분리하여 현장 운영에 맞는 모델을 구현했다.

- QR ticket issue
- QR ticket verify
- QR ticket email delivery
- QR secret version/keyring support
- reservation detail QR read path
- field check-in verify
- field check-in consume
- duplicate scan prevention
- offline sync
- field monitor summary/logs
- ticket scan event persistence
- entry status and QR credential status separation

### 6.10 Admin backend

운영자 console을 위한 backend API를 구축했다.

- admin performance CRUD
- performance publish workflow
- seat map upload
- local upload path
- banner management
- admin dashboard summary/revenue
- admin booking list/detail/export
- admin refund/manual open
- admin booking payment funnel
- seat stats/filter
- admin seat operations
- operations inbox
- support content management
- translation source/draft/review/publish
- settlement summary/export
- admin user management
- raw CSV export with capability/reason gating
- admin security allowlist/permission state
- admin audit
- consent audit
- cutover gate
- diagnostics/prewarm endpoints

## 7. Database 및 data model 설계

### 7.1 Schema 설계

PostgreSQL/Drizzle schema를 제품 도메인 기준으로 설계했다.

Identity/auth:

- `users`
- `social_accounts`
- `refresh_tokens`
- `email_verification_tokens`

Consent/legal:

- `consent_items`
- `consent_audit_logs`
- `terms_agreements`
- `legal_content`

Catalog:

- `performances`
- `venues`
- `showtimes`
- `castings`
- `price_tiers`
- `banners`

Seat/layout:

- `venue_layouts`
- `venue_layout_floors`
- `venue_layout_sections`
- `venue_layout_seats`
- `seat_maps`
- `performance_seat_tiers`
- `performance_seat_assignments`
- `seat_inventories`

Booking/payment/refund:

- `booking_policies`
- `reservations`
- `reservation_seats`
- `ticket_items`
- `payments`
- `payment_webhook_events`
- `refunds`

QR/entry:

- `tickets`
- `ticket_scan_events`

Admin/operations:

- `admin_audit_logs`
- `booking_operation_audit_logs`
- `admin_access_allowlist`
- `seat_operation_history`

Support/translation:

- `support_threads`
- `support_messages`
- `support_faqs`
- `support_notices`
- `translation_sources`
- `translation_drafts`

### 7.2 Migration 운영

30개 migration을 통해 schema를 단계적으로 확장했다. 주요 migration 범위는 다음과 같다.

- launch foundation
- consent audit
- event category
- booking core
- admin operations console
- venue layout template seats
- locale enum backfill
- performance detail images
- admin user management
- account withdrawal
- ticket scan events
- ticket items
- provider charge quotes
- booking starts at

### 7.3 Ticket item architecture

좌석 단위 티켓 생명주기를 위해 `ticket_items`를 도입했다. 기존 `reservation_seats`는 예약 당시 seat snapshot 성격으로 유지하고, ticket lifecycle의 source of truth를 `ticket_items`로 분리했다.

해당 설계로 다음 요구를 처리할 수 있게 했다.

- 좌석 단위 QR credential
- 좌석 단위 입장 상태
- 좌석 단위 cancellation/refund effect
- partial cancellation
- duplicate scan prevention
- settlement/export reconciliation
- admin reservation detail의 seat-level truth

이는 단순 schema 추가가 아니라 booking, payment, refund, QR, scanner, admin, settlement, export 전체에 영향을 주는 architecture rollout이었다.

## 8. 결제 및 매출 핵심 업무

### 8.1 Toss Payments v2 integration

국내/해외 결제 흐름을 server-authoritative 방식으로 구현했다.

- frontend Toss widget rendering
- backend payment branch selection
- reservation order identity validation
- amount validation
- payment confirm lock
- provider state verification
- webhook event persistence
- webhook replay/idempotency handling
- failed/aborted/expired payment state handling
- admin payment status visibility

### 8.2 해외 결제 및 PayPal/foreign payment

해외 구매자 결제 흐름을 위해 provider별 차이를 설계하고 구현했다.

- foreign easy pay handling
- PayPal checkout enable flag
- provider charge quote model
- KRW reservation payable amount과 provider charge amount 분리
- Toss provider contract에 맞춘 confirm flow
- overseas card routing
- server secret-based fail-closed gate
- admin/operator-facing evidence for foreign payment recovery

### 8.3 Payment incident 대응

실제 결제 이슈에서 단순 추측이 아니라 admin, Toss, DB, logs, API state를 대조해 원인을 분류했다.

- 결제대기와 결제실패 구분
- provider approval 전 만료/이탈과 backend confirm 실패 구분
- Toss `orderId`, local `reservationNumber`, `paymentKey` 구분
- in-app browser payment expiry 원인 분석
- Alipay/foreign payment restoration
- cancellation mismatch reconciliation
- admin sold count and revenue reconciliation

이 작업은 매출과 고객 신뢰에 직접 연결되는 production operation 역량이다.

## 9. Admin 및 운영 자동화

### 9.1 Admin booking

운영자가 예매와 결제를 실제로 관리할 수 있도록 admin booking surface를 구현하고 안정화했다.

- reservation list/detail
- payment funnel status
- sold/pending/failed/cancelled/partial-cancelled 구분
- Toss order ID 노출
- payment attempted/completed timestamp 노출
- seat grade stats
- performance/showtime/seat tier/floor/seat query filter
- pagination debounce race fix
- detail modal stability fix
- export coverage 확장

### 9.2 Admin users and security

운영 보안과 개인정보 export 통제를 구현했다.

- admin user list/detail
- user stats
- raw CSV export
- formula-safe CSV
- country ratio
- permission/capability gating
- reason capture
- allowlist/security state
- audit log
- sensitive user action handling

### 9.3 Settlement and export

정산 담당자가 사용할 수 있는 summary와 export를 구현했다.

- settlement dashboard
- reservation/payment/refund export
- entry/no-show export
- ticket item gross/service fee columns
- ticketless reservation export coverage
- failed cancelled contact export
- Excel encoding fix
- item-level reconciliation

### 9.4 Field operations

현장 입장 운영 도구를 구현했다.

- scanner check-in
- offline sync
- duplicate prevention
- field monitor
- scan logs
- entry count/not-entered count/entry rate
- rejection and offline backlog visibility

## 10. CI/CD 및 production 운영

### 10.1 CI 구축

GitHub Actions CI를 구성해 PR마다 핵심 검증이 자동으로 돌도록 했다.

- `pnpm install --frozen-lockfile`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- API integration test
- Drizzle migration
- seed test data
- API server bootstrap smoke
- Playwright browser install
- Playwright E2E
- Toss test secret presence gate
- failure log dump

### 10.2 Deploy workflow 구축

Production deploy workflow를 구축했다.

- production origin validation
- Cloud SQL Auth Proxy startup
- production migration
- API Docker image build/push
- Web Docker image build/push
- Cloud Run API deploy
- Cloud Run Web deploy
- Secret Manager 기반 secret injection
- Cloud SQL instance 연결
- production env var wiring
- min/max instance, concurrency, CPU/memory 설정
- Asia Seoul region 기준 production 배포

### 10.3 Runtime safety

Production 운영 중 silent failure를 줄이기 위해 runtime safety를 구성했다.

- production CORS origin validation
- booking enabled server authority
- Redis/Valkey wiring validation
- rate limiting
- Sentry integration
- Cloud Logging/Monitoring 기반 runtime smoke
- health endpoint
- runtime flags endpoint
- deploy 완료와 business cutover 가능 상태 구분

## 11. Testing 및 quality assurance

### 11.1 Unit/component test

223개 test file을 통해 핵심 기능을 검증했다.

Frontend 검증 예:

- auth page i18n
- signup consent
- phone verification
- booking route auth
- seat map viewer
- Toss payment widget
- booking complete QR
- reservation detail QR
- refund timeline
- admin booking dashboard
- admin user management
- settlement dashboard
- field monitor
- scanner check-in
- i18n routing and message parity

Backend 검증 예:

- auth service/controller
- booking service
- Redis provider
- queue guard
- reservation finalization
- payment service
- Toss webhook guard/controller
- refund service
- QR ticket service
- field check-in/offline sync
- admin booking/dashboard/security/user/settlement
- pg-boss workers
- performance cache/freshness

Shared package 검증 예:

- auth schema
- booking schema
- consent schema
- performance schema
- field operations schema
- ticket item schema
- locale constants
- feature flags
- seat identity

### 11.2 E2E test

20개 Playwright E2E spec을 구축했다.

- Toss payment
- booking queue
- booking floor selection
- booking complete QR
- social login
- signup SMS
- My Page withdrawal
- i18n smoke
- admin dashboard
- admin event publish
- admin export and seat ops
- admin operations inbox
- admin RBAC/security
- admin users
- admin cutover
- QR visibility
- QR check-in
- offline sync

### 11.3 Production verification

단순 local green에서 끝내지 않고 production readiness와 runtime smoke를 확인하는 기준을 만들었다.

- live API health check
- runtime flags check
- Cloud Run revision/status check
- Deploy workflow status check
- admin page HTTP/auth behavior check
- production DB read-only preflight
- Toss/provider state cross-check
- cache invalidation verification
- QR/seat-map propagation verification

## 12. Security, privacy, compliance

Grabit은 결제, 개인정보, QR credential, admin 권한을 다루기 때문에 보안 경계를 직접 설계했다.

- global JWT auth guard
- public endpoint 명시
- admin role/capability guard
- scanner capability 분리
- allowlist 기반 admin/security operation
- raw export reason capture
- formula-safe CSV export
- raw QR payload 비노출
- payment identifier와 PII 출력 제한
- consent audit log
- legal content route
- account withdrawal
- social account cleanup
- production secret은 GitHub/Cloud Run/Secret Manager로 관리

## 13. Documentation 및 운영 runbook

프로젝트가 혼자 개발되어도 지속 운영 가능하도록 docs와 ADR을 작성했다.

주요 문서:

- `docs/02-PRD.md`
- `docs/03-ARCHITECTURE.md`
- `docs/04-UIUX-GUIDE.md`
- `docs/05-ADMIN-PREDICTION.md`
- `docs/adr/0001-seat-level-qr-credentials.md`
- `docs/adr/0002-use-nol-ticket-cancellation-fee-policy.md`
- `docs/adr/0003-use-ticket-items-as-seat-level-ticket-records.md`
- `docs/adr/0004-use-provider-charge-quotes-for-paypal.md`
- `docs/adr/0005-use-admin-pre-open-booking-smoke-on-real-performance.md`
- `docs/runbooks/*`
- `docs/uat/*`

문서 작업은 단순 설명이 아니라 production launch, UAT, cancellation reconciliation, ticketing open evidence gate, seat-level ticket rollout 같은 실제 운영 판단을 지원하는 자료다.

## 14. 대표 성과 사례

### 14.1 Seat-level ticket item rollout

문제:

- reservation 단위 QR/좌석 모델만으로는 좌석 단위 입장, 부분 취소, 정산, export, duplicate scan을 안정적으로 처리하기 어려웠다.

수행:

- `ticket_items` schema 도입
- migration/backfill 설계
- booking finalization에서 seat-level ticket item 생성
- QR, scanner, admin detail, settlement, export를 item-level truth로 전환
- ADR과 UAT 문서 작성

성과:

- 좌석 단위 생명주기 관리 가능
- 부분 취소와 현장 입장 처리의 정확도 향상
- admin/settlement reconciliation 신뢰도 개선

### 14.2 Toss 결제 및 해외 결제 안정화

문제:

- 결제 provider state, local reservation state, webhook state가 어긋나면 매출과 고객 신뢰에 직접 영향을 준다.

수행:

- Toss confirm/webhook integration
- payment branch API 구현
- provider event persistence
- PayPal/foreign easy pay provider charge quote 설계
- overseas card routing과 fail-closed server secret gate 구현
- payment failure/in-app browser expiry 원인 분석

성과:

- payment confirm과 reservation finalization의 server-authoritative 구조 확보
- 해외 결제와 국내 결제 흐름 분리
- production incident에서 원인 분류와 고객/운영 대응 가능

### 14.3 Admin booking 운영 콘솔 고도화

문제:

- 운영자가 단순 예약 상태만 보면 실제 결제/환불/취소 funnel을 판단하기 어렵다.

수행:

- payment funnel 중심 admin booking 설계
- Toss order ID 노출
- sold count null-safe 처리
- seat stats/filter 추가
- payment attempt/completion timestamp 추가
- detail modal 안정화
- export coverage 개선

성과:

- 운영자가 결제 상태와 좌석 판매 상태를 더 정확히 파악
- customer support와 finance reconciliation 속도 향상
- admin 화면의 실제 운영 적합성 개선

### 14.4 Production launch readiness

문제:

- 티켓 오픈은 트래픽, 결제, 좌석 점유, admin 운영, QR 입장까지 한 번에 실패할 수 있는 high-risk release다.

수행:

- booking enabled runtime flag
- queue admission
- traffic defense
- prewarm endpoint
- Cloud Run min/max instance and concurrency 설정
- CI/E2E gate
- UAT/runbook/evidence gate 작성
- live API/runtime smoke 기준 정립

성과:

- launch 직전 code complete와 operator UAT 경계를 분리
- production deploy와 business cutover 가능 상태를 구분
- 장애 대응과 검증 절차를 문서화

## 15. 비즈니스 임팩트

### 15.1 제품 출시 가능성 확보

본인은 아이디어 수준의 티켓팅 서비스를 실제 production deploy 가능한 web/API/admin platform으로 만들었다. 이는 회사 입장에서 별도 frontend, backend, infra, QA, DevOps 인력을 각각 투입해야 가능한 범위다.

### 15.2 매출 경로 직접 구현

예매 서비스의 매출 경로는 좌석 선택, 결제, 예약 확정, QR 발급이다. 본인은 이 경로를 모두 직접 구현했고, payment provider와 backend finalization 사이의 장애까지 대응할 수 있는 구조를 만들었다.

### 15.3 운영 비용 절감

Admin booking, user management, settlement, support, field monitor, cutover, audit를 구현해 운영자가 개발자 없이도 많은 상황을 직접 확인하고 처리할 수 있게 했다.

### 15.4 장애 대응 역량 확보

production payment incident, cache invalidation, QR origin, SVG upload validation, cancellation mismatch 같은 문제를 live truth source 기준으로 분석했다. 이는 단순 기능 개발을 넘어 실제 서비스 안정화 역량에 해당한다.

### 15.5 확장 가능한 기반 확보

Shared contract, modular monolith, DB migration, CI/CD, ADR, runbook, E2E test를 갖춰 이후 기능 추가와 운영 인수인계가 가능한 기반을 만들었다.

## 16. 연봉 협상에서 강조할 핵심 문장

다음 문장은 협상 자리에서 그대로 사용할 수 있는 요약이다.

1. 저는 Grabit을 처음부터 끝까지 혼자 만들었습니다. 단순 frontend 구현이 아니라, 예매, 좌석, 결제, QR, 현장 입장, admin, 정산, 배포, production incident 대응까지 전체 제품 생명주기를 담당했습니다.

2. 현재 repository 기준으로 `HEAD`에 1,973개 commit이 있고, backend module 20개, web route 37개, DB schema 42개, migration 30개, test file 223개, E2E spec 20개가 있습니다. 이 범위는 한 명이 일반적인 feature 몇 개를 개발한 수준이 아니라 제품 전체를 구축한 규모입니다.

3. 제가 만든 핵심 가치는 매출 경로입니다. 좌석 선택, seat lock, queue, Toss payment, reservation finalization, QR ticket issuance까지 예매 서비스의 돈이 흐르는 경로를 직접 설계하고 구현했습니다.

4. 운영자가 실제로 사용할 수 있는 admin도 직접 만들었습니다. 공연 관리, 예매 관리, 결제 funnel, 환불, 좌석 운영, 사용자 관리, 정산 export, 보안 권한, audit까지 운영 업무에 필요한 기능을 구현했습니다.

5. production 운영까지 책임졌습니다. GitHub Actions CI/CD, migration, Docker build, Cloud Run deploy, runtime smoke, production incident 분석, UAT/runbook 문서화까지 구축했습니다.

6. 이 프로젝트에서 저는 한 가지 직무만 수행한 것이 아니라 product engineer, full-stack engineer, platform engineer, QA, DevOps, production operator 역할을 동시에 수행했습니다.

7. 따라서 제 기여는 단순 개발 산출물이 아니라, 회사가 매출을 만들고 운영할 수 있는 production ticketing platform을 단독으로 구축한 성과입니다.

## 17. 협상용 짧은 버전

Grabit은 제가 처음부터 끝까지 단독으로 만든 production ticketing platform입니다. Next.js frontend, NestJS backend, shared contract, PostgreSQL schema, Toss 결제, 좌석 lock/queue, QR 티켓, field check-in, admin, settlement, CI/CD, Cloud Run deploy까지 전체를 설계하고 구현했습니다.

현재 repository 기준으로 `HEAD` commit 1,973개, backend module 20개, web route 37개, DB schema 42개, migration 30개, test file 223개, Playwright E2E spec 20개가 있습니다. 단순 기능 개발자가 아니라 제품의 매출 경로, 운영 경로, 배포 경로, 장애 대응 경로를 모두 만든 full-cycle owner로 기여했습니다.

연봉 협상에서는 이 프로젝트를 "혼자 만든 웹사이트"가 아니라 "혼자 설계, 구현, 검증, 배포, 운영 안정화까지 수행한 production-grade ticketing business platform"으로 설명하는 것이 맞습니다.

## 18. 근거 파일

보고서 작성에 사용한 주요 근거는 다음과 같다.

- `package.json`
- `apps/web/package.json`
- `apps/api/package.json`
- `packages/shared/package.json`
- `docs/02-PRD.md`
- `docs/03-ARCHITECTURE.md`
- `docs/adr/0003-use-ticket-items-as-seat-level-ticket-records.md`
- `docs/adr/0004-use-provider-charge-quotes-for-paypal.md`
- `.github/workflows/ci.yml`
- `.github/workflows/deploy.yml`
- `apps/api/src/app.module.ts`
- `apps/api/src/modules/*`
- `apps/api/src/database/schema/*`
- `apps/api/src/database/migrations/*`
- `apps/web/app/*`
- `apps/web/components/*`
- `apps/web/e2e/*`
- `packages/shared/src/*`
