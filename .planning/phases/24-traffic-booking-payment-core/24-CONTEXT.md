# Phase 24: Traffic + Booking + Payment Core - Context

**Gathered:** 2026-05-08T11:27:21+09:00
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 24 completes the test-key core booking path for the v2.0 fanmeet launch: traffic queue admission, WAF/rate-limit/prewarm documentation, multi-floor SVG seat selection, event-specific ticket policy, payment method expansion, refund state handling, cancelled-seat random holding, and QR issuance/email scheduling.

This phase must preserve Phase 23's `BOOKING_ENABLED=false` cutover gate until later Phase 26 gates explicitly enable live booking. Phase 24 may build and test the core path with test keys and safe fixtures, but it does not perform Toss live-key cutover, k6/DR/on-call PASS gates, full admin operations console, field QR scanning, event-day monitor, settlement export, or post-event retrospective.

</domain>

<decisions>
## Implementation Decisions

### Queue Admission Contract
- **D-01:** Queue admission starts at `/booking`, not at event detail or signup. Performance detail and signup remain browseable, but `/booking` entry and booking mutation APIs require valid admission.
- **D-02:** `lockSeat`, `prepareReservation`, and `confirmPayment` must reject requests without valid admission. Admission is an API-side authorization condition, not only a web route guard.
- **D-03:** Admission token identity is bound to `userId + refresh token family/device slot + queue session`. This aligns queue fairness with Phase 23's three-device refresh-token policy and reduces token sharing.
- **D-04:** Admission uses a short active window: 10 minutes active, server-side extension during payment progress, and a 2-3 minute re-entry grace for refresh/back navigation.
- **D-05:** Queue UI shows position, estimated wait, remaining seats, and automatically enters the booking screen when admitted. Manual "enter now" is not the primary behavior.

### Traffic Defense Posture
- **D-06:** Use progressive defense. Normal traffic gets endpoint-specific rate limits and app-layer guards; suspicious traffic gets Cloudflare `Managed Challenge`; clear macro/bot behavior gets `Block`.
- **D-07:** Rate limits are keyed by endpoint plus the richest available identity context: `userId`, session cookie, admission token, and IP. IP-only rate limiting is insufficient for shared networks and global fandom traffic.
- **D-08:** User-facing failure states must distinguish queue redirect, 429/rate-limit retry, security challenge, and blocked/macro behavior with localized copy.
- **D-09:** Phase 24 includes booking-critical macro scoring only: repeated `lock/prepare/payment` attempts across account, phone, email, payment method, device-ish fingerprint, and admission token. Full anti-fraud graphing and provider-heavy fraud tooling are out of scope.

### Multi-Floor Seats and Ticket Policy
- **D-10:** Extend `seat_maps` from one unique row per performance into floor-specific rows. Each floor needs `floorKey`, `floorLabel`, `sortOrder`, `svgUrl`, and `seatConfig`. Existing single-map data migrates to default floor `1F`.
- **D-11:** Users can switch floors without losing selections. Side/bottom selection summary must show all selected seats grouped or labeled by floor.
- **D-12:** Max ticket policy is event-configured and enforced across all floors combined. Fanmeet default is 1 ticket per user; event settings may raise the limit to `N`.
- **D-13:** Replace hardcoded `MAX_SEATS=4` usage in web and API with event configuration. Enforcement must happen both in UI and server-side lock/prepare paths.
- **D-14:** Seat changes are allowed only before payment confirmation. After payment is confirmed, user self-service seat change is not supported; users must use cancellation/refund flow instead.

### Payment, Refund, and QR Contract
- **D-15:** Overseas payment disclaimers require explicit checkbox consent immediately before payment method confirmation. This applies to overseas card, Alipay+, and truemoney paths and must cover KRW charging, FX estimate/disclaimer, fees, and refund deposit delay.
- **D-16:** Refund UX uses a detailed state machine visible to users: requested, sent to PG, processing at PG, completed, and failed. Include expected deposit timing and automatic CS CTA on delay.
- **D-17:** User cancellations do not reopen seats immediately. Cancelled seats enter a uniform random 1-10 minute hold implemented through delayed jobs before becoming available.
- **D-18:** Operator manual open is the explicit exception to random holding and may reopen cancelled seats immediately. The admin UI for this exception belongs primarily to Phase 25, but Phase 24's data/job model must support it.
- **D-19:** QR ticket is issued immediately after successful payment confirmation using JWT/HMAC payload. Users can see it in My Page immediately.
- **D-20:** QR email is also scheduled for D-1, 24 hours before the event. This is part of Phase 24's `QR-01` contract, while field scanning and offline sync are Phase 27.
- **D-21:** Payment expansion stays with Toss Payments SDK/widget path. Direct custom payment UI is not required unless Toss method constraints force a targeted adapter.

### the agent's Discretion
No implementation choices were delegated to the agent. Downstream agents should follow the locked decisions above.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v2.0 Scope and Phase Contract
- `.planning/ROADMAP.md` - Phase 24 goal, requirements, merged former phases, and success criteria.
- `.planning/REQUIREMENTS.md` - `TRAF-01`, `TRAF-02`, `TRAF-03`, `BOOK-01`, `BOOK-02`, `BOOK-03`, `PAY-02`, `REFUND-01`, `REFUND-02`, `QR-01`.
- `.planning/PROJECT.md` - v2.0 milestone constraints, cutover gate policy, production compatibility, and project-level key decisions.
- `.planning/STATE.md` - Current state after Phase 23 and accepted-risk/deferred evidence caveats.
- `docs/v2.0-fanmeet-milestone-spec.md` - Source spec for SP-3/SP-4, queue, WAF, prewarm, multi-floor booking, payment, refund, random hold, and QR decisions.
- `.planning/phases/22-preflight-closure/22-CONTEXT.md` - Evidence policy: accepted risk is not PASS evidence.
- `.planning/phases/23-launch-foundation/23-CONTEXT.md` - `BOOKING_ENABLED=false`, locale/legal/auth/consent foundations, and cutover guard decisions.
- `docs/runbooks/phase23-canary-rollback.md` - Existing booking-disabled API smoke and rollback expectations that Phase 24 must preserve until cutover.

### Existing Booking, Seat, Payment, and Refund Code
- `apps/api/src/modules/booking/booking.service.ts` - Current Valkey Lua seat locks, 10-minute TTL, ownership assertion/consume/extend, payment confirm lock, sold-seat check, and `BOOKING_ENABLED` assertion.
- `apps/api/src/modules/booking/booking.controller.ts` - Existing booking lock/my-locks/status endpoints that need admission enforcement.
- `apps/api/src/modules/booking/booking.gateway.ts` - Existing Socket.IO seat update channel; queue progress may use a separate namespace or event contract.
- `apps/api/src/modules/reservation/reservation.service.ts` - Current prepare/confirm/cancel flow, Toss confirm compensation, seat sold transition, immediate cancellation seat reopen behavior that must change.
- `apps/api/src/modules/reservation/reservation.controller.ts` - Existing prepare, payment confirm, reservation detail, cancel, and pending-cancel routes.
- `apps/api/src/modules/payment/toss-payments.client.ts` - Current Toss confirm/cancel client; refund/payment method expansion should preserve error handling and compensation semantics.
- `apps/api/src/modules/payment/payment.service.ts` - Current payment read model.
- `apps/api/src/database/schema/seat-maps.ts` - Currently one unique row per performance; must be expanded for floor rows.
- `apps/api/src/database/schema/seat-inventories.ts` - Existing sold/available seat inventory table; random hold will likely need new status or hold metadata.
- `apps/api/src/database/schema/reservations.ts` - Reservation status model; refund state expansion may require additive fields/tables.
- `apps/api/src/database/schema/payments.ts` - Current payment status/cancel fields; refund state machine likely needs additive schema.
- `packages/shared/src/schemas/booking.schema.ts` - Existing booking DTOs and consent schema hooks.
- `packages/shared/src/types/booking.types.ts` - Shared seat, reservation, payment, and admin booking types.

### Existing Web Booking Code
- `apps/web/components/booking/booking-page.tsx` - Booking route, selected seats, timer, seat map, panel/sheet, and `BOOKING_ENABLED` UI gate.
- `apps/web/components/booking/seat-map-viewer.tsx` - SVG fetch/sanitize/render, `data-seat-id`, zoom/pan/minimap, state coloring, selected-seat feedback.
- `apps/web/components/booking/toss-payment-widget.tsx` - Toss widget integration and payment request surface.
- `apps/web/app/booking/[performanceId]/confirm/page.tsx` - Current prepare-before-payment, consent capture, payment widget, and lock-failure recovery.
- `apps/web/app/booking/[performanceId]/complete/page.tsx` - Current payment confirm and recovery flow.
- `apps/web/hooks/use-booking.ts` - Booking, prepare, confirm, my-locks, and pending-cancel hooks.
- `apps/web/stores/use-booking-store.ts` - Current in-memory booking state and timer/selection data.
- `apps/web/components/reservation/reservation-detail.tsx` - Existing user reservation detail/refund surface to extend.
- `apps/web/components/reservation/cancel-confirm-modal.tsx` - Existing cancellation confirmation UI to replace/extend with refund preview.

### Admin and Upload Integration
- `apps/api/src/modules/admin/admin.service.ts` - Current `saveSeatMap` upsert and performance form persistence.
- `apps/api/src/modules/admin/upload.service.ts` - Existing SVG/R2 upload contract.
- `apps/web/components/admin/performance-form.tsx` - Current admin event form that will later connect to multi-floor seat map/event settings.
- `apps/web/components/admin/svg-preview.tsx` - Existing admin SVG validation/preview behavior.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `BookingService` already has hash-tagged Valkey keys, Lua scripts, seat ownership assertion/consume/extend, and `PAYMENT_CONFIRM_LOCK_TTL`. Queue admission should reuse the same ioredis/Valkey operational style.
- `ReservationService.prepareReservation()` already validates booking consent, canonical seat pricing, owned locks, and idempotent pending orders. Admission enforcement and event ticket limit checks belong before side effects.
- `ReservationService.confirmAndCreateReservation()` already confirms Toss before DB sold transition and compensates with Toss cancel on failure. QR issuance must happen after the DB commit that marks reservation/payment confirmed.
- `SeatMapViewer` already handles SVG sanitization, zoom/pan, minimap, state coloring, and click delegation. Multi-floor should wrap this with a floor selector rather than rewrite SVG rendering.
- `useBookingStore` already keeps selected seats, showtime, timer, and confirm-page data in memory. Floor identity must be added to selected seat data or derived reliably from floor-specific seat maps.
- `TossPaymentWidget` already uses Toss Payments widget. Payment method expansion should first check Toss widget configuration before building custom direct UI.
- `ConsentService` and shared consent schemas already support booking-source consent capture; overseas payment disclaimer consent can follow the same immutable audit pattern if needed.

### Established Patterns
- `BOOKING_ENABLED` is an API runtime flag and must block backend mutation paths before Redis, DB, and Toss side effects.
- Migrations must be expand-only until after event stabilization. Existing single-floor seat maps, reservations, sessions, and Korean URLs must continue working.
- Planning artifacts must preserve the difference between direct evidence, accepted risk, and missing human/operator evidence.
- Valkey correctness should use Lua and hash-tagged keys for cross-slot safety, matching Phase 14/19 patterns.
- User-visible copy should be localized across `ko`, `en`, `th`, `zh-CN`, and `zh-TW`; legal/payment-sensitive copy should avoid unreviewed machine translation.
- Existing cancellation currently makes seats available immediately. Phase 24 must intentionally change this for user cancellations.

### Integration Points
- Queue admission likely needs a new API module/service plus middleware/guard used by `/booking` entry and booking mutation endpoints.
- Queue progress can use SSE or Socket.IO, but must expose position, ETA, remaining seats, and auto-entry signal.
- WAF/rate-limit/prewarm deliverables likely include runbooks/config artifacts plus app-layer rate limit/macro score tests.
- Event settings need additive schema for max tickets, cancellation policy, payment methods, random hold settings, and QR schedule.
- Multi-floor seat maps require API/admin/web/shared type changes: floor list retrieval, selected-seat floor labels, floor-aware lock keys or globally unique seat IDs, and backward-compatible migration from current single map.
- Refund state machine likely needs a separate refund table or additive payment/reservation fields so user and admin can distinguish PG submission, PG processing, completion, and failure.
- Random cancelled-seat holding needs pg-boss delayed jobs and a seat status/hold metadata contract so `getSeatStatus()` does not expose held cancelled seats as available.
- QR issuance needs a durable ticket/QR table or fields tied to reservation/payment confirmation, JWT/HMAC key rotation policy, and D-1 email job scheduling.

</code_context>

<specifics>
## Specific Ideas

- Queue should feel transparent rather than punitive: position, ETA, remaining seats, then automatic entry.
- Fanmeet ticket fairness is prioritized over group-booking convenience; default max ticket count is 1.
- Users may compare floors freely before payment, but payment confirmation freezes the selected seats.
- Overseas payment UX must create explicit agreement evidence before payment, not bury risk text in generic terms.
- QR should reassure users immediately after payment and still support event-day readiness through D-1 email.

</specifics>

<deferred>
## Deferred Ideas

- Toss live-key cutover and `BOOKING_ENABLED=true` are Phase 26 gates.
- k6 10k/20k PASS, DR drills, on-call alert dry-runs, Cloud SQL HA/read replica, and pgBouncer gate evidence are Phase 26.
- Full admin operations console, admin RBAC/MFA/IP allowlist, CS console, and detailed manual seat operation UI are Phase 25.
- Field QR scanning, duplicate/tamper detection, offline fallback sync, event-day monitor, and settlement exports are Phase 27.
- Full anti-fraud graphing, provider-heavy fraud tooling, and broad device fingerprint product integration are outside Phase 24 unless later explicitly scoped.

</deferred>

---

*Phase: 24-Traffic + Booking + Payment Core*
*Context gathered: 2026-05-08T11:27:21+09:00*
