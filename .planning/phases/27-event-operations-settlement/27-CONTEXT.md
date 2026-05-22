# Phase 27: Event Operations + Settlement - Context

**Gathered:** 2026-05-22T00:37:48Z
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 27 closes the 2026-07-04 event-day operations loop for v2.0. It covers the buyer-visible QR ticket surface required before field scanning, phone-camera QR deep links, scanner-only staff access, manual entry processing, duplicate/tamper/refund/offline scan handling, event-day field monitor, settlement dashboard/export, and post-event retrospective evidence.

This phase must make the QR path end-to-end testable from a real buyer ticket screen to a field staff phone browser. A QR ticket is not Phase 27-ready if the buyer only sees QR status metadata or a ticket ID; the buyer must see a scannable QR code that opens the protected ticket management/check-in page.

This phase does not introduce dedicated hardware scanners, a native mobile app, external accounting/tax-system integration, or a full admin retrospective product surface.

</domain>

<decisions>
## Implementation Decisions

### Buyer QR Ticket Surface

- **D-01:** Payment complete and My Page reservation detail must show an actual scannable QR code image, not only `QR active` state or masked ticket metadata.
- **D-02:** The buyer QR card shows only minimal metadata next to the QR: reservation number, performance title, showtime, seat(s), and ticket status. Raw QR token and raw JTI must not be rendered as visible text.
- **D-03:** The QR payload should be an HTTPS Grabit URL that a normal phone camera app can open. The URL routes to the protected ticket check-in/management page for that ticket.
- **D-04:** Invalid ticket states are not hidden from the buyer QR surface. The buyer may still see/present the QR, but scanner-side verification is the source of truth for `USED`, `REVOKED`, `EXPIRED`, cancelled, refunded, duplicate, or tampered cases.
- **D-05:** The QR URL may contain an opaque ticket token or equivalent one-time/verifiable identifier needed to find the ticket, but the buyer UI must not print raw token/JTI values outside the QR image or URL itself.

### Scanner-Only Access Model

- **D-06:** Grapit will not use separate QR scanner hardware. Field staff scan buyer QR tickets with normal mobile phones.
- **D-07:** Phone camera QR scan opens the Grabit ticket check-in page. If the visitor is not logged in, route them to login first and then return to the intended ticket page.
- **D-08:** A normal member account must receive access denied on the QR check-in page. Seeing or possessing the QR URL must not allow a regular user to check in a ticket.
- **D-09:** Field staff use a lower-privilege scanner-only admin account, not a full admin account. Implement this through the existing admin capability model by adding a scanner-only bundle/capability set such as `adminCapabilityBundle='scanner'` or equivalent explicit capabilities.
- **D-10:** Scanner-only accounts may access only the event/showtime-scoped scan page/API, submit scan/check-in attempts, submit offline sync payloads, and write scan audit evidence. They must not access refund, reservation management, user management, content, security, settlement, or raw export capabilities.
- **D-11:** Full admin accounts may manage scanner-only staff permissions, but scanner-only accounts must not see the full admin sidebar or unrelated admin routes.

### Ticket Check-In Flow

- **D-12:** Opening a QR URL never automatically marks a ticket as used. The page first displays ticket identity, status, reservation/showtime/seat context, and the server verification result.
- **D-13:** Final entry processing is manual: scanner staff must press an `입장 처리` action after confirming the displayed ticket status.
- **D-14:** The server must be the final authority for normal, duplicate, tampered, refunded/cancelled, expired, wrong-showtime, and already-used outcomes.
- **D-15:** Duplicate scans must return an explicit duplicate/already-used result with the prior scan/check-in timestamp and staff/device context where safe. Do not silently treat duplicates as success.
- **D-16:** Tampered or unverifiable QR URLs/tokens must not reveal sensitive lookup details. Show an operator-readable rejection state and write audit/log evidence with redacted token/JTI values.
- **D-17:** Refunded/cancelled tickets must be rejected at scan time even if the buyer QR surface still renders a QR image.

### Offline Fallback Sync

- **D-18:** The scanner page is online-first. It should verify and process entry with the server whenever connectivity is available.
- **D-19:** If the scanner page is already available to an authenticated scanner-only session and a network failure prevents processing, store a local pending scan attempt for later sync.
- **D-20:** Local pending scan data must include scanner account context, event/showtime scope, QR URL/token reference, attempt timestamp, device-local attempt id, and pending/synced/rejected state. Avoid storing raw PII.
- **D-21:** When connectivity recovers, pending attempts sync to the server. The server resolves all conflicts and final states, including duplicate, tampered, refunded, expired, and already-used tickets.
- **D-22:** Offline sync results must be visible to field staff and the field monitor as pending, synced, or rejected. Offline local acceptance is not final admission evidence until server sync succeeds.

### Field Monitor

- **D-23:** The event-day field monitor is KPI-first. Its first screen answers whether entry is proceeding normally.
- **D-24:** Required KPIs are entered count, not-entered count, entry rate, duplicate scans, rejected scans, offline pending count, offline synced count, and latest abnormal alerts.
- **D-25:** Scan logs are secondary drill-down/filter data. The default monitor should not be a raw log table.
- **D-26:** Abnormal alerts must cover at least duplicate scan spikes, rejected/tampered scans, refunded/cancelled scan attempts, offline pending backlog, and sync failures.

### Settlement And Export

- **D-27:** Phase 27 includes an admin settlement/operations dashboard plus CSV export, not CSV-only output.
- **D-28:** Dashboard summary should show event-level sales/payment/refund/entry/no-show summary suitable for post-event operator review.
- **D-29:** CSV exports must include entry status, no-show reservation list, reservation/payment/refund summary, and settlement/accounting input data.
- **D-30:** External accounting system integration, tax/PG settlement mapping, and formal accounting workflow documents are out of scope for Phase 27.
- **D-31:** Settlement/export access is not part of scanner-only capability. It remains full admin or finance-capability scope.

### Retrospective

- **D-32:** Post-event retrospective is a GSD artifact, not an admin product feature in Phase 27.
- **D-33:** Create `27-RETROSPECTIVE.md` covering incidents, non-incidents, improvements, next-event carry-forward items, field scan/offline/settlement evidence, and v2.0 completion evidence.
- **D-34:** Admin retrospective input/management UI is deferred unless a later phase proves repeated event operations need it.

### the agent's Discretion

- Planner may choose the QR rendering library, QR URL route shape, QR token encoding detail, and whether the buyer QR is rendered as canvas, SVG, or image as long as the result is scannable and raw token/JTI is not printed as text.
- Planner may choose exact scanner capability names and route guards, but scanner-only accounts must be lower privilege than full admin and regular users must be denied.
- Planner may choose IndexedDB/localStorage/service-worker details for pending offline attempts, but must preserve D-18 through D-22 and avoid raw PII storage.
- Planner may choose the dashboard layout, chart/table mix, polling/refresh strategy, and export file naming as long as D-23 through D-31 are met.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase Scope And Requirements

- `.planning/ROADMAP.md` - Phase 27 goal, requirements, merged former phases, and success criteria.
- `.planning/REQUIREMENTS.md` - `QR-02`, `FIELD-01`, `OPS-03`, `POST-01`, and `POST-02` requirement mapping.
- `.planning/PROJECT.md` - v2.0 event operations goals, one-person development constraint, launch dates, and out-of-scope mobile app/accounting assumptions.
- `.planning/STATE.md` - Current v2.0 state, Phase 26 human-needed/no-go caveats, and accepted-risk conventions.
- `docs/v2.0-fanmeet-milestone-spec.md` - Source milestone spec for event operations, QR scan, field monitoring, settlement, and retrospective assumptions.

### Prior Phase Decisions And Caveats

- `.planning/phases/24-traffic-booking-payment-core/24-CONTEXT.md` - QR issuance/email contract, refund/cancel state, and explicit deferral of field scanning/offline sync to Phase 27.
- `.planning/phases/25-admin-operations-console/25-CONTEXT.md` - Admin capability/audit/export patterns and explicit deferral of field QR scanning, event-day monitor, settlement export, and retrospective.
- `.planning/phases/26-m1-canary-cutover-gates/26-CONTEXT.md` - QR visibility blocker, buyer-visible QR requirement, Phase 27 scanner contract smoke, and cutover evidence rules.
- `.planning/phases/26-m1-canary-cutover-gates/26-VERIFICATION.md` - Current Phase 26 verification status and remaining human-needed live cutover gates.
- `.planning/phases/26-m1-canary-cutover-gates/26-UAT.md` - Automated UAT evidence for payment complete/My Page QR metadata visibility and remaining limitations.
- `.planning/phases/26-m1-canary-cutover-gates/26-GATE-LEDGER.md` - Gate evidence format and no-go/accepted-risk language to preserve in Phase 27 verification.

### Existing QR, Reservation, And Buyer UI Code

- `apps/api/src/modules/ticket/qr-ticket.service.ts` - Existing QR token/JWT/HMAC issuance, D-1 email scheduling, scanner-contract verification helper, status mapping, and redacted scanner contract.
- `apps/api/src/modules/ticket/ticket.controller.ts` - Existing owned reservation ticket API surface.
- `apps/api/src/modules/reservation/reservation.service.ts` - Reservation detail read path that self-heals confirmed DONE payments by issuing QR tickets.
- `apps/api/src/modules/reservation/reservation.controller.ts` - Existing reservation detail API used by My Page.
- `packages/shared/src/schemas/booking.schema.ts` - `qrTicketSchema` and `reservationDetailSchema` with `qrTicket.token`, `jti`, status, and email schedule fields.
- `packages/shared/src/types/booking.types.ts` - `QrTicket`, `QrTicketStatus`, and `ReservationDetail` shared types.
- `apps/web/components/booking/booking-complete.tsx` - Current payment complete QR card that shows status/JTI metadata but no scannable QR image.
- `apps/web/components/reservation/reservation-detail.tsx` - Current My Page reservation QR card that shows status/JTI metadata but no scannable QR image.
- `apps/web/app/booking/[performanceId]/complete/page.tsx` - Payment complete flow and QR visibility integration point.
- `apps/web/app/mypage/reservations/[id]/page.tsx` - My Page reservation detail integration point.
- `apps/web/hooks/use-reservations.ts` - Existing reservation detail fetch hook.
- `apps/web/e2e/phase26-qr-visibility.spec.ts` - Existing Phase 26 tests that prove QR metadata visibility and raw-token non-rendering, but not actual QR image scannability.
- `apps/web/e2e/booking-complete-qr.spec.ts` - Existing QR follow-up CTA tests that must be strengthened for real QR image/deep-link behavior.

### Existing Admin Capability And Audit Code

- `apps/api/src/database/schema/users.ts` - Existing `role`, `adminCapabilityBundle`, and `adminCapabilities` fields; currently `role` is `user | admin` style and scanner-only is not yet represented.
- `packages/shared/src/schemas/admin-operations.schema.ts` - Existing admin capabilities/bundles; currently includes operator/reviewer/approver/finance/admin and must be extended for scanner-only access.
- `packages/shared/src/types/admin-operations.types.ts` - Existing admin capability resolver and bundle logic.
- `apps/api/src/common/guards/roles.guard.ts` - Current coarse `@Roles()` guard pattern that will not be sufficient alone for scanner-only restrictions.
- `apps/api/src/modules/admin/admin-user.service.ts` - Existing admin user permission update logic and `security.manage` protection.
- `apps/web/components/admin/admin-user-management.tsx` - Existing admin user role/bundle management UI where scanner-only assignment may be surfaced.
- `apps/api/src/modules/admin/admin-audit.service.ts` - Existing admin audit write/query pattern for sensitive operational actions.
- `apps/api/src/modules/admin/admin-booking.service.ts` - Existing booking operation audit and reservation operation patterns to preserve where scan actions touch reservation/ticket state.

### External Technical References

- `https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html` - JWT handling principles relevant to not exposing sensitive token contents and enforcing signature/state validation server-side.
- `https://developer.mozilla.org/en-US/docs/Web/API/Barcode_Detection_API` - Browser QR/barcode scanning API reference and compatibility caveat for any camera-based scanner fallback planning.
- `https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation` - Offline/background operation concepts relevant to pending local scan queues and recovery sync.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `QrTicketService` already issues signed QR tokens, validates JWT/HMAC state, rejects revoked/used/expired tickets, and exposes `verifyTicketForScannerContract()` for redacted Phase 27 scanner input smoke.
- `ReservationService.getReservationDetail()` already ensures confirmed `DONE` payments have active QR ticket data on the read path.
- `ReservationDetail.qrTicket.token` is already available in shared API contracts, so buyer QR rendering can use the existing token without changing the core reservation detail shape unless the QR URL/deep-link contract needs an additional field.
- `adminCapabilityBundle` and `adminCapabilities` already exist on `users`, giving Phase 27 a natural place to add scanner-only staff privileges without adding a completely separate auth system.
- Admin audit, booking operation audit, and CSV export utilities from Phase 25 provide patterns for scan audit, settlement exports, and permission evidence.

### Established Patterns

- Existing admin permissions are capability-based on top of coarse `role='admin'`. Phase 27 should extend this instead of giving scanner staff full admin access.
- Existing buyer QR surfaces intentionally avoid printing raw payment keys, raw QR tokens, and full raw JTI. Phase 27 must preserve that non-leakage rule while adding a real QR image.
- Accepted risk is not PASS evidence. Offline fallback, scanner-only access, and settlement export should each produce direct test evidence or be clearly marked as gaps.
- Admin UI style is dense, utilitarian, table/card/filter driven. Field monitor and settlement dashboard should follow that pattern rather than a marketing-style page.
- User-facing QR copy should stay operationally direct and not imply entry is guaranteed before scanner validation.

### Integration Points

- Buyer QR rendering connects to `BookingComplete`, `ReservationDetailView`, and the `ReservationDetail.qrTicket` contract.
- QR deep links need new protected routes and API endpoints for ticket lookup/check-in, likely outside the full admin shell for scanner-only accounts.
- Scanner authorization needs capability checks in API guards/services and route-level web gating beyond the current `role === 'admin'` layout behavior.
- Offline pending scan sync needs browser local persistence and a server sync endpoint that deduplicates by device-local attempt id and ticket token/JTI.
- Field monitor likely connects to new scan/check-in audit tables plus existing reservation/ticket/payment state.
- Settlement dashboard/export should reuse existing admin export/audit conventions while adding event/showtime/entry/no-show dimensions.

</code_context>

<specifics>
## Specific Ideas

- The user explicitly corrected the scanner model: there is no separate scanner device; staff will use phone cameras.
- The buyer QR must be a normal camera-readable URL, not an app-specific payload requiring special scanner hardware.
- If the QR URL is opened while logged out, the user should be routed to login and returned to the ticket management/check-in page.
- If a normal member opens the QR URL, they should see access denied.
- Staff must review the ticket page and press `입장 처리`; opening the page alone must not mark the ticket used.
- The first Phase 27 implementation should make the whole real-world path testable: buyer QR image -> phone camera URL -> scanner-only login/access -> manual entry -> duplicate/rejected/offline monitor -> settlement and retrospective evidence.

</specifics>

<deferred>
## Deferred Ideas

- Dedicated QR scanner hardware is not part of Phase 27.
- A native mobile scanner app is not part of Phase 27.
- Full external accounting/tax/PG settlement integration and formal mapping documents are deferred beyond Phase 27.
- Admin retrospective input/management UI is deferred; Phase 27 uses `27-RETROSPECTIVE.md`.

</deferred>

---

*Phase: 27-Event Operations + Settlement*
*Context gathered: 2026-05-22T00:37:48Z*
