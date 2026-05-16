---
phase: quick-260516-wp5-allow-login-before-email-verification-im
plan: 01
subsystem: auth
tags: [auth, email-verification, phone-verification, booking, payments, jwt]
requires: []
provides:
  - Login sessions for email-unverified users with forced email verification routing
  - Fresh email and phone verification flags on UserProfile and JWT request user context
  - Server-side booking and payment gates requiring both email and phone verification
affects: [auth, booking, reservations, payments, frontend]
tech-stack:
  added: []
  patterns:
    - "Verification flags are loaded from DB-backed user profile/request context, not JWT claims"
key-files:
  created: []
  modified:
    - packages/shared/src/types/user.types.ts
    - apps/api/src/modules/auth/auth.service.ts
    - apps/api/src/modules/auth/strategies/jwt.strategy.ts
    - apps/api/src/modules/booking/booking.service.ts
    - apps/api/src/modules/reservation/reservation.service.ts
    - apps/web/components/auth/auth-initializer.tsx
    - apps/web/components/auth/login-form.tsx
    - apps/web/hooks/use-booking-availability.ts
key-decisions:
  - "Password login no longer rejects email-unverified users; booking/payment remain blocked."
  - "Existing linked social users with unverified email now receive a session and are forced to verification."
  - "Booking/payment gates run before Redis lock, reservation write, payment-confirm lock, and Toss confirm side effects."
patterns-established:
  - "Use UserProfile.isEmailVerified together with isPhoneVerified for purchase eligibility."
  - "Unverified authenticated sessions are routed to /auth/verify-email?email=... globally."
requirements-completed: [QUICK-260516-WP5]
duration: 58min
completed: 2026-05-16
---

# Quick 260516-WP5 Summary

**Email-unverified users can log in, but they are forced to email verification and cannot book or pay until both email and phone are verified.**

## Performance

- **Duration:** 58 min
- **Started:** 2026-05-16T22:53:00+09:00
- **Completed:** 2026-05-16T23:51:00+09:00
- **Tasks:** 3
- **Files modified:** 22

## Accomplishments

- Password login now returns an auth session for email-unverified users and includes `user.isEmailVerified`.
- `AuthInitializer`, login, and `/auth` redirect authenticated email-unverified users to `/auth/verify-email?email=...`.
- `BookingService.lockSeat`, `ReservationService.prepareReservation`, and `ReservationService.confirmAndCreateReservation` reject users missing email or phone verification before external side effects.
- Booking UI uses verification-required copy when the current authenticated user is missing either verification flag.

## Files Created/Modified

- `packages/shared/src/types/user.types.ts` - added `UserProfile.isEmailVerified`.
- `apps/api/src/modules/auth/auth.service.ts` - removed email verification rejection from password validation and returned email verification state in profiles.
- `apps/api/src/modules/auth/strategies/jwt.strategy.ts` - returns fresh email and phone verification flags from DB user rows.
- `apps/api/src/modules/booking/booking.service.ts` - added email+phone verification gate before Redis lock mutation.
- `apps/api/src/modules/reservation/reservation.service.ts` - added email+phone verification gate before reservation and Toss payment side effects.
- `apps/web/components/auth/auth-initializer.tsx` - forces active unverified sessions to email verification.
- `apps/web/components/auth/login-form.tsx` - sends unverified login success to the verification screen.
- `apps/web/app/auth/verify-email/page.tsx` - supports email query driven verification request/resend flow.
- `apps/web/hooks/use-booking-availability.ts` - blocks booking availability for users missing email or phone verification.

## Decisions Made

- Verification freshness comes from `JwtStrategy.validate()` loading the current user row; JWT payloads are not trusted for verification state.
- Admin bypass still applies to booking-open feature gates only. Admin booking/payment mutation tests now use actors verified for both email and phone.
- Existing linked social users with unverified email now authenticate and are redirected to email verification, matching the new login policy. New social registration still completes phone verification first and shows email verification as before.

## Deviations from Plan

### Auto-fixed Issues

**1. Existing social-login unverified users authenticated instead of pending-only**
- **Found during:** Task 1
- **Issue:** The plan said to keep social pending-email behavior intact, but the user asked for login to succeed before email verification. Keeping existing linked social accounts unauthenticated would make social login inconsistent with password login.
- **Fix:** Existing linked social users now receive an auth session after a verification email is issued; frontend global routing sends them to email verification.
- **Files modified:** `apps/api/src/modules/auth/auth.service.ts`, `apps/api/src/modules/auth/auth.service.spec.ts`
- **Verification:** API auth service tests and browser session redirect test.

**Total deviations:** 1 auto-fixed
**Impact on plan:** The deviation narrows inconsistency across login methods without weakening booking/payment enforcement.

## Issues Encountered

- Existing port 3000 was a different Next server returning 404 for `/auth`; browser verification used the current app server already running on port 3001.
- `next build` temporarily changed `apps/web/next-env.d.ts` to production route types; reverted that generated build artifact.

## Verification

- `pnpm --filter @grabit/api typecheck` - pass
- `pnpm --filter @grabit/web typecheck` - pass
- `pnpm --filter @grabit/api test -- src/modules/auth/auth.service.spec.ts src/modules/user/user.service.spec.ts src/modules/booking/__tests__/booking.service.spec.ts src/modules/reservation/reservation.service.spec.ts` - pass; Vitest ran all API tests, 681 passed
- `pnpm --filter @grabit/web test -- hooks/__tests__/use-booking.test.tsx hooks/__tests__/booking-disabled-runtime.test.tsx` - pass; Vitest ran all web tests, 431 passed
- `pnpm --filter @grabit/api lint` - pass with existing warnings
- `pnpm --filter @grabit/web lint` - pass with existing warnings
- `pnpm --filter @grabit/api build` - pass
- `pnpm --filter @grabit/web build` - pass
- Browser verification on `http://localhost:3001`:
  - unverified login redirected to `/auth/verify-email?email=browser-unverified%40example.com`
  - unverified refreshed session attempting a performance URL redirected to `/auth/verify-email?email=browser-session-unverified%40example.com`

## User Setup Required

None - no external service configuration required for this code change.

## Next Phase Readiness

The auth/session profile now exposes both verification flags, and booking/payment mutation paths enforce them server-side. Future checkout or queue work should pass `req.user.isEmailVerified` and `req.user.isPhoneVerified` whenever it introduces a new purchase-affecting mutation.

---
*Phase: quick-260516-wp5-allow-login-before-email-verification-im*
*Completed: 2026-05-16*
