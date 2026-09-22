import {
  Controller,
  ForbiddenException,
  Get,
  Post,
  Put,
  Param,
  Body,
  Query,
  Request,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import {
  prepareReservationSchema,
  queueAdmissionSchema,
  confirmPaymentSchema,
  cancelReservationSchema,
  cancelTicketItemSchema,
  type PrepareReservationInput,
  type ConfirmPaymentInput,
  type ConfirmPaymentRequest,
  type CancelReservationInput,
  type CancelTicketItemInput,
  type ReservationStatus,
} from '@grabit/shared';
import { resolveTrustedRequestIp } from '../../common/request-ip.js';
import type { ConsentRequestMeta } from '../consent/consent.service.js';
import { AdmissionGuard } from '../queue/guards/admission.guard.js';
import { ReservationService } from './reservation.service.js';
import { RefundService } from '../refund/refund.service.js';

const prepareReservationTransportSchema = prepareReservationSchema
  .omit({ queueAdmission: true })
  .extend({
    queueAdmission: queueAdmissionSchema.partial().optional(),
  });

type PrepareReservationTransportInput = z.infer<
  typeof prepareReservationTransportSchema
>;

type QueueAdmissionRequest = ExpressRequest & {
  user: {
    id: string;
    role?: string;
    isEmailVerified?: boolean;
    isPhoneVerified?: boolean;
  };
  queueAdmission?: PrepareReservationInput['queueAdmission'];
};

type AuthenticatedReservationUser = {
  id: string;
  role?: string;
  isEmailVerified?: boolean;
  isPhoneVerified?: boolean;
};

@Controller()
export class ReservationController {
  constructor(
    private readonly reservationService: ReservationService,
    private readonly refundService: RefundService,
  ) {}

  @UseGuards(AdmissionGuard)
  @Post('reservations/prepare')
  async prepareReservation(
    @Body(new ZodValidationPipe(prepareReservationTransportSchema))
    body: PrepareReservationTransportInput,
    @Req() req: QueueAdmissionRequest,
  ) {
    const result = await this.reservationService.prepareReservation(
      {
        ...body,
        queueAdmission: this.requireQueueAdmission(req),
      },
      {
        id: req.user.id,
        role: req.user.role,
        isEmailVerified: req.user.isEmailVerified,
        isPhoneVerified: req.user.isPhoneVerified,
      },
      this.resolveConsentMeta(req),
    );

    return {
      ...result,
      queueAdmission: {
        ...result.queueAdmission,
        admissionToken: 'cookie-bound',
      },
    };
  }

  @UseGuards(AdmissionGuard)
  @Post('payments/confirm')
  async confirmPayment(
    @Body(new ZodValidationPipe(confirmPaymentSchema)) body: ConfirmPaymentInput,
    @Request() req: { user: AuthenticatedReservationUser },
  ) {
    return this.reservationService.confirmAndCreateReservation(
      body as ConfirmPaymentRequest,
      {
        id: req.user.id,
        role: req.user.role,
        isEmailVerified: req.user.isEmailVerified,
        isPhoneVerified: req.user.isPhoneVerified,
      },
    );
  }

  @Get('users/me/reservations')
  async getMyReservations(
    @Request() req: { user: { id: string } },
    @Query('status') status?: string,
    @Query('locale') locale?: string,
  ) {
    return this.reservationService.getMyReservations(
      req.user.id,
      status as ReservationStatus | undefined,
      locale,
    );
  }

  @Get('reservations')
  async getReservationByOrderId(
    @Request() req: { user: { id: string } },
    @Query('orderId') orderId: string,
    @Res() response: ExpressResponse,
    @Query('locale') locale?: string,
  ) {
    const reservation = await this.reservationService.getReservationByOrderId(orderId, req.user.id, locale);
    // Nest sends an empty body for a null return. The lookup contract needs
    // literal JSON null so customers can distinguish absence from a read error.
    response.json(reservation);
  }

  @Get('reservations/:id')
  async getReservationDetail(
    @Param('id') id: string,
    @Request() req: { user: { id: string } },
    @Query('locale') locale?: string,
  ) {
    return this.reservationService.getReservationDetail(id, req.user.id, locale);
  }

  @Put('reservations/:id/cancel')
  async cancelReservation(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(cancelReservationSchema)) body: CancelReservationInput,
    @Request() req: { user: { id: string } },
  ) {
    return this.refundService.requestRefund(id, req.user.id, body.reason, body);
  }

  @Put('reservations/:id/ticket-items/:ticketItemId/cancel')
  async cancelTicketItem(
    @Param('id') id: string,
    @Param('ticketItemId') ticketItemId: string,
    @Body(new ZodValidationPipe(cancelTicketItemSchema)) body: CancelTicketItemInput,
    @Request() req: { user: { id: string } },
  ) {
    return this.reservationService.cancelTicketItem(id, ticketItemId, req.user.id, body.reason, body);
  }

  @Get('reservations/:id/ticket-items/:ticketItemId/refund-preview')
  async getTicketItemRefundPreview(@Param('id') id: string, @Param('ticketItemId') ticketItemId: string,
    @Request() req: { user: { id: string } }) {
    return this.reservationService.getTicketItemCancellationPreview(id, ticketItemId, req.user.id);
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

  private requireQueueAdmission(
    req: QueueAdmissionRequest,
  ): PrepareReservationInput['queueAdmission'] {
    if (!req.queueAdmission) {
      throw new ForbiddenException('대기열 입장 인증이 필요합니다');
    }

    return req.queueAdmission;
  }
}
