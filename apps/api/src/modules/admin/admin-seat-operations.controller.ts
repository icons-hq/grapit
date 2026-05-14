import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';

import {
  adminSeatOperationRequestSchema,
  type AdminSeatOperationRequest,
} from '@grabit/shared';
import { AdminCapabilities } from '../../common/decorators/admin-capabilities.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { AdminCapabilitiesGuard } from '../../common/guards/admin-capabilities.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { resolveTrustedRequestIp } from '../../common/request-ip.js';
import { AdminSeatOperationsService } from './admin-seat-operations.service.js';

const seatOperationMutationSchema = adminSeatOperationRequestSchema.pick({
  showtimeId: true,
  seatKey: true,
  reservationId: true,
  reason: true,
  confirmed: true,
});

const seatOperationHistoryQuerySchema = z.object({
  showtimeId: z.string().min(1, '회차 ID가 필요합니다'),
  seatKey: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

type SeatOperationMutationInput = Pick<
  AdminSeatOperationRequest,
  'showtimeId' | 'seatKey' | 'reservationId' | 'reason' | 'confirmed'
>;
type SeatOperationHistoryQuery = z.infer<typeof seatOperationHistoryQuerySchema>;

@Controller('admin/seat-operations')
@UseGuards(RolesGuard, AdminCapabilitiesGuard)
@Roles('admin')
export class AdminSeatOperationsController {
  constructor(
    private readonly seatOperationsService: AdminSeatOperationsService,
  ) {}

  @Post('disable')
  @AdminCapabilities('seat.disable')
  async disableSeat(
    @CurrentUser('id') actorUserId: string,
    @Body(new ZodValidationPipe(seatOperationMutationSchema))
    body: SeatOperationMutationInput,
    @Req() request: Request,
  ) {
    return this.seatOperationsService.performOperation(
      actorUserId,
      {
        ...body,
        operation: 'seat.disable',
      },
      requestContext(request),
    );
  }

  @Post('reactivate')
  @AdminCapabilities('seat.reactivate')
  async reactivateSeat(
    @CurrentUser('id') actorUserId: string,
    @Body(new ZodValidationPipe(seatOperationMutationSchema))
    body: SeatOperationMutationInput,
    @Req() request: Request,
  ) {
    return this.seatOperationsService.performOperation(
      actorUserId,
      {
        ...body,
        operation: 'seat.reactivate',
      },
      requestContext(request),
    );
  }

  @Get('history')
  @AdminCapabilities('seat.disable', 'seat.reactivate')
  async listHistory(
    @Query(new ZodValidationPipe(seatOperationHistoryQuerySchema))
    query: SeatOperationHistoryQuery,
  ) {
    return this.seatOperationsService.listHistory(query);
  }
}

function requestContext(request: Request) {
  return {
    ipAddress: resolveTrustedRequestIp(request),
    userAgent: request.get('user-agent') ?? null,
  };
}
