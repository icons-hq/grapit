# Phase 26: M1 Canary + Cutover Gates - Pattern Map

**Mapped:** 2026-05-20  
**Files analyzed:** 30 new/modified candidates  
**Analogs found:** 27 / 30

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `.planning/phases/26-m1-canary-cutover-gates/26-GATE-LEDGER.md` | config/artifact | batch | `docs/runbooks/phase23-canary-rollback.md` | role-match |
| `.planning/phases/26-m1-canary-cutover-gates/26-GATE-LEDGER.json` | config/artifact | transform | `packages/shared/src/schemas/admin-operations.schema.ts` | partial |
| `scripts/phase26/validate-gate-ledger.mjs` | utility | transform | `scripts/smoke-valkey-production.mjs` | role-match |
| `scripts/phase26/infra-evidence.mjs` | utility | batch/file-I/O | `scripts/smoke-valkey-production.mjs` | exact |
| `scripts/phase26/rehearsal-smoke.mjs` | utility | request-response | `scripts/smoke-valkey-production.mjs` | role-match |
| `scripts/phase26/cleanup-dry-run.sql` | utility | CRUD/file-I/O | no close SQL cleanup analog | none |
| `scripts/phase26/cleanup-test-event.sql` | utility | CRUD/file-I/O | no close SQL cleanup analog | none |
| `scripts/k6/phase26-baseline.js` | test | batch/request-response | no existing k6 script | none |
| `scripts/k6/phase26-stress.js` | test | batch/request-response | no existing k6 script | none |
| `.planning/phases/26-m1-canary-cutover-gates/26-FIRST-24H-WATCH.md` | runbook | batch | `docs/runbooks/phase24-production-operations-handling.md` | exact |
| `docs/runbooks/phase26-direct-deploy-watch.md` | runbook | batch | `docs/runbooks/phase23-canary-rollback.md` | role-match |
| `docs/runbooks/phase26-cutover-ops.md` | runbook | event-driven/batch | `docs/runbooks/phase24-production-operations-handling.md` | exact |
| `apps/api/src/modules/payment/toss-payments.client.ts` | service | request-response | same file | exact |
| `apps/api/src/modules/payment/payment-webhook.controller.ts` | controller | event-driven/request-response | same file | exact |
| `apps/api/src/modules/payment/payment.service.ts` | service | CRUD/event-driven | same file | exact |
| `apps/api/src/modules/payment/toss-webhook.controller.spec.ts` | test | event-driven | same file | exact |
| `apps/api/src/modules/payment/payment.service.spec.ts` | test | CRUD/event-driven | same file | exact |
| `apps/api/src/modules/reservation/reservation.service.ts` | service | CRUD/request-response | same file | exact |
| `apps/api/src/modules/ticket/qr-ticket.service.ts` | service | CRUD/transform | same file | exact |
| `apps/api/src/modules/ticket/qr-ticket.service.spec.ts` | test | CRUD/transform | same file | exact |
| `apps/web/app/booking/[performanceId]/complete/page.tsx` | component/page | request-response | `apps/web/components/booking/booking-complete.tsx` | role-match |
| `apps/web/components/booking/booking-complete.tsx` | component | request-response | same file | exact |
| `apps/web/components/reservation/reservation-detail.tsx` | component | request-response | same file | exact |
| `apps/web/e2e/phase26-qr-visibility.spec.ts` | test | request-response | `apps/web/e2e/booking-complete-qr.spec.ts` | exact |
| `apps/web/e2e/phase26-toss-cutover.spec.ts` | test | request-response | `apps/web/e2e/toss-payment-phase24.spec.ts` | role-match |
| `packages/shared/src/constants/locales.ts` | config | transform | same file / `apps/web/e2e/i18n-smoke.spec.ts` | role-match |
| `apps/web/app/admin/cutover/page.tsx` | component/page | request-response | `apps/web/app/admin/operations/page.tsx` | role-match |
| `apps/web/components/admin/cutover-gate-ledger.tsx` | component | event-driven/request-response | `apps/web/components/admin/operations-inbox.tsx` | role-match |
| `apps/web/hooks/use-admin-cutover.ts` | hook | request-response | `apps/web/hooks/use-admin-operations.ts` | exact |
| `apps/web/components/admin/admin-sidebar.tsx` | component | request-response | same file | exact |

## Pattern Assignments

### Gate Ledger Artifacts And Validators

**Files:**  
`.planning/phases/26-m1-canary-cutover-gates/26-GATE-LEDGER.md`, `.planning/phases/26-m1-canary-cutover-gates/26-GATE-LEDGER.json`, `scripts/phase26/validate-gate-ledger.mjs`

**Analog:** `docs/runbooks/phase23-canary-rollback.md`, `scripts/smoke-valkey-production.mjs`

**Runbook gate semantics pattern** (`docs/runbooks/phase23-canary-rollback.md` lines 7-13):
```markdown
This runbook is the strict D-02 gate: if any smoke fails, rollback immediately and do not mark Phase 23 as PASS.

## Scope

- Applies to Phase 23 canary, progressive traffic shift, and post-shift smoke.
- Preserves Phase 22 `ACCEPTED_RISK` caveats as not-PASS evidence until direct proof is collected.
- Evidence must be redacted. Do not store raw access tokens, refresh cookies, OTP values, reset links, payment keys, or unmasked PII.
```

**PASS/FAIL rule pattern** (`docs/runbooks/phase23-canary-rollback.md` lines 108-130):
```markdown
If any smoke check fails:

1. Stop traffic increase immediately.
2. Roll traffic back to the last known-good revision.
3. Record the failed smoke category, canary revision, previous revision, timestamp, and redacted evidence.
...
Accepted risk is not PASS evidence. A caveat can remain documented, but it cannot substitute for direct smoke evidence.
```

**CLI validator style and redaction pattern** (`scripts/smoke-valkey-production.mjs` lines 41-70, 92-103):
```javascript
function usage() {
  return `
Usage:
  pnpm --filter @grabit/web exec node ../../scripts/smoke-valkey-production.mjs --check health
...
  Security:
  The script records command shape, revision, mode, PASS/FAIL, and sanitized summaries only.
  It redacts redis:// and rediss:// values, Authorization, Cookie, JWT, phone, paymentKey, orderId, and private customer data markers.
`;
}

function redact(value) {
  return String(value)
    .replace(REDIS_URL_PATTERN, '[redacted redis url]')
    .replace(/\bAuthorization:\s*Bearer\s+[^\s`'")]+/gi, 'Authorization: Bearer <redacted>')
    .replace(/\bCookie:\s*[^`\n\r]+/gi, 'Cookie: <redacted>')
    .replace(/\b(private customer data|customer data)\b/gi, '<customer-data:redacted>');
}
```

**Apply:** Gate validator must preserve `PASS`, `FAIL`, `ACCEPTED_RISK`, `CONFIG_READY_NOT_DRILLED`, and `BLOCKED` as distinct states. Do not collapse approved non-PASS rows into `PASS`.

---

### Phase 26 Ops Scripts

**Files:**  
`scripts/phase26/infra-evidence.mjs`, `scripts/phase26/rehearsal-smoke.mjs`

**Analog:** `scripts/smoke-valkey-production.mjs`

**Argument/env validation pattern** (`scripts/smoke-valkey-production.mjs` lines 73-90, 119-136):
```javascript
function parseArgs(argv) {
  const checkIndex = argv.indexOf('--check');
  if (checkIndex < 0 || !argv[checkIndex + 1]) {
    throw new Error('Missing --check. Use --help for supported checks.');
  }

  const check = argv[checkIndex + 1];
  const valid = new Set(['health', 'lua', 'socketio', 'idle', 'logs', 'all']);
  if (!valid.has(check)) {
    throw new Error(`Unsupported --check ${check}. Use --help for supported checks.`);
  }

  return { help: false, check };
}

function getEnv(name, fallback = undefined) {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable: ${name}`);
}
```

**Production project and safe fixture pattern** (`scripts/smoke-valkey-production.mjs` lines 151-185):
```javascript
async function loadConfig(check) {
  const apiUrl = parseProductionApiUrl(getEnv('GRABIT_API_URL'));
  const authHeaderPath = getEnv('GRABIT_SMOKE_AUTH_HEADER_FILE');
  const authHeaderContent = await readFile(authHeaderPath, 'utf8');
  ...
  const performanceId = getEnv('GRABIT_SMOKE_PERFORMANCE_ID');
  const showtimeId = getEnv('GRABIT_SMOKE_SHOWTIME_ID');
  const seatId = getEnv('GRABIT_SMOKE_SEAT_ID');
  const project = getEnv('GRABIT_GCP_PROJECT', 'grapit-491806');
  const region = getEnv('GRABIT_GCP_REGION', 'asia-northeast3');
  ...
}
```

**gcloud JSON pattern** (`scripts/smoke-valkey-production.mjs` lines 208-249):
```javascript
function runCli(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 10,
    timeout: GCLOUD_TIMEOUT_MS,
    env: {
      ...process.env,
      CLOUDSDK_CORE_DISABLE_PROMPTS: '1',
    },
  });
  ...
}

function gcloudJson(args) {
  const result = runCli('gcloud', [...args, '--format=json']);
  if (!result.ok) {
    throw new Error(`gcloud failed for ${result.shape}: ${redact(result.stderr || result.stdout)}`);
  }
  return JSON.parse(result.stdout || 'null');
}
```

**Apply:** New scripts should write redacted evidence to phase artifact paths, require dedicated test event IDs, and default to `--project=grapit-491806` / `asia-northeast3` unless explicitly overridden.

---

### k6 Load Scripts

**Files:**  
`scripts/k6/phase26-baseline.js`, `scripts/k6/phase26-stress.js`

**Analog:** No existing k6 script in repo.

**Use research-provided threshold pattern:**
```javascript
export const options = {
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<2000'],
  },
  scenarios: {
    baseline: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RATE || 500),
      timeUnit: '1s',
      duration: __ENV.DURATION || '20m',
      preAllocatedVUs: Number(__ENV.PREALLOCATED_VUS || 1000),
      maxVUs: Number(__ENV.MAX_VUS || 5000),
    },
  },
};
```

**Apply:** Keep payment provider load out of 10k/20k stress. Queue/read paths can be high volume; lock/prepare should be sampled; Toss confirm/cancel/query should be tiny safe smoke only.

---

### Direct Deploy Watch And First-24h Runbooks

**Files:**  
`docs/runbooks/phase26-direct-deploy-watch.md`, `.planning/phases/26-m1-canary-cutover-gates/26-FIRST-24H-WATCH.md`, `docs/runbooks/phase26-cutover-ops.md`

**Analog:** `docs/runbooks/phase24-production-operations-handling.md`, `docs/runbooks/phase23-canary-rollback.md`

**Production baseline and operator rule pattern** (`docs/runbooks/phase24-production-operations-handling.md` lines 23-53):
```markdown
## Current Production Baseline

| Area | Current baseline |
| --- | --- |
| Project | `grapit-491806` |
| Region | `asia-northeast3` |
...
| Booking gate | `BOOKING_ENABLED` must remain absent or false until the approved cutover phase |

## Operator Rules

1. Do not paste secrets into docs, issue trackers, chats, screenshots, shell history snippets, or commit messages.
2. Do not record full Toss `paymentKey`, webhook endpoint query secret, access token, refresh cookie, OTP, or card information.
3. Do not set `BOOKING_ENABLED=true` unless the explicit launch cutover gate approves it.
```

**Fast status check pattern** (`docs/runbooks/phase24-production-operations-handling.md` lines 54-80):
```bash
PROJECT_ID=grapit-491806
REGION=asia-northeast3

gcloud run services describe grabit-api \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format='json(status.latestReadyRevisionName,status.traffic,spec.template.spec.containers[0].image,spec.template.spec.containers[0].env)'

curl -fsS https://api.heygrabit.com/api/v1/health
curl -fsS https://heygrabit.com/api/runtime-flags
```

**Launch monitoring order pattern** (`docs/runbooks/phase24-production-operations-handling.md` lines 131-158):
```markdown
Monitor in this order:

1. Cloudflare challenge/block spikes.
2. API health and Cloud Run 5xx rate.
3. Queue admission logs and Redis errors.
4. Reservation prepare/confirm errors.
5. Toss redirect, confirm, and webhook status.
6. QR issuance and email scheduling side effects.
```

**Apply:** Phase 26 must remove traffic-split canary language and document `CI/CD green -> 100% direct deploy -> 15-minute watch`.

---

### Toss Client And Webhook Hardening

**Files:**  
`apps/api/src/modules/payment/toss-payments.client.ts`, `apps/api/src/modules/payment/payment-webhook.controller.ts`, `apps/api/src/modules/payment/payment.service.ts`

**Analog:** Same files.

**Toss client import/auth/error pattern** (`apps/api/src/modules/payment/toss-payments.client.ts` lines 1-25, 28-39):
```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export class TossPaymentError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'TossPaymentError';
    this.code = code;
  }
}

@Injectable()
export class TossPaymentsClient {
  private readonly secretKey: string;
  private readonly baseUrl = 'https://api.tosspayments.com/v1';

  constructor(private readonly configService: ConfigService) {
    this.secretKey = this.configService.get<string>('TOSS_SECRET_KEY', '');
  }

  private getAuthHeader(): string {
    return `Basic ${Buffer.from(this.secretKey + ':').toString('base64')}`;
  }
```

**Confirm/cancel request pattern** (`apps/api/src/modules/payment/toss-payments.client.ts` lines 41-70, 73-95):
```typescript
async confirmPayment(params: {
  paymentKey: string;
  orderId: string;
  amount: number;
}): Promise<TossPaymentResponse> {
  const response = await fetch(`${this.baseUrl}/payments/confirm`, {
    method: 'POST',
    headers: {
      Authorization: this.getAuthHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      paymentKey: params.paymentKey,
      orderId: params.orderId,
      amount: params.amount,
    }),
  });

  const data: unknown = await response.json();

  if (!response.ok) {
    const errorBody = data as Record<string, unknown>;
    throw new TossPaymentError(...);
  }

  return data as TossPaymentResponse;
}
```

**Webhook validation/guard pattern** (`apps/api/src/modules/payment/payment-webhook.controller.ts` lines 1-10, 35-68):
```typescript
import { Body, Controller, Headers, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { TossWebhookGuard } from './toss-webhook.guard.js';

export const tossWebhookSchema = z.object({
  eventId: z.string().min(1, 'eventId가 필요합니다').optional(),
  eventType: z.enum(['PAYMENT_STATUS_CHANGED', 'CANCEL_STATUS_CHANGED']),
  data: z.object({
    paymentKey: z.string().min(1, 'paymentKey가 필요합니다'),
    orderId: z.string().min(1, 'orderId가 필요합니다'),
    status: z.string().min(1, 'status가 필요합니다'),
  }),
});

@Public()
@UseGuards(TossWebhookGuard)
@Post('webhook')
async handleTossWebhook(
  @Body(new ZodValidationPipe(tossWebhookSchema)) body: TossWebhookDto,
  @Headers('tosspayments-webhook-transmission-id') transmissionId?: string,
) {
  const webhook = this.withEventId(body, transmissionId);
  const ledger = await this.paymentService.recordWebhookEvent(webhook);
```

**Webhook ledger duplicate/error pattern** (`apps/api/src/modules/payment/payment-webhook.controller.ts` lines 70-104):
```typescript
if (ledger.state === 'duplicate-processed') {
  return {
    acknowledged: true,
    duplicate: true,
    processingResultCode: ledger.processingResultCode ?? 'ALREADY_PROCESSED',
  };
}

try {
  const progress = await this.paymentService.findAsyncPaymentProgress(
    webhook.data.orderId,
    webhook.data.paymentKey,
  );
  const processingResult = await this.processEvent(webhook, progress);
  await this.paymentService.markWebhookEventProcessed(...);
  return { acknowledged: true, duplicate: false, processingResultCode: processingResult.code };
} catch (error) {
  const message = error instanceof Error ? error.message : 'webhook processing failed';
  await this.paymentService.markWebhookEventFailed(webhook.eventId, 'PROCESSING_FAILED', message);
  throw error;
}
```

**Payment event persistence pattern** (`apps/api/src/modules/payment/payment.service.ts` lines 191-233):
```typescript
async recordWebhookEvent(payload: TossWebhookRequestBody): Promise<TossWebhookRecordResult> {
  const [inserted] = await this.db
    .insert(paymentWebhookEvents)
    .values({
      eventId: payload.eventId,
      eventType: payload.eventType,
      paymentKey: payload.data.paymentKey,
      tossOrderId: payload.data.orderId,
      payload,
      receivedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: paymentWebhookEvents.id });

  if (inserted) {
    return { state: 'inserted', eventId: payload.eventId };
  }
  ...
}
```

**Apply:** Add `queryPayment(paymentKey)` to the client using the same auth/error style. Add `Idempotency-Key` support to POST confirm/cancel without logging raw keys. Webhook final state must re-query Toss before applying final local payment state.

---

### Reservation Confirm And QR Issuance

**Files:**  
`apps/api/src/modules/reservation/reservation.service.ts`, `apps/api/src/modules/ticket/qr-ticket.service.ts`

**Analog:** Same files.

**Booking gate and amount authority pattern** (`apps/api/src/modules/reservation/reservation.service.ts` lines 528-636):
```typescript
async prepareReservation(dto: PrepareReservationRequest, actorOrUserId: string | BookingActor, ...) {
  const actor = typeof actorOrUserId === 'string'
    ? { id: actorOrUserId, isEmailVerified: true, isPhoneVerified: true }
    : actorOrUserId;
  const userId = actor.id;
  this.featureFlags.assertBookingEnabled(actor);
  assertBookingVerificationComplete(actor);
  ...
  const canonicalSeats = await this.getCanonicalSeatSelections(dto.seats, showtime.performanceId);
  const expectedAmount = this.calculateSeatTotal(canonicalSeats);

  if (expectedAmount !== dto.amount) {
    throw new BadRequestException('금액이 일치하지 않습니다');
  }

  await this.bookingService.assertOwnedSeatLocks(...);
```

**Payment confirm lock and cleanup pattern** (`apps/api/src/modules/reservation/reservation.service.ts` lines 716-759):
```typescript
async confirmAndCreateReservation(dto: ConfirmPaymentRequest, actorOrUserId: string | BookingActor) {
  ...
  this.featureFlags.assertBookingEnabled(actor);
  assertBookingVerificationComplete(actor);

  const confirmLockToken = randomUUID();
  const confirmLockAcquired = await this.bookingService.acquirePaymentConfirmLock(
    dto.orderId,
    confirmLockToken,
  );

  if (!confirmLockAcquired) {
    throw new ConflictException('결제 확인이 이미 진행 중입니다.');
  }

  const refreshTimer = this.startPaymentConfirmLockRefresh(dto.orderId, confirmLockToken);
  try {
    ...
  } finally {
    clearInterval(refreshTimer);
    await this.bookingService.releasePaymentConfirmLock(dto.orderId, confirmLockToken);
  }
}
```

**Confirm transaction and QR issuance pattern** (`apps/api/src/modules/reservation/reservation.service.ts` lines 966-980, 1030-1208):
```typescript
const tossResponse = await this.tossClient.confirmPayment({
  paymentKey: dto.paymentKey,
  orderId: dto.orderId,
  amount: dto.amount,
});

approvedPayment = {
  paymentKey: tossResponse.paymentKey,
  orderId: tossResponse.orderId,
  method: tossResponse.method,
  totalAmount: tossResponse.totalAmount,
  approvedAt: tossResponse.approvedAt,
  asyncStatus: 'sync',
};

await this.db.transaction(async (tx) => {
  await tx.update(reservations).set({ status: 'CONFIRMED', updatedAt: new Date() });
  ...
  // Mark seats sold only when the inventory row is still available.
});

if (this.qrTicketService && committedPaymentId) {
  await this.qrTicketService.ensureIssuedTicketForReservation({
    reservationId: reservation.id,
    paymentId: committedPaymentId,
  });
}
```

**QR token issue/verify pattern** (`apps/api/src/modules/ticket/qr-ticket.service.ts` lines 108-147, 203-232):
```typescript
async ensureIssuedTicketForReservation(input: {
  reservationId: string;
  paymentId: string;
}): Promise<QrTicket> {
  let ticketRecord = await this.findTicketByReservationId(input.reservationId);

  if (!ticketRecord) {
    const issueContext = await this.getReservationIssueContext(input);
    const issuedAt = new Date();
    ...
    const inserted = await this.db
      .insert(tickets)
      .values({
        reservationId: issueContext.reservationId,
        paymentId: issueContext.paymentId,
        showtimeId: issueContext.showtimeId,
        qrTokenJti: randomUUID(),
        secretVersion: this.getCurrentSecretVersion(),
        status: 'active',
        issuedAt,
      })
      .returning(this.ticketRecordFields());
  }
  ...
}

async verifyTicketToken(token: string): Promise<QrTicketTokenPayload> {
  const decoded = this.jwtService.decode<Record<string, unknown> | null>(token);
  ...
  const verified = await this.jwtService.verifyAsync<QrTicketTokenPayload>(token, {
    secret: this.getVerificationSecret(secretVersion),
    algorithms: ['HS256'],
  });
  ...
  await this.requireValidTicketState(verified);
  return verified;
}
```

**Apply:** Field-scan contract smoke should call/cover `verifyTicketToken()` and assert reservation/payment/showtime linkage, but not add Phase 27 scanner UI.

---

### QR Complete Page And My Page Visibility

**Files:**  
`apps/web/app/booking/[performanceId]/complete/page.tsx`, `apps/web/components/booking/booking-complete.tsx`, `apps/web/components/reservation/reservation-detail.tsx`

**Analog:** `apps/web/components/booking/booking-complete.tsx`, `apps/web/components/reservation/reservation-detail.tsx`

**Complete surface imports/layout pattern** (`apps/web/components/booking/booking-complete.tsx` lines 1-13, 31-56):
```tsx
'use client';

import { useRouter } from 'next/navigation';
import { CheckCircle2, Mail, QrCode } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import type { ReservationDetail } from '@grabit/shared';

export function BookingComplete({ booking }: BookingCompleteProps) {
  const router = useRouter();

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="flex flex-col items-center gap-3 pt-4">
        <CheckCircle2 className="h-16 w-16 text-success" />
        <h1 className="text-xl font-semibold" tabIndex={-1} id="booking-complete-heading">
          예매가 완료되었습니다
        </h1>
      </div>
```

**Current QR CTA pattern** (`apps/web/components/booking/booking-complete.tsx` lines 125-160):
```tsx
<Card className="w-full border-[#E9DFFF] bg-[#F8F5FF]">
  <CardContent className="space-y-4 py-5">
    <div className="flex items-start justify-between gap-3">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <QrCode className="h-5 w-5 text-[#6C3CE0]" />
          <h2 className="text-base font-semibold text-gray-900">QR 티켓</h2>
        </div>
        <p className="text-sm text-gray-700">
          결제가 완료되었습니다. QR 티켓은 마이페이지에서 바로 확인할 수 있습니다.
        </p>
      </div>
      <Badge className="bg-[#F0FDF4] text-[#15803D]">발급 완료</Badge>
    </div>
...
<Button className="h-12 w-full" onClick={() => router.push(`/mypage/reservations/${booking.id}`)}>
  QR 티켓 보기
</Button>
```

**My Page QR active pattern** (`apps/web/components/reservation/reservation-detail.tsx` lines 189-235):
```tsx
{reservation.qrTicket.status === 'ACTIVE' && (
  <Card className="mt-4 border-[#E9DFFF] bg-[#F8F5FF] py-4">
    <CardContent className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <QrCode className="h-5 w-5 text-[#6C3CE0]" />
            <h2 className="text-base font-semibold text-gray-900">QR 티켓</h2>
          </div>
          <p className="text-sm text-gray-700">
            결제 직후 발급된 입장용 QR 티켓입니다. 공연장 입장 전에 다시 확인해주세요.
          </p>
        </div>
        <Badge className="bg-[#F0FDF4] text-[#15803D] border-transparent">발급 완료</Badge>
      </div>
      ...
      <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs text-gray-700">
        {reservation.qrTicket.token}
      </pre>
    </CardContent>
  </Card>
)}
```

**Apply:** D-25/D-26 require visible QR/access on both complete page and My Page. Redact raw QR token in evidence artifacts; UI should avoid exposing raw token if Phase 26 replaces text token with QR image/metadata.

---

### QR And Toss Browser E2E

**Files:**  
`apps/web/e2e/phase26-qr-visibility.spec.ts`, `apps/web/e2e/phase26-toss-cutover.spec.ts`

**Analog:** `apps/web/e2e/booking-complete-qr.spec.ts`, `apps/web/e2e/toss-payment-phase24.spec.ts`

**QR fixture and auth mock pattern** (`apps/web/e2e/booking-complete-qr.spec.ts` lines 1-65, 67-100):
```typescript
import { expect, test, type Page, type Route } from '@playwright/test';

function createReservationDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 'phase24-qr-reservation',
    reservationNumber: 'GRP-QR-0001',
    status: 'CONFIRMED',
    ...
    qrTicket: {
      token: 'qr-token-phase24',
      jti: 'qr-jti-phase24',
      status: 'ACTIVE',
      issuedAt: new Date().toISOString(),
      emailScheduledAt: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString(),
    },
    ...overrides,
  };
}

async function enableBooking(page: Page) {
  await page.route('**/api/runtime-flags', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ bookingEnabled: true }),
    });
  });
}
```

**QR assertions pattern** (`apps/web/e2e/booking-complete-qr.spec.ts` lines 103-143):
```typescript
test.describe('booking complete QR visibility', () => {
  test('booking complete exposes QR follow-up CTA and D-1 email notice', async ({ page }) => {
    await enableBooking(page);
    await mockAuthenticatedSession(page);
    await page.route('**/api/v1/payments/confirm', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createReservationDetail()) });
    });
    await page.goto('/booking/phase24-qr-performance/complete?paymentKey=phase24-payment-key&orderId=phase24-order-id&amount=50000');
    await expect(page.getByRole('button', { name: 'QR 티켓 보기' })).toBeVisible({ timeout: 10000 });
  });

  test('QR ticket is visible immediately from reservation detail', async ({ page }) => {
    ...
    await expect(page.getByRole('heading', { name: 'QR 티켓' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('qr-jti-phase24')).toBeVisible({ timeout: 10000 });
  });
});
```

**Toss recovery state pattern** (`apps/web/e2e/toss-payment-phase24.spec.ts` lines 120-160):
```typescript
test.describe('toss-payment phase24 recovery states', () => {
  test('pending return shows inline wait UI without re-confirming payment', async ({ page }) => {
    let confirmIntercepted = false;
    await enableBooking(page);
    await mockAuthenticatedSession(page);
    await injectBookingFixture(page, {...});
    await page.route('**/api/v1/payments/confirm', async (route: Route) => {
      confirmIntercepted = true;
      await route.fulfill({ status: 500, body: 'unexpected confirm call' });
    });
    ...
    await expect(page.getByText('해외 결제 인증을 기다리고 있습니다')).toBeVisible({ timeout: 10000 });
    await expect.poll(() => confirmIntercepted).toBe(false);
  });
});
```

**Apply:** Phase 26 E2E should move beyond stub-only proof where possible: pair Playwright visible assertions with API/database smoke or rehearsal evidence proving confirmed payment returns active `qrTicket`.

---

### Admin Cutover UI

**Files:**  
`apps/web/app/admin/cutover/page.tsx`, `apps/web/components/admin/cutover-gate-ledger.tsx`, `apps/web/hooks/use-admin-cutover.ts`, `apps/web/components/admin/admin-sidebar.tsx`

**Analog:** `apps/web/app/admin/operations/page.tsx`, `apps/web/components/admin/operations-inbox.tsx`, `apps/web/hooks/use-admin-operations.ts`, `apps/web/components/admin/admin-sidebar.tsx`

**Admin page container pattern** (`apps/web/app/admin/operations/page.tsx` lines 1-30):
```tsx
'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { OperationsInbox } from '@/components/admin/operations-inbox';
import {
  useAdminOperationsInbox,
  useAnswerOperation,
  ...
} from '@/hooks/use-admin-operations';

export default function AdminOperationsPage() {
  const [filters, setFilters] = useState<OperationsInboxFilters>({});
  const inbox = useAdminOperationsInbox(filters);
  ...
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-display font-semibold leading-[1.2]">운영 인박스</h1>
```

**Admin table/filter/detail pattern** (`apps/web/components/admin/operations-inbox.tsx` lines 1-25, 160-206):
```tsx
'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle, MessageSquareReply, Search, UserRoundPlus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
...
return (
  <div className="space-y-4">
    <form onSubmit={handleSubmit} className="grid gap-3 rounded-lg bg-white p-4 shadow-sm md:grid-cols-3">
      ...
    </form>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
```

**Admin row state/accessibility pattern** (`apps/web/components/admin/operations-inbox.tsx` lines 253-320):
```tsx
<TableRow
  key={row.id}
  data-testid="operations-inbox-row"
  role="button"
  tabIndex={0}
  aria-label={`${row.subject} 운영 항목 상세 보기`}
  className={cn(
    'min-h-11 cursor-pointer hover:bg-gray-50',
    selectedRow?.id === row.id && 'bg-[#F3EFFF]',
    row.escalation.escalated && 'border-l-4 border-l-[#C62828]',
  )}
  onClick={() => setSelectedRow(row)}
  onKeyDown={(event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setSelectedRow(row);
    }
  }}
>
```

**Admin detail action pattern** (`apps/web/components/admin/operations-inbox.tsx` lines 320-411):
```tsx
<aside className="rounded-lg bg-white p-4 shadow-sm" aria-label="운영 항목 상세">
  {selectedRow ? (
    <div className="space-y-4">
      <div>
        <h2 className="text-heading font-semibold leading-[1.2]">
          {selectedRow.subject}
        </h2>
        <p className="mt-2 text-sm text-gray-600">{selectedRow.summary ?? '요약 없음'}</p>
      </div>
      ...
      <Button type="button" variant="destructive" onClick={() => void handleEscalate()} disabled={!reason.trim()}>
        <AlertTriangle className="h-4 w-4" />
        에스컬레이션
      </Button>
    </div>
  ) : (
    <div className="py-10 text-center text-sm text-gray-600">...</div>
  )}
</aside>
```

**React Query hook pattern** (`apps/web/hooks/use-admin-operations.ts` lines 1-5, 126-171):
```typescript
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

export function useAdminOperationsInbox(filters: OperationsInboxFilters = {}) {
  return useQuery({
    queryKey: ['admin', 'operations', filters],
    queryFn: () => {
      const params = buildOperationsSearchParams(filters);
      const query = params.toString();
      return apiClient.get<OperationsInboxResponse>(
        `/api/v1/admin/operations/inbox${query ? `?${query}` : ''}`,
      );
    },
  });
}

export function useAnswerOperation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: AnswerOperationInput) =>
      apiClient.post(`/api/v1/admin/operations/inbox/${id}/answer`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'operations'] });
    },
  });
}
```

**Sidebar nav pattern** (`apps/web/components/admin/admin-sidebar.tsx` lines 21-102, 137-149):
```tsx
const NAV_GROUPS = [
  {
    label: '운영',
    items: [
      {
        label: '운영 인박스',
        href: '/admin/operations',
        icon: Inbox,
      },
      ...
    ],
  },
] as const;

<Link
  key={item.href}
  href={item.href}
  className={cn(
    'flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors',
    isActive
      ? 'border-l-[3px] border-primary bg-primary/5 text-primary'
      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
  )}
>
  <Icon className="h-5 w-5" />
  {item.label}
</Link>
```

**Apply:** Gate rows should sort blockers first, use exact state text, keep destructive actions behind `AlertDialog`, and keep `BOOKING_ENABLED=true` disabled until validator allows it.

---

### Optional Admin API For Cutover Readiness

**Files:**  
`apps/api/src/modules/admin/admin-cutover.controller.ts`, `apps/api/src/modules/admin/admin-cutover.service.ts` if planner chooses API-backed read surface.

**Analog:** `apps/api/src/modules/admin/admin-operations.controller.ts`, `apps/api/src/modules/admin/admin-operations.service.ts`

**Controller guard/validation pattern** (`apps/api/src/modules/admin/admin-operations.controller.ts` lines 1-23, 61-85):
```typescript
import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AdminCapabilities } from '../../common/decorators/admin-capabilities.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { AdminCapabilitiesGuard } from '../../common/guards/admin-capabilities.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';

@Controller('admin/operations')
@UseGuards(RolesGuard, AdminCapabilitiesGuard)
@Roles('admin')
export class AdminOperationsController {
  constructor(private readonly adminOperationsService: AdminOperationsService) {}

  @Get('inbox')
  @AdminCapabilities('support.manage')
  async listInbox(...) {
    return this.adminOperationsService.listInbox({...});
  }
}
```

**Service Drizzle/read model pattern** (`apps/api/src/modules/admin/admin-operations.service.ts` lines 1-26, 234-260):
```typescript
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { aliasedTable, and, asc, desc, eq, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import { refunds, supportMessages, supportThreads, users } from '../../database/schema/index.js';
import { AdminAuditService } from './admin-audit.service.js';

@Injectable()
export class AdminOperationsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly adminAuditService: AdminAuditService,
  ) {}

  async listInbox(filters: AdminOperationsInboxFilters = {}, context: AdminOperationsExecutionContext = {}) {
    const now = context.now ?? new Date();
    const rows = await this.fetchThreadRows(filters);
    const inboxRows = rows.map((row) => toInboxRow(row, now)).filter(...).sort(...);
    return { generatedAt: now.toISOString(), rows: inboxRows, totals: {...} };
  }
}
```

**Admin capability guard pattern** (`apps/api/src/common/guards/admin-capabilities.guard.ts` lines 14-40):
```typescript
canActivate(context: ExecutionContext): boolean {
  const requiredCapabilities = this.reflector.getAllAndOverride<AdminCapability[]>(
    ADMIN_CAPABILITIES_KEY,
    [context.getHandler(), context.getClass()],
  );
  if (!requiredCapabilities || requiredCapabilities.length === 0) {
    return true;
  }
  const request = context.switchToHttp().getRequest<{ user?: AdminCapabilityUser }>();
  if (!request.user) {
    return false;
  }
  const snapshot = resolveAdminCapabilitySnapshot(request.user);
  if (snapshot.superuser) {
    return true;
  }
  return requiredCapabilities.every((capability) => snapshot.capabilities.includes(capability));
}
```

**Apply:** Prefer read-only artifact/API display first. Do not add a high-risk runtime write surface for Gate Ledger unless planning explicitly scopes audit, auth, and persistence.

---

### Tests For Payment Webhook And Async Finalization

**Files:**  
`apps/api/src/modules/payment/toss-webhook.controller.spec.ts`, `apps/api/src/modules/payment/payment.service.spec.ts`

**Analog:** Same files.

**Webhook controller test setup pattern** (`apps/api/src/modules/payment/toss-webhook.controller.spec.ts` lines 1-24, 63-101):
```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator.js';
import { PaymentWebhookController, tossWebhookSchema } from './payment-webhook.controller.js';
import { TossWebhookGuard } from './toss-webhook.guard.js';

function createMockPaymentService() {
  return {
    recordWebhookEvent: vi.fn<PaymentService['recordWebhookEvent']>(),
    findAsyncPaymentProgress: vi.fn<PaymentService['findAsyncPaymentProgress']>(),
    upsertAsyncPaymentProgress: vi.fn<PaymentService['upsertAsyncPaymentProgress']>(),
    markWebhookEventProcessed: vi.fn<PaymentService['markWebhookEventProcessed']>(),
    markWebhookEventFailed: vi.fn<PaymentService['markWebhookEventFailed']>(),
  };
}

it('marks the Toss webhook endpoint public while requiring provider guard authentication', () => {
  expect(Reflect.getMetadata(IS_PUBLIC_KEY, PaymentWebhookController.prototype.handleTossWebhook)).toBe(true);
  expect(Reflect.getMetadata(GUARDS_METADATA, PaymentWebhookController.prototype.handleTossWebhook)).toContain(TossWebhookGuard);
});
```

**Duplicate/stale webhook test pattern** (`apps/api/src/modules/payment/toss-webhook.controller.spec.ts` lines 170-235):
```typescript
it('acknowledges duplicate replay without re-applying an already processed event', async () => {
  paymentService.recordWebhookEvent.mockResolvedValueOnce(
    makeLedgerResult({
      state: 'duplicate-processed',
      processingResultCode: 'PAYMENT_DONE_APPLIED',
    }),
  );

  const result = await controller.handleTossWebhook(paymentStatusChangedEvent);
  expect(result).toEqual({
    acknowledged: true,
    duplicate: true,
    processingResultCode: 'PAYMENT_DONE_APPLIED',
  });
  expect(paymentService.upsertAsyncPaymentProgress).not.toHaveBeenCalled();
});
```

**Async finalization test pattern** (`apps/api/src/modules/payment/payment.service.spec.ts` lines 239-335):
```typescript
it('finalizes async DONE webhook by confirming reservation, selling seats, and issuing QR ticket', async () => {
  ...
  await service.upsertAsyncPaymentProgress({...}, 'DONE', 'payment_status_changed:done');

  expect(updateReservation.set).toHaveBeenCalledWith(
    expect.objectContaining({ status: 'CONFIRMED' }),
  );
  expect(insertPayment.values).toHaveBeenCalledWith(
    expect.objectContaining({
      paymentKey: 'pay_async_done',
      amount: 150000,
      status: 'DONE',
      asyncStatus: 'payment_status_changed:done',
    }),
  );
  expect(mockQrTicketService.ensureIssuedTicketForReservation).toHaveBeenCalledWith({
    reservationId,
    paymentId,
  });
});
```

**Apply:** Add tests that webhook processing calls `queryPayment(paymentKey)` before finalizing, rejects mismatch between provider query and webhook payload, and sends `Idempotency-Key` for Toss POST confirm/cancel.

## Shared Patterns

### `BOOKING_ENABLED` Hard Gate

**Source:** `packages/shared/src/flags.ts`, `apps/api/src/modules/feature-flags/feature-flags.service.ts`  
**Apply to:** Reservation prepare/confirm, booking mutation smoke, cutover validator, runtime flag checks.

```typescript
// packages/shared/src/flags.ts lines 1-29
export const FLAG_NAMES = {
  BOOKING_ENABLED: 'BOOKING_ENABLED',
} as const;

export function readFeatureFlags(env: Record<string, string | undefined>): { bookingEnabled: boolean } {
  return {
    bookingEnabled: parseBooleanFlag(env[FLAG_NAMES.BOOKING_ENABLED], false),
  };
}

// apps/api/src/modules/feature-flags/feature-flags.service.ts lines 21-27
assertBookingEnabled(actor?: BookingActor): void {
  if (this.getFlags().bookingEnabled || actor?.role === 'admin') {
    return;
  }

  throw new ForbiddenException('예매는 추후 오픈 예정입니다');
}
```

### Queue Admission Guard

**Source:** `apps/api/src/modules/queue/guards/admission.guard.ts`  
**Apply to:** Booking mutation smoke, k6 sampled mutation, payment confirm safety checks.

```typescript
// lines 35-80
async canActivate(context: ExecutionContext): Promise<boolean> {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  const userId = request.user?.id;
  if (!userId) {
    throw new ForbiddenException('대기열 입장 인증이 필요합니다');
  }

  if (request.user?.role === 'admin') {
    request.queueAdmission = this.createAdminBypassAdmission(userId);
    return true;
  }

  const refreshToken = readRefreshCookie(request.cookies as Record<string, string | undefined>);
  const admissionToken = readQueueAdmissionCookie(request.cookies as Record<string, string | undefined>);
  ...
  request.queueAdmission = {...};
  return true;
}
```

### Traffic Defense Policies

**Source:** `apps/api/src/modules/traffic/traffic-defense.service.ts`  
**Apply to:** WAF/app-layer evidence, k6 thresholds, first-24h monitoring.

```typescript
// lines 13-19, 67-122
const TRAFFIC_POLICY_NAMES = [
  'queue-entry',
  'lock-seat',
  'prepare-reservation',
  'confirm-payment',
  'signup',
] as const;

const TRAFFIC_POLICIES: Record<TrafficPolicyName, TrafficPolicyDefinition> = {
  'queue-entry': { ttl: 60_000, limit: 20, matchers: [...] },
  'lock-seat': { ttl: 15_000, limit: 12, matchers: [...] },
  'prepare-reservation': { ttl: 60_000, limit: 8, matchers: [...] },
  'confirm-payment': { ttl: 60_000, limit: 6, matchers: [...] },
  signup: { ttl: 60_000, limit: 5, matchers: [...] },
};
```

### Health And DB Pool Evidence

**Source:** `apps/api/src/health/health.controller.ts`, `apps/api/src/database/drizzle.provider.ts`  
**Apply to:** Direct deploy watch, DR/infra ledger rows, first-24h checks.

```typescript
// apps/api/src/health/health.controller.ts lines 14-21
@Public()
@SkipThrottle()
@Get()
@HealthCheck()
check() {
  return this.health.check([
    () => this.redisIndicator.isHealthy('redis'),
  ]);
}

// apps/api/src/database/drizzle.provider.ts lines 31-46
useFactory: (config: ConfigService) => {
  const pool = new Pool({
    connectionString: config.get<string>('DATABASE_URL'),
    max: parsePositiveIntegerEnv(config, 'DB_POOL_MAX', 10),
    idleTimeoutMillis: parsePositiveIntegerEnv(config, 'DB_POOL_IDLE_TIMEOUT_MS', 30_000),
    connectionTimeoutMillis: parsePositiveIntegerEnv(config, 'DB_POOL_CONNECTION_TIMEOUT_MS', 5_000),
  });
  return drizzle(pool, { schema });
},
```

### Deploy Secrets And Cloud Run Settings

**Source:** `.github/workflows/deploy.yml`  
**Apply to:** Direct deploy watch, live-key smoke, DB pool capacity evidence.

```yaml
# lines 204-230
flags: >-
  --service-account=grapit-cloudrun@${{ env.GCP_PROJECT_ID }}.iam.gserviceaccount.com
  --add-cloudsql-instances=${{ secrets.CLOUD_SQL_CONNECTION_NAME }}
  --min-instances=0
  --max-instances=100
  --memory=512Mi
  --cpu=1
  --port=8080
  --no-cpu-throttling
  --session-affinity
  --allow-unauthenticated
env_vars: |
  NODE_ENV=production
  VALKEY_MODE=cluster
  DB_POOL_MAX=3
  DB_POOL_IDLE_TIMEOUT_MS=30000
  DB_POOL_CONNECTION_TIMEOUT_MS=5000
```

```yaml
# lines 231-260
secrets: |
  DATABASE_URL=database-url:latest
  JWT_SECRET=jwt-secret:latest
  JWT_REFRESH_SECRET=jwt-refresh-secret:latest
  REDIS_URL=redis-url:latest
  TOSS_SECRET_KEY=toss-secret-key:latest
  TOSS_WEBHOOK_SECRET=toss-webhook-secret:latest
  QR_TICKET_SECRET=qr-ticket-secret:latest
  QR_TICKET_SECRET_VERSION=qr-ticket-secret-version:latest
```

### Admin Auth And Capability Guard

**Source:** `apps/api/src/modules/admin/admin-operations.controller.ts`, `apps/api/src/common/guards/admin-capabilities.guard.ts`  
**Apply to:** Any admin cutover API surface.

```typescript
// apps/api/src/modules/admin/admin-operations.controller.ts lines 61-70
@Controller('admin/operations')
@UseGuards(RolesGuard, AdminCapabilitiesGuard)
@Roles('admin')
export class AdminOperationsController {
  constructor(private readonly adminOperationsService: AdminOperationsService) {}

  @Get('inbox')
  @AdminCapabilities('support.manage')
  async listInbox(...) { ... }
}
```

```typescript
// apps/api/src/common/guards/admin-capabilities.guard.ts lines 32-40
const snapshot = resolveAdminCapabilitySnapshot(request.user);
if (snapshot.superuser) {
  return true;
}

return requiredCapabilities.every((capability) =>
  snapshot.capabilities.includes(capability),
);
```

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `scripts/k6/phase26-baseline.js` | test | batch/request-response | No existing k6 scripts under `scripts/` or `apps/*`; use research threshold pattern. |
| `scripts/k6/phase26-stress.js` | test | batch/request-response | No existing k6 scripts under `scripts/` or `apps/*`; use research threshold pattern. |
| `scripts/phase26/cleanup-dry-run.sql` | utility | CRUD/file-I/O | No scoped production cleanup SQL analog found; copy safety principles from runbooks and Drizzle transaction patterns instead. |
| `scripts/phase26/cleanup-test-event.sql` | utility | CRUD/file-I/O | No scoped production cleanup SQL analog found; must be dry-run-first, test-event-scoped, denylist-protected, and backup-gated. |

## Metadata

**Analog search scope:** `apps/api/src`, `apps/web`, `packages/shared`, `scripts`, `docs/runbooks`, `.github/workflows`  
**Files scanned:** `rg --files` across source, scripts, runbooks, workflows, and shared packages  
**Pattern extraction date:** 2026-05-20  
**Project-local skills:** none found under `.codex/skills/` or `.agents/skills/`  
**Important constraint:** Source code was not modified; this file is the only artifact written in this mapping pass.
