import { describe, expect, it } from 'vitest';

import {
  decodeSeatRuntimeId,
  encodeSeatRuntimeId,
  normalizeSeatIdentity,
  toFloorAwareSeatSelection,
} from './seat-identity';

describe('seat identity helpers', () => {
  it('normalizes legacy local seat ids with default 1F labels', () => {
    expect(normalizeSeatIdentity({ seatId: 'A-10' })).toEqual({
      floorKey: '1F',
      floorLabel: '1층',
      seatId: 'A-10',
      seatKey: '1F:A-10',
    });
  });

  it('preserves explicit legacy defaults for the booking confirm page', () => {
    expect(
      normalizeSeatIdentity(
        { seatId: 'A-10' },
        { defaultFloorKey: 'default', defaultFloorLabel: '기본' },
      ),
    ).toEqual({
      floorKey: 'default',
      floorLabel: '기본',
      seatId: 'A-10',
      seatKey: 'default:A-10',
    });
  });

  it('splits colon seat keys and keeps the provided floor label', () => {
    expect(
      normalizeSeatIdentity({
        seatId: 'A-10',
        seatKey: '2F:A-10',
        floorLabel: '2층',
      }),
    ).toEqual({
      floorKey: '2F',
      floorLabel: '2층',
      seatId: 'A-10',
      seatKey: '2F:A-10',
    });
  });

  it('converts a base seat selection into a floor-aware selection', () => {
    expect(
      toFloorAwareSeatSelection({
        seatId: 'A-10',
        tierName: 'VIP',
        price: 77000,
        row: 'A',
        number: '10',
      }),
    ).toEqual({
      seatId: 'A-10',
      tierName: 'VIP',
      price: 77000,
      row: 'A',
      number: '10',
      floorKey: '1F',
      floorLabel: '1층',
      seatKey: '1F:A-10',
    });
  });

  it('round-trips Redis runtime ids without leaking encoding rules to callers', () => {
    const seatKey = '2F:A-10';
    const runtimeId = encodeSeatRuntimeId(seatKey);

    expect(runtimeId).toBe('2F%3AA-10');
    expect(decodeSeatRuntimeId(runtimeId)).toBe(seatKey);
  });
});
