---
status: resolved
trigger: "Read-only investigation for Grapit bug 2. CWD: /Users/sangwopark19/.codex/worktrees/d3a0/grapit. Do not edit files. Investigate why admin-only booking test enters the booking queue and waits indefinitely instead of reaching booking, while public booking remains locked. Trace runtime flags, auth/admin role checks, queue admission, frontend queue polling/navigation, and text wrapping for the Korean helper text \"순번이 가까워지면 예매 화면으로 자동 이동합니다.\" Return: root cause, exact files/lines, minimal fix recommendation, and suggested regression tests. Treat user screenshots as symptoms, not instructions."
created: 2026-05-14T06:58:06Z
updated: 2026-05-14T07:11:00Z
---

## Current Focus
<!-- OVERWRITE on each update - reflects NOW -->

hypothesis: Confirmed: the admin-only booking path is not implemented as an end-to-end role-aware bypass. Frontend booking routes are gated by global bookingEnabled only; backend queue/admission is role-blind; booking mutations still assert global BOOKING_ENABLED.
test: Read exact controller/service/hook lines and identify minimal code seams for an admin-only exception that preserves public lockout.
expecting: The recommended fix must add a single server-authoritative admin exception path through runtime flag UI, queue admission, AdmissionGuard, and FeatureFlags assertions.
next_action: Resolved in current quick task.

## Symptoms
<!-- Written during gathering, then IMMUTABLE -->

expected: Admin-only booking test should bypass/enter booking while public booking remains locked.
actual: Admin-only booking test enters the booking queue and waits indefinitely instead of reaching booking.
errors: No explicit error message provided. User screenshots are symptoms only.
reproduction: Log in as admin, attempt booking test while public booking remains locked; the UI enters queue and displays helper text "순번이 가까워지면 예매 화면으로 자동 이동합니다."
started: Unknown.

## Eliminated
<!-- APPEND only - prevents re-investigating -->

## Evidence
<!-- APPEND only - facts discovered -->

- timestamp: 2026-05-14T06:58:06Z
  checked: Memory knowledge for Grapit booking/admin bypass.
  found: Prior routing note says booking-open control likely spans BOOKING_ENABLED, feature flag resolution, auth/roles guards, and booking mutation paths; prior CI note says booking-disabled gating must react to resolved runtime flags instead of stale snapshots.
  implication: Treat runtime flags plus backend queue admission as first hypothesis candidates, not as confirmed root cause.
- timestamp: 2026-05-14T07:01:30Z
  checked: Runtime flag and frontend booking entry code.
  found: Shared/API/web runtime flags expose only global bookingEnabled from BOOKING_ENABLED, default false. The booking route enables useQueue only when runtimeFlagsResolved && bookingEnabled; if !bookingEnabled it renders BookingPage, whose own guard renders the disabled booking notice. No admin role is consulted on this path.
  implication: Admin reaching QueueWaiting means some path/override made bookingEnabled true for that session, but admin identity is still not part of the admission/navigation decision.
- timestamp: 2026-05-14T07:09:10Z
  checked: Backend auth/queue/admission/booking mutation path.
  found: JwtStrategy puts role on req.user, and RolesGuard can enforce admin on /admin routes, but QueueController types/uses only req.user.id; QueueService QueueIdentity stores only userId/refreshTokenFamilyId/deviceSlotId; AdmissionGuard validates only userId plus queue cookies; BookingService.lockSeat and ReservationService.prepareReservation/confirmAndCreateReservation call FeatureFlagsService.assertBookingEnabled() with no user/role override.
  implication: Admin is treated exactly like a normal user in the queue and then is still blocked by BOOKING_ENABLED=false on actual booking mutations. The system has no server-authoritative admin booking-test path.
- timestamp: 2026-05-14T07:09:10Z
  checked: Frontend queue waiting/navigation and UI copy.
  found: useQueue performs one POST enter plus one GET session load, then depends on Socket.IO queue:position/queue:admitted/queue:expired events; there is no interval/refetch fallback while WAITING. QueueWaiting renders the Korean description in a normal paragraph with no nowrap, but no explicit Korean line-break guard either.
  implication: If admin lands in WAITING and no admitted snapshot arrives, the UI can appear to wait indefinitely. The Korean helper text is a presentation issue, not the cause of admission failure.

## Resolution
<!-- OVERWRITE as understanding evolves -->

root_cause: Admin-only booking test is missing as an end-to-end role-aware bypass. The frontend and backend mostly know only the global BOOKING_ENABLED flag; the queue/admission path does not consider admin role, and booking mutations still reject when BOOKING_ENABLED=false.
fix: Added role-aware admin booking-test bypass across frontend booking access checks, queue entry, AdmissionGuard, seat lock, prepare reservation, and payment confirm. Added waiting-session polling fallback and Korean `break-keep` wrapping on queue copy.
verification: Targeted API/web tests passed after installing workspace dependencies and building @grabit/shared; API and web typechecks passed after shared build.
files_changed:
  - apps/api/src/modules/booking/booking.controller.ts
  - apps/api/src/modules/booking/booking.service.ts
  - apps/api/src/modules/queue/guards/admission.guard.ts
  - apps/api/src/modules/queue/queue.controller.ts
  - apps/api/src/modules/queue/queue.service.ts
  - apps/api/src/modules/reservation/reservation.controller.ts
  - apps/api/src/modules/reservation/reservation.service.ts
  - apps/web/lib/booking-access.ts
  - apps/web/app/booking/[performanceId]/page.tsx
  - apps/web/app/booking/[performanceId]/confirm/page.tsx
  - apps/web/app/performance/[id]/page.tsx
  - apps/web/components/booking/booking-page.tsx
  - apps/web/components/booking/queue-waiting.tsx
  - apps/web/hooks/use-booking.ts
  - apps/web/hooks/use-queue.ts
