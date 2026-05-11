import { describe, it, expect } from 'vitest';
import { lockSeatSchema } from '../dto/lock-seat.dto.js';
import type { SeatState } from '@grabit/shared';

describe('LockSeatRequest zod schema', () => {
  it('validates valid {showtimeId: uuid, seatId: string}', () => {
    const valid = {
      showtimeId: '550e8400-e29b-41d4-a716-446655440000',
      seatId: 'A-1',
    };
    const result = lockSeatSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('rejects missing fields', () => {
    const noShowtimeId = { seatId: 'A-1' };
    const noSeatId = { showtimeId: '550e8400-e29b-41d4-a716-446655440000' };
    const empty = {};

    expect(lockSeatSchema.safeParse(noShowtimeId).success).toBe(false);
    expect(lockSeatSchema.safeParse(noSeatId).success).toBe(false);
    expect(lockSeatSchema.safeParse(empty).success).toBe(false);
  });

  it('rejects seatId longer than 20 chars', () => {
    const tooLong = {
      showtimeId: '550e8400-e29b-41d4-a716-446655440000',
      seatId: 'A'.repeat(21),
    };
    expect(lockSeatSchema.safeParse(tooLong).success).toBe(false);
  });
});

describe('SeatState type', () => {
  it('includes available | locked | sold | held', () => {
    // Type-level check: assign each literal to SeatState
    const available: SeatState = 'available';
    const locked: SeatState = 'locked';
    const sold: SeatState = 'sold';
    const held: SeatState = 'held';

    expect(available).toBe('available');
    expect(locked).toBe('locked');
    expect(sold).toBe('sold');
    expect(held).toBe('held');
  });
});
