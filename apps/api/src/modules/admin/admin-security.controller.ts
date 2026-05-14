import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { AdminSecurityStatus } from '@grabit/shared';

import { AdminCapabilities } from '../../common/decorators/admin-capabilities.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { AdminCapabilitiesGuard } from '../../common/guards/admin-capabilities.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { resolveTrustedRequestIp } from '../../common/request-ip.js';
import {
  AdminSecurityService,
  type AdminSecurityDecision,
} from './admin-security.service.js';

const DEFERRED_MFA_COPY =
  'MFA는 아직 적용되지 않았습니다. 현재는 IP allowlist와 audit monitoring으로 운영합니다.';

const allowlistRecordSchema = z.object({
  cidr: z.string().trim().min(1, 'CIDR 또는 IP를 입력해주세요'),
  label: z.string().trim().min(1, '라벨을 입력해주세요'),
  source: z.enum(['db_managed', 'temporary_exception']).default('db_managed'),
  reason: z.string().trim().min(1, '변경 사유를 입력해주세요'),
  expiresAt: z.string().datetime().nullable().optional(),
});

type AllowlistRecordInput = z.infer<typeof allowlistRecordSchema>;

@Controller('admin/security')
@UseGuards(RolesGuard, AdminCapabilitiesGuard)
@Roles('admin')
@AdminCapabilities('security.manage')
export class AdminSecurityController {
  constructor(private readonly securityService: AdminSecurityService) {}

  @Get('status')
  async getSecurityStatus(
    @CurrentUser('id') actorUserId: string,
    @Req() request: Request,
  ) {
    const decision = await this.securityService.evaluateRequest(request, {
      actorUserId,
      requestId: request.get('x-request-id') ?? undefined,
      userAgent: request.get('user-agent') ?? undefined,
    });

    return {
      ...securityStatusFromDecision(decision),
      currentRequest: {
        allowed: decision.allowed,
        source: decision.source,
        maskedIpAddress: maskIp(decision.ipAddress),
        matchedCidr: decision.matchedCidr ?? null,
        allowlistRecordId: decision.allowlistRecordId ?? null,
        reason: decision.reason ?? null,
      },
      deferredMfaCopy: DEFERRED_MFA_COPY,
      requiredCapability: 'security.manage',
    };
  }

  @Post('allowlist')
  async createAllowlistRecord(
    @CurrentUser('id') actorUserId: string,
    @Req() request: Request,
    @Body(new ZodValidationPipe(allowlistRecordSchema))
    body: AllowlistRecordInput,
  ) {
    const result = await this.securityService.createAllowlistRecord({
      actorUserId,
      hasSecurityManage: true,
      cidr: body.cidr,
      label: body.label,
      source: body.source,
      reason: body.reason,
      expiresAt: body.expiresAt ?? null,
      requestId: request.get('x-request-id') ?? undefined,
      ipAddress: resolveTrustedRequestIp(request),
      userAgent: request.get('user-agent') ?? undefined,
    });

    return {
      ...result,
      requiredCapability: 'security.manage',
    };
  }
}

function securityStatusFromDecision(
  decision: AdminSecurityDecision,
): AdminSecurityStatus {
  return {
    mfa: {
      status: 'deferred_accepted_risk',
      note: DEFERRED_MFA_COPY,
    },
    ipAllowlist: {
      mode: decision.source === 'non_production_bypass' ? 'monitoring' : 'enforced',
      activeRecords: decision.matchedCidr || decision.allowlistRecordId ? 1 : 0,
      lastChangedAt: null,
    },
    lastAuditEventAt: null,
  };
}

function maskIp(ipAddress: string): string {
  if (ipAddress.includes(':')) {
    return `${ipAddress.split(':').slice(0, 4).join(':')}::`;
  }

  const octets = ipAddress.split('.');
  if (octets.length === 4) {
    return `${octets[0]}.${octets[1]}.${octets[2]}.0`;
  }

  return '0.0.0.0';
}
