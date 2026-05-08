import { Body, Controller, Get, Param, Post, Request } from '@nestjs/common';
import { cancelReservationSchema, type CancelReservationInput } from '@grabit/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { RefundService } from './refund.service.js';

@Controller()
export class RefundController {
  constructor(private readonly refundService: RefundService) {}

  @Get('reservations/:id/refund-preview')
  async getRefundPreview(
    @Param('id') reservationId: string,
    @Request() req: { user: { id: string } },
  ) {
    return this.refundService.getRefundPreview(reservationId, req.user.id);
  }

  @Post('reservations/:id/refund')
  async requestRefund(
    @Param('id') reservationId: string,
    @Body(new ZodValidationPipe(cancelReservationSchema)) body: CancelReservationInput,
    @Request() req: { user: { id: string } },
  ) {
    return this.refundService.requestRefund(reservationId, req.user.id, body.reason);
  }
}
