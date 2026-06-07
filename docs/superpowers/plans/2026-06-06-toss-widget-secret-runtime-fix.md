# Toss Widget Secret Runtime Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align production overseas-card payment approval with the Toss Payments Widget USD MID secret key.

**Architecture:** Use the existing USD foreign-payment widget secret as the source of truth for overseas-card approval because the same USD MID/variant contains overseas card, PayPal, and Alipay. Add guardrails so API individual `sk` keys cannot be used for the widget-only overseas-card path again.

**Tech Stack:** GCP Secret Manager, Cloud Run, NestJS, Toss Payments SDK/API, Vitest.

---

### Task 1: Runtime Secret Rotation

**Files:**
- External: GCP Secret Manager `toss-overseas-card-secret-key`
- External: Cloud Run service `grabit-api`

- [x] Verify `toss-foreign-easy-pay-secret-key` latest value is a Toss payment widget secret key without printing the raw key.
- [x] Add a new `toss-overseas-card-secret-key` version from the widget `gsk` source secret.
- [x] Update Cloud Run `grabit-api` with `--update-secrets=TOSS_OVERSEAS_CARD_SECRET_KEY=toss-overseas-card-secret-key:latest`.
- [x] Verify the new Cloud Run revision serves 100% traffic.

### Task 2: Code Guardrails

**Files:**
- Modify: `apps/api/src/modules/payment/provider-charge-quote.service.ts`
- Modify: `apps/api/src/modules/payment/toss-payments.client.ts`
- Modify: `.env.example`
- Test: `apps/api/src/modules/payment/provider-charge-quote.service.spec.ts`
- Test: `apps/api/src/modules/payment/toss-payments.client.spec.ts`

- [x] Add tests that reject API individual `sk` keys for overseas-card widget approval.
- [x] Require `test_gsk_` or `live_gsk_` for `TOSS_OVERSEAS_CARD_SECRET_KEY`.
- [x] Remove obsolete `NEXT_PUBLIC_TOSS_OVERSEAS_CARD_CLIENT_KEY` from `.env.example`.

### Task 3: Verification

**Files:**
- No new production files.

- [x] Run API payment/reservation focused tests.
- [x] Run web overseas payment focused tests.
- [x] Run API and web typecheck.
- [x] Verify production API health and runtime flags.
