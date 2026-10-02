# Grabit Product Requirements Document

## 1. Product Position

Grabit is a live-entertainment ticketing and event-operations platform. The product is built around one critical path:

`discover -> authenticate -> select seats -> pay -> receive QR ticket -> venue entry -> refund or settlement operations`

The current product is focused on fanmeet and live-event operations, not a broad marketplace. Current source-of-truth code lives in:

- `apps/web`: Next.js public, booking, mypage, field, legal, and admin surfaces
- `apps/api`: NestJS API modules and Drizzle schema
- `packages/shared`: Zod schemas, DTO-like TypeScript types, locale constants, and feature flag contracts

Historical planning artifacts in `.planning/` are useful for context, but current source code and package manifests take precedence.

## 2. Users And Jobs

| User | Primary job | Current product support |
| --- | --- | --- |
| Buyer | Find an event, verify account, reserve seats, pay, view QR ticket, cancel or request refund when allowed | Public home, genre/search/detail, auth, booking, payment, My Page reservation detail, QR display |
| Overseas buyer | Use localized UI and phone verification, understand payment/refund caveats | `ko`, `en`, `th`, `zh-CN` UI, country/phone inputs, localized booking copy |
| Field scanner staff | Open QR ticket URLs, verify ticket context, manually complete entry, sync offline attempts | `/field/check-in`, scanner capability bundle, field check-in APIs, offline sync |
| Operator | Create events, manage seat maps, monitor bookings, handle support, manage banners and notices | Admin event, booking, support, banner, seat operation, operations inbox surfaces |
| Finance/operator reviewer | Check sales/refund/entry data and export settlement datasets | Admin settlement dashboard and export API |
| Admin/security owner | Manage users, permissions, audit, allowlist, and launch/cutover gates | Admin users, audit, security, cutover, consent audit surfaces |

## 3. Current Scope

### 3.1 Public Discovery

The public surface supports a focused catalog rather than a large category marketplace.

- Event categories are `artist_celebrity` and `ip_popup` in shared contracts.
- The public genre route currently exposes `artist_celebrity` as the visible public category.
- Home surfaces include banners, hot events, new events, genre entry points, and localized shell navigation.
- Search supports keyword search with genre, locale, ended-state, page, and limit query contracts.
- Performance detail surfaces show title, venue, schedule, price tiers, castings, detail images, sales information, booking availability, and localized fallback indicators.
- Buyer-facing sale status on list, search, and detail is judged against the booking start time: a booking start still in the future reads as upcoming even when the operator status is selling or closing soon, and an upcoming performance whose booking start has passed reads as on sale. The API list/search cards, catalog status filters, hot list, and the public detail API use the same rule; the admin detail read is a separate endpoint and does not apply it. Open pages switch the badge and schedule at the booking start without a reload, the detail page reusing the booking button's server-clock verdict so a skewed device clock cannot split them. A closing-soon performance whose booking start is still in the future therefore reads as upcoming and, right after its start, as on sale until the page fetches it again. The on-sale and upcoming home filters refetch once, 5–60 seconds (per-client jitter) after the nearest booking start that was pending when the page was fetched, also in a background tab; the unfiltered list relies on the client-side switch. The hot list cache expires at the next booking start of any published performance, since a newly opened performance can enter it.

### 3.2 Auth, Verification, And Consent

Auth must protect scarce booking resources and admin surfaces.

- Email-based registration uses three visible steps: credentials, itemized consent, and profile/phone verification.
- Social login supports Kakao, Naver, and Google callback flows.
- Email verification and SMS/phone verification are required before ordinary buyers can book.
- Refresh-token state supports device-family management and logout. Several tabs refreshing at once, or a temporary API failure during refresh, must not sign the buyer out.
- Social sign-in is protected against login CSRF and forwarded registration links. Social-only sign-up completes without an email code; a password account linked to a social login keeps its own email verification unless the provider verified the same address.
- Login email matching is case-insensitive.
- Itemized consent capture is shared by signup, social completion, and booking flows. Each row records the version and language of the legal document actually shown; booking records only the booking terms and privacy notice rows it displays.
- Legal pages are public and linked through the frontend legal routes.
- Account profile update and withdrawal are available from My Page/user endpoints.

### 3.3 Queue And Booking

Booking is gated by runtime feature flags and queue admission.

- `BOOKING_ENABLED` is the API-side runtime flag. Client-public names are not accepted as API authority.
- When booking is disabled, non-admin buyers cannot create seat locks, prepare reservations, or confirm payment. Admin Booking Bypass belongs to full admins only; scanner, finance and other restricted admin bundles book like Buyers.
- Queue entry is event/performance scoped and returns admission state used by booking mutation guards.
- Queue entry is refused for unknown, unpublished, or ended performances and when every showtime has already started; a buyer already waiting is told the same once the last showtime starts. Before the booking start, the booking route shows a countdown and joins the queue automatically at the open time; when the open time is not announced it re-checks about every 15 seconds.
- The waiting screen shows the position and an estimated maximum wait ("within N minutes") computed from the admission cycles (remaining seats of the showtimes still on sale and the longest admission window); because a confirmed purchase returns its slot early, it promises no minimum wait. The maximum holds only while the remaining seats stay as they are: when seats sell during the wait, the next estimate grows. It does not show a per-position fixed estimate and shows "not available" instead of a misleading number when no estimate is possible.
- Queue admission is carried through the booking flow and checked again during reservation prepare and payment confirm.
- An admission ends when its active window ends. Joining the queue again after that gives a new waiting position, unless an order prepared during that admission is still awaiting payment: then the buyer can only complete (or cancel) that payment until its deadline, and is not admitted to choose seats again.
- Booking policy is event-specific and includes maximum tickets, payment window, seat hold window, cancellation/change behavior, allowed payment methods, and manual open rules.
- The maximum-ticket limit is per person as identified by a verified phone number: confirmed tickets of every Buyer Account that verified the same phone (E.164) count together. A Buyer Account without a verified phone is limited on its own. Seat lock and reservation prepare also count seats another account of the same phone holds in an unexpired pending payment. Signup is not blocked; a stronger identity (CI/DI) is outside the current scope.
- Sales for a showtime close at its scheduled start time. Seat lock and reservation prepare reject a started showtime for every actor.
- Reservation prepare rejects a payment method that is not in the performance's allowed payment methods. Checkout keeps the selected seats and asks the buyer to choose another method. The admin performance form offers exactly the categories checkout can submit: card (domestic and overseas), bank transfer, domestic easy pay (Toss Pay, Naver Pay, Kakao Pay) and foreign easy pay.

### 3.4 Seat Selection

Seat selection is SVG-based and floor-aware.

- Admin event setup can store one or more seat map floors per performance.
- Seat tier, color, price, and sale status are represented by shared contracts and Drizzle tables.
- Public booking groups seat selection by floor and seat key, not only by visible row/number labels.
- Seat locks are temporary, per user/showtime, and must be owned by the buyer before reservation prepare.
- Locked/sold/available seat state is broadcast through the real-time seat channel.

### 3.5 Payment, Reservation, QR

Payment and reservation finalization are server-authoritative.

- Toss Payments is the current payment provider integration.
- The queue admission token stays in its httpOnly cookie; reservations do not store it and responses do not echo it.
- The payment confirm response uses the buyer's display locale for translated performance titles.
- The payment branch API chooses synchronous or asynchronous handling based on payment method.
- Payment confirm validates amount, order identity, lock ownership, queue admission (bound to the pending order until its server payment deadline), and payment state before finalizing reservation state. A confirmed purchase returns its queue slot to the waiting line. When confirm succeeds, that queue admission ends: choosing more seats needs a new queue entry, while another order already prepared in the same admission can still be confirmed through its own order binding.
- Toss webhook handling records provider events and re-checks provider state before applying final state changes.
- A confirmed reservation with completed payment issues a seat-level QR credential per active Ticket Item and schedules one QR reminder email per reservation when eligible.
- Ticket emails (manual resend and D-1 reminder) include every active seat's Seat Identity and QR token; a reservation is reminded at most once even when background workers run in parallel.
- Reservation detail must remain readable after field entry.
- QR credential validity and venue admission state are intentionally separate:
  - `qrTicket.status` describes credential validity.
  - `entryStatus` and `enteredAt` describe whether venue entry has been processed.
  - Buyer-facing QR remains visible after entry when the credential is still valid.

### 3.6 My Page And Refunds

Buyers can review and manage reservations.

- My Page lists reservations and reservation details.
- Reservation detail shows payment, refund, cancellation deadline, seats, QR ticket, and entry status.
- Buyer cancellation updates reservation and seat inventory when allowed.
- Buyer refund requests are blocked after the cancellation window (23:59 KST on the day before the show) and once the showtime start time has passed. After the window only an admin Full Refund Override can refund.
- Refund preview and refund request APIs expose refund timeline and expected customer-service state.
- Admin refund can hold cancelled seats for controlled reopening and records operational audit evidence.

### 3.7 Field Operations

Field operations are web-first and scanner-account based.

- Buyer QR image points to a protected Grabit check-in URL.
- Opening a QR URL verifies ticket context but does not automatically mark entry complete.
- Scanner staff must be logged in with field scan capabilities.
- Normal user accounts are denied on scanner-only surfaces.
- Staff manually confirms entry after seeing ticket context.
- Consuming one QR processes only the scanned Ticket Item. Other seats, including those owned by the same buyer for the same showtime, remain independent. Historical batch admission results are preserved (ADR 0011).
- Duplicate, tampered, refunded/cancelled, expired, wrong-showtime, and already-used outcomes are recorded as distinct scan results, including rejections found at verification before any entry action. Each scan is attributed to the showtime the scanner selected.
- Benefit redemption requires the separate `field.benefits.redeem` capability and online confirmation; it never consumes admission.
- Offline handling is a local pending queue with server-authoritative sync; local pending state is not final admission evidence. Syncing confirms entry, so it requires both `field.scan.sync` and `field.scan.consume`.
- Field monitor focuses first on entered count, not-entered count, entry rate, duplicates, and rejections. Offline backlog stays on each field device until sync, so the monitor directs staff to the devices instead of showing a server count.

### 3.8 Admin Operations

Admin is an operational console, not a marketing CMS.

- Event management covers performance creation/editing, publish workflow, venue/transport fields, castings, detail images, price tiers, showtimes, banners, and seat maps.
  - Publication approval shows the server-computed sale opening: a scheduled KST start, manual opening when an upcoming performance has no start time, or immediate sale. A stored sale start that has already passed blocks approval, and publishing a performance whose sale is already open requires an explicit immediate-sale confirmation. Sale start inputs outside 2000–2100 KST are rejected.
  - Price tiers must be priced above 0 and tier names are trimmed on input. Preparation blocks publication until every configured seat has a sellable assignment charged at the displayed tier price.
  - Only never-published performances without booking, scan, or seat-operation history can be deleted, and each deletion is audited as `event.delete` with the deleted performance snapshot. Published performances are archived (sale status ended) instead.
- Booking admin covers reservation list/detail, CSV export, admin refund, and manual open.
- Seat operations cover disable, reactivate, manual open, and history.
- Support operations cover operations inbox, assignment, escalation, FAQ, notice, and support content review.
- Translation operations cover source capture, draft creation, review, and publish.
- Security operations cover allowlist, permission status, user permission updates, audit, and sensitive user actions.
- Settlement operations cover summary and export datasets for entry status, no-show reservations, reservation/payment/refund summary, and accounting input.

## 4. Functional Requirements

### 4.1 Buyer Requirements

| ID | Requirement | Acceptance criteria |
| --- | --- | --- |
| BUY-01 | Browse public events | Home, genre, search, and performance detail pages load localized event data without admin access. |
| BUY-02 | Register and verify account | Email registration, required consent, profile, email verification, and phone verification can be completed before booking. |
| BUY-03 | Use social auth | Kakao, Naver, and Google login callbacks return the user to the intended auth flow and require completion when profile/consent data is missing. |
| BUY-04 | Enter queue | Buyer can enter a performance queue and receive admission state before scarce booking mutations. |
| BUY-05 | Select seats | Buyer can choose floor-aware seats, see lock state, release locks, and recover from lock expiry. |
| BUY-06 | Prepare reservation | Server validates selected seats, amount, queue admission, consent rows, account verification, and booking policy before creating pending reservation. |
| BUY-07 | Pay and confirm | Server confirms Toss payment or awaits provider webhook depending on method, then marks reservation confirmed and seats sold. |
| BUY-08 | View QR | Booking complete and reservation detail show a scannable QR image without exposing raw QR values as visible text. |
| BUY-09 | Keep QR after entry | After venue entry, reservation detail still renders the QR and separately shows entry-complete state. |
| BUY-10 | Cancel/refund | Buyer can cancel eligible reservations and view refund timeline and delayed-seat-reopen guidance. |

### 4.2 Field Requirements

| ID | Requirement | Acceptance criteria |
| --- | --- | --- |
| FIELD-01 | Scanner-only access | Scanner capability can verify and consume ticket entry but cannot access unrelated admin or finance operations. |
| FIELD-02 | Verify before consume | QR URL opens ticket context and server verification result; entry is not processed until staff confirms. |
| FIELD-03 | Duplicate prevention | Re-scanning a consumed ticket returns duplicate/already-used context instead of processing a second entry. |
| FIELD-04 | Offline pending sync | Offline attempts stay pending locally and become synced or rejected only after server sync. |
| FIELD-05 | Monitor entry health | Monitor summary shows entry KPIs and abnormal scan alerts before raw logs. |

### 4.3 Admin Requirements

| ID | Requirement | Acceptance criteria |
| --- | --- | --- |
| ADM-01 | Manage events | Operator can create, edit, review, publish, and delete performances within permission boundaries. |
| ADM-02 | Manage seat maps | Operator can upload/store SVG seat maps, assign tiers, and operate seats without changing public API contracts. |
| ADM-03 | Manage reservations | Operator can inspect bookings, export masked/raw data when permitted, refund, and manually open seats. |
| ADM-04 | Manage support content | Operator can manage inbox, FAQ, notices, escalation, and review state. |
| ADM-05 | Manage security | Admin can inspect audit/security state, allowlist entries, and user permission bundles. |
| ADM-06 | Manage settlement | Finance-capable admin explicitly selects event/showtime, KST date basis and evidence cutoff; compares original order/payment, completed/pending cancellation, remaining tickets and separate provider currencies; exports payment/ticket/provider records with scope and reason. Unqueried/failed/empty evidence remains distinct, and bank deposits/closing remain unverified without external evidence (ADR 0012). |
| ADM-07 | Manage translations | Admin can create translation sources, review drafts, and publish reviewed localized content. |

### 4.4 Platform Requirements

| ID | Requirement | Acceptance criteria |
| --- | --- | --- |
| PLAT-01 | Shared contracts | API and web use `packages/shared` Zod schemas/types for cross-boundary payloads where available. |
| PLAT-02 | Runtime flag authority | API reads booking flags from server runtime only and fails closed for buyer booking mutations. |
| PLAT-03 | Production startup safety | Production API startup fails when required frontend origin or Redis/Valkey pub/sub wiring is invalid. |
| PLAT-04 | Redacted evidence | Operational documents and logs must not expose raw credentials, cookies, QR payloads, payment identifiers, or PII-heavy rows. |
| PLAT-05 | Docs follow code | PRD and Architecture must be updated from current controllers, routes, schema, manifests, and workflow files. |

## 5. Non-Functional Requirements

### 5.1 Reliability

- PostgreSQL is the final source of truth for users, performances, reservations, payments, refunds, tickets, scan events, audit, and content state.
- Redis/Valkey is used for low-latency locking, queue, throttling, cache, and real-time pub/sub. It is not the durable source of truth for reservation completion.
- Payment confirmation uses idempotency, provider state checks, confirm locks, and compensation cancellation paths to avoid double-selling.
- Field offline sync is conflict-aware and server-authoritative.
- Production startup must fail loudly rather than silently falling back to single-instance behavior.

### 5.2 Security And Privacy

- Public routes are unauthenticated only where explicitly marked public.
- Global JWT auth and role/capability guards protect API surfaces.
- Admin capability bundles separate operator, reviewer, approver, finance, scanner, and full admin abilities.
- Raw QR payloads, full JTI values, payment identifiers, cookies, OTP values, full phone numbers, and raw customer exports must not be rendered in public UI or committed to documentation.
- Raw PII export requires an admin reason and capability.
- Social auth, email verification, and SMS verification flows must avoid leaking account existence beyond intended availability checks.

### 5.3 Performance

- Public list/search/detail surfaces should remain cacheable where the current API cache layer supports it.
- Seat lock and status reads must stay fast under ticket-open traffic.
- Queue, throttling, and prewarm controls exist to absorb launch spikes.
- SVG seat map rendering must support desktop and mobile without blocking the booking flow.
- Admin tables and exports should prioritize operational scanning and predictable filters over decorative layout.

### 5.4 Accessibility And Localization

- Public UI supports `ko`, `en`, `th`, and `zh-CN`.
- Korean routes are prefixless; foreign locales use locale-prefixed routes where the routing layer applies them.
- Localized date/time/currency formatting should be used for buyer-facing flows.
- The performance period is date-only: it is shown as KST calendar dates in the Gregorian calendar for every locale. Viewer-local time conversion is only for exact instants such as showtimes, and it also uses the Gregorian calendar.
- Every explicit language change (language switcher or the suggestion banner) stores the preference (cookie, and `preferredLocale` when signed in) and does a full page navigation so the next-intl provider locale and `<html lang>` follow the new URL.
- Booking, auth, QR, legal, and field-operation copy must avoid relying on color alone.
- Critical buttons and scanner workflows must remain usable on mobile browsers.

## 6. Data Model Overview

This is a product-level overview. The implementation source of truth is `apps/api/src/database/schema/*`.

| Area | Key tables |
| --- | --- |
| Identity and auth | `users`, `social_accounts`, `refresh_tokens`, `email_verification_tokens`, `terms_agreements` |
| Consent and legal | `consent_items`, `consent_audit_logs`, `legal_content` |
| Catalog | `performances`, `venues`, `showtimes`, `castings`, `price_tiers`, `banners` |
| Venue layout and seats | `venue_layouts`, `venue_layout_floors`, `venue_layout_sections`, `venue_layout_seats`, `seat_maps`, `performance_seat_tiers`, `performance_seat_assignments` |
| Booking | `booking_policies`, `seat_inventories`, `reservations`, `reservation_seats` |
| Payment and refund | `payments`, `payment_webhook_events`, `refunds` |
| QR and field entry | `tickets`, `ticket_scan_events` |
| Admin and audit | `admin_audit_logs`, `booking_operation_audit_logs`, `admin_access_allowlist`, `seat_operation_history` |
| Support and content | `support_threads`, `support_messages`, `support_faqs`, `support_notices`, `translation_sources`, `translation_drafts` |

## 7. Release State

| Milestone | Current state |
| --- | --- |
| v1.0 MVP | Shipped on 2026-04-09. |
| v1.1 stabilization | Shipped on 2026-05-04. |
| v2.0 Fanmeet Launch | Phases 22-27 implemented and shipped through PR #82 in project state. |

Current v2.0 implementation coverage includes preflight closure, launch foundation, traffic/booking/payment core, admin operations console, cutover gates, event operations, field check-in, and settlement/export.

Automated Phase 27 evidence is green in local project artifacts. Remaining external launch evidence is tracked separately:

- Real physical phone-camera QR scan
- External operational contact sign-off
- Production/venue settlement dataset sign-off

Those items are launch/manual evidence follow-ups, not missing code paths in the current implementation.

## 8. Out Of Scope For Current Codebase

The current repo does not implement a native mobile app, separate microservices, broad marketplace loyalty programs, external accounting integration, or seat-level transfer. Those should not be described as current product behavior unless future code implements them.

Future expansion candidates should start from current contracts:

- Add public categories by extending shared genre constants and public route filtering.
- Add seat-level entitlement by expanding ticket state beyond reservation-level QR.
- Add external finance integration after settlement CSV and dashboard evidence are accepted.
- Add native clients only after web QR/field operations prove the operational workflow.
