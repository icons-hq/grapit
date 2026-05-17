import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { AdminCapabilitiesGuard } from '../../common/guards/admin-capabilities.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { AdminCapabilities } from '../../common/decorators/admin-capabilities.decorator.js';
import { resolveTrustedRequestIp } from '../../common/request-ip.js';
import {
  createPerformanceSchema,
  updatePerformanceSchema,
  saveSeatMapPayloadSchema,
  type CreatePerformanceInput,
  type UpdatePerformanceInput,
  type SaveSeatMapPayloadInput,
} from '@grabit/shared';
import { AdminService } from './admin.service.js';
import { UploadService } from './upload.service.js';
import { PerformanceService } from '../performance/performance.service.js';
import type { AdminEventMutationContext } from './admin.service.js';

const publishContentChecklistSchema = z.object({
  ko: z.object({
    title: z.boolean(),
    description: z.boolean(),
  }),
  en: z.object({
    title: z.boolean(),
    description: z.boolean(),
  }),
});

const publishPerformanceSchema = z.object({
  reason: z.string().trim().min(1, '게시 사유를 입력해주세요').max(500),
  confirmed: z.literal(true, {
    errorMap: () => ({ message: '게시 전 확인이 필요합니다' }),
  }),
  confirmedChangedFields: z
    .array(z.string().trim().min(1).max(100))
    .min(1, '변경된 필드 확인이 필요합니다'),
  contentChecklist: publishContentChecklistSchema,
});

type PublishPerformanceBody = z.infer<typeof publishPerformanceSchema>;
type AdminRequest = Request & {
  user?: {
    id?: string;
    role?: string | null;
  };
};

@Controller('admin')
@UseGuards(RolesGuard, AdminCapabilitiesGuard)
@Roles('admin')
export class AdminPerformanceController {
  constructor(
    private readonly adminService: AdminService,
    private readonly uploadService: UploadService,
    private readonly performanceService: PerformanceService,
  ) {}

  @Get('performances')
  async listPerformances(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.listPerformances({
      status,
      search,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
  }

  @Get('performances/:id')
  async getPerformance(@Param('id') id: string) {
    return this.performanceService.findById(id, undefined, {
      includeHiddenCopy: true,
    });
  }

  @Post('performances')
  async createPerformance(
    @Body(new ZodValidationPipe(createPerformanceSchema)) body: CreatePerformanceInput,
  ) {
    return this.adminService.createPerformance(body);
  }

  @Put('performances/:id')
  @AdminCapabilities('event.write')
  async updatePerformance(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updatePerformanceSchema)) body: UpdatePerformanceInput,
    @Req() req: AdminRequest,
  ) {
    return this.adminService.updatePerformance(
      id,
      body,
      this.resolveMutationContext(req),
    );
  }

  @Post('performances/:id/publish')
  @AdminCapabilities('event.publish')
  async publishPerformance(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(publishPerformanceSchema)) body: PublishPerformanceBody,
    @Req() req: AdminRequest,
  ) {
    return this.adminService.publishPerformance(
      id,
      body,
      this.resolveMutationContext(req),
    );
  }

  @Delete('performances/:id')
  async deletePerformance(@Param('id') id: string) {
    await this.adminService.deletePerformance(id);
    return { message: '공연이 삭제되었습니다' };
  }

  @Post('performances/:id/seat-map')
  async saveSeatMap(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(saveSeatMapPayloadSchema))
    body: SaveSeatMapPayloadInput,
  ) {
    return this.adminService.saveSeatMap(id, body);
  }

  @Post('upload/presigned')
  async getPresignedUrl(
    @Body() body: { folder: string; contentType: string; extension: string },
  ) {
    return this.uploadService.generatePresignedUrl(
      body.folder,
      body.contentType,
      body.extension,
    );
  }

  private resolveMutationContext(req: AdminRequest): AdminEventMutationContext {
    return {
      actorUserId: req.user?.id ?? 'unknown-admin',
      ipAddress: resolveTrustedRequestIp(req),
      userAgent: req.get('user-agent') ?? null,
      requestId: req.get('x-request-id') ?? null,
    };
  }
}
