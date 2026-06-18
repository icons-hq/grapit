import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { Readable } from 'node:stream';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { benefitDefinitionSchema } from '@grabit/shared';
import { AdminCapabilities } from '../../common/decorators/admin-capabilities.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { AdminCapabilitiesGuard } from '../../common/guards/admin-capabilities.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { resolveTrustedRequestIp } from '../../common/request-ip.js';
import { AdminBenefitsService } from './admin-benefits.service.js';

const showtimeIdSchema = z.string().uuid('유효한 회차 ID가 필요합니다');
const saveConfigurationBodySchema = z
  .object({
    benefits: z.array(benefitDefinitionSchema).min(1),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
const changesQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();

type SaveConfigurationBody = z.infer<typeof saveConfigurationBodySchema>;
type ChangesQuery = z.infer<typeof changesQuerySchema>;

@Controller('admin/benefits')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminBenefitsController {
  constructor(private readonly adminBenefitsService: AdminBenefitsService) {}

  @Get('showtimes/:showtimeId/configuration')
  async getConfiguration(
    @Param('showtimeId', new ZodValidationPipe(showtimeIdSchema))
    showtimeId: string,
  ) {
    return this.adminBenefitsService.getConfiguration(showtimeId);
  }

  @Put('showtimes/:showtimeId/configuration')
  @UseGuards(AdminCapabilitiesGuard)
  @AdminCapabilities('benefits.manage')
  async saveConfiguration(
    @CurrentUser('id') actorUserId: string,
    @Param('showtimeId', new ZodValidationPipe(showtimeIdSchema))
    showtimeId: string,
    @Body(new ZodValidationPipe(saveConfigurationBodySchema))
    body: SaveConfigurationBody,
    @Req() request: Request,
  ) {
    return this.adminBenefitsService.saveConfiguration(
      showtimeId,
      actorUserId,
      body,
      requestContext(request),
    );
  }

  @Get('showtimes/:showtimeId/configuration/changes')
  async listConfigurationChanges(
    @Param('showtimeId', new ZodValidationPipe(showtimeIdSchema))
    showtimeId: string,
    @Query(new ZodValidationPipe(changesQuerySchema))
    query: ChangesQuery,
  ) {
    return this.adminBenefitsService.listConfigurationChanges(
      showtimeId,
      query.limit,
    );
  }

  @Get('showtimes/:showtimeId/configuration/export')
  @UseGuards(AdminCapabilitiesGuard)
  @AdminCapabilities('benefits.export')
  async exportConfiguration(
    @CurrentUser('id') actorUserId: string,
    @Param('showtimeId', new ZodValidationPipe(showtimeIdSchema))
    showtimeId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.adminBenefitsService.exportConfiguration(
      showtimeId,
      {
        actorUserId,
        ...requestContext(request),
      },
    );

    response.set({
      'Content-Type': result.contentType,
      'Content-Disposition': contentDisposition(result.filename),
      'Cache-Control': 'no-store',
    });

    return new StreamableFile(Readable.from([result.csv]));
  }
}

function requestContext(request: Request) {
  return {
    ipAddress: resolveTrustedRequestIp(request),
    userAgent: request.get('user-agent') ?? null,
    requestId: request.get('x-request-id') ?? null,
  };
}

function contentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7E]+/g, '-');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
