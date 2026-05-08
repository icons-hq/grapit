import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { adminRefundSchema, type AdminRefundInput } from '@grabit/shared';
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

  @Post('bookings/:id/refund')
  async refundBooking(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(adminRefundSchema)) body: AdminRefundInput,
  ) {
    await this.adminBookingService.refundBooking(id, body.reason);
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
