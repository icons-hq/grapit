# PayPal Provider Charge Quotes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activate Toss PayPal checkout safely by separating KRW reservation truth from backend-owned USD provider charge quotes.

**Architecture:** `reservations.total_amount` and `payments.amount` remain KRW. A new payment-domain quote service validates PayPal config, creates USD minor-unit quote snapshots during `prepareReservation`, and backend confirmation validates Toss redirect decimals against the stored quote. PayPal remains `FOREIGN_EASY_PAY / PAYPAL / USD` semantically but uses Toss synchronous successUrl + confirm API flow.

**Tech Stack:** NestJS 11, Drizzle ORM, PostgreSQL migrations, Zod shared contracts, Next.js 16 React, Toss Payments SDK v2, Vitest.

---

## File Structure

- `packages/shared/src/schemas/booking.schema.ts`: add provider charge quote schema and PayPal confirm request contract.
- `packages/shared/src/types/booking.types.ts`: add `ProviderChargeQuote`, extend prepare/branch/confirm types.
- `packages/shared/src/schemas/booking.schema.test.ts`: contract tests for PayPal quote and confirm payloads.
- `apps/api/src/database/schema/reservations.ts`: add reservation quote snapshot columns.
- `apps/api/src/database/schema/payments.ts`: add payment quote snapshot copy columns.
- `apps/api/src/database/migrations/0026_paypal_provider_charge_quotes.sql`: add nullable quote columns.
- `apps/api/src/modules/payment/provider-charge-quote.service.ts`: create/validate PayPal quote snapshots and decimal conversion helpers.
- `apps/api/src/modules/payment/provider-charge-quote.service.spec.ts`: quote config, rounding, startup hard-fail tests.
- `apps/api/src/modules/payment/payment.module.ts`: provide/export quote service.
- `apps/api/src/modules/reservation/reservation.service.ts`: create quote snapshot during PayPal `prepareReservation`.
- `apps/api/src/modules/reservation/reservation-finalization.service.ts`: validate PayPal redirect quote and store KRW amount plus provider quote fields.
- `apps/api/src/modules/payment/payment.service.ts`: route PayPal as sync branch and return availability/quote data.
- `apps/api/src/modules/payment/payment.service.spec.ts`: branch and webhook regression tests.
- `apps/api/src/modules/reservation/reservation-finalization.service.spec.ts`: PayPal confirm amount validation tests.
- `apps/web/components/booking/toss-payment-widget.tsx`: consume backend branch quote, build PayPal request payload, remove guard only when branch allows checkout.
- `apps/web/app/booking/[performanceId]/confirm/page.tsx`: allow PayPal CTA only when backend availability allows it.
- `apps/web/app/booking/[performanceId]/complete/page.tsx`: preserve raw decimal redirect amount for PayPal confirm.
- `apps/web/hooks/__tests__/use-booking.test.tsx`: PayPal selection/request payload tests.
- `.env.example`: document backend PayPal enable flag and quote rate without secrets.

## Task 1: Shared Contract, DB Shape, and Quote Service

**Files:**
- Modify: `packages/shared/src/schemas/booking.schema.ts`
- Modify: `packages/shared/src/types/booking.types.ts`
- Modify: `packages/shared/src/schemas/booking.schema.test.ts`
- Modify: `apps/api/src/database/schema/reservations.ts`
- Modify: `apps/api/src/database/schema/payments.ts`
- Create: `apps/api/src/database/migrations/0026_paypal_provider_charge_quotes.sql`
- Create: `apps/api/src/modules/payment/provider-charge-quote.service.ts`
- Create: `apps/api/src/modules/payment/provider-charge-quote.service.spec.ts`
- Modify: `apps/api/src/modules/payment/payment.module.ts`
- Modify: `.env.example`

- [ ] **Step 1: Write failing shared contract tests**

Add tests proving:

```ts
expect(providerChargeQuoteSchema.parse({
  currency: 'USD',
  amountMinor: 10800,
  amountDecimal: '108.00',
  rate: '0.00072',
  quotedAt: '2026-05-29T00:00:00.000Z',
})).toMatchObject({ currency: 'USD', amountMinor: 10800 });

expect(confirmPaymentSchema.parse({
  paymentKey: 'pay_paypal',
  orderId: 'GRP-PAYPAL',
  provider: 'PAYPAL',
  providerChargeAmount: '108.00',
})).toMatchObject({ provider: 'PAYPAL' });
```

- [ ] **Step 2: Run shared RED**

Run: `pnpm --filter @grabit/shared test src/schemas/booking.schema.test.ts`

Expected: FAIL because `providerChargeQuoteSchema` and PayPal confirm fields do not exist.

- [ ] **Step 3: Write failing quote service tests**

Create `provider-charge-quote.service.spec.ts` with tests:

```ts
expect(() => new ProviderChargeQuoteService(config({ PAYPAL_CHECKOUT_ENABLED: 'true' })))
  .toThrow(/PAYPAL_KRW_USD_RATE/);

const service = new ProviderChargeQuoteService(config({
  PAYPAL_CHECKOUT_ENABLED: 'true',
  PAYPAL_KRW_USD_RATE: '0.00072',
}));
expect(service.createPaypalQuote({ reservationPayableAmount: 150000, now: new Date('2026-05-29T00:00:00Z') }))
  .toMatchObject({ currency: 'USD', amountMinor: 10800, amountDecimal: '108.00', rate: '0.00072' });
```

- [ ] **Step 4: Run API quote service RED**

Run: `pnpm --filter @grabit/api test src/modules/payment/provider-charge-quote.service.spec.ts`

Expected: FAIL because the service file does not exist.

- [ ] **Step 5: Implement minimal shared schema/types**

Add `ProviderChargeQuote`, `providerChargeQuoteSchema`, optional `providerChargeQuote` in prepare response and branch response, plus PayPal confirm fields:

```ts
provider?: 'PAYPAL';
providerChargeAmount?: string;
```

Use `superRefine` so domestic confirm still requires integer `amount`, while PayPal confirm requires decimal-string `providerChargeAmount`.

- [ ] **Step 6: Implement DB columns and migration**

Add nullable columns to both `reservations` and `payments`:

```sql
ALTER TABLE "reservations" ADD COLUMN "provider_charge_currency" varchar(10);
ALTER TABLE "reservations" ADD COLUMN "provider_charge_amount_minor" integer;
ALTER TABLE "reservations" ADD COLUMN "provider_charge_rate" varchar(50);
ALTER TABLE "reservations" ADD COLUMN "provider_charge_quoted_at" timestamp with time zone;
ALTER TABLE "payments" ADD COLUMN "provider_charge_currency" varchar(10);
ALTER TABLE "payments" ADD COLUMN "provider_charge_amount_minor" integer;
ALTER TABLE "payments" ADD COLUMN "provider_charge_rate" varchar(50);
ALTER TABLE "payments" ADD COLUMN "provider_charge_quoted_at" timestamp with time zone;
```

- [ ] **Step 7: Implement `ProviderChargeQuoteService`**

The service reads backend env through `ConfigService`, defaults PayPal checkout to disabled, validates rate only when enabled, returns unavailable state when disabled, creates USD quotes from KRW payable amount, and converts decimal redirect strings to minor units.

- [ ] **Step 8: Run GREEN**

Run:

```bash
pnpm --filter @grabit/shared test src/schemas/booking.schema.test.ts
pnpm --filter @grabit/api test src/modules/payment/provider-charge-quote.service.spec.ts
```

Expected: PASS.

## Task 2: Backend Prepare, Branch, and Confirm Flow

**Files:**
- Modify: `apps/api/src/modules/reservation/reservation.service.ts`
- Modify: `apps/api/src/modules/reservation/reservation-finalization.service.ts`
- Modify: `apps/api/src/modules/payment/payment.service.ts`
- Modify: `apps/api/src/modules/payment/payment.service.spec.ts`
- Modify: `apps/api/src/modules/reservation/reservation-finalization.service.spec.ts`
- Modify: `apps/api/src/modules/reservation/reservation.service.spec.ts` if prepare mocks need quote column coverage.

- [ ] **Step 1: Write failing backend branch tests**

Change the PayPal branch test to expect:

```ts
expect(branch).toMatchObject({
  method: 'FOREIGN_EASY_PAY',
  provider: 'PAYPAL',
  currency: 'USD',
  asyncStatus: 'sync',
  checkoutEnabled: true,
});
expect(branch.pendingUrl).toBeUndefined();
```

- [ ] **Step 2: Write failing PayPal confirm tests**

Add tests proving PayPal confirm:

```ts
await service.confirmAndCreateReservation({
  paymentKey: 'pay_paypal',
  orderId,
  provider: 'PAYPAL',
  providerChargeAmount: '108.00',
}, userId);
```

calls Toss confirm with amount `108`, stores `payments.amount` as the KRW reservation total, stores `providerChargeAmountMinor=10800`, and rejects `providerChargeAmount: '107.99'` before Toss confirm.

- [ ] **Step 3: Run backend RED**

Run:

```bash
pnpm --filter @grabit/api test src/modules/payment/payment.service.spec.ts
pnpm --filter @grabit/api test src/modules/reservation/reservation-finalization.service.spec.ts
```

Expected: FAIL on old PayPal async branch and missing PayPal confirm handling.

- [ ] **Step 4: Implement backend flow**

Inject `ProviderChargeQuoteService` into reservation prepare, payment branch, and finalization. During PayPal prepare, create and store quote columns on `reservations`. In branch, return PayPal as sync and include stored quote when present. During PayPal confirm, validate redirect decimal against stored quote, call Toss confirm with decimal USD, store KRW amount in `payments.amount`, keep `payments.currency='KRW'`, and copy provider quote columns.

- [ ] **Step 5: Keep async webhook PayPal out of DONE finalization**

Remove `PAYPAL` from the async foreign wallet provider set. Keep Alipay/TrueMoney webhook tests green.

- [ ] **Step 6: Run backend GREEN**

Run:

```bash
pnpm --filter @grabit/api test src/modules/payment/payment.service.spec.ts
pnpm --filter @grabit/api test src/modules/reservation/reservation-finalization.service.spec.ts
pnpm --filter @grabit/api typecheck
```

Expected: PASS.

## Task 3: Frontend PayPal Request and Completion Flow

**Files:**
- Modify: `apps/web/components/booking/toss-payment-widget.tsx`
- Modify: `apps/web/app/booking/[performanceId]/confirm/page.tsx`
- Modify: `apps/web/app/booking/[performanceId]/complete/page.tsx`
- Modify: `apps/web/hooks/__tests__/use-booking.test.tsx`

- [ ] **Step 1: Write failing frontend tests**

Add tests proving:

```ts
expect(resolvePaymentMethodSelection('PAYPAL').paymentMethod).toMatchObject({
  method: 'FOREIGN_EASY_PAY',
  provider: 'PAYPAL',
  currency: 'USD',
});
expect(resolvePaymentMethodSelection('PAYPAL').paymentMethod.pendingUrlRequired).toBeUndefined();
```

and `buildWidgetPaymentRequest()` uses the backend quote amount for PayPal `foreignEasyPay.products`.

- [ ] **Step 2: Run frontend RED**

Run: `pnpm --filter @grabit/web test hooks/__tests__/use-booking.test.tsx`

Expected: FAIL because PayPal still requires pendingUrl and uses KRW amount in the request helper.

- [ ] **Step 3: Implement frontend request changes**

Remove the hard PayPal request guard. Use `branch.checkoutEnabled` and `branch.providerChargeQuote` to decide real checkout. For PayPal, call `widgets.setAmount({ currency: 'USD', value: Number(branch.providerChargeQuote.amountDecimal) })`, set `successUrl` with a stable `provider=PAYPAL` marker, omit `pendingUrl`, and send `foreignEasyPay.products` from backend quote/product data when available.

- [ ] **Step 4: Implement completion parsing**

When `provider=PAYPAL`, preserve the raw `amount` search param as `providerChargeAmount` and call confirm with `{ provider: 'PAYPAL', providerChargeAmount }`. Domestic confirm keeps existing integer `amount`.

- [ ] **Step 5: Run frontend GREEN**

Run:

```bash
pnpm --filter @grabit/web test hooks/__tests__/use-booking.test.tsx
pnpm --filter @grabit/web typecheck
```

Expected: PASS.

## Task 4: Integration Verification and Cleanup

**Files:**
- Modify only files required by failed tests or typecheck.

- [ ] **Step 1: Run cross-boundary tests**

Run:

```bash
pnpm --filter @grabit/shared typecheck
pnpm --filter @grabit/api typecheck
pnpm --filter @grabit/web typecheck
pnpm --filter @grabit/shared test src/schemas/booking.schema.test.ts
pnpm --filter @grabit/api test src/modules/payment/payment.service.spec.ts src/modules/payment/provider-charge-quote.service.spec.ts src/modules/reservation/reservation-finalization.service.spec.ts
pnpm --filter @grabit/web test hooks/__tests__/use-booking.test.tsx
git diff --check
```

Expected: PASS.

- [ ] **Step 2: Review safety constraints**

Verify:

```text
PayPal is not enabled without PAYPAL_CHECKOUT_ENABLED=true.
PayPal does not use pendingUrl.
KRW reservation/payment amount remains intact.
USD amount is validated through stored Provider Charge Quote.
No raw secrets are printed or committed.
```

- [ ] **Step 3: Final review**

Run spec compliance review first, then code quality review across all changed files before marking complete.
