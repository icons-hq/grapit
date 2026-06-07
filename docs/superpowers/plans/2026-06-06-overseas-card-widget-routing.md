# Overseas Card Widget Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route USD overseas-card checkout through Toss Payments Widget keys and the foreign-payment widget variant, not API individual direct-payment keys.

**Architecture:** Keep the server-side USD provider-charge quote model from PayPal/foreign payments so Grabit can store KRW business totals while Toss receives USD provider totals. On the web, overseas-card selection stays inside the rendered `uspay` payment widget and calls `widgets.requestPayment()`. The direct `payment.requestPayment()` path is removed from overseas-card production flow so `live_ck_*` keys are not used for this widget-only integration.

**Tech Stack:** Next.js App Router, React, Toss Payments SDK v2 widgets, NestJS, Drizzle, Vitest.

---

### Task 1: Web Selection Flow

**Files:**
- Modify: `apps/web/components/booking/toss-payment-widget.tsx`
- Test: `apps/web/hooks/__tests__/use-booking.test.tsx`
- Test: `apps/web/components/booking/__tests__/toss-payment-widget.test.tsx`

- [x] Change `resolvePaymentMethodSelection('CARD', 'uspay')` and `resolvePaymentMethodSelection('OVERSEAS_CARD', 'uspay')` to return `requestFlow: 'widget'`, `method: 'CARD'`, `provider: 'CARD'`, `currency: 'USD'`, and overseas consent.
- [x] Remove overseas-card dependence on `NEXT_PUBLIC_TOSS_OVERSEAS_CARD_CLIENT_KEY` from the payment request path.
- [x] Verify the foreign widget variant still loads with the configured widget client key (`gck` in production, redacted in tests).

### Task 2: Widget Request Payload

**Files:**
- Modify: `apps/web/components/booking/toss-payment-widget.tsx`
- Test: `apps/web/hooks/__tests__/use-booking.test.tsx`
- Test: `apps/web/components/booking/__tests__/toss-payment-widget.test.tsx`

- [x] When branch has a provider-charge quote, call `widgets.setAmount({ currency: quote.currency, value: quote.amountMinor / 100 })` immediately before `widgets.requestPayment()`.
- [x] For overseas-card widget requests, append `provider=OVERSEAS_CARD` and `providerChargeAmount=<quote decimal>` to `successUrl`.
- [x] Keep PayPal `foreignEasyPay.products` and PayPal `providerChargeAmount` behavior unchanged.

### Task 3: Complete Page Confirm Gate

**Files:**
- Modify: `apps/web/app/booking/[performanceId]/complete/page.tsx`
- Test: `apps/web/hooks/__tests__/use-booking.test.tsx`

- [x] Treat `provider=OVERSEAS_CARD&providerChargeAmount=<USD decimal>` as a valid confirm return.
- [x] Keep legacy `provider=OVERSEAS_CARD&amount=<KRW>` confirm handling for existing returns.
- [x] Keep domestic card amount-based confirm unchanged.

### Task 4: Verification

**Files:**
- No new production files.

- [x] Run `pnpm --filter @grabit/web exec vitest run components/booking/__tests__/toss-payment-widget.test.tsx hooks/__tests__/use-booking.test.tsx`.
- [x] Run `pnpm --filter @grabit/api exec vitest run src/modules/payment/provider-charge-quote.service.spec.ts src/modules/reservation/reservation.service.spec.ts src/modules/payment/payment.service.spec.ts`.
- [x] Run `pnpm --filter @grabit/web typecheck`.
- [x] Run `pnpm --filter @grabit/api typecheck`.
- [x] Run `git diff --check`.
