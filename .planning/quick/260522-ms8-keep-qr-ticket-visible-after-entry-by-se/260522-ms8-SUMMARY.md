# Quick Task 260522-ms8 Summary

## Result

QR ticket credential state is now separated from admission state. After field check-in, the customer reservation detail keeps rendering the QR token/JTI as an active credential and shows entry completion separately through `entryStatus` and `enteredAt`.

## Changes

- Added optional `QrTicket.entryStatus` and `QrTicket.enteredAt` to shared types and zod schema.
- Changed customer QR ticket mapping so `usedAt` means `entryStatus = ENTERED`, not credential invalidation.
- Kept scanner contract behavior strict: scanner verification still reports already-entered tickets as `USED` for duplicate entry prevention.
- Updated field check-in consume logic to set `usedAt`/`updatedAt` without changing `tickets.status` to `used`.
- Updated reservation detail UI to keep the QR visible for active credentials and render a separate entry-completed notice below the QR.

## Verification

- PASS: `pnpm --filter @grabit/api test -- qr-ticket.service.spec.ts field-check-in.service.spec.ts reservation.service.spec.ts`
- PASS: `pnpm --filter @grabit/shared test -- booking.schema.test.ts`
- PASS: `pnpm --filter @grabit/web exec vitest run components/reservation/__tests__/reservation-detail-qr.test.tsx`
- PASS: `pnpm --filter @grabit/api typecheck`
- PASS: `pnpm --filter @grabit/web typecheck`
- PASS: `pnpm --filter @grabit/shared typecheck`
- PASS: `pnpm --filter @grabit/api lint` with existing warnings
- PASS: `pnpm --filter @grabit/web lint` with existing warnings
- PASS: `git diff --check -- <changed files>`

## Caveats

- `pnpm --filter @grabit/web test -- reservation-detail-qr.test.tsx` invokes the broader web suite and failed in `lib/__tests__/next-config.test.ts` because of pre-existing dirty changes in `apps/web/next.config.ts`. The focused QR reservation detail spec passed through direct `vitest run`.
- `pnpm --filter @grabit/shared lint` is unavailable because `@grabit/shared` has no `lint` script.

## Commits

- `89d82342 fix(qr): separate entry state from QR credential`
