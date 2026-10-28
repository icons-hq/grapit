import { describe, expect, it } from 'vitest';
import { createVenueLayoutSchema } from './venue-layout.schema';

function input(seatIds: string[]) {
  return { venueName: '극장', layoutName: '정면 무대', seatMaps: [{
    floorKey: '1F', floorLabel: '1층', totalSeats: seatIds.length, svgUrl: 'https://example.test/seats.svg',
    seatConfig: { tiers: [{ tierName: 'VIP', color: '#6C3CE0', seatIds }],
      sections: [{ sectionKey: 'front', label: '앞쪽', seatIds }] },
  }] };
}

describe('venue layout seat identities', () => {
  it('accepts a floor-local or matching floor-qualified identity', () => {
    expect(createVenueLayoutSchema.safeParse(input(['A-1', '1F:A-2'])).success).toBe(true);
  });
  it.each([['A-1', '1F:A-1'], ['2F:A-1'], ['']])('rejects ambiguous, wrong-floor or empty identities: %s', (...ids) => {
    expect(createVenueLayoutSchema.safeParse(input(ids)).success).toBe(false);
  });
});
