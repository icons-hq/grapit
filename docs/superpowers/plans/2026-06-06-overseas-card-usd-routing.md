# Overseas Card USD Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route Grabit overseas-card checkout through Toss USD foreign-payment contract semantics instead of KRW overseas-card semantics.

**Architecture:** Keep PayPal and Alipay on existing provider-charge quote paths. Extend the same stored USD quote model to overseas-card `CARD` requests so Toss receives `CARD + USD + useInternationalCardOnly`, while Grabit stores reservation/payment truth in KRW.

**Tech Stack:** NestJS, Drizzle, Zod shared schemas, Next.js React client, Toss Payments SDK v2, Vitest.

---

### Task 1: Provider Charge Quote

**Files:**
- Modify: `apps/api/src/modules/payment/provider-charge-quote.service.ts`
- Test: `apps/api/src/modules/payment/provider-charge-quote.service.spec.ts`

- [x] Add failing tests for `getOverseasCardAvailability()` and `createOverseasCardQuote()`.
- [x] Implement overseas-card availability from `TOSS_OVERSEAS_CARD_SECRET_KEY`.
- [x] Reuse the existing KRW-to-USD quote calculation.
- [x] Run `pnpm --filter @grabit/api exec vitest run src/modules/payment/provider-charge-quote.service.spec.ts`.

### Task 2: Reservation Prepare

**Files:**
- Modify: `apps/api/src/modules/reservation/reservation.service.ts`
- Test: `apps/api/src/modules/reservation/reservation.service.spec.ts`

- [x] Change overseas-card prepare test from KRW/no quote to USD provider quote stored and returned.
- [x] Include overseas-card in provider-charge detection only when `method=CARD`, `provider=CARD`, and overseas consent is required.
- [x] Call `createOverseasCardQuote()` for overseas-card.
- [x] Run `pnpm --filter @grabit/api exec vitest run src/modules/reservation/reservation.service.spec.ts`.

### Task 3: Payment Branch

**Files:**
- Modify: `apps/api/src/modules/payment/payment.service.ts`
- Test: `apps/api/src/modules/payment/payment.service.spec.ts`

- [x] Change overseas-card branch test to expect `currency: 'USD'`, stored quote, and `useInternationalCardOnly: true`.
- [x] Make provider-charge branch include overseas-card direct-card requests.
- [x] Keep domestic card requests on `KRW` widget path.
- [x] Run `pnpm --filter @grabit/api exec vitest run src/modules/payment/payment.service.spec.ts`.

### Task 4: Web Toss Request

**Files:**
- Modify: `apps/web/components/booking/toss-payment-widget.tsx`
- Test: `apps/web/components/booking/__tests__/toss-payment-widget.test.tsx`

- [x] Change overseas-card direct payment test to require USD quote and `providerChargeAmount` success param.
- [x] Require provider-charge quote for overseas-card request flow.
- [x] Keep PayPal/Alipay widget behavior unchanged.
- [x] Run `pnpm --filter @grabit/web exec vitest run components/booking/__tests__/toss-payment-widget.test.tsx`.

### Task 5: Verification

**Files:**
- No new files.

- [x] Run focused API and web tests.
- [x] Run `git diff --check`.
- [x] Report remaining production boundary: Toss Developer Center MID/key confirmation and redeploy/live smoke.
