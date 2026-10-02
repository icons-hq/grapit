import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';

import { AdminCapabilities } from '../../common/decorators/admin-capabilities.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { AdminCapabilitiesGuard } from '../../common/guards/admin-capabilities.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { resolveTrustedRequestIp } from '../../common/request-ip.js';
import {
  AdminOperationsService,
  type AdminOperationsInboxFilters,
} from './admin-operations.service.js';

const answerSchema = z.object({
  body: z.string().min(1, '답변 내용을 입력해주세요'),
  visibility: z.enum(['public', 'internal']).default('public'),
  internalNote: z.boolean().default(false),
  markResolved: z.boolean().default(false),
});

const escalateSchema = z.object({
  reason: z.string().min(1, '에스컬레이션 사유를 입력해주세요'),
});

const statusSchema = z.object({
  status: z.enum(['open', 'waiting_customer', 'waiting_operator', 'resolved', 'closed']),
  reason: z.string().min(1, '상태 변경 사유를 입력해주세요'),
});

const reassignSchema = z.object({
  assigneeUserId: z.string().uuid().nullable(),
  reason: z.string().min(1, '담당자 변경 사유를 입력해주세요'),
});

const signupLookupSchema = z.object({
  emailHash: z.string().min(1).optional(),
  phoneHash: z.string().min(1).optional(),
}).refine((value) => value.emailHash || value.phoneHash, {
  message: '가입 실패 조회 키가 필요합니다',
});

// admin_audit_logs.user_agent is varchar(500).
const AUDIT_USER_AGENT_MAX_LENGTH = 500;

@Controller('admin/operations')
@UseGuards(RolesGuard, AdminCapabilitiesGuard)
@Roles('admin')
export class AdminOperationsController {
  constructor(
    private readonly adminOperationsService: AdminOperationsService,
  ) {}

  @Get('inbox')
  @AdminCapabilities('support.manage')
  async listInbox(
    @Query('source') source?: AdminOperationsInboxFilters['source'],
    @Query('category') category?: AdminOperationsInboxFilters['category'],
    @Query('status') status?: AdminOperationsInboxFilters['status'],
    @Query('priority') priority?: AdminOperationsInboxFilters['priority'],
    @Query('includeResolved') includeResolved?: string,
    @Query('performanceId', new ZodValidationPipe(z.string().uuid().optional())) performanceId?: string,
    @Query('showtimeId', new ZodValidationPipe(z.string().uuid().optional())) showtimeId?: string,
  ) {
    return this.adminOperationsService.listInbox({
      source,
      category,
      status,
      priority,
      includeResolved: includeResolved === 'true',
      performanceId,
      showtimeId,
    });
  }

  @Get('inbox/:id')
  @AdminCapabilities('support.manage')
  async getThreadDetail(@Param('id') id: string) {
    return this.adminOperationsService.getThreadDetail(id);
  }

  @Post('inbox/:id/answer')
  @AdminCapabilities('support.manage')
  async answerThread(
    @Param('id') id: string,
    @CurrentUser('id') actorUserId: string,
    @Body(new ZodValidationPipe(answerSchema)) body: z.infer<typeof answerSchema>,
  ) {
    return this.adminOperationsService.answerThread(id, actorUserId, body);
  }

  @Post('inbox/:id/escalate')
  @AdminCapabilities('support.escalate')
  async escalateThread(
    @Param('id') id: string,
    @CurrentUser('id') actorUserId: string,
    @Body(new ZodValidationPipe(escalateSchema)) body: z.infer<typeof escalateSchema>,
    @Req() request: Request,
  ) {
    return this.adminOperationsService.escalateThread(
      id,
      actorUserId,
      body,
      requestContext(request),
    );
  }

  @Patch('inbox/:id/status')
  @AdminCapabilities('support.manage')
  async updateThreadStatus(
    @Param('id') id: string,
    @CurrentUser('id') actorUserId: string,
    @Body(new ZodValidationPipe(statusSchema)) body: z.infer<typeof statusSchema>,
    @Req() request: Request,
  ) {
    return this.adminOperationsService.updateThreadStatus(
      id,
      actorUserId,
      body,
      requestContext(request),
    );
  }

  @Patch('inbox/:id/reassign')
  @AdminCapabilities('support.manage')
  async reassignThread(
    @Param('id') id: string,
    @CurrentUser('id') actorUserId: string,
    @Body(new ZodValidationPipe(reassignSchema)) body: z.infer<typeof reassignSchema>,
    @Req() request: Request,
  ) {
    return this.adminOperationsService.reassignThread(
      id,
      actorUserId,
      body,
      requestContext(request),
    );
  }

  @Get('signup-failures')
  @AdminCapabilities('support.manage')
  async lookupSignupFailures(
    @Query(new ZodValidationPipe(signupLookupSchema))
    query: z.infer<typeof signupLookupSchema>,
  ) {
    return this.adminOperationsService.lookupSignupFailures(query);
  }
}

/**
 * Audit context for support-thread mutations. The IP comes from the shared
 * trusted resolver (forwarded headers only behind Cloudflare), never from a
 * client-supplied X-Forwarded-For value (audit #123).
 */
function requestContext(request: Request) {
  const userAgent = request.get('user-agent');
  return {
    ipAddress: resolveTrustedRequestIp(request),
    userAgent: userAgent ? userAgent.slice(0, AUDIT_USER_AGENT_MAX_LENGTH) : null,
  };
}
