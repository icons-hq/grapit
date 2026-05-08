# Phase 24: Traffic + Booking + Payment Core - Research

**Researched:** 2026-05-08  
**Domain:** admission queue, multi-floor booking, Toss Payments branching, refund automation, QR issuance  
**Confidence:** MEDIUM

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Queue admission starts at `/booking`, not at event detail or signup. Performance detail and signup remain browseable, but `/booking` entry and booking mutation APIs require valid admission.
- **D-02:** `lockSeat`, `prepareReservation`, and `confirmPayment` must reject requests without valid admission. Admission is an API-side authorization condition, not only a web route guard.
- **D-03:** Admission token identity is bound to `userId + refresh token family/device slot + queue session`. This aligns queue fairness with Phase 23's three-device refresh-token policy and reduces token sharing.
- **D-04:** Admission uses a short active window: 10 minutes active, server-side extension during payment progress, and a 2-3 minute re-entry grace for refresh/back navigation.
- **D-05:** Queue UI shows position, estimated wait, remaining seats, and automatically enters the booking screen when admitted. Manual "enter now" is not the primary behavior.

- **D-06:** Use progressive defense. Normal traffic gets endpoint-specific rate limits and app-layer guards; suspicious traffic gets Cloudflare `Managed Challenge`; clear macro/bot behavior gets `Block`.
- **D-07:** Rate limits are keyed by endpoint plus the richest available identity context: `userId`, session cookie, admission token, and IP. IP-only rate limiting is insufficient for shared networks and global fandom traffic.
- **D-08:** User-facing failure states must distinguish queue redirect, 429/rate-limit retry, security challenge, and blocked/macro behavior with localized copy.
- **D-09:** Phase 24 includes booking-critical macro scoring only: repeated `lock/prepare/payment` attempts across account, phone, email, payment method, device-ish fingerprint, and admission token. Full anti-fraud graphing and provider-heavy fraud tooling are out of scope.

- **D-10:** Extend `seat_maps` from one unique row per performance into floor-specific rows. Each floor needs `floorKey`, `floorLabel`, `sortOrder`, `svgUrl`, and `seatConfig`. Existing single-map data migrates to default floor `1F`.
- **D-11:** Users can switch floors without losing selections. Side/bottom selection summary must show all selected seats grouped or labeled by floor.
- **D-12:** Max ticket policy is event-configured and enforced across all floors combined. Fanmeet default is 1 ticket per user; event settings may raise the limit to `N`.
- **D-13:** Replace hardcoded `MAX_SEATS=4` usage in web and API with event configuration. Enforcement must happen both in UI and server-side lock/prepare paths.
- **D-14:** Seat changes are allowed only before payment confirmation. After payment is confirmed, user self-service seat change is not supported; users must use cancellation/refund flow instead.

- **D-15:** Overseas payment disclaimers require explicit checkbox consent immediately before payment method confirmation. This applies to overseas card, Alipay+, and truemoney paths and must cover KRW charging, FX estimate/disclaimer, fees, and refund deposit delay.
- **D-16:** Refund UX uses a detailed state machine visible to users: requested, sent to PG, processing at PG, completed, and failed. Include expected deposit timing and automatic CS CTA on delay.
- **D-17:** User cancellations do not reopen seats immediately. Cancelled seats enter a uniform random 1-10 minute hold implemented through delayed jobs before becoming available.
- **D-18:** Operator manual open is the explicit exception to random holding and may reopen cancelled seats immediately. The admin UI for this exception belongs primarily to Phase 25, but Phase 24's data/job model must support it.
- **D-19:** QR ticket is issued immediately after successful payment confirmation using JWT/HMAC payload. Users can see it in My Page immediately.
- **D-20:** QR email is also scheduled for D-1, 24 hours before the event. This is part of Phase 24's `QR-01` contract, while field scanning and offline sync are Phase 27.
- **D-21:** Payment expansion stays with Toss Payments SDK/widget path. Direct custom payment UI is not required unless Toss method constraints force a targeted adapter.

### the agent's Discretion
No implementation choices were delegated to the agent. Downstream agents should follow the locked decisions above.

### Deferred Ideas (OUT OF SCOPE)
- Toss live-key cutover and `BOOKING_ENABLED=true` are Phase 26 gates.
- k6 10k/20k PASS, DR drills, on-call alert dry-runs, Cloud SQL HA/read replica, and pgBouncer gate evidence are Phase 26.
- Full admin operations console, admin RBAC/MFA/IP allowlist, CS console, and detailed manual seat operation UI are Phase 25.
- Field QR scanning, duplicate/tamper detection, offline fallback sync, event-day monitor, and settlement exports are Phase 27.
- Full anti-fraud graphing, provider-heavy fraud tooling, and broad device fingerprint product integration are outside Phase 24 unless later explicitly scoped.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TRAF-01 | Valkey Sorted Set queue admission with batch entry, position, ETA, remaining-seat updates | Valkey sorted set + hash-tagged Lua admission pattern, queue guard placement, Socket.IO/SSE transport recommendation, API-side admission enforcement |
| TRAF-02 | Cloudflare WAF, per-endpoint rate limits, bot/macro controls | Cloudflare rate limiting + custom rules + managed rules execution order, Nest throttler shared counters, app-layer macro scoring pattern |
| TRAF-03 | Cloud Scheduler prewarm before traffic | Cloud Run service-level min scale docs, Cloud Scheduler auth and HTTP method limits, recommended intermediary control path pattern |
| BOOK-01 | Multi-floor SVG seat selection with ticket limits | Floor-row schema expansion, composite seat identity, floor-aware summary, current viewer/store constraints |
| BOOK-02 | 7-minute payment countdown, 10-minute lock expiry, failure return | Separate payment deadline vs lock TTL design, current confirm timer coupling, failure-state recovery paths |
| BOOK-03 | Event-specific cancel/change policy and manual seat operations | Event policy schema additions, held-cancelled seat state, manual-open exception support in data/job model |
| PAY-02 | Domestic Toss + overseas card + Alipay+ + truemoney | Toss widget v2 current path, overseas-card `CARD + useInternationalCardOnly=true` branch, `pendingUrl`/webhook async branch for `FOREIGN_EASY_PAY`, disclaimer consent placement, sandbox limitations |
| REFUND-01 | Refund preview and visible refund state machine | Dedicated refund table/state machine recommendation, Toss cancel API behavior, user timeline requirements |
| REFUND-02 | Random cancelled-seat hold with delayed reopen | `pg-boss` delayed job pattern, held seat state, manual override bypass |
| QR-01 | QR JWT/HMAC issuance and D-1 email | Reuse JWT stack for HS256 QR ticket, durable ticket record, D-1 email scheduling via `pg-boss` + existing Resend service |
</phase_requirements>

## Summary

Phase 24 is not a single booking feature; it is four coupled subsystems that share state boundaries: admission queue, floor-aware seat identity, payment-method branching, and asynchronous post-payment automation. The current codebase already has strong primitives for seat ownership and payment confirmation safety: Valkey Lua seat locks, a separate payment-confirm lock, canonical amount checks, Toss widget v2 wiring, and reservation/payment compensation on confirm failures. It does **not** yet have queue admission state, batch-admission orchestration, multi-floor data structures, foreign-payment webhooks, delayed release jobs, refund state storage, or QR issuance storage. [VERIFIED: apps/api/src/modules/booking/booking.service.ts] [VERIFIED: apps/api/src/modules/reservation/reservation.service.ts] [VERIFIED: apps/web/components/booking/toss-payment-widget.tsx] [VERIFIED: apps/api/src/database/schema/seat-maps.ts] [VERIFIED: codebase grep]

The two planning insights that most affect scope are operational, not UI. First, Toss foreign payment methods are not just “more buttons” in the widget: `FOREIGN_EASY_PAY` requires `pendingUrl`, and except for PayPal the result must be completed asynchronously through `PAYMENT_STATUS_CHANGED`; foreign cancel events also use `CANCEL_STATUS_CHANGED`. Second, Cloud Scheduler cannot directly send a JSON body with `PATCH`, and `gcloud scheduler jobs create http` only supports `delete|get|head|post|put`, with request bodies only on `PUT` or `POST`. That means the prewarm automation needs an intermediary control surface instead of pointing Cloud Scheduler straight at the Cloud Run Admin API `PATCH` endpoint. [CITED: https://docs.tosspayments.com/en/api-guide] [CITED: https://docs.tosspayments.com/en/webhooks] [CITED: https://cloud.google.com/run/docs/configuring/min-instances?authuser=1] [VERIFIED: gcloud scheduler jobs create http --help]

The safest plan shape is: Wave 0 schema/contracts first, then queue admission + defense, then payment branching + refund jobs, then QR/email + verification. Multi-floor seat identity and refund/hold storage must land before UI polish; otherwise later work will duplicate state migration effort. [VERIFIED: apps/api/src/database/schema/seat-inventories.ts] [VERIFIED: apps/api/src/database/schema/reservations.ts] [VERIFIED: apps/api/src/database/schema/payments.ts] [VERIFIED: apps/web/components/booking/booking-page.tsx]

**Primary recommendation:** reuse the current Valkey Lua + Socket.IO + Toss widget foundations, add `pg-boss` for all delayed/background work, split payment into synchronous and asynchronous branches, and treat queue admission as a first-class API authorization boundary. [VERIFIED: apps/api/src/modules/booking/booking.service.ts] [VERIFIED: apps/api/src/modules/booking/booking.gateway.ts] [VERIFIED: apps/web/components/booking/toss-payment-widget.tsx] [VERIFIED: npm registry]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Queue admission state, batch admission, token validation | API / Backend | Database / Storage | Admission must be enforced on `lockSeat`, `prepareReservation`, and `confirmPayment`; state lives in Valkey and must be checked server-side. [VERIFIED: .planning/phases/24-traffic-booking-payment-core/24-CONTEXT.md] [VERIFIED: apps/api/src/modules/booking/booking.service.ts] |
| Queue waiting UI, ETA display, auto-entry | Browser / Client | API / Backend | The browser renders position/ETA and handles auto-navigation, but the source of truth is server state. [VERIFIED: .planning/phases/24-traffic-booking-payment-core/24-CONTEXT.md] [VERIFIED: .planning/phases/24-traffic-booking-payment-core/24-UI-SPEC.md] |
| WAF, challenge, and coarse rate limiting | CDN / Static | API / Backend | Cloudflare should absorb anonymous/suspicious traffic first; Nest throttler and macro scoring should apply richer identity-aware rules after edge filtering. [CITED: https://developers.cloudflare.com/waf/custom-rules/] [CITED: https://developers.cloudflare.com/waf/rate-limiting-rules/parameters/] [VERIFIED: apps/api/src/app.module.ts] |
| Multi-floor seat persistence and sold/held availability | Database / Storage | API / Backend | Floor rows, seat availability, held-cancelled state, and event ticket policy are authoritative backend data concerns. [VERIFIED: apps/api/src/database/schema/seat-maps.ts] [VERIFIED: apps/api/src/database/schema/seat-inventories.ts] |
| Seat map rendering, floor switching, selected-seat summary | Browser / Client | API / Backend | The client owns visualization and switch UX, but it consumes floor-aware data contracts from the API. [VERIFIED: apps/web/components/booking/seat-map-viewer.tsx] [VERIFIED: apps/web/components/booking/booking-page.tsx] |
| Payment confirmation, foreign webhook handling, refund orchestration | API / Backend | Database / Storage | Provider callbacks, idempotency, compensation, and refund state transitions must be durable and server-owned. [VERIFIED: apps/api/src/modules/reservation/reservation.service.ts] [VERIFIED: apps/api/src/modules/payment/toss-payments.client.ts] [CITED: https://docs.tosspayments.com/en/webhooks] |
| QR issuance and D-1 QR email scheduling | API / Backend | Database / Storage | Ticket signing, key rotation, and delayed email scheduling are backend responsibilities with durable state. [VERIFIED: apps/api/src/modules/auth/auth.module.ts] [VERIFIED: apps/api/src/modules/auth/email/email.service.ts] |
| Prewarm scaling automation | API / Backend | — | Cloud Scheduler can authenticate to HTTP targets, but because it cannot directly perform a JSON `PATCH` request to Cloud Run scaling, the project needs a protected intermediary control path or equivalent control-plane helper. [CITED: https://docs.cloud.google.com/scheduler/docs/http-target-auth] [CITED: https://cloud.google.com/run/docs/configuring/min-instances?authuser=1] [VERIFIED: gcloud scheduler jobs create http --help] |

## Project Constraints (from AGENTS.md)

- 모든 사용자 응답은 한국어로 작성하고, technical term과 code identifier는 English로 유지한다. [VERIFIED: AGENTS.md]
- 이 저장소의 작업은 GSD workflow 맥락을 유지해야 하며, 직접 repo edit를 하더라도 Phase context와 planning artifact를 어기면 안 된다. [VERIFIED: AGENTS.md]
- 프로젝트는 1인 개발, monolith-first 제약을 따른다. 운영/인프라를 추가할 때도 별도 플랫폼 수를 최소화해야 한다. [VERIFIED: AGENTS.md]
- `BOOKING_ENABLED=false` cutover gate는 Phase 26 전까지 유지해야 하며, Phase 24는 test-key 기준 구현/검증만 수행한다. [VERIFIED: .planning/phases/24-traffic-booking-payment-core/24-CONTEXT.md] [VERIFIED: AGENTS.md]
- 루트 `.env`만 사용하고, `drizzle-kit`은 루트 `.env`를 직접 보지 못하므로 `DOTENV_CONFIG_PATH=../../.env` 패턴을 유지해야 한다. [VERIFIED: AGENTS.md]
- 개발 기본 포트는 `web:3000`, `api:8080`이다. [VERIFIED: AGENTS.md]
- 필수 프로덕션 환경변수는 `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`이며, Phase 24가 QR 서명을 추가하면 별도 QR secret도 Secret Manager/Cloud Run env로 추가해야 한다. 마지막 항목은 추천 사항이며 별도 설계가 필요하다. [VERIFIED: AGENTS.md] [ASSUMED]
- 현재 프로젝트의 canonical infra/runtime 방향은 `Next.js 16 + NestJS 11 + Drizzle + PostgreSQL 16 + Google Memorystore for Valkey (ioredis) + Socket.IO + Toss Payments` 이다. 오래된 문서의 Upstash/TypeORM 서술과 충돌하면 최신 PROJECT/STATE/code를 우선한다. [VERIFIED: .planning/PROJECT.md] [VERIFIED: .planning/STATE.md] [VERIFIED: apps/api/package.json]

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ioredis` | `5.10.1` | Valkey queue state, admission tokens, seat locks, macro counters | Already the repo-standard Redis client; current lock ownership logic and Socket.IO adapter both rely on it, and cluster-safe Lua is already a proven local pattern. [VERIFIED: npm registry] [VERIFIED: apps/api/src/modules/booking/providers/redis.provider.ts] |
| `socket.io` | `4.8.3` | Realtime seat updates and queue-status transport reuse | Already installed end-to-end with existing booking namespace and multi-instance adapter path; reusing it avoids introducing a second realtime transport for the same booking surface. [VERIFIED: npm registry] [VERIFIED: apps/api/src/modules/booking/booking.gateway.ts] [VERIFIED: apps/web/package.json] |
| `@nestjs/throttler` | `6.5.0` | App-layer per-endpoint rate limiting | Already wired globally in `AppModule`; Phase 24 should extend it with booking-specific named limits instead of inventing custom middleware counters for the basic case. [VERIFIED: npm registry] [VERIFIED: apps/api/src/app.module.ts] |
| `@nest-lab/throttler-storage-redis` | `1.2.0` | Shared rate-limit counters in Valkey | Keeps throttler counters shared across instances using the same Valkey runtime already used for booking. [VERIFIED: npm registry] [VERIFIED: apps/api/src/app.module.ts] |
| `@tosspayments/tosspayments-sdk` | `2.7.0` | Toss widget v2 payment UI | Official current browser SDK; Toss explicitly recommends SDK v2 and the repo already uses widget rendering with `renderPaymentMethods()` and `renderAgreement()`. [VERIFIED: npm registry] [CITED: https://docs.tosspayments.com/en/integration-widget] [VERIFIED: apps/web/components/booking/toss-payment-widget.tsx] |
| `pg-boss` | `12.18.2` | Delayed seat reopen, D-1 QR email, refund reconciliation jobs | Postgres-native job queue with delayed jobs, retries, exponential backoff, and cron scheduling; it matches the project’s “Just Use Postgres” constraint and is not yet installed. [VERIFIED: npm registry] [CITED: https://github.com/timgit/pg-boss] [VERIFIED: codebase grep] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@nestjs/jwt` | `11.0.2` | HS256 QR ticket signing/verifying via existing Nest stack | Use for Phase 24 QR JWT/HMAC issuance to avoid adding a new crypto stack when existing Nest JWT infrastructure is already in the repo. [VERIFIED: npm registry] [VERIFIED: apps/api/src/modules/auth/auth.module.ts] [ASSUMED] |
| `resend` | `6.12.3` | D-1 QR email delivery | Use through the existing email service pattern instead of introducing a second mail provider or scheduler-owned email sender. [VERIFIED: npm registry] [VERIFIED: apps/api/src/modules/auth/email/email.service.ts] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `socket.io` queue-status stream | SSE | SSE is simpler for one-way updates, but the repo already has Socket.IO server/client wiring and multi-instance pub/sub. A second realtime transport would fragment booking observability and tests. [VERIFIED: apps/api/src/modules/booking/booking.gateway.ts] [VERIFIED: apps/web/package.json] |
| `pg-boss` | Cloud Tasks / ad-hoc cron + DB table | External queue services add infra and auth surfaces; ad-hoc cron tables lose retries, backoff, and worker semantics already provided by `pg-boss`. [CITED: https://github.com/timgit/pg-boss] [VERIFIED: .planning/PROJECT.md] |
| Reuse `@nestjs/jwt` for QR | `jose` `6.2.3` | `jose` is a strong alternative for broader JOSE features and key tooling, but it is a new dependency. Reusing Nest JWT is simpler unless Phase 27 scanner work needs richer JWK/JWKS handling. [VERIFIED: npm registry] [CITED: https://github.com/panva/jose] [ASSUMED] |

**Installation:**
```bash
pnpm --filter @grabit/api add pg-boss
```

**Version verification (2026-05-08):**

| Package | Latest | Registry modified | Repo status |
|---------|--------|-------------------|-------------|
| `@tosspayments/tosspayments-sdk` | `2.7.0` | `2026-04-21` | already installed [VERIFIED: npm registry] |
| `pg-boss` | `12.18.2` | `2026-05-02` | not installed [VERIFIED: npm registry] [VERIFIED: codebase grep] |
| `@nestjs/throttler` | `6.5.0` | `2025-12-02` | already installed [VERIFIED: npm registry] |
| `@nest-lab/throttler-storage-redis` | `1.2.0` | `2026-02-03` | already installed [VERIFIED: npm registry] |
| `ioredis` | `5.10.1` | `2026-03-19` | already installed [VERIFIED: npm registry] |
| `socket.io` | `4.8.3` | `2025-12-23` | already installed [VERIFIED: npm registry] |
| `@nestjs/jwt` | `11.0.2` | `2025-12-05` | already installed [VERIFIED: npm registry] |
| `resend` | `6.12.3` | `2026-05-06` | already installed [VERIFIED: npm registry] |

## Architecture Patterns

### System Architecture Diagram

```text
User
  -> Cloudflare WAF / Rate Limiting / Managed Rules
  -> Next.js /booking entry
     -> Queue gate check
        -> no valid admission
           -> Queue UI (position, ETA, remaining seats)
           -> Queue transport (Socket.IO room or SSE)
           -> Valkey waiting ZSET + session hash + admission state
           -> Batch admission Lua/service
           -> short-lived admission token
        -> valid admission
           -> Multi-floor booking UI
           -> lockSeat / prepareReservation / confirmPayment
              -> AdmissionGuard + booking-enabled guard
              -> Valkey seat locks + Postgres sold/held checks
              -> Reservation PENDING_PAYMENT
              -> Toss widget v2
                 -> Domestic / overseas card sync successUrl/failUrl
                 -> FOREIGN_EASY_PAY async pendingUrl + webhook
              -> Confirm / webhook completion
                 -> Reservation + Payment commit
                 -> QR ticket issue
                 -> pg-boss jobs
                    -> delayed cancelled-seat reopen
                    -> D-1 QR email
```

### Recommended Project Structure

```text
apps/api/src/modules/
├── queue/               # admission service, guard, controller, transport contract
├── booking/             # existing seat-lock Lua + seat status merge
├── reservation/         # prepare/confirm/cancel orchestration
├── payment/             # Toss client, foreign webhook controller, payment status mapping
├── refund/              # refund preview/state machine read/write API
├── ticket/              # QR issuance, lookup, signer/verifier
├── jobs/                # pg-boss workers: seat release, qr email, refund reconciliation
└── ops/                 # prewarm endpoint/runbook helpers, protected internal control path

apps/web/
├── components/booking/  # queue screen, floor selector, payment branch UI, QR reassurance
├── components/reservation/ # refund timeline and QR visibility
└── hooks/               # queue status, payment status recovery, admission restore
```

### Pattern 1: Admission-Gated Booking Mutations

**What:** admission is a shared server-side guard used by `lockSeat`, `prepareReservation`, and `confirmPayment`, bound to `userId + refresh-token family/device slot + queue session`. [VERIFIED: .planning/phases/24-traffic-booking-payment-core/24-CONTEXT.md]

**When to use:** every booking mutation that can create or finalize seat ownership. Do not apply only at the page-router layer. [VERIFIED: .planning/phases/24-traffic-booking-payment-core/24-CONTEXT.md]

**Example:**
```typescript
// Source: phase decision + current BookingService guard style
function assertAdmitted(ctx: {
  userId: string;
  refreshFamilyId: string;
  queueSessionId: string;
  token: string | null;
}) {
  if (!ctx.token) throw new ForbiddenException('QUEUE_ADMISSION_REQUIRED');
  // Resolve token in Valkey and verify it matches user + device slot + queue session.
}
```

### Pattern 2: Floor-Aware Seat Identity Normalization

**What:** keep display labels (`row`, `number`, `floorLabel`) separate from the internal seat identity. Internally normalize seats as `floorKey + seatId` or equivalent composite identity so `A-1` on `1F` and `A-1` on `2F` never collide. [VERIFIED: apps/web/components/booking/seat-map-viewer.tsx] [VERIFIED: apps/web/stores/use-booking-store.ts] [VERIFIED: apps/api/src/database/schema/seat-maps.ts] [VERIFIED: apps/api/src/database/schema/seat-inventories.ts]

**When to use:** before migrating `seat_maps`, `seat_inventories`, reservation seats, and selected-seat store state. [VERIFIED: apps/api/src/modules/performance/performance.service.ts]

**Example:**
```typescript
// Source: current selected-seat shape + multi-floor requirement
type FloorSeatKey = `${string}:${string}`; // `${floorKey}:${seatId}`

interface FloorSeatSelection extends SeatSelection {
  floorKey: string;
  floorLabel: string;
  seatKey: FloorSeatKey;
}
```

### Pattern 3: Split Synchronous and Asynchronous Payment Branches

**What:** keep the current synchronous confirm-page flow for domestic methods and overseas card, but branch `FOREIGN_EASY_PAY` into `pendingUrl + webhook + recovery UI`. Overseas card is still a `CARD` flow with an international-card window, while Alipay+/TrueMoney are `FOREIGN_EASY_PAY` providers. Do not force every payment method through the same request shape. [CITED: https://docs.tosspayments.com/guides/v2/payment-window/integration-international] [CITED: https://docs.tosspayments.com/en/api-guide] [CITED: https://docs.tosspayments.com/en/webhooks] [VERIFIED: apps/web/components/booking/toss-payment-widget.tsx] [VERIFIED: apps/web/app/booking/[performanceId]/complete/page.tsx]

**When to use:** `CARD + useInternationalCardOnly=true` for overseas-card checkout, and `FOREIGN_EASY_PAY` for Alipay+, TrueMoney, and any future Toss async foreign wallet provider except PayPal. [CITED: https://docs.tosspayments.com/guides/v2/payment-window/integration-international] [CITED: https://docs.tosspayments.com/en/api-guide]

**Example:**
```typescript
// Source: Toss payment API guide (adapted)
const request = {
  method: 'FOREIGN_EASY_PAY',
  provider: 'TRUEMONEY',
  currency: 'USD',
  successUrl,
  failUrl,
  pendingUrl, // required for FOREIGN_EASY_PAY except PayPal
};
```

### Pattern 4: Held-Cancelled Seats + Delayed Release Job

**What:** on user cancel, move the seat into an internal held state and enqueue a delayed release job with uniform random jitter between 1 and 10 minutes. Manual operator open deletes or bypasses the job. [VERIFIED: .planning/phases/24-traffic-booking-payment-core/24-CONTEXT.md] [CITED: https://github.com/timgit/pg-boss]

**When to use:** all user-initiated cancellations; not operator manual reopen. [VERIFIED: .planning/phases/24-traffic-booking-payment-core/24-CONTEXT.md]

**Example:**
```typescript
// Source: pg-boss feature set + phase decision (adapted)
const delaySeconds = randomInt(60, 600);
await boss.send(
  'release-cancelled-seat',
  { showtimeId, seatKey, reservationId },
  { startAfter: `${delaySeconds} seconds` },
);
```

### Anti-Patterns to Avoid

- **Client-only admission gating:** redirecting only on `/booking` without guarding `lockSeat`, `prepareReservation`, and `confirmPayment` breaks D-02 immediately. [VERIFIED: .planning/phases/24-traffic-booking-payment-core/24-CONTEXT.md]
- **Assuming `seatId` is globally unique across floors:** the current viewer/store/schema treat `seatId` as a singleton key; multi-floor data will collide unless identity is normalized. [VERIFIED: apps/web/components/booking/seat-map-viewer.tsx] [VERIFIED: apps/api/src/database/schema/seat-inventories.ts]
- **Treating all Toss methods as synchronous redirect-confirm flows:** `FOREIGN_EASY_PAY` requires `pendingUrl` and webhook completion except PayPal. [CITED: https://docs.tosspayments.com/en/api-guide]
- **Immediate reopen on cancel:** the current service does this today, but Phase 24 must intentionally stop doing it. [VERIFIED: apps/api/src/modules/reservation/reservation.service.ts]
- **Cloud Scheduler direct PATCH-to-Cloud-Run plan:** Scheduler CLI-supported HTTP methods and request-body constraints do not fit Cloud Run Admin API `PATCH` scaling updates. [CITED: https://cloud.google.com/run/docs/configuring/min-instances?authuser=1] [VERIFIED: gcloud scheduler jobs create http --help]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Delayed reopen / scheduled QR email / retryable background tasks | `setTimeout`, ad-hoc cron tables, or inline request-thread side effects | `pg-boss` | Delayed jobs, retries, exponential backoff, and cron scheduling are already built-in and durable in Postgres. [CITED: https://github.com/timgit/pg-boss] |
| Payment UI and provider handoff | Custom credit-card / wallet UI | Toss widget v2 | The official widget already renders payment methods and agreement UI and is the project’s locked payment path. [CITED: https://docs.tosspayments.com/en/integration-widget] [VERIFIED: apps/web/components/booking/toss-payment-widget.tsx] |
| Global rate limit + challenge pages | Homegrown CAPTCHA wall or IP-ban middleware | Cloudflare custom rules + rate limiting + managed rules | Edge challenges and WAF execution order already solve this class better than application middleware alone. [CITED: https://developers.cloudflare.com/waf/custom-rules/] [CITED: https://developers.cloudflare.com/waf/managed-rules/] |
| Queue position / ETA source of truth | SQL polling queue or client-side counters | Valkey sorted set + hash-tagged Lua/state service | Sorted-set rank/count operations are purpose-built for rank/position lookups and already match the repo’s Valkey Lua pattern. [CITED: https://valkey.io/topics/sorted-sets/] [VERIFIED: apps/api/src/modules/booking/booking.service.ts] |
| QR token format | Ad-hoc base64/HMAC blobs with custom parser rules | HS256 JWT via existing Nest JWT stack | A JWT gives a standard claim envelope and verification path; inventing a new token format only adds parser/security surface. [VERIFIED: apps/api/src/modules/auth/auth.module.ts] [ASSUMED] |

**Key insight:** this phase’s expensive bugs are not visual bugs; they are “state branch” bugs: admission bypass, seat-key collisions, async provider completion, duplicate refund/cancel, and jobs that silently fail after the HTTP request ended. Use durable state boundaries and provider-native flows everywhere you can. [VERIFIED: apps/api/src/modules/reservation/reservation.service.ts] [CITED: https://docs.tosspayments.com/en/webhooks] [CITED: https://github.com/timgit/pg-boss]

## Common Pitfalls

### Pitfall 1: Foreign payment methods look like a UI toggle but are an async backend branch
**What goes wrong:** Alipay+/TrueMoney appears selectable in the widget, but the current complete-page confirm flow never receives the final result correctly. [CITED: https://docs.tosspayments.com/en/api-guide] [VERIFIED: apps/web/components/booking/toss-payment-widget.tsx]
**Why it happens:** the current widget wrapper only uses `successUrl`/`failUrl`; foreign easy-pay methods except PayPal require `pendingUrl` and `PAYMENT_STATUS_CHANGED`. [CITED: https://docs.tosspayments.com/en/api-guide]
**How to avoid:** split domestic/PayPal sync flow from async foreign-wallet flow, add webhook endpoint, store async payment state, and build a recovery/status UI. [CITED: https://docs.tosspayments.com/en/webhooks]
**Warning signs:** “결제는 완료됐는데 예약이 안 생김”, `pendingUrl` absent in request payload, or no webhook/event-id persistence. [CITED: https://docs.tosspayments.com/en/api-guide] [VERIFIED: codebase grep]

### Pitfall 2: Floor rows without composite seat identity will corrupt locks and reservations
**What goes wrong:** seats with the same visible label on different floors fight over the same Valkey key or DB row. [VERIFIED: apps/api/src/database/schema/seat-inventories.ts] [VERIFIED: apps/web/components/booking/seat-map-viewer.tsx]
**Why it happens:** current code and schema key everything by `seatId` only, and current `seat_maps` is one row per performance. [VERIFIED: apps/api/src/database/schema/seat-maps.ts] [VERIFIED: apps/api/src/modules/performance/performance.service.ts] [VERIFIED: apps/web/stores/use-booking-store.ts]
**How to avoid:** normalize to `floorKey + seatId` internally before touching queue, lock, reservation, or payment code. [VERIFIED: .planning/phases/24-traffic-booking-payment-core/24-CONTEXT.md]
**Warning signs:** duplicated `A-1` labels across vendor SVGs, composite-key TODOs postponed until after UI work, or tests that still assume `SeatSelection.seatId` is globally unique. [VERIFIED: apps/web/components/admin/svg-preview.tsx] [VERIFIED: packages/shared/src/types/booking.types.ts]

### Pitfall 3: The current confirm timer is the lock TTL, not the required payment deadline
**What goes wrong:** users see one countdown, but the requirement needs a 7-minute payment deadline plus 10-minute lock ownership rules. [VERIFIED: apps/web/components/booking/confirm-header.tsx] [VERIFIED: apps/api/src/modules/booking/booking.service.ts] [VERIFIED: .planning/REQUIREMENTS.md]
**Why it happens:** the confirm page reads `expiresAt` from booking state and treats it as the only timer. [VERIFIED: apps/web/components/booking/confirm-header.tsx] [VERIFIED: apps/web/stores/use-booking-store.ts]
**How to avoid:** model two timers explicitly: lock TTL/state extension in Valkey, and a payment-deadline timestamp persisted with the pending reservation or payment-attempt state. [VERIFIED: .planning/REQUIREMENTS.md] [ASSUMED]
**Warning signs:** new code keeps reusing `expiresAt` everywhere, or the red-warning threshold is still derived from the 10-minute lock timer. [VERIFIED: apps/web/components/booking/confirm-header.tsx]

### Pitfall 4: Cloud Scheduler cannot directly perform the prewarm scaling update you actually need
**What goes wrong:** prewarm automation is planned as “Scheduler calls Cloud Run Admin API”, but implementation stalls when the job cannot send a JSON body with `PATCH`. [CITED: https://cloud.google.com/run/docs/configuring/min-instances?authuser=1] [VERIFIED: gcloud scheduler jobs create http --help]
**Why it happens:** Scheduler supports `delete|get|head|post|put` in CLI flows, and request bodies only with `PUT` or `POST`; Cloud Run scaling uses a JSON `PATCH` endpoint. [VERIFIED: gcloud scheduler jobs create http --help] [CITED: https://cloud.google.com/run/docs/configuring/min-instances?authuser=1]
**How to avoid:** plan an intermediary control surface, or explicitly choose a different GCP control-plane helper. For this repo, the lowest-complexity path is a protected internal POST endpoint that performs the Cloud Run service-level scale update. [CITED: https://docs.cloud.google.com/scheduler/docs/http-target-auth] [ASSUMED]
**Warning signs:** plans that say “just add two Scheduler jobs” without describing the control path or IAM boundary. [VERIFIED: gcloud scheduler jobs create http --help]

### Pitfall 5: Cloudflare bot-score fields may not exist on the project’s current plan
**What goes wrong:** the planner assumes `cf.bot_management.score` or `cf.bot_management.js_detection.passed` is available, then later discovers those fields are Enterprise add-ons. [CITED: https://developers.cloudflare.com/ruleset-engine/rules-language/fields/reference/] [CITED: https://developers.cloudflare.com/cloudflare-challenges/challenge-types/javascript-detections/] [VERIFIED: AGENTS.md]
**Why it happens:** project docs say “Cloudflare Free plan”, while TRAF-02/spec language expects bot-score-driven challenge/blocking. [VERIFIED: AGENTS.md] [VERIFIED: .planning/REQUIREMENTS.md]
**How to avoid:** treat plan capability as an explicit planning gate. If Enterprise Bot Management is unavailable, use Cloudflare rate limiting + managed challenge + app-layer macro scoring, and record the requirement caveat. [CITED: https://developers.cloudflare.com/waf/rate-limiting-rules/parameters/] [VERIFIED: .planning/phases/24-traffic-booking-payment-core/24-CONTEXT.md]
**Warning signs:** rule expressions referencing Enterprise-only fields without a confirmed plan upgrade. [CITED: https://developers.cloudflare.com/ruleset-engine/rules-language/fields/reference/]

### Pitfall 6: Webhook handlers that are not idempotent will double-apply async payment or cancel events
**What goes wrong:** provider retries create duplicate state transitions, duplicate emails, or seat/state drift. [CITED: https://docs.tosspayments.com/en/webhooks]
**Why it happens:** Toss retries webhooks up to 7 times if the endpoint does not return `200`, and async foreign flows depend on those events. [CITED: https://docs.tosspayments.com/en/webhooks]
**How to avoid:** persist an event idempotency key, make handlers side-effect safe, and only return `200` after the durable write succeeds. [CITED: https://docs.tosspayments.com/en/webhooks] [ASSUMED]
**Warning signs:** handlers that send QR email inline before committing DB state, or no persisted record of processed webhook events. [VERIFIED: codebase grep]

## Code Examples

Verified patterns from official sources and current repo constraints:

### Queue Status Read Model
```typescript
// Source: https://valkey.io/topics/sorted-sets/ + current Valkey/Lua repo style
const queueKey = `{${showtimeId}}:queue:waiting`;
const position = await redis.zrank(queueKey, queueSessionId);   // 0-based
const waitingCount = await redis.zcard(queueKey);

return {
  position: position === null ? null : position + 1,
  waitingCount,
  etaSeconds: estimateEta(waitingCount, activeAdmissions, releaseRate),
};
```

### Delayed Cancelled-Seat Release Job
```typescript
// Source: https://github.com/timgit/pg-boss
await boss.send(
  'release-cancelled-seat',
  { showtimeId, seatKey, reservationId },
  {
    startAfter: `${randomInt(60, 600)} seconds`,
    retryLimit: 5,
    retryBackoff: true,
  },
);
```

### Async Foreign Payment Request Shape
```typescript
// Source: https://docs.tosspayments.com/en/api-guide
const body = {
  method: 'FOREIGN_EASY_PAY',
  provider: 'ALIPAY',
  currency: 'USD',
  orderId,
  orderName,
  amount,
  failUrl,
  pendingUrl,
  // successUrl is still used for PayPal or other sync cases
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Toss SDK v1 with multiple separate browser/mobile SDK lines | Toss SDK v2 unified browser SDK (`@tosspayments/tosspayments-sdk`) | Toss docs now recommend v2 in current widget guide | Build new widget work on v2, not v1 sample assumptions. [CITED: https://docs.tosspayments.com/en/integration-widget] [VERIFIED: npm registry] |
| Treat every payment method as `successUrl/failUrl` redirect-confirm | Split synchronous methods from async foreign-wallet methods using `pendingUrl` + webhook | Current Toss API guide | Foreign methods need backend webhook/state work from the start. [CITED: https://docs.tosspayments.com/en/api-guide] [CITED: https://docs.tosspayments.com/en/webhooks] |
| Revision-specific min-instance toggles for ops scripts | Service-level scale update (`--min` / `scaling.minInstanceCount`) for service prewarm | Current Cloud Run docs + CLI | Prewarm should target the service abstraction, not a specific revision. [CITED: https://cloud.google.com/run/docs/configuring/min-instances?authuser=1] [VERIFIED: gcloud run services update --help] |

**Deprecated/outdated:**

- `@tosspayments/sdk` and v1-only sample assumptions for new browser integrations. Use `@tosspayments/tosspayments-sdk` v2. [CITED: https://docs.tosspayments.com/en/integration-widget] [VERIFIED: npm registry]
- Immediate seat reopen on cancel in current service logic is outdated for Phase 24 requirements. [VERIFIED: apps/api/src/modules/reservation/reservation.service.ts] [VERIFIED: .planning/REQUIREMENTS.md]
- Planning Cloudflare bot-score rules without confirming plan capabilities is outdated and unsafe. [CITED: https://developers.cloudflare.com/ruleset-engine/rules-language/fields/reference/] [VERIFIED: AGENTS.md]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Reusing existing `@nestjs/jwt` with a dedicated QR secret and durable ticket-status lookup is acceptable for Phase 24 QR issuance, so `jose` is optional rather than required. | Project Constraints / Standard Stack / Don't Hand-Roll / Security Domain | If wrong, Phase 24 may need a new JOSE dependency and a different ticket verification design after QR storage is already implemented. |
| A2 | The 7-minute payment deadline should be modeled as its own persisted timestamp/state, not inferred from the existing 10-minute seat-lock expiry. | Common Pitfalls | If wrong, planners may over-model timer state; if omitted when needed, BOOK-02 can never be tested cleanly. |
| A3 | The simplest viable prewarm automation in this repo is a protected internal POST control path that performs the Cloud Run scale update on behalf of Cloud Scheduler. | Common Pitfalls / Architecture | If wrong, the planner should introduce Cloud Workflows or another control-plane helper, increasing infra scope. |
| A4 | Webhook handlers should persist an explicit processed-event record or equivalent idempotency key even if Toss docs do not mandate a specific storage model. | Common Pitfalls / Security Domain | If wrong, duplicate event prevention may be overbuilt; if omitted when needed, async payment/refund state can corrupt. |

## Open Questions

1. **Does the production Cloudflare plan actually include Bot Management / bot-score fields?**
   - What we know: project constraints mention Cloudflare Free plan, while Cloudflare docs mark `cf.bot_management.score`, `cf.bot_management.detection_ids`, and `cf.bot_management.js_detection.passed` as Enterprise add-ons. [VERIFIED: AGENTS.md] [CITED: https://developers.cloudflare.com/ruleset-engine/rules-language/fields/reference/]
   - What's unclear: whether TRAF-02’s “bot-score challenge/blocking” is a hard requirement with a plan upgrade, or whether Phase 24 should satisfy it with managed challenge + app-layer macro scoring only.
   - Recommendation: resolve this before plan lock. If no Enterprise add-on is available, record a requirement caveat and plan Cloudflare challenge rules without bot-score predicates.

2. **How much of Alipay+/TrueMoney can actually be executed with current test keys?**
   - What we know: Toss docs state some digital wallet providers do not work in test environments, and non-PayPal foreign wallets are async via webhook. [CITED: https://docs.tosspayments.com/en/api-guide]
   - What's unclear: which foreign providers the merchant account can simulate today versus only validate via webhook fixtures/test logs.
   - Recommendation: plan both provider-facing E2E and fixture-based webhook verification; do not make the phase depend solely on a browser-run happy path.

3. **What is the canonical internal seat identity for future vendor SVGs?**
   - What we know: the repo currently assumes single `seatId` keys, and Phase 24 requires floor-specific rows. [VERIFIED: apps/api/src/database/schema/seat-maps.ts] [VERIFIED: apps/web/components/booking/seat-map-viewer.tsx]
   - What's unclear: whether future vendor SVGs guarantee globally unique `data-seat-id` across floors.
   - Recommendation: normalize to composite identity even if current files appear unique; this is cheaper than discovering collisions after lock/reservation code ships.

4. **Which service account will own prewarm scaling permissions?**
   - What we know: Cloud Scheduler can authenticate to HTTP targets, and Cloud Run scaling can be changed through the service API. [CITED: https://docs.cloud.google.com/scheduler/docs/http-target-auth] [CITED: https://cloud.google.com/run/docs/configuring/min-instances?authuser=1]
   - What's unclear: whether the current API service account is allowed to update Cloud Run services, or whether a dedicated control-plane service account/workflow is preferred.
   - Recommendation: decide this in planning because it affects both security review and implementation shape.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | web/api build and tests | ✓ | `v24.13.0` | repo requires `>=22`, so current host is acceptable |
| `pnpm` | workspace install/test commands | ✓ | `10.28.1` | `npm` exists, but workspace commands are standardized on `pnpm` |
| `npm` | registry version checks | ✓ | `11.6.2` | — |
| Docker | Valkey integration tests via testcontainers | ✓ | `29.1.3` | without Docker, integration tests fall back to unit-only coverage |
| `gcloud` | Cloud Run / Cloud Scheduler verification and runbook execution | ✓ | `564.0.0` | Cloud Console/manual API calls if CLI is unavailable |
| `wrangler` | Cloudflare API automation from CLI | ✗ | — | use Cloudflare dashboard or direct HTTP API tooling |
| `redis-cli` | direct Valkey inspection during debugging | ✗ | — | use existing `ioredis` scripts/tests or app health endpoints |
| `psql` | direct Postgres inspection during debugging | ✗ | — | use Drizzle/testcontainers or app-level read models |

**Missing dependencies with no fallback:**

- None identified for planning or implementation design. [VERIFIED: local environment checks]

**Missing dependencies with fallback:**

- `wrangler` is missing, so Cloudflare automation should be planned as dashboard/manual API work unless the phase explicitly installs a CLI later. [VERIFIED: local environment checks]
- `redis-cli` and `psql` are missing, so operator/developer inspection steps should use existing Node tooling or testcontainers instead of assuming those CLIs. [VERIFIED: local environment checks]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `Vitest 3.2.0` for API/web unit tests + `Playwright 1.59.1` for web E2E [VERIFIED: apps/api/package.json] [VERIFIED: apps/web/package.json] |
| Config file | `apps/api/vitest.config.ts`, `apps/api/vitest.integration.config.ts`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts` [VERIFIED: codebase grep] |
| Quick run command | `pnpm --filter @grabit/api test -- src/modules/reservation/reservation.service.spec.ts && pnpm --filter @grabit/web test -- hooks/__tests__/use-booking.test.tsx` |
| Full suite command | `pnpm test && pnpm --filter @grabit/api test:integration && pnpm --filter @grabit/web test:e2e` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TRAF-01 | admission token required for booking mutations and queue rank/ETA updates | API unit + E2E | `pnpm --filter @grabit/api test -- src/modules/queue/queue.service.spec.ts` | ❌ Wave 0 |
| TRAF-02 | per-endpoint booking limits, macro scoring, and localized failure states | API unit + web E2E | `pnpm --filter @grabit/api test -- src/modules/traffic/traffic-defense.service.spec.ts && pnpm --filter @grabit/web test:e2e --grep "queue|rate"` | ❌ Wave 0 |
| TRAF-03 | prewarm control path and runbook verification | API unit + manual/gcloud smoke | `pnpm --filter @grabit/api test -- src/modules/ops/prewarm.service.spec.ts` | ❌ Wave 0 |
| BOOK-01 | multi-floor upload/render/switching and floor-aware selection summary | web component + API unit | `pnpm --filter @grabit/web test -- components/booking/__tests__/seat-map-viewer.test.tsx` | ✅ extend |
| BOOK-02 | separate payment deadline, lock expiry, and payment-failure return flow | web unit + E2E | `pnpm --filter @grabit/web test -- hooks/__tests__/use-booking.test.tsx && pnpm --filter @grabit/web test:e2e --grep "toss-payment"` | ✅ extend |
| BOOK-03 | event-specific max tickets, cancellation policy, manual reopen exception model | API unit | `pnpm --filter @grabit/api test -- src/modules/booking/booking-policy.service.spec.ts` | ❌ Wave 0 |
| PAY-02 | domestic sync path + foreign async path + disclaimer gating | web E2E + API webhook tests | `pnpm --filter @grabit/web test:e2e --grep "toss-payment" && pnpm --filter @grabit/api test -- src/modules/payment/toss-webhook.controller.spec.ts` | web ✅ / api ❌ |
| REFUND-01 | refund preview and visible refund-state machine | API unit + web UI | `pnpm --filter @grabit/api test -- src/modules/refund/refund.service.spec.ts && pnpm --filter @grabit/web test -- components/reservation/__tests__/refund-timeline.test.tsx` | ❌ Wave 0 |
| REFUND-02 | random cancelled-seat hold and delayed reopen | API unit + integration | `pnpm --filter @grabit/api test -- src/modules/jobs/cancelled-seat-release.worker.spec.ts` | ❌ Wave 0 |
| QR-01 | QR issue on payment success and D-1 email scheduling | API unit + web E2E | `pnpm --filter @grabit/api test -- src/modules/ticket/qr-ticket.service.spec.ts && pnpm --filter @grabit/web test:e2e --grep "booking complete"` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** run the narrowest affected Vitest suite plus any touched booking E2E slice.
- **Per wave merge:** `pnpm test` and the relevant `pnpm --filter @grabit/web test:e2e --grep ...` scenario set.
- **Phase gate:** full suite green plus `apps/api` integration tests (`pnpm --filter @grabit/api test:integration`) before `$gsd-verify-work`.

### Wave 0 Gaps

- [ ] `apps/api/src/modules/queue/queue.service.spec.ts` — admission state, batch admission, ETA math, token validation
- [ ] `apps/api/src/modules/queue/queue.guard.spec.ts` — guard enforcement on `lockSeat`, `prepareReservation`, `confirmPayment`
- [ ] `apps/api/src/modules/payment/toss-webhook.controller.spec.ts` — `PAYMENT_STATUS_CHANGED` / `CANCEL_STATUS_CHANGED` idempotency and retries
- [ ] `apps/api/src/modules/jobs/cancelled-seat-release.worker.spec.ts` — random delayed reopen + manual-open bypass
- [ ] `apps/api/src/modules/ticket/qr-ticket.service.spec.ts` — QR JWT claims, revocation/status checks, D-1 email enqueue
- [ ] `apps/web/e2e/booking-queue.spec.ts` — queue position/ETA/auto-entry/user-facing failure states
- [ ] `apps/web/components/booking/__tests__/floor-selector.test.tsx` — floor switching without selection loss
- [ ] `apps/web/components/reservation/__tests__/refund-timeline.test.tsx` — refund status timeline and delay CTA

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Existing Phase 23 auth + admission token bound to authenticated `userId` and refresh-family/device slot. [VERIFIED: .planning/phases/24-traffic-booking-payment-core/24-CONTEXT.md] [VERIFIED: .planning/REQUIREMENTS.md] |
| V3 Session Management | yes | Existing refresh-token family policy, httpOnly session cookies, and short-lived admission window. [VERIFIED: .planning/STATE.md] [VERIFIED: .planning/phases/24-traffic-booking-payment-core/24-CONTEXT.md] |
| V4 Access Control | yes | Server-side `AdmissionGuard` on booking mutations, admin/manual-open exception separated from user cancel path. [VERIFIED: .planning/phases/24-traffic-booking-payment-core/24-CONTEXT.md] |
| V5 Input Validation | yes | `zod` schemas + `ZodValidationPipe` + server-side canonical amount/seat recalculation. [VERIFIED: packages/shared/src/schemas/booking.schema.ts] [VERIFIED: apps/api/src/modules/reservation/reservation.service.ts] |
| V6 Cryptography | yes | HMAC/HS256 JWT using existing JWT stack and secrets from Secret Manager / Cloud Run env. Never hand-roll crypto primitives. [VERIFIED: apps/api/src/modules/auth/auth.module.ts] [VERIFIED: AGENTS.md] [ASSUMED] |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Queue bypass or admission-token replay | Spoofing / Elevation | Bind admission to `userId + refresh family/device slot + queue session`, short TTL, server-side validation on every mutation. [VERIFIED: .planning/phases/24-traffic-booking-payment-core/24-CONTEXT.md] |
| Seat-lock replay / stale lock reuse | Tampering | Keep Valkey Lua ownership checks and payment-confirm lock; never trust client-selected seat lists without canonical verification. [VERIFIED: apps/api/src/modules/booking/booking.service.ts] [VERIFIED: apps/api/src/modules/reservation/reservation.service.ts] |
| Amount tampering on redirect return | Tampering | Compare redirect `amount` against the original request and prepared reservation amount before confirm. [CITED: https://docs.tosspayments.com/en/integration-widget] [VERIFIED: apps/api/src/modules/reservation/reservation.service.ts] |
| Webhook replay / duplicate async payment updates | Tampering / Repudiation | Persist idempotency key or processed-event record, handle retries safely, and return `200` only after durable write. [CITED: https://docs.tosspayments.com/en/webhooks] [ASSUMED] |
| Refund double-submit | Tampering | Use transaction + row locking / unique refund request guard before calling cancel API. [VERIFIED: apps/api/src/modules/reservation/reservation.service.ts] |
| QR forgery or stale QR use | Spoofing | Dedicated QR secret, signed claims, server-side ticket status check, and later scanner revocation logic. [VERIFIED: .planning/phases/24-traffic-booking-payment-core/24-CONTEXT.md] [ASSUMED] |

## Sources

### Primary (HIGH confidence)

- `AGENTS.md` - project constraints, env conventions, stack direction, GSD workflow requirements. [VERIFIED: AGENTS.md]
- `.planning/phases/24-traffic-booking-payment-core/24-CONTEXT.md` - locked decisions and phase scope. [VERIFIED: .planning/phases/24-traffic-booking-payment-core/24-CONTEXT.md]
- `.planning/REQUIREMENTS.md` - requirement IDs and success criteria mapping. [VERIFIED: .planning/REQUIREMENTS.md]
- `.planning/PROJECT.md` / `.planning/STATE.md` - current canonical stack decisions, especially Valkey/ioredis direction and accepted-risk constraints. [VERIFIED: .planning/PROJECT.md] [VERIFIED: .planning/STATE.md]
- `apps/api/src/modules/booking/booking.service.ts` - current lock/Lua/payment-confirm primitives. [VERIFIED: apps/api/src/modules/booking/booking.service.ts]
- `apps/api/src/modules/reservation/reservation.service.ts` - current prepare/confirm/cancel flow and immediate-reopen behavior. [VERIFIED: apps/api/src/modules/reservation/reservation.service.ts]
- `apps/web/components/booking/toss-payment-widget.tsx`, `apps/web/app/booking/[performanceId]/confirm/page.tsx`, `apps/web/app/booking/[performanceId]/complete/page.tsx` - current sync Toss browser flow. [VERIFIED: apps/web/components/booking/toss-payment-widget.tsx] [VERIFIED: apps/web/app/booking/[performanceId]/confirm/page.tsx] [VERIFIED: apps/web/app/booking/[performanceId]/complete/page.tsx]
- `https://docs.tosspayments.com/en/integration-widget` - Toss widget v2 flow and redirect handling. [CITED: https://docs.tosspayments.com/en/integration-widget]
- `https://docs.tosspayments.com/en/api-guide` - foreign payment, `pendingUrl`, provider codes, confirm/cancel API, partial cancel fields. [CITED: https://docs.tosspayments.com/en/api-guide]
- `https://docs.tosspayments.com/guides/v2/payment-window/integration-international` - overseas card flow, `useInternationalCardOnly=true`, KRW request with estimated USD display, and the same success/fail/confirm pattern. [CITED: https://docs.tosspayments.com/guides/v2/payment-window/integration-international]
- `https://docs.tosspayments.com/en/webhooks` - webhook event types, async foreign cancel flow, retry policy, 10-minute authorization window after `IN_PROGRESS`. [CITED: https://docs.tosspayments.com/en/webhooks]
- `https://cloud.google.com/run/docs/configuring/min-instances?authuser=1` - service-level min scale and update paths. [CITED: https://cloud.google.com/run/docs/configuring/min-instances?authuser=1]
- `https://docs.cloud.google.com/scheduler/docs/http-target-auth` - Scheduler auth model for HTTP targets. [CITED: https://docs.cloud.google.com/scheduler/docs/http-target-auth]
- local `gcloud` help: `gcloud run services update --help`, `gcloud scheduler jobs create http --help` - current CLI behavior and HTTP-method/body constraints. [VERIFIED: local gcloud help]
- `https://developers.cloudflare.com/waf/rate-limiting-rules/parameters/` - challenge/block actions and plan-dependent throttling behavior. [CITED: https://developers.cloudflare.com/waf/rate-limiting-rules/parameters/]
- `https://developers.cloudflare.com/waf/custom-rules/` and `https://developers.cloudflare.com/waf/managed-rules/` - WAF rule types and execution order. [CITED: https://developers.cloudflare.com/waf/custom-rules/] [CITED: https://developers.cloudflare.com/waf/managed-rules/]
- `https://developers.cloudflare.com/ruleset-engine/rules-language/fields/reference/` and `https://developers.cloudflare.com/cloudflare-challenges/challenge-types/javascript-detections/` - bot-score / JS detection field availability and constraints. [CITED: https://developers.cloudflare.com/ruleset-engine/rules-language/fields/reference/] [CITED: https://developers.cloudflare.com/cloudflare-challenges/challenge-types/javascript-detections/]
- `https://valkey.io/topics/sorted-sets/`, `https://valkey.io/commands/zrank/`, `https://valkey.io/commands/zadd/` - sorted-set semantics and rank operations. [CITED: https://valkey.io/topics/sorted-sets/] [CITED: https://valkey.io/commands/zrank/] [CITED: https://valkey.io/commands/zadd/]
- `https://github.com/timgit/pg-boss` - delayed jobs, retries, backoff, cron scheduling, SKIP LOCKED model. [CITED: https://github.com/timgit/pg-boss]
- npm registry for package version verification: `@tosspayments/tosspayments-sdk`, `pg-boss`, `@nestjs/throttler`, `@nest-lab/throttler-storage-redis`, `ioredis`, `socket.io`, `@nestjs/jwt`, `resend`, `jose`. [VERIFIED: npm registry]

### Secondary (MEDIUM confidence)

- `docs/v2.0-fanmeet-milestone-spec.md` - phase intent, historical merged-scope rationale, and older design notes. Useful when consistent with current PROJECT/STATE, but not authoritative when they conflict. [VERIFIED: docs/v2.0-fanmeet-milestone-spec.md]
- `docs/03-ARCHITECTURE.md` - still useful for older intent around queue/WAF/jobs, but parts are stale against current PROJECT decisions (for example, Upstash references). [VERIFIED: docs/03-ARCHITECTURE.md] [VERIFIED: .planning/PROJECT.md]

### Tertiary (LOW confidence)

- None. Low-confidence items are captured explicitly in the Assumptions Log instead of being presented as sourced fact.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - current versions were verified from npm registry and matched against the codebase and project decisions.
- Architecture: MEDIUM - the core patterns are strongly grounded in current code and official docs, but the prewarm control-path shape and Cloudflare plan capability still need project confirmation.
- Pitfalls: HIGH - they come directly from current code assumptions, CLI constraints, and official provider docs.

**Research date:** 2026-05-08  
**Valid until:** 2026-05-15
