import { describe, expect, it } from 'vitest';
import { BookingGateway } from './booking.gateway.js';

describe('BookingGateway', () => {
  it('skips broadcasts when running without a Socket.IO server', () => {
    const gateway = new BookingGateway();

    expect(() =>
      gateway.broadcastSeatUpdate(
        '00000000-0000-4000-8000-000000000001',
        'A-1',
        'available',
        '00000000-0000-4000-8000-000000000002',
      )
    ).not.toThrow();
  });
});
