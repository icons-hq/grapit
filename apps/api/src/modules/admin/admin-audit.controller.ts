import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { AdminCapabilities } from '../../common/decorators/admin-capabilities.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { AdminCapabilitiesGuard } from '../../common/guards/admin-capabilities.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_STATUSES,
  AdminAuditService,
  type AdminAuditQueryFilters,
  type MaskedAdminAuditEvent,
} from './admin-audit.service.js';

const adminAuditQuerySchema = z.object({
  actorUserId: z.string().min(1).optional(),
  action: z.enum(ADMIN_AUDIT_ACTIONS).optional(),
  status: z.enum(ADMIN_AUDIT_STATUSES).optional(),
  resourceType: z.string().min(1).optional(),
  resourceId: z.string().min(1).optional(),
  requestId: z.string().min(1).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

type AdminAuditQuery = z.infer<typeof adminAuditQuerySchema>;

@Controller('admin/audit')
@UseGuards(RolesGuard, AdminCapabilitiesGuard)
@Roles('admin')
@AdminCapabilities('audit.read')
export class AdminAuditController {
  constructor(private readonly auditService: AdminAuditService) {}

  @Get()
  async queryAudit(
    @Query(new ZodValidationPipe(adminAuditQuerySchema))
    query: AdminAuditQuery,
  ) {
    const rows = await this.auditService.query(query as AdminAuditQueryFilters);
    return rows.map(maskAuditEvent);
  }
}

function maskAuditEvent(row: MaskedAdminAuditEvent): MaskedAdminAuditEvent {
  return {
    ...row,
    ipAddress: row.ipAddress ? maskIp(row.ipAddress) : null,
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
