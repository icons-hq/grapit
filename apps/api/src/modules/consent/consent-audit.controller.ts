import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  consentAuditQuerySchema,
  type ConsentAuditPage,
  type ConsentAuditQuery,
} from '@grabit/shared';
import { AdminCapabilities } from '../../common/decorators/admin-capabilities.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { AdminCapabilitiesGuard } from '../../common/guards/admin-capabilities.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { ConsentService } from './consent.service.js';

/**
 * Member consent evidence (masked email/phone/IP) is audit data: it needs the
 * same `audit.read` capability as the other audit surfaces, so restricted admin
 * bundles such as the field scanner account cannot list it.
 */
@Controller('admin/consent-audit')
@UseGuards(RolesGuard, AdminCapabilitiesGuard)
@Roles('admin')
@AdminCapabilities('audit.read')
export class ConsentAuditController {
  constructor(private readonly consentService: ConsentService) {}

  @Get()
  async queryAudit(
    @Query(new ZodValidationPipe(consentAuditQuerySchema))
    query: ConsentAuditQuery,
  ): Promise<ConsentAuditPage> {
    return this.consentService.queryConsentAudit(query);
  }
}
