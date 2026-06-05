import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { adminBookingListQuerySchema } from '@grabit/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AdminBookingController } from './admin-booking.controller.js';

describe('AdminBookingController', () => {
  it('rejects invalid booking list query params with a controlled 400', () => {
    const pipe = new ZodValidationPipe(adminBookingListQuerySchema);

    for (const query of [
      { status: 'UNKNOWN' },
      { reservationStatus: 'UNKNOWN' },
      { funnelStatus: 'UNKNOWN' },
      { paymentStatus: 'UNKNOWN' },
      { paymentMethod: 'UNKNOWN' },
      { audienceRegion: 'global' },
      { dateFrom: '2026-7-1' },
      { dateFrom: '2026-02-30' },
      { dateFrom: '2026-07-31', dateTo: '2026-07-01' },
      { page: '0' },
      { page: '1.5' },
    ]) {
      expect(() => pipe.transform(query)).toThrow(BadRequestException);
    }
  });

  it('forwards validated booking list query params to the service', async () => {
    const adminBookingService = {
      getBookings: vi.fn().mockResolvedValue({
        bookings: [],
        stats: {
          totalBookings: 0,
          totalRevenue: 0,
          cancelRate: 0,
          soldCount: 0,
          pendingPaymentCount: 0,
          paymentProcessingCount: 0,
          failedCount: 0,
          cancelProcessingCount: 0,
          cancelledCount: 0,
          partialCancelledCount: 0,
          completedRevenue: 0,
        },
        total: 0,
      }),
    };
    const controller = new AdminBookingController(adminBookingService as never);
    const query = adminBookingListQuerySchema.parse({
      status: 'CONFIRMED',
      reservationStatus: 'PENDING_PAYMENT',
      funnelStatus: 'PAYMENT_PENDING',
      paymentStatus: 'READY',
      paymentMethod: 'FOREIGN_EASY_PAY',
      audienceRegion: 'overseas',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      search: 'buyer@example.com',
      page: '2',
    });

    await controller.listBookings(query);

    expect(adminBookingService.getBookings).toHaveBeenCalledWith({
      status: 'CONFIRMED',
      reservationStatus: 'PENDING_PAYMENT',
      funnelStatus: 'PAYMENT_PENDING',
      paymentStatus: 'READY',
      paymentMethod: 'FOREIGN_EASY_PAY',
      audienceRegion: 'overseas',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      search: 'buyer@example.com',
      page: 2,
    });
  });
});
