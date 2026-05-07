import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  Query,
  Request,
  Req,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import {
  prepareReservationSchema,
  confirmPaymentSchema,
  cancelReservationSchema,
  type PrepareReservationInput,
  type ConfirmPaymentInput,
  type CancelReservationInput,
  type ReservationStatus,
} from '@grabit/shared';
import { resolveTrustedRequestIp } from '../../common/request-ip.js';
import type { ConsentRequestMeta } from '../consent/consent.service.js';
import { ReservationService } from './reservation.service.js';

@Controller()
export class ReservationController {
  constructor(
    private readonly reservationService: ReservationService,
  ) {}

  @Post('reservations/prepare')
  async prepareReservation(
    @Body(new ZodValidationPipe(prepareReservationSchema)) body: PrepareReservationInput,
    @Req() req: ExpressRequest & { user: { id: string } },
  ) {
    return this.reservationService.prepareReservation(
      body,
      req.user.id,
      this.resolveConsentMeta(req),
    );
  }

  @Post('payments/confirm')
  async confirmPayment(
    @Body(new ZodValidationPipe(confirmPaymentSchema)) body: ConfirmPaymentInput,
    @Request() req: { user: { id: string } },
  ) {
    return this.reservationService.confirmAndCreateReservation(body, req.user.id);
  }

  @Get('users/me/reservations')
  async getMyReservations(
    @Request() req: { user: { id: string } },
    @Query('status') status?: string,
  ) {
    return this.reservationService.getMyReservations(
      req.user.id,
      status as ReservationStatus | undefined,
    );
  }

  @Get('reservations')
  async getReservationByOrderId(
    @Request() req: { user: { id: string } },
    @Query('orderId') orderId: string,
  ) {
    return this.reservationService.getReservationByOrderId(orderId, req.user.id);
  }

  @Get('reservations/:id')
  async getReservationDetail(
    @Param('id') id: string,
    @Request() req: { user: { id: string } },
  ) {
    return this.reservationService.getReservationDetail(id, req.user.id);
  }

  @Put('reservations/:id/cancel')
  async cancelReservation(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(cancelReservationSchema)) body: CancelReservationInput,
    @Request() req: { user: { id: string } },
  ) {
    await this.reservationService.cancelReservation(id, req.user.id, body.reason);
    return { message: '예매가 취소되었습니다' };
  }

  @Put('reservations/:id/cancel-pending')
  async cancelPendingReservation(
    @Param('id') id: string,
    @Request() req: { user: { id: string } },
  ) {
    await this.reservationService.cancelPendingReservation(id, req.user.id);
    return { message: '만료된 예매가 취소되었습니다' };
  }

  private resolveConsentMeta(req: ExpressRequest): ConsentRequestMeta {
    return {
      ipAddress: resolveTrustedRequestIp(req),
      userAgent: req.get('user-agent'),
    };
  }
}
