import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  fieldMonitorLogFilterSchema,
  type FieldMonitorLogFilter,
} from '@grabit/shared';
import { z } from 'zod';

import { AdminCapabilities } from '../../common/decorators/admin-capabilities.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { AdminCapabilitiesGuard } from '../../common/guards/admin-capabilities.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { FieldMonitorService } from './field-monitor.service.js';

const fieldMonitorSummaryQuerySchema = z
  .object({
    eventId: z.string().min(1, '이벤트 ID가 필요합니다'),
    showtimeId: z.string().uuid('유효한 회차 ID가 필요합니다'),
  })
  .strict();

type FieldMonitorSummaryQuery = z.infer<typeof fieldMonitorSummaryQuerySchema>;

@Controller('field/monitor')
@UseGuards(RolesGuard)
@Roles('admin')
export class FieldMonitorController {
  constructor(private readonly fieldMonitorService: FieldMonitorService) {}

  @Get('summary')
  @UseGuards(AdminCapabilitiesGuard)
  @AdminCapabilities('field.scan.verify')
  async getSummary(
    @Query(new ZodValidationPipe(fieldMonitorSummaryQuerySchema))
    query: FieldMonitorSummaryQuery,
  ) {
    return this.fieldMonitorService.getSummary(query);
  }

  @Get('logs')
  @UseGuards(AdminCapabilitiesGuard)
  @AdminCapabilities('audit.read')
  async listLogs(
    @Query(new ZodValidationPipe(fieldMonitorLogFilterSchema))
    query: FieldMonitorLogFilter,
  ) {
    return this.fieldMonitorService.listScanLogs(query);
  }
}
