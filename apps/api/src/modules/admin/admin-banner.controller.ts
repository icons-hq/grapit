import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { AdminCapabilitiesGuard } from '../../common/guards/admin-capabilities.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { AdminCapabilities } from '../../common/decorators/admin-capabilities.decorator.js';
import { resolveTrustedRequestIp } from '../../common/request-ip.js';
import { createBannerSchema, type CreateBannerInput } from '@grabit/shared';
import { AdminService } from './admin.service.js';
import type { AdminEventMutationContext } from './admin.service.js';

type AdminRequest = Request & {
  user?: {
    id?: string;
    role?: string | null;
  };
};

@Controller('admin')
@UseGuards(RolesGuard, AdminCapabilitiesGuard)
@Roles('admin')
export class AdminBannerController {
  constructor(private readonly adminService: AdminService) {}

  @Get('banners')
  async listBanners() {
    return this.adminService.listBanners();
  }

  @Post('banners')
  @AdminCapabilities('banner.manage')
  async createBanner(
    @Body(new ZodValidationPipe(createBannerSchema)) body: CreateBannerInput,
    @Req() req: AdminRequest,
  ) {
    return this.adminService.createBanner(body, this.resolveMutationContext(req));
  }

  // CRITICAL: Static route 'banners/reorder' MUST appear before dynamic 'banners/:id'
  @Put('banners/reorder')
  @AdminCapabilities('banner.manage')
  async reorderBanners(
    @Body() body: { orderedIds: string[] },
    @Req() req: AdminRequest,
  ) {
    await this.adminService.reorderBanners(
      body.orderedIds,
      this.resolveMutationContext(req),
    );
    return { message: '배너 순서가 변경되었습니다' };
  }

  @Put('banners/:id')
  @AdminCapabilities('banner.manage')
  async updateBanner(
    @Param('id') id: string,
    @Body() body: Partial<CreateBannerInput>,
    @Req() req: AdminRequest,
  ) {
    return this.adminService.updateBanner(
      id,
      body,
      this.resolveMutationContext(req),
    );
  }

  @Delete('banners/:id')
  @AdminCapabilities('banner.manage')
  async deleteBanner(
    @Param('id') id: string,
    @Req() req: AdminRequest,
  ) {
    await this.adminService.deleteBanner(id, this.resolveMutationContext(req));
    return { message: '배너가 삭제되었습니다' };
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
