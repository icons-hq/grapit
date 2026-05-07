## Basic Guidelines

### Language Settings

- Write all responses in Korean.
- Keep technical terms and code identifiers in English, and write explanations in Korean.

### Codex GSD Subagent Handling

- This section applies only to the Codex global runtime. Do not modify Claude/`~/.claude` settings, files, or workflows.
- Standing authorization: The user has explicitly authorized Codex, for this repository, to use Codex native subagents whenever a GSD workflow, GSD skill, GSD command, or agentic coding task has independent work that can safely run in parallel.
- Treat this standing authorization as the explicit user request needed for GSD-related `spawn_agent`, `@gsd-*` custom agents, or the GSD `Task()` adapter, unless the current turn says to avoid subagents, avoid parallel work, pause, or only explain.
- Prefer Codex native subagents for parallelizable GSD work when tasks are independent, write scopes are disjoint, or the workflow recommends wave-based fan-out.
- Do not spawn subagents for tightly coupled work, single blocking next steps, small sequential edits, or tasks where parallel writes would create avoidable merge conflicts.
- When using a GSD workflow's `Task()` adapter, `spawn_agent`, or `@gsd-*` custom agents, a `wait_agent` timeout or empty status is not a failure.
- After spawning a GSD subagent, wait until terminal status or the artifact contract (`PLAN.md`, `RESEARCH.md`, `PATTERNS.md`, `SUMMARY.md`, verification marker, commit, etc.) is confirmed.
- When calling `wait_agent`, use the `workflow.subagent_timeout` value as `timeout_ms` if it exists; otherwise use the default value of `1800000` ms.
- If `wait_agent` times out, call `wait_agent` again for the same agent, check status with `send_input`, or spot-check filesystem/git artifacts.
- Do not call `close_agent` immediately after a timeout, and do not directly reimplement still-running subagent work in the main agent.
- Call `close_agent` only after collecting the final result, confirming terminal failure, completing artifact contract verification, or receiving an explicit stop request from the user.
- Use inline sequential fallback only when Codex native subagents cannot be started, the workflow marks the work as non-parallelizable, or safety checks detect overlapping write scopes; clearly explain the fallback reason to the user.

<!-- GSD:project-start source:PROJECT.md -->
## Project

**Grabit**

공연·전시·스포츠 등 라이브 엔터테인먼트 티켓 예매 플랫폼. NOL 티켓(인터파크)을 참조하여 장르별 큐레이션, SVG 기반 좌석 선택, 원스톱 예매 플로우를 제공한다. 실제 서비스 런칭을 목표로 1인 개발로 진행한다.

**Core Value:** 사용자가 원하는 공연을 발견하고, 좌석을 직접 선택하여, 안정적으로 예매를 완료할 수 있는 것. 이 흐름이 끊기면 서비스의 의미가 없다.

### Constraints

- **1인 개발**: 모든 영역(프론트/백/인프라)을 혼자 담당 — 복잡도를 최소화하고 모놀리스 우선
- **Tech Stack**: docs/03-ARCHITECTURE.md에 정의된 스택을 그대로 따름
- **결제**: Toss Payments SDK 연동 (PG사 계약 및 사업자등록 필요)
- **인프라**: GCP 서울 리전 (asia-northeast3) 기반, 초기 min-instances=0으로 비용 최소화
- **SVG 좌석맵**: MVP부터 SVG 기반 좌석 선택 구현 (외부 제작 SVG 업로드 방식)
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Recommended Stack
### Runtime
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Node.js | 22.22.x LTS (Jod) | Server runtime for Next.js + NestJS | Active LTS until April 2027. All frameworks in this stack require >= 20.9.0. v22 is the safe choice -- v24 LTS exists but ecosystem adoption is still catching up. | HIGH |
| TypeScript | 5.9.x | Type system | Stable since August 2025. TS 6.0 and 7.0 (Go-based) are coming but not production-ready. Stick with 5.9 for now; upgrade path is straightforward. | HIGH |
### Frontend Core
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Next.js | 16.2.x | SSR/SSG framework | Released Oct 2025. Turbopack stable for dev+prod, 50%+ faster builds. `output: 'standalone'` for Cloud Run containers. App Router is the standard. | HIGH |
| React | 19.x (bundled with Next.js 16) | UI library | React 19 ships with Next.js 16. Use whatever version Next.js pins -- currently 19.1.x in the Next.js peer dependency. Do not independently pin React. | HIGH |
| Tailwind CSS | 4.2.x | Utility CSS | v4 is 5x faster full builds, 100x faster incremental. CSS-first config (no JS config file). next/font integration works out of the box. | HIGH |
### Frontend Libraries
| Library | Version | Purpose | Why | Confidence |
|---------|---------|---------|-----|------------|
| @tanstack/react-query | 5.95.x | Server state management | The standard for async state in React. Built-in Suspense support, optimistic updates, streaming with RSC. Actively maintained (releases weekly). | HIGH |
| zustand | 5.0.x | Client state management | Minimal API, ~1kb, React 19 compatible. Use for booking flow state (selected seats, schedule), user session. Name stores with `use` prefix for React Compiler compatibility. | HIGH |
| react-hook-form | 7.72.x | Form management | Uncontrolled-first approach minimizes re-renders. Works with React 19 and useActionState. Pair with zod for schema validation. | HIGH |
| zod | 4.3.x | Schema validation | TypeScript-first validation. Use for both frontend form schemas and backend DTO validation (via drizzle-zod for DB schema parity). v4 is stable. | HIGH |
| swiper | 12.1.x | Carousel/slider | v12 (Sep 2025): pure CSS theming, no SCSS/LESS. Use for banner carousels, performance card sliders. Element-based API is the recommended approach. | HIGH |
| react-day-picker | 9.x | Calendar component | Lightweight, accessible (WCAG 2.1 AA), customizable. Better for booking calendars than react-calendar because it supports disabled dates natively, locale, and custom modifiers for "sold out" / "available" states. | MEDIUM |
| react-zoom-pan-pinch | 3.7.x | SVG seat map zoom/pan | 350+ downstream projects. Supports pinch zoom, wheel zoom, double-tap zoom. Wrap the SVG seat map with TransformWrapper + TransformComponent. Last release was ~1 year ago but stable API, no breaking changes expected. | MEDIUM |
| @tosspayments/tosspayments-sdk | 2.5.x | Payment UI (frontend) | Official Toss Payments SDK. Handles payment widget rendering, card input, easy-pay flow. The `@tosspayments/sdk` package is deprecated -- use this one. | HIGH |
| @sentry/nextjs | 10.x | Error tracking (frontend) | Official Sentry SDK for Next.js. Source map upload, performance monitoring, session replay. Install via `npx @sentry/wizard`. | HIGH |
| sharp | latest | Image optimization | Required for Next.js image optimization in standalone mode. Must be explicitly installed for Cloud Run deployment. | HIGH |
### Backend Core
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| NestJS | 11.x (@nestjs/core 11.1.x) | API framework | Modular monolith via NestJS modules. TypeScript-native, DI container, guards/interceptors/pipes. v11 (Jan 2025) added JSON logging, IntrinsicException. | HIGH |
| Drizzle ORM | 0.45.x (stable) | Database ORM | Use over TypeORM and Prisma. 14x lower latency than N+1-prone ORMs, ~7kb bundle, zero dependencies, SQL-first approach. Code-first schema definition in TypeScript. 1.0-beta exists but stick with 0.45.x stable for production. | HIGH |
| drizzle-kit | 0.30.x | DB migrations | Companion CLI for Drizzle. Generates SQL migrations from schema changes. `drizzle-kit generate` + `drizzle-kit migrate`. | HIGH |
| pg (node-postgres) | 8.x | PostgreSQL driver | Use with Drizzle ORM. Connection pooling via `pg.Pool`. Drizzle wraps this -- do not use an ORM-specific driver. | HIGH |
| pg-boss | 12.14.x | Job queue | PostgreSQL-native job queue using SKIP LOCKED. Cron scheduling, priority queues, dead letter queues, automatic retries with exponential backoff. Direct integration (no NestJS wrapper needed -- create a custom provider). | HIGH |
### Backend Libraries
| Library | Version | Purpose | Why | Confidence |
|---------|---------|---------|-----|------------|
| @nestjs/jwt | 10.x | JWT token management | Official NestJS JWT module. Access token (15min) + Refresh token rotation (7d httpOnly cookie). | HIGH |
| @nestjs/passport | 11.0.x | Auth strategies | Official NestJS Passport module. Use passport-kakao, passport-naver for social login strategies. | HIGH |
| @nestjs/config | 4.0.x | Configuration | `.env` loading, typed config namespaces, validation via Joi or zod. | HIGH |
| @nestjs/terminus | 11.1.x | Health checks | Cloud Run health check endpoint. Checks DB connection + Redis connection. | HIGH |
| @nestjs/websockets | 11.1.x | WebSocket gateway | Real-time seat status broadcasting. Use with Socket.IO adapter for namespace support + Redis adapter for multi-instance. | HIGH |
| @nestjs/platform-socket.io | 11.1.x | Socket.IO adapter | Default WebSocket adapter for NestJS. Provides namespaces, rooms, automatic reconnection. Use over raw `ws` because Cloud Run multi-instance requires Redis pub/sub relay, and Socket.IO has built-in Redis adapter. | HIGH |
| socket.io | 4.x | WebSocket server | Underlying WebSocket library. Paired with @socket.io/redis-adapter for multi-instance broadcast. | HIGH |
| @socket.io/redis-adapter | 8.x | Multi-instance WebSocket | Connects Socket.IO across Cloud Run instances via Redis pub/sub. Essential for seat status broadcast when scaled to multiple instances. | HIGH |
| @upstash/redis | 1.37.x | Redis client | HTTP-based Redis client for Upstash. Serverless-friendly, no persistent connections. Use for seat locking (SET NX), queue position, ranking cache. | HIGH |
| ioredis | 5.x | Redis client (WebSocket pub/sub) | TCP-based Redis client. Required for Socket.IO Redis adapter (pub/sub requires persistent connections that @upstash/redis HTTP client cannot provide). Use ioredis ONLY for WebSocket pub/sub; use @upstash/redis for everything else. | HIGH |
| argon2 | 0.41.x | Password hashing | OWASP-recommended over bcrypt. Memory-hard (resists GPU/ASIC attacks). Use argon2id variant. Configured: memory 19 MiB, iterations 2, parallelism 1. | HIGH |
| helmet | 8.x | HTTP security headers | OWASP security headers middleware. Apply via NestJS middleware. | HIGH |
| @aws-sdk/client-s3 | 3.x | R2 object storage | S3-compatible SDK for Cloudflare R2. Change endpoint to `<ACCOUNT_ID>.r2.cloudflarestorage.com`. Zero egress fees. | HIGH |
| @sentry/nestjs | 10.x | Error tracking (backend) | Official Sentry SDK for NestJS. Performance monitoring, distributed tracing, exception capture. | HIGH |
| drizzle-zod | 0.7.x | Schema-to-Zod bridge | Auto-generate Zod schemas from Drizzle table definitions. Shared validation between DB layer and API DTOs. Eliminates class-validator/class-transformer dependency. | MEDIUM |
### Database
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Cloud SQL PostgreSQL | 16 | Primary database | Seoul region (asia-northeast3), automatic backup (7-day PITR), 99.95% SLA. PostgreSQL 16 for tsvector FTS, pg_trgm, SKIP LOCKED. | HIGH |
| Upstash Redis | Serverless | Cache + real-time | Seat locking (SET NX + TTL), queue position (Sorted Set), ranking cache, real-time pub/sub. Serverless = no idle cost. Seoul edge node for low latency. | HIGH |
### Infrastructure
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Google Cloud Run | N/A | Container hosting | Seoul region, auto-scale to zero (min-instances=0 for cost), WebSocket/SSE native support. Separate services: `web` (Next.js) + `api` (NestJS). | HIGH |
| Cloudflare R2 | N/A | Object storage | S3-compatible, zero egress fees. Posters, SVG seat maps, static assets. | HIGH |
| Cloudflare CDN/WAF | Free plan | CDN + security | Static asset caching, DDoS protection, rate limiting. | HIGH |
| GitHub Actions | N/A | CI/CD | Workload Identity Federation (OIDC) for GCP auth. Build -> Artifact Registry -> Cloud Run deploy. | HIGH |
| Sentry | Free tier | Observability | Frontend + backend error tracking, performance monitoring. | HIGH |
### Dev Dependencies
| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| @nestjs/cli | 11.x | NestJS scaffolding | Code generation, build, dev server |
| @nestjs/testing | 11.x | Test utilities | Integration testing with DI container |
| vitest | 3.x | Test runner | Fast, ESM-native, TypeScript-first. Use over Jest for new projects. |
| @testing-library/react | 16.x | Component testing | DOM testing utilities for React 19 |
| eslint | 9.x | Linting | Flat config format. Use @typescript-eslint for TS rules |
| prettier | 3.x | Formatting | Code formatting |
| drizzle-kit | 0.30.x | DB tooling | Migration generation and execution |
| @playwright/test | 1.x | E2E testing | Cross-browser E2E tests |
## Alternatives Considered
### ORM Decision: Drizzle over TypeORM and Prisma
| Criterion | Drizzle (Chosen) | TypeORM | Prisma |
|-----------|-----------------|---------|--------|
| Performance | 14x lower latency, single optimized SQL | N+1 prone, heavy abstraction | Rust query engine binary, cold start overhead |
| Bundle size | ~7kb, zero deps | Heavy, many deps | Requires binary engine (~5MB) |
| Type safety | Full TypeScript inference from schema | Decorator-based, weaker inference | Schema-first, generated client |
| NestJS integration | Manual provider (simple) | First-class (@nestjs/typeorm) | Community module |
| SQL control | SQL-like API, transparent queries | QueryBuilder or raw SQL | Limited raw SQL escape hatch |
| Cloud Run fit | Tiny bundle, fast cold start | Acceptable | Binary engine = slower cold start |
| Maintenance | Active, trending | Legacy, slower releases | Active but heavier |
### Validation: drizzle-zod over class-validator
| Criterion | drizzle-zod + zod (Chosen) | class-validator + class-transformer |
|-----------|---------------------------|-------------------------------------|
| Schema source | Drizzle table = single source of truth | Separate DTO classes |
| Frontend sharing | Zod schemas work in browser | class-validator is backend-only |
| Bundle | zod: ~13kb | class-validator: ~50kb + class-transformer |
| TypeScript DX | Full type inference | Decorator-based, less inference |
| NestJS pipes | Custom ZodValidationPipe (10 lines) | Built-in ValidationPipe |
### WebSocket: Socket.IO over raw ws
| Criterion | Socket.IO (Chosen) | ws (raw WebSocket) |
|-----------|--------------------|--------------------|
| Multi-instance | @socket.io/redis-adapter built-in | Manual Redis pub/sub relay |
| Reconnection | Automatic with exponential backoff | Manual implementation |
| Namespaces/rooms | Built-in (useful for per-schedule seat rooms) | Not supported |
| Performance overhead | ~5-10% higher latency | Raw, minimal overhead |
| NestJS integration | @nestjs/platform-socket.io official | @nestjs/platform-ws official |
### Password Hashing: argon2 over bcrypt
| Criterion | argon2 (Chosen) | bcrypt |
|-----------|----------------|--------|
| Security | Memory-hard, GPU/ASIC resistant | CPU-only, vulnerable to GPU |
| OWASP recommendation | Primary recommendation (2025) | Acceptable with cost 12+ |
| Performance | ~200-500ms tunable | ~200-500ms with cost 12 |
| Node.js support | Native binding (argon2 npm) | Native binding (bcryptjs or bcrypt) |
### Calendar: react-day-picker over react-calendar
| Criterion | react-day-picker (Chosen) | react-calendar |
|-----------|---------------------------|----------------|
| Size | Lightweight | Heavier |
| Disabled dates | Native disabled modifier | Less flexible |
| Custom modifiers | "sold-out", "available", "selected" modifiers | Limited |
| Accessibility | WCAG 2.1 AA compliant | Good but less documented |
| Styling | CSS-first, easy Tailwind integration | Requires overrides |
### SVG Seat Map: react-zoom-pan-pinch over react-svg-pan-zoom
| Criterion | react-zoom-pan-pinch (Chosen) | react-svg-pan-zoom |
|-----------|------------------------------|---------------------|
| React integration | Hooks-based, modern API | Class-based, older API |
| Touch support | Pinch zoom, wheel zoom, double-tap | Pinch zoom, wheel zoom |
| DOM agnostic | Works with any child element | SVG-specific |
| Bundle | Small | Larger |
| Maintenance | Stable (v3.7), widely used | Less active |
## What NOT to Use
| Technology | Why Not | Use Instead |
|------------|---------|-------------|
| TypeORM | Legacy patterns, N+1 prone, heavy abstraction, slower releases | Drizzle ORM |
| Prisma | Binary query engine (slow cold starts on Cloud Run), schema-first adds indirection | Drizzle ORM |
| MikroORM | Smaller ecosystem, less NestJS community adoption | Drizzle ORM |
| class-validator + class-transformer | Backend-only, cannot share with frontend, decorator-heavy | zod + drizzle-zod |
| BullMQ + Redis | Adds Redis complexity for job queue when PostgreSQL is already available | pg-boss (PostgreSQL native) |
| Kafka | Massive overkill for ~100/min job throughput | pg-boss |
| Elasticsearch | Overkill for performance catalog search (<100k records) | PostgreSQL tsvector + pg_trgm |
| raw ws library | No built-in reconnection, rooms, or Redis adapter | Socket.IO via @nestjs/platform-socket.io |
| bcrypt | Acceptable but not OWASP primary recommendation for new projects | argon2 |
| @tosspayments/sdk | Deprecated package | @tosspayments/tosspayments-sdk |
| @tosspayments/payment-sdk | Older package | @tosspayments/tosspayments-sdk |
| Jest | Slower, CJS-first, heavier config | vitest |
| Moment.js | Deprecated, heavy bundle | date-fns or native Intl |
| styled-components / CSS Modules | Unnecessary with Tailwind CSS v4 | Tailwind CSS |
| Redux / MobX | Overkill for this project's client state needs | Zustand |
| Apollo Client / urql | GraphQL clients -- this project uses REST | TanStack Query |
| Vercel hosting | Project deploys to Cloud Run, not Vercel | Google Cloud Run |
## Installation
### Frontend (apps/web)
# Core
# Styling
# State & Data
# UI Components
# Payment
# Observability
# Image optimization (required for standalone)
# Dev
### Backend (apps/api)
# Core
# Database
# Validation
# Auth
# WebSocket
# Redis
# Job Queue
# Storage
# Config & Health
# Security
# Observability
# Dev
## Version Pinning Strategy
## Redis Client Strategy (Important Architectural Note)
| Client | Transport | Used For | Why |
|--------|-----------|----------|-----|
| @upstash/redis | HTTP | Seat locking, queue, ranking cache, general key/value | Serverless-friendly, no connection pool, works everywhere |
| ioredis | TCP | Socket.IO Redis adapter (pub/sub) | Pub/sub requires persistent TCP connections that HTTP client cannot provide |
## pg-boss Integration Pattern (NestJS without wrapper)
## Sources
- [Next.js 16 release blog](https://nextjs.org/blog/next-16)
- [Next.js 16.1 release blog](https://nextjs.org/blog/next-16-1)
- [NestJS 11 announcement (Trilon)](https://trilon.io/blog/announcing-nestjs-11-whats-new)
- [TypeScript 5.9 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-5-9/)
- [Drizzle ORM + NestJS (Trilon)](https://trilon.io/blog/nestjs-drizzleorm-a-great-match)
- [NestJS ORM comparison 2025](https://dev.to/sasithwarnakafonseka/best-orm-for-nestjs-in-2025-drizzle-orm-vs-typeorm-vs-prisma-229c)
- [Node.js ORM comparison (thedataguy)](https://thedataguy.pro/blog/2025/12/nodejs-orm-comparison-2025/)
- [Drizzle vs Prisma 2026 (makerkit)](https://makerkit.dev/blog/tutorials/drizzle-vs-prisma)
- [pg-boss GitHub](https://github.com/timgit/pg-boss)
- [React Zoom Pan Pinch GitHub](https://github.com/BetterTyped/react-zoom-pan-pinch)
- [Swiper v12 blog](https://swiperjs.com/blog/swiper-v12)
- [React DayPicker docs](https://daypicker.dev/)
- [Toss Payments SDK npm](https://www.npmjs.com/package/@tosspayments/tosspayments-sdk)
- [Upstash Redis npm](https://www.npmjs.com/package/@upstash/redis)
- [Sentry Next.js docs](https://docs.sentry.io/platforms/javascript/guides/nextjs/)
- [Cloudflare R2 S3 SDK](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/)
- [Password hashing guide 2025](https://guptadeepak.com/the-complete-guide-to-password-hashing-argon2-vs-bcrypt-vs-scrypt-vs-pbkdf2-2026/)
- [NestJS WebSocket docs](https://docs.nestjs.com/websockets/gateways)
- [Scalable WebSockets NestJS + Redis (LogRocket)](https://blog.logrocket.com/scalable-websockets-with-nestjs-and-redis/)
- [TanStack Query npm](https://www.npmjs.com/package/@tanstack/react-query)
- [Zustand npm](https://www.npmjs.com/package/zustand)
- [Tailwind CSS v4](https://tailwindcss.com/blog/tailwindcss-v4)
- [Node.js 22.22.x LTS](https://nodejs.org/en/about/previous-releases)
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

### 어드민 계정
개발환경, 프로덕션 동일
- admin@grapit.test  TestAdmin2026!

### 개발환경 서버포트
- web: 3000
- api: 8080

### 환경변수 (.env)

- `.env` 파일은 **모노레포 루트** (`/grapit/.env`)에 위치한다. `apps/api/`나 `apps/web/`에 별도 `.env`를 두지 않는다.
- NestJS `ConfigModule.forRoot()`는 루트 `.env`를 읽는다 (`envFilePath` 미지정 시 cwd 기준).
- **drizzle-kit은 `process.cwd()` 기준으로 `.env`를 찾는다.** `pnpm --filter`는 cwd를 `apps/api/`로 바꾸므로 루트 `.env`를 못 찾는다. 반드시 `DOTENV_CONFIG_PATH`를 지정해야 한다:
  ```bash
  # 마이그레이션 (루트에서 실행)
  DOTENV_CONFIG_PATH=../../.env pnpm --filter @grabit/api exec drizzle-kit migrate
  # 스키마 생성 (루트에서 실행)
  DOTENV_CONFIG_PATH=../../.env pnpm --filter @grabit/api exec drizzle-kit generate
  ```
- `.env`는 `.gitignore`에 포함. `.env.example`은 커밋하되 실제 시크릿은 넣지 않는다.

### 프로덕션 환경변수 (Cloud Run)

- Cloud Run에서는 `.env` 파일을 사용하지 않는다. GCP Secret Manager 또는 Cloud Run 환경변수 설정으로 주입한다.
- drizzle-kit migrate는 프로덕션에서 직접 실행하지 않는다. CI/CD (GitHub Actions)에서 `DATABASE_URL`을 환경변수로 주입하여 실행:
  ```yaml
  # GitHub Actions에서
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
  run: pnpm --filter @grabit/api exec drizzle-kit migrate
  ```
- 필수 환경변수: `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`
- 선택 환경변수: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` (없으면 SMS dev mock 모드)
- OAuth: `KAKAO_CLIENT_ID`, `KAKAO_CLIENT_SECRET`, `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-Codex-profile` -- do not edit manually.
<!-- GSD:profile-end -->
