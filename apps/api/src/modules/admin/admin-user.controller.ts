import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  adminUserListQuerySchema,
  adminUserPermissionUpdateSchema,
  type AdminUserListQuery,
  type AdminUserPermissionUpdate,
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
}

function requestContext(request: Request) {
  return {
    ipAddress: resolveTrustedRequestIp(request),
    userAgent: request.get('user-agent') ?? null,
    requestId: request.get('x-request-id') ?? null,
  };
}
