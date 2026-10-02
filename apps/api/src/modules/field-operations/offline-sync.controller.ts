import {
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  fieldOfflineSyncRequestSchema,
  type FieldOfflineSyncRequest,
  type FieldOfflineSyncResponse,
} from '@grabit/shared';

import { AdminCapabilities } from '../../common/decorators/admin-capabilities.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { AdminCapabilitiesGuard } from '../../common/guards/admin-capabilities.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { resolveTrustedRequestIp } from '../../common/request-ip.js';
import { ROUTE_THROTTLES } from '../traffic/route-throttles.js';
import { OfflineSyncService } from './offline-sync.service.js';

@Controller('field/check-in')
@UseGuards(RolesGuard)
@Roles('admin')
// Shared scanner accounts run several gate devices at once; bucket per account
// and network with gate-peak headroom instead of the 60/min default.
@Throttle({ default: ROUTE_THROTTLES.fieldOperations })
export class OfflineSyncController {
  constructor(private readonly offlineSyncService: OfflineSyncService) {}

  @Post('offline-sync')
  @UseGuards(AdminCapabilitiesGuard)
  @AdminCapabilities('field.scan.sync')
  async syncPendingAttempts(
    @CurrentUser('id') scannerUserId: string,
    @Req() request: Request,
    @Body(new ZodValidationPipe(fieldOfflineSyncRequestSchema))
    body: FieldOfflineSyncRequest,
  ): Promise<FieldOfflineSyncResponse> {
    return this.offlineSyncService.syncPendingAttempts(body, {
      scannerUserId,
      recoveredAt: new Date().toISOString(),
      ipAddress: resolveTrustedRequestIp(request),
      userAgent: request.get('user-agent') ?? null,
    });
  }
}
