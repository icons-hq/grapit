---
phase: 24-traffic-booking-payment-core
plan: 10
subsystem: ui
tags: [toss-payments, next-intl, react-query, booking, payment-deadline]

requires:
  - phase: 24-09
    provides: "Toss branch endpoint and server-owned paymentDeadlineAt contract"
  - phase: 24-16
    provides: "confirm flow booking foundations consumed by the payment UI"
provides:
  - "Confirm page paymentDeadlineAt banner distinct from seat-lock expiry"
  - "Overseas card, Alipay+, and TrueMoney disclaimer gate before requestPayment"
  - "Localized payment deadline/disclaimer/recovery copy for all five launch locales"
affects: [24-17, booking, payments]

tech-stack:
  added: []
  patterns:
    - "Confirm page consumes a separate payment snapshot instead of reusing expiresAt as the payment timer"
    - "Toss widget selection -> /payments/branch -> requestPayment payload mapping for domestic vs overseas flows"

key-files:
  created:
    - apps/web/components/booking/payment-deadline-banner.tsx
  modified:
    - apps/web/app/booking/[performanceId]/confirm/page.tsx
    - apps/web/components/booking/toss-payment-widget.tsx
    - apps/web/hooks/use-booking.ts
    - apps/web/messages/ko.json
    - apps/web/messages/en.json
    - apps/web/messages/th.json
    - apps/web/messages/zh-CN.json
    - apps/web/messages/zh-TW.json

key-decisions:
  - "Keep lock expiry in queueAdmission.activeUntilAt while exposing a separate paymentDeadlineAt snapshot for confirm UI and prepare payloads."
  - "Use the widget paymentMethodSelect signal plus POST /payments/branch so overseas card and FOREIGN_EASY_PAY share one requestPayment path with an explicit consent gate."

patterns-established:
  - "Payment deadline UI turns destructive only at 02:00 while seat-hold expiry remains visible as secondary context."
  - "Overseas payment consent records FX and refund-delay notices inside the paymentMethod payload."

requirements-completed: [BOOK-02, PAY-02]

duration: 20min
completed: 2026-05-08
---

# Phase 24 Plan 10: Confirm Payment Deadline Summary

**Confirm checkout now shows a distinct 7-minute payment deadline, consent-gates overseas payment methods, and ships aligned payment risk copy across all five launch locales**

## Performance

- **Duration:** 20 min
- **Started:** 2026-05-08T08:17:30Z
- **Completed:** 2026-05-08T08:37:12Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments

- `confirm/page.tsx` now reads a separate payment snapshot, renders a dedicated deadline banner, and blocks submission when the payment window expires or required overseas consent is missing.
- `toss-payment-widget.tsx` now maps widget-selected methods into domestic card, overseas card, and `FOREIGN_EASY_PAY` branch requests, including `pendingUrl` and `useInternationalCardOnly`.
- All five locale bundles now share the same `paymentDeadline`, `paymentDisclaimer`, and `paymentRecovery` namespace for the current confirm flow and the follow-up recovery plan.

## Task Commits

Each task was committed atomically:

1. **Task 1: Render the separate payment deadline and provider-specific disclaimer gate on confirm**
   - `82ffa2c` (`test`)
   - `a95f90a` (`feat`)
2. **Task 2: Localize payment deadline and overseas-disclaimer copy for all launch locales**
   - `cb89fe3` (`feat`)

## Files Created/Modified

- `apps/web/components/booking/payment-deadline-banner.tsx` - 7-minute payment countdown banner with a `02:00` destructive threshold and secondary seat-hold context.
- `apps/web/app/booking/[performanceId]/confirm/page.tsx` - separate payment snapshot consumption, overseas disclaimer checkbox gate, and corrected prepare payload timing fields.
- `apps/web/components/booking/toss-payment-widget.tsx` - widget selection mapping, `/payments/branch` request, `pendingUrl`, and overseas-card / foreign-wallet request payload shaping.
- `apps/web/hooks/use-booking.ts` - `useBookingPaymentSnapshot()` export for distinct `paymentDeadlineAt` vs lock expiry.
- `apps/web/hooks/__tests__/use-booking.test.tsx` - RED/GREEN coverage for the separate payment snapshot and foreign-wallet request payloads.
- `apps/web/hooks/__tests__/booking-disabled-runtime.test.tsx` - updated mocks to keep confirm-page runtime coverage valid after the new i18n/payment snapshot dependencies.
- `apps/web/messages/*.json` - shared payment deadline, disclaimer, FX helper, refund-delay, and recovery copy across `ko`, `en`, `th`, `zh-CN`, and `zh-TW`.

## Decisions Made

- The confirm page keeps the existing widget/requestPayment UX, but selection-specific risk handling now happens immediately above the CTA instead of being deferred to a later custom UI.
- The UI-side payment timer is derived separately from the lock timer and feeds the prepare payload without overwriting the lock/admission timeline fields that the backend uses for recovery.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Expanded test coverage beyond the listed ownership scope to satisfy TDD and keep existing confirm-page tests green**
- **Found during:** Task 1
- **Issue:** The plan requires TDD, but the ownership list omitted the verify target `apps/web/hooks/__tests__/use-booking.test.tsx`; after adding `next-intl` payment copy hooks, `booking-disabled-runtime.test.tsx` also broke.
- **Fix:** Added RED coverage in `use-booking.test.tsx` and updated `booking-disabled-runtime.test.tsx` mocks for `useTranslations` and `useBookingPaymentSnapshot`.
- **Files modified:** `apps/web/hooks/__tests__/use-booking.test.tsx`, `apps/web/hooks/__tests__/booking-disabled-runtime.test.tsx`
- **Verification:** `pnpm --filter @grabit/web test -- hooks/__tests__/use-booking.test.tsx`
- **Committed in:** `82ffa2c`, `a95f90a`

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Test-file broadening was required to execute the TDD contract and preserve the existing confirm-page verification path. No production scope creep.

## Issues Encountered

- The repository's `pnpm --filter @grabit/web test -- hooks/__tests__/use-booking.test.tsx` command fans out across the full web test suite instead of only a single file, so unrelated mock assumptions surfaced during verification.

## User Setup Required

- Add `NEXT_PUBLIC_TOSS_CLIENT_KEY` and `TOSS_SECRET_KEY` for the target environment before manually exercising overseas branches.
- In Toss Payments Developer Console, confirm overseas card, Alipay+, and TrueMoney visibility on the test merchant and register the public webhook URL for `PAYMENT_STATUS_CHANGED` and `CANCEL_STATUS_CHANGED`.

## Known Stubs

- `apps/web/components/booking/toss-payment-widget.tsx:280` - `pendingUrl` now carries async foreign-wallet redirects with `orderId` and `amount`, but the actual pending/recovery UI remains intentionally deferred to Plan 24-17.

## Next Phase Readiness

- Plan 24-17 can reuse the new `paymentRecovery` namespace and the `pendingUrl` handoff without inventing new wording.
- The confirm page already distinguishes lock expiry from payment deadline, so later recovery work can focus on async/pending states instead of reworking the basic payment UX.
- ROADMAP/STATE updates were intentionally skipped per wave orchestration instructions.

## Self-Check: PASSED

- Found `.planning/phases/24-traffic-booking-payment-core/24-10-SUMMARY.md`
- Found task commits `82ffa2c`, `a95f90a`, and `cb89fe3` in git history
