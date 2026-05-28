import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { Readable } from 'node:stream';
import type { Request } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import {
  adminUserExportRequestSchema,
  adminUserListQuerySchema,
  adminUserHardDeleteSchema,
  adminUserPermissionUpdateSchema,
  adminUserWithdrawalSchema,
  type AdminUserExportRequest,
  type AdminUserListQuery,
  type AdminUserHardDeleteInput,
  type AdminUserPermissionUpdate,
  type AdminUserWithdrawalInput,
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
import { AdminUserService } from './admin-user.service.js';

@Controller('admin/users')
@UseGuards(RolesGuard, AdminCapabilitiesGuard)
@Roles('admin')
export class AdminUserController {
  constructor(private readonly adminUserService: AdminUserService) {}

  @Get()
  @AdminCapabilities('audit.read')
  async listUsers(
    @Query(new ZodValidationPipe(adminUserListQuerySchema))
    query: AdminUserListQuery,
  ) {
    return this.adminUserService.listUsers(query);
  }

  @Get('stats')
  @AdminCapabilities('audit.read')
  async getUserStats() {
    return this.adminUserService.getUserStats();
  }

  @Post('export')
  @AdminCapabilities('security.manage')
  async exportUsers(
    @CurrentUser('id') actorUserId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body(new ZodValidationPipe(adminUserExportRequestSchema))
    body: AdminUserExportRequest,
  ) {
    const result = await this.adminUserService.exportUsers({
      actorUserId,
      reason: body.reason,
      ipAddress: resolveTrustedRequestIp(request),
      userAgent: request.get('user-agent') ?? null,
      requestId: request.get('x-request-id') ?? null,
    });

    response.set({
      'Content-Type': result.contentType,
      'Content-Disposition': `attachment; filename="${result.filename}"`,
      'Cache-Control': 'no-store',
    });

    return new StreamableFile(Readable.from([result.csv]));
  }

  @Get(':id')
  @AdminCapabilities('audit.read')
  async getUserDetail(
    @Param('id', new ZodValidationPipe(z.string().uuid('유효한 회원 ID가 필요합니다')))
    id: string,
  ) {
    return this.adminUserService.getUserDetail(id);
  }

  @Patch(':id/permissions')
  @AdminCapabilities('security.manage')
  async updatePermissions(
    @Param('id', new ZodValidationPipe(z.string().uuid('유효한 회원 ID가 필요합니다')))
    id: string,
    @CurrentUser() actor: RequestUser,
    @Body(new ZodValidationPipe(adminUserPermissionUpdateSchema))
    body: AdminUserPermissionUpdate,
    @Req() request: Request,
  ) {
    return this.adminUserService.updatePermissions(
      actor.id,
      id,
      body,
      requestContext(request),
    );
  }

  @Post(':id/withdrawal')
  @AdminCapabilities('security.manage')
  async withdrawUser(
    @Param('id', new ZodValidationPipe(z.string().uuid('유효한 회원 ID가 필요합니다')))
    id: string,
    @CurrentUser() actor: RequestUser,
    @Body(new ZodValidationPipe(adminUserWithdrawalSchema))
    body: AdminUserWithdrawalInput,
    @Req() request: Request,
  ) {
    return this.adminUserService.withdrawUser(
      actor.id,
      id,
      body,
      requestContext(request),
    );
  }

  @Post(':id/hard-delete')
  @AdminCapabilities('security.manage')
  async hardDeleteUser(
    @Param('id', new ZodValidationPipe(z.string().uuid('유효한 회원 ID가 필요합니다')))
    id: string,
    @CurrentUser() actor: RequestUser,
    @Body(new ZodValidationPipe(adminUserHardDeleteSchema))
    body: AdminUserHardDeleteInput,
    @Req() request: Request,
  ) {
    return this.adminUserService.hardDeleteUser(
      actor.id,
      id,
      body,
      requestContext(request),
    );
  }
}

function requestContext(request: Request) {
  return {
    ipAddress: resolveTrustedRequestIp(request),
    userAgent: request.get('user-agent') ?? null,
    requestId: request.get('x-request-id') ?? null,
  };
}
