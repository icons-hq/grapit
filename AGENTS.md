# AGENTS.md

이 문서는 Grabit repository에서 작업하는 AI agent의 프로젝트 단위 운영 기준이다. 세부 판단은 현재 source code, `package.json`, `pnpm-lock.yaml`, `turbo.json`, `docs/03-ARCHITECTURE.md`를 확인한 뒤 내린다. 문서와 코드가 다르면 code/package manifest truth를 우선한다.

## 응답 원칙

- 기본 답변은 한국어로 작성한다.
- 기술 용어, package name, command, file path, code identifier는 English 그대로 둔다.
- 답변은 간결하고 직접적으로 쓴다. 무엇을 확인했고, 무엇을 바꿨고, 무엇이 남았는지를 먼저 말한다.
- 작업 범위가 불명확하면 실행 전에 질문한다. 다만 사용자가 명확히 수정, 구현, 정리를 요청한 경우에는 필요한 확인 후 진행한다.
- 추측보다 evidence를 우선한다. 오래된 문서나 summary는 현재 repo/runtime truth로 다시 확인한다.

## 안전 경계

- 기본은 read-only로 시작한다. 사용자가 명확히 파일 수정, 실행, 배포, 정리를 요청했을 때만 write action을 수행한다.
- 삭제, 덮어쓰기, production DB 변경, 외부 API write, 배포, 결제/환불처럼 되돌리기 어려운 작업은 사용자의 명시적 요청이나 확인 없이 수행하지 않는다.
- key, token, password, cookie, authorization header, raw secret value는 출력하지 않는다. 필요하면 존재 여부와 redacted metadata만 말한다.
- `.env`는 읽더라도 값을 노출하지 않는다. `.env.example`에는 실제 secret을 넣지 않는다.
- 사용자나 다른 agent가 만든 unrelated change는 되돌리지 않는다.

## 프로젝트 기준

- Grabit은 공연, 전시, 스포츠 등 라이브 엔터테인먼트 티켓 예매 플랫폼이다.
- 핵심 사용자 흐름은 `discover -> seat selection -> booking/payment -> QR ticket -> venue entry`다. 이 흐름을 끊는 변경은 우선순위를 높게 다룬다.
- 1인 개발 프로젝트이므로 복잡도를 낮게 유지한다. microservice보다 modular monolith를 우선한다.
- 새로운 구조보다 기존 module, component, helper, naming convention을 따른다.
- MVP/production readiness에 직접 기여하지 않는 기능 추가, 리팩터링, 최적화는 요청받지 않으면 하지 않는다.

## Repository 구조

- `apps/web`: Next.js App Router frontend. Public booking, auth, admin, field check-in, mypage, legal, i18n UI가 포함된다.
- `apps/api`: NestJS modular monolith API. Auth, admin, booking, payment, reservation, queue, refund, traffic, translation, consent, field operations module이 포함된다.
- `packages/shared`: frontend/backend가 공유하는 Zod schema, type, constants, i18n contract.
- `docs/`: product, architecture, operation documentation. 오래된 예시는 source code로 검증한 뒤 사용한다.
- `.planning/`: 과거 계획, milestone, debug artifact 등 historical context. 현재 작업 지시나 workflow source of truth로 취급하지 않는다.

## 기술 스택 기준

- runtime은 Node.js 22+와 `pnpm@10.28.1` workspace를 기준으로 한다.
- root scripts는 `turbo` 기반이며 기본 command는 `pnpm dev`, `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`다.
- frontend는 Next.js 16, React 19, TypeScript 5.9, Tailwind CSS v4, `next-intl`, TanStack Query, Zustand, React Hook Form, Toss Payments SDK, Sentry를 기준으로 한다.
- backend는 NestJS 11, Drizzle ORM, PostgreSQL, `pg-boss`, `ioredis`/Google Memorystore for Valkey, Socket.IO, Cloudflare R2, Sentry를 기준으로 한다.
- shared package는 Zod schema/type contract의 공유 계층이다. public API나 DB schema 변경 시 `packages/shared` 영향도까지 확인한다.
- installed version truth는 각 `package.json`과 `pnpm-lock.yaml`을 따른다. AGENTS나 docs의 version 서술이 다르면 manifest/lockfile을 먼저 믿는다.
- TypeORM, Prisma, class-validator/class-transformer, BullMQ, Kafka, Elasticsearch, Redux, Apollo/GraphQL client, Upstash Redis 중심 구조는 명확한 승인 없이 도입하지 않는다.

## Architecture 원칙

- modular monolith를 유지한다. module 경계는 business capability 기준으로 둔다.
- PostgreSQL을 primary source of truth로 둔다. 검색, job queue, transaction은 가능한 한 Postgres 기반으로 해결한다.
- Valkey/Redis는 seat lock, queue, ranking/cache, throttling, pub/sub처럼 low-latency 또는 real-time이 필요한 곳에만 사용한다.
- WebSocket multi-instance broadcast는 Socket.IO와 Redis adapter 패턴을 따른다.
- Cloud Run은 `grabit-web`과 `grabit-api` service로 분리하고, production region은 `asia-northeast3`를 기준으로 한다.
- Cloudflare R2는 poster, SVG seat map, static asset storage 용도로 사용한다.

## 구현 기준

- 변경은 요청 범위에 맞춰 작게 유지한다.
- 기존 public API, shared type, database schema, user-visible flow를 바꾸기 전에 호출부와 downstream impact를 확인한다.
- 한 번만 쓰이는 helper나 추상화 계층을 만들지 않는다.
- 발생할 수 없는 상황을 위해 fallback이나 error handling을 추가하지 않는다.
- 사용되지 않는 코드가 확인되면 주석으로 남기지 말고 제거한다.
- 주석은 로직이 자명하지 않을 때만 짧게 추가한다.
- formatting-only churn과 unrelated cleanup은 피한다.

## Frontend 기준

- Grabit UI는 ticketing/operations product다. 조용하고 명확하며 반복 작업에 강한 화면을 우선한다.
- 기존 component, Tailwind token, route pattern, query key pattern을 먼저 찾는다.
- server state는 TanStack Query, client booking/session state는 Zustand를 우선한다.
- form은 React Hook Form과 Zod schema를 우선한다.
- locale 처리와 문구는 `next-intl`, `apps/web/messages/*`, shared locale constants의 현재 패턴을 따른다.
- UI 변경은 desktop/mobile 모두에서 text overlap, layout shift, disabled/loading/error state를 확인한다.
- icon이 필요한 button은 기존 icon library를 우선 사용한다.

## Backend 기준

- NestJS module/service/repository 경계를 유지한다.
- Drizzle schema와 shared Zod/type contract를 single source of truth에 가깝게 유지한다.
- seat selection, reservation, payment confirm, QR issuance는 transaction/concurrency boundary를 먼저 확인한다.
- customer-facing error는 user-visible message와 HTTP status가 일관되게 나가야 한다.
- background job은 `pg-boss`/PostgreSQL 기반을 우선한다.
- auth, role, admin guard 변경은 public/admin route impact를 함께 확인한다.
- production startup path는 `FRONTEND_URL`, Redis ping, Socket.IO Redis adapter wiring처럼 hard-fail 조건을 보존한다.

## Booking, QR, Field Entry 기준

- 좌석 선택, 임시 점유, 결제, 예매 확정은 서비스의 핵심 경로다. 이 경로의 regression은 사소한 UI 문제보다 우선한다.
- SVG seat map은 MVP 핵심 기능이다. SVG 업로드, parsing, rendering, seat selection contract를 임의로 바꾸지 않는다.
- QR credential validity와 venue entry state는 분리해서 다룬다.
- `입장 처리 완료` 이후에도 구매자 예매 상세와 QR 표시가 필요한 read path는 깨지지 않아야 한다.
- scanner duplicate prevention, offline sync, field monitor, customer reservation detail UX는 별도 요구사항으로 검증한다.

## 환경변수와 실행

- `.env`는 monorepo root에 둔다. `apps/api/` 또는 `apps/web/`에 별도 `.env`를 만들지 않는다.
- local 기본 port는 `web: 3000`, `api: 8080`이다.
- `apps/web/next.config.ts`는 monorepo root `.env`를 명시적으로 load한다.
- `apps/api/app.module.ts`는 `envFilePath: '../../.env'`를 사용한다.
- `pnpm --filter`로 Drizzle command를 실행할 때 root `.env`가 필요하면 명시한다.

```bash
DOTENV_CONFIG_PATH=../../.env pnpm --filter @grabit/api exec drizzle-kit migrate
DOTENV_CONFIG_PATH=../../.env pnpm --filter @grabit/api exec drizzle-kit generate
```

- Cloud Run production은 `.env` 파일을 사용하지 않는다. GCP Secret Manager, GitHub Actions secrets/vars, Cloud Run environment variable injection을 기준으로 한다.
- production migration은 local에서 직접 실행하지 않고 CI/CD 또는 명시 승인된 runbook을 따른다.

## CI/CD와 Production 운영 기준

- CI는 GitHub Actions에서 `pnpm lint`, `pnpm typecheck`, `pnpm test`, API integration test, Drizzle migration, seed, Playwright E2E를 실행한다.
- Deploy는 GitHub Actions에서 migration, Docker image build/push, Cloud Run deploy 순서로 진행된다.
- production issue는 local 추측보다 live truth를 우선한다.
- 확인 우선순위는 Cloud Run revision/status, live API response, runtime flags, logs, Sentry, database/cache evidence 순서로 둔다.
- GCP command는 project/region drift를 피하기 위해 필요한 경우 `--project=grapit-491806 --region=asia-northeast3`를 명시한다.
- production data cleanup은 보호 대상과 삭제 대상을 먼저 확정하고, destructive action 전 확인을 받는다.
- deploy 완료와 business cutover 가능 상태를 구분해서 보고한다.

## Verification 기준

- 코드 변경 후에는 변경 범위에 맞는 가장 작은 검증부터 실행한다.
- shared contract나 API/web cross-boundary 변경은 관련 package의 typecheck/test를 함께 본다.
- UI 변경은 가능하면 browser smoke 또는 screenshot으로 실제 render를 확인한다.
- production hotfix는 local green에서 멈추지 않고 deploy state와 live smoke를 확인해야 완료로 말할 수 있다.
- 문서-only 변경은 `git diff --check`와 민감정보 패턴 검색으로 충분한지 판단한다.
- 실행하지 못한 검증은 이유와 남은 risk를 명확히 남긴다.

## Git 기준

- 작업 전 `git status --short --branch`로 dirty state와 branch divergence를 확인한다.
- unrelated dirty file은 건드리지 않는다.
- destructive git command(`reset --hard`, `checkout --`, 강제 push 등)는 명시 요청 없이 사용하지 않는다.
- PR은 사용자가 명시적으로 draft를 요청한 경우를 제외하고 항상 ready-for-review 상태로 생성한다. 실수로 draft/리뷰 준비중 상태가 되면 즉시 `gh pr ready`로 전환한다.
- production ship은 기본적으로 branch -> PR -> CI green -> merge -> deploy -> live smoke 흐름을 따른다.
- direct push to `main`이나 direct production mutation은 사용자가 명확히 요구한 경우에만 고려한다.

## 문서 기준

- `AGENTS.md`에는 agent가 자주 따라야 하는 운영 기준만 둔다.
- 긴 technology comparison, source link catalog, historical decision log는 `docs/`나 historical artifact에 둔다.
- secret, password, personal token, private endpoint detail은 문서에 넣지 않는다.
- 문서가 stale해 보이면 현재 repo와 runtime truth를 확인한 뒤 갱신한다.
