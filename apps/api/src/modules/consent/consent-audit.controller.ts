import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { CONSENT_ITEM_KEYS, SUPPORTED_LOCALES } from '@grabit/shared';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { ConsentService, type ConsentAuditFilters } from './consent.service.js';

const consentAuditQuerySchema = z.object({
  itemKey: z.enum(CONSENT_ITEM_KEYS).optional(),
  version: z.string().min(1).optional(),
  language: z.enum(SUPPORTED_LOCALES).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  ip: z.string().min(1).optional(),
  userId: z.string().min(1).optional(),
  email: z.string().email().optional(),
});

@Controller('admin/consent-audit')
@UseGuards(RolesGuard)
@Roles('admin')
export class ConsentAuditController {
  constructor(private readonly consentService: ConsentService) {}

  @Get()
  async queryAudit(
    @Query(new ZodValidationPipe(consentAuditQuerySchema))
    query: ConsentAuditFilters,
  ) {
    return this.consentService.queryConsentAudit(query);
  }
}
