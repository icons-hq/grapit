import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  StreamableFile,
  Req,
  Res,
} from '@nestjs/common';
import { Readable } from 'node:stream';
import type { Request, Response } from 'express';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { AdminCapabilitiesGuard } from '../../common/guards/admin-capabilities.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { AdminCapabilities } from '../../common/decorators/admin-capabilities.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import {
  adminRefundSchema,
  adminReservationExportFilterSchema,
  type AdminRefundInput,
  type AdminReservationExportFilter,
} from '@grabit/shared';
import { resolveTrustedRequestIp } from '../../common/request-ip.js';
import { AdminBookingService } from './admin-booking.service.js';

@Controller('admin')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminBookingController {
  constructor(
    private readonly adminBookingService: AdminBookingService,
  ) {}

  @Get('bookings')
  async listBookings(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
  ) {
    return this.adminBookingService.getBookings({
      status,
      search,
      page: page ? parseInt(page, 10) : 1,
    });
  }

  @Get('bookings/:id')
  async getBookingDetail(@Param('id') id: string) {
    return this.adminBookingService.getBookingDetail(id);
  }

  @Post('bookings/export')
  @UseGuards(AdminCapabilitiesGuard)
  @AdminCapabilities('reservations.export_raw')
  async exportBookings(
    @CurrentUser('id') operatorUserId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body(new ZodValidationPipe(adminReservationExportFilterSchema))
    body: AdminReservationExportFilter,
  ) {
    const result = await this.adminBookingService.exportReservations({
      actorUserId: operatorUserId,
      filters: {
        ...body,
        exportType: 'raw_pii',
      },
      ipAddress: resolveTrustedRequestIp(request),
      userAgent: request.get('user-agent') ?? null,
    });

    response.set({
      'Content-Type': result.contentType,
      'Content-Disposition': `attachment; filename="${result.filename}"`,
      'Cache-Control': 'no-store',
    });

    return new StreamableFile(Readable.from([result.csv]));
  }

  @Post('bookings/:id/refund')
  async refundBooking(
    @Param('id') id: string,
    @CurrentUser('id') operatorUserId: string,
    @Body(new ZodValidationPipe(adminRefundSchema)) body: AdminRefundInput,
  ) {
    await this.adminBookingService.refundBooking(id, operatorUserId, body.reason);
    return { message: '환불이 처리되었습니다' };
  }

  @Post('bookings/:id/manual-open')
  async manualOpenBooking(
    @Param('id') id: string,
    @CurrentUser('id') operatorUserId: string,
  ) {
    await this.adminBookingService.manualOpen(id, operatorUserId);
    return { message: '좌석이 즉시 오픈되었습니다' };
  }
}
