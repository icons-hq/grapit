import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { Readable } from 'node:stream';
import type { Request, Response } from 'express';
import {
  adminSettlementReconciliationSchema,
  settlementExportRequestSchema,
  type SettlementExportRequest,
} from '@grabit/shared';

import { AdminCapabilities } from '../../common/decorators/admin-capabilities.decorator.js';
import {
  CurrentUser,
  type RequestUser,
} from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { AdminCapabilitiesGuard } from '../../common/guards/admin-capabilities.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { resolveTrustedRequestIp } from '../../common/request-ip.js';
import { AdminSettlementReconciliationService } from './admin-settlement-reconciliation.service.js';
import { SettlementExportService } from './settlement-export.service.js';

const settlementSummaryQuerySchema = settlementExportRequestSchema.omit({
  dataset: true,
  reason: true,
});

type SettlementSummaryQuery = Pick<
  SettlementExportRequest,
  'eventId' | 'showtimeId' | 'dateFrom' | 'dateTo'
>;
const settlementReconciliationQuerySchema =
  adminSettlementReconciliationSchema.pick({ eventId: true });
type SettlementReconciliationQuery = { eventId: string };

@Controller('admin/settlement')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminSettlementController {
  constructor(
    private readonly settlementExportService: SettlementExportService,
    private readonly reconciliationService: AdminSettlementReconciliationService,
  ) {}

  @Get('summary')
  @UseGuards(AdminCapabilitiesGuard)
  @AdminCapabilities('settlement.export')
  async getSummary(
    @Query(new ZodValidationPipe(settlementSummaryQuerySchema))
    query: SettlementSummaryQuery,
  ) {
    return this.settlementExportService.getSummary(query);
  }

  @Get('reconciliation')
  @UseGuards(AdminCapabilitiesGuard)
  @AdminCapabilities('settlement.export')
  async getReconciliation(
    @Query(new ZodValidationPipe(settlementReconciliationQuerySchema))
    query: SettlementReconciliationQuery,
  ) {
    return this.reconciliationService.getReconciliation(query);
  }

  @Post('export')
  @UseGuards(AdminCapabilitiesGuard)
  @AdminCapabilities('settlement.export')
  async exportDataset(
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body(new ZodValidationPipe(settlementExportRequestSchema))
    body: SettlementExportRequest,
  ) {
    const result = await this.settlementExportService.exportDataset(body, {
      actorUserId: user.id,
      role: user.role,
      adminCapabilityBundle: user.adminCapabilityBundle ?? null,
      adminCapabilities: user.adminCapabilities ?? [],
      ipAddress: resolveTrustedRequestIp(request),
      userAgent: request.get('user-agent') ?? null,
    });

    response.set({
      'Content-Type': result.contentType,
      'Content-Disposition': contentDisposition(result.filename),
      'Cache-Control': 'no-store',
    });

    return new StreamableFile(Readable.from([result.csv]));
  }
}

function contentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7E]+/g, '-');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
