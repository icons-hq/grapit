import { BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { adminBookingListQuerySchema } from '@grabit/shared';
import { ADMIN_CAPABILITIES_KEY } from '../../common/decorators/admin-capabilities.decorator.js';
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

  it('preserves the failed/cancelled contact export type when forwarding export requests', async () => {
    const adminBookingService = {
      exportReservations: vi.fn().mockResolvedValue({
        filename: 'reservation-export-failed-cancelled-contacts-2026-06-08.csv',
        contentType: 'text/csv; charset=utf-8',
        csv: 'User Email\nfailed@example.com\n',
        rowCount: 1,
      }),
    };
    const controller = new AdminBookingController(adminBookingService as never);
    const response = {
      set: vi.fn(),
    } as unknown as Response;
    const request = {
      get: vi.fn().mockReturnValue('Vitest Admin Console'),
      ip: '203.0.113.10',
      headers: {},
    } as unknown as Request;

    await controller.exportBookings(
      'admin-1',
      request,
      response,
      {
        exportType: 'failed_cancelled_contacts',
        reason: '실패 고객 안내',
      },
    );

    expect(adminBookingService.exportReservations).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'admin-1',
        filters: {
          exportType: 'failed_cancelled_contacts',
          reason: '실패 고객 안내',
        },
        userAgent: 'Vitest Admin Console',
      }),
    );
  });

  it('preserves the active ticket manifest export type when forwarding export requests', async () => {
    const adminBookingService = {
      exportReservations: vi.fn().mockResolvedValue({
        filename: 'reservation-export-active-ticket-manifest-2026-06-30.csv',
        contentType: 'text/csv; charset=utf-8',
        csv: 'Tier,Seat\nVIP,1F:A-1\n',
        rowCount: 1,
      }),
    };
    const controller = new AdminBookingController(adminBookingService as never);
    const response = {
      set: vi.fn(),
    } as unknown as Response;
    const request = {
      get: vi.fn().mockReturnValue('Vitest Admin Console'),
      ip: '203.0.113.10',
      headers: {},
    } as unknown as Request;

    await controller.exportBookings(
      'admin-1',
      request,
      response,
      {
        exportType: 'active_ticket_manifest',
        showtimeId: 'showtime-1',
        reason: '현장 운영 명단',
      },
    );

    expect(adminBookingService.exportReservations).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'admin-1',
        filters: {
          exportType: 'active_ticket_manifest',
          showtimeId: 'showtime-1',
          reason: '현장 운영 명단',
        },
        userAgent: 'Vitest Admin Console',
      }),
    );
  });

  it('requires refund.admin_refund capability for admin refund preview and execution endpoints', () => {
    const reflector = new Reflector();

    expect(
      reflector.get<string[]>(
        ADMIN_CAPABILITIES_KEY,
        AdminBookingController.prototype.getRefundPreview,
      ),
    ).toEqual(['refund.admin_refund']);
    expect(
      reflector.get<string[]>(
        ADMIN_CAPABILITIES_KEY,
        AdminBookingController.prototype.refundBooking,
      ),
    ).toEqual(['refund.admin_refund']);
  });
});
