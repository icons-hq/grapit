import { Module } from '@nestjs/common';

import { AdminCapabilitiesGuard } from '../../common/guards/admin-capabilities.guard.js';
import { AdminAuditService } from '../admin/admin-audit.service.js';
import { TicketModule } from '../ticket/ticket.module.js';
import { FieldCheckInController } from './field-check-in.controller.js';
import { FieldCheckInService } from './field-check-in.service.js';
import { OfflineSyncController } from './offline-sync.controller.js';
import { OfflineSyncService } from './offline-sync.service.js';

@Module({
  imports: [TicketModule],
  controllers: [FieldCheckInController, OfflineSyncController],
  providers: [
    FieldCheckInService,
    OfflineSyncService,
    AdminAuditService,
    AdminCapabilitiesGuard,
  ],
  exports: [FieldCheckInService, OfflineSyncService],
})
export class FieldOperationsModule {}
