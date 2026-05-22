import { Module } from '@nestjs/common';

import { AdminCapabilitiesGuard } from '../../common/guards/admin-capabilities.guard.js';
import { AdminAuditService } from '../admin/admin-audit.service.js';
import { TicketModule } from '../ticket/ticket.module.js';
import { FieldCheckInController } from './field-check-in.controller.js';
import { FieldCheckInService } from './field-check-in.service.js';
import { FieldMonitorController } from './field-monitor.controller.js';
import { FieldMonitorService } from './field-monitor.service.js';
import { OfflineSyncController } from './offline-sync.controller.js';
import { OfflineSyncService } from './offline-sync.service.js';

@Module({
  imports: [TicketModule],
  controllers: [
    FieldCheckInController,
    OfflineSyncController,
    FieldMonitorController,
  ],
  providers: [
    FieldCheckInService,
    OfflineSyncService,
    FieldMonitorService,
    AdminAuditService,
    AdminCapabilitiesGuard,
  ],
  exports: [FieldCheckInService, OfflineSyncService, FieldMonitorService],
})
export class FieldOperationsModule {}
