import {
  Body,
  Controller,
  Get,
  GoneException,
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
  financeLedgerQuerySchema,
  type FinanceLedgerQuery,
  financeLedgerExportSchema,
  type FinanceLedgerExportRequest,
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
import { FinanceLedgerService } from './finance-ledger.service.js';

@Controller('admin/settlement')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminSettlementController {
  constructor(
    private readonly financeLedgerService: FinanceLedgerService,
  ) {}

  @Get('ledger')
  @UseGuards(AdminCapabilitiesGuard)
  @AdminCapabilities('settlement.export')
  getLedger(@Query(new ZodValidationPipe(financeLedgerQuerySchema)) query: FinanceLedgerQuery) {
    return this.financeLedgerService.getLedger(query);
  }

  @Post('ledger/export')
  @UseGuards(AdminCapabilitiesGuard)
  @AdminCapabilities('settlement.export')
  async exportLedger(@CurrentUser() user: RequestUser, @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body(new ZodValidationPipe(financeLedgerExportSchema)) body: FinanceLedgerExportRequest) {
    const result = await this.financeLedgerService.exportLedger(body, { actorUserId: user.id, role: user.role,
      adminCapabilityBundle: user.adminCapabilityBundle, adminCapabilities: user.adminCapabilities,
      ipAddress: resolveTrustedRequestIp(request), userAgent: request.get('user-agent') ?? null });
    response.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': contentDisposition(result.filename), 'Cache-Control': 'no-store' });
    return new StreamableFile(Readable.from([result.csv]));
  }

  // The old contracts cannot express currency evidence, asOf or the date basis.
  // Return an explicit migration error instead of a second, conflicting ledger.
  @Get(['summary', 'reconciliation'])
  @UseGuards(AdminCapabilitiesGuard)
  @AdminCapabilities('settlement.export')
  retiredSummary(): never {
    throw new GoneException('정산 조회 계약이 변경되었습니다. 화면을 새로고침하거나 /admin/settlement/ledger에서 기간 기준과 기준 시각을 지정해주세요.');
  }

  @Post('export')
  @UseGuards(AdminCapabilitiesGuard)
  @AdminCapabilities('settlement.export')
  retiredExport(): never {
    throw new GoneException('정산 내보내기 계약이 변경되었습니다. /admin/settlement/ledger/export를 사용해주세요.');
  }

}

function contentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7E]+/g, '-');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
