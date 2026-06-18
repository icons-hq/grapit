import {
  Body,
  Controller,
  Get,
  Param,
  Post,
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
import { BenefitRunnerService } from './benefit-runner.service.js';

const showtimeIdSchema = z.string().uuid('유효한 회차 ID가 필요합니다');
const runIdSchema = z.string().uuid('유효한 benefit run ID가 필요합니다');
const saveConfigurationBodySchema = z
  .object({
    benefits: z.array(benefitDefinitionSchema).min(1),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
const testRunBodySchema = z
  .object({
    configurationId: z.string().uuid('유효한 혜택 설정 ID가 필요합니다').nullable().optional(),
    operatorProvidedSeedRef: z.string().trim().min(1).optional(),
    configurationSnapshot: z
      .object({
        active: z.literal(false),
        sourceConfigurationId: z.string().uuid().nullable().optional(),
        capturedAt: z.string().datetime().optional(),
        benefits: z.array(benefitDefinitionSchema).min(1),
      })
      .strict()
      .optional(),
  })
  .strict();
const liveRunBodySchema = z
  .object({
    configurationId: z.string().uuid('유효한 혜택 설정 ID가 필요합니다'),
    reason: z.string().trim().min(1).max(500).optional(),
    confirmed: z.literal(true, {
      errorMap: () => ({ message: '라이브 혜택 실행 확인이 필요합니다' }),
    }),
  })
  .strict();
const rollbackBodySchema = z
  .object({
    sourceRunId: runIdSchema,
    sourceRunMode: z.literal('live').default('live'),
    reason: z
      .string({ required_error: '혜택 rollback 사유가 필요합니다' })
      .trim()
      .min(1, '혜택 rollback 사유가 필요합니다')
      .max(500),
    confirmed: z.literal(true, {
      errorMap: () => ({ message: '혜택 rollback 확인이 필요합니다' }),
    }),
  })
  .strict();
const changesQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();

type SaveConfigurationBody = z.infer<typeof saveConfigurationBodySchema>;
type TestRunBody = z.infer<typeof testRunBodySchema>;
type LiveRunBody = z.infer<typeof liveRunBodySchema>;
type RollbackBody = z.infer<typeof rollbackBodySchema>;
type ChangesQuery = z.infer<typeof changesQuerySchema>;

@Controller('admin/benefits')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminBenefitsController {
  constructor(
    private readonly adminBenefitsService: AdminBenefitsService,
    private readonly benefitRunnerService: BenefitRunnerService,
  ) {}

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

  @Post('showtimes/:showtimeId/test-runs')
  @UseGuards(AdminCapabilitiesGuard)
  @AdminCapabilities('benefits.manage')
  async runTest(
    @CurrentUser('id') actorUserId: string,
    @Param('showtimeId', new ZodValidationPipe(showtimeIdSchema))
    showtimeId: string,
    @Body(new ZodValidationPipe(testRunBodySchema))
    body: TestRunBody,
  ) {
    return this.benefitRunnerService.runTest({
      showtimeId,
      actorUserId,
      ...body,
    });
  }

  @Post('showtimes/:showtimeId/live-runs')
  @UseGuards(AdminCapabilitiesGuard)
  @AdminCapabilities('benefits.manage')
  async runLive(
    @CurrentUser('id') actorUserId: string,
    @Param('showtimeId', new ZodValidationPipe(showtimeIdSchema))
    showtimeId: string,
    @Body(new ZodValidationPipe(liveRunBodySchema))
    body: LiveRunBody,
  ) {
    return this.benefitRunnerService.runLive({
      showtimeId,
      actorUserId,
      ...body,
    });
  }

  @Get('showtimes/:showtimeId/runs')
  @UseGuards(AdminCapabilitiesGuard)
  @AdminCapabilities('benefits.manage')
  async listRuns(
    @Param('showtimeId', new ZodValidationPipe(showtimeIdSchema))
    showtimeId: string,
  ) {
    return this.benefitRunnerService.listRuns(showtimeId);
  }

  @Get('runs/:runId')
  @UseGuards(AdminCapabilitiesGuard)
  @AdminCapabilities('benefits.manage')
  async getRun(
    @Param('runId', new ZodValidationPipe(runIdSchema))
    runId: string,
  ) {
    return this.benefitRunnerService.getRun(runId);
  }

  @Get('runs/:runId/export')
  @UseGuards(AdminCapabilitiesGuard)
  @AdminCapabilities('benefits.export')
  async exportRun(
    @CurrentUser('id') actorUserId: string,
    @Param('runId', new ZodValidationPipe(runIdSchema))
    runId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.benefitRunnerService.exportRun(runId, {
      actorUserId,
      ...requestContext(request),
    });

    response.set({
      'Content-Type': result.contentType,
      'Content-Disposition': contentDisposition(result.filename),
      'Cache-Control': 'no-store',
    });

    return new StreamableFile(Readable.from([result.csv]));
  }

  @Post('showtimes/:showtimeId/rollback')
  @UseGuards(AdminCapabilitiesGuard)
  @AdminCapabilities('benefits.manage')
  async rollback(
    @CurrentUser('id') actorUserId: string,
    @Param('showtimeId', new ZodValidationPipe(showtimeIdSchema))
    showtimeId: string,
    @Body(new ZodValidationPipe(rollbackBodySchema))
    body: RollbackBody,
  ) {
    return this.benefitRunnerService.rollback({
      showtimeId,
      actorUserId,
      ...body,
    });
  }

  @Get('showtimes/:showtimeId/entitlements/export')
  @UseGuards(AdminCapabilitiesGuard)
  @AdminCapabilities('benefits.export')
  async exportEntitlements(
    @CurrentUser('id') actorUserId: string,
    @Param('showtimeId', new ZodValidationPipe(showtimeIdSchema))
    showtimeId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.benefitRunnerService.exportEntitlements(showtimeId, {
      actorUserId,
      ...requestContext(request),
    });

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
