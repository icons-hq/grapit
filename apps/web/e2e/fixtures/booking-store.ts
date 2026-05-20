import type { Page } from '@playwright/test';
import type { FloorAwareSeatSelection, SeatSelection } from '@grabit/shared';

/**
 * Inject minimal booking store state into the window before page navigation so the
 * confirm page does not redirect to /booking/:id (see confirm/page.tsx:62-66).
 *
 * Run BEFORE `page.goto('/booking/.../confirm')`.
 *
 * The companion hook in `apps/web/stores/use-booking-store.ts` reads
 * `window.__BOOKING_FIXTURE__` once on client init (dev/test only) and seeds the
 * store via `setBookingData`.
 *
 * Blocker B1 (revision-2): seats shape MUST match SeatSelection from
 * packages/shared/src/types/booking.types.ts:30-37 — { seatId, tierName, price,
 * row, number, tierColor? } — NOT the older { id, label, price, grade } form.
 */
export async function injectBookingFixture(
  page: Page,
  args: {
    performanceId: string;
    showtimeId: string;
    seats: Array<FloorAwareSeatSelection | SeatSelection>;
    performanceTitle: string;
    showDateTime: string;
    venue: string;
    posterUrl?: string;
  },
): Promise<void> {
  await page.addInitScript((fixtureArgs) => {
    (window as unknown as { __BOOKING_FIXTURE__: typeof fixtureArgs }).__BOOKING_FIXTURE__ =
      fixtureArgs;
  }, args);
}
