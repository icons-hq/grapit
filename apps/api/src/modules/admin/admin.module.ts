import { Module } from '@nestjs/common';
import { AdminCapabilitiesGuard } from '../../common/guards/admin-capabilities.guard.js';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import { PerformanceModule } from '../performance/performance.module.js';
import { PaymentModule } from '../payment/payment.module.js';
import { BookingModule } from '../booking/booking.module.js';
import { RefundModule } from '../refund/refund.module.js';
import { AdminPerformanceController } from './admin-performance.controller.js';
import { AdminBannerController } from './admin-banner.controller.js';
import { AdminBookingController } from './admin-booking.controller.js';
import { AdminOperationsController } from './admin-operations.controller.js';
import { AdminSupportContentController } from './admin-support-content.controller.js';
import { AdminSeatOperationsController } from './admin-seat-operations.controller.js';
import { AdminAuditController } from './admin-audit.controller.js';
import { AdminCutoverController } from './admin-cutover.controller.js';
import { AdminSecurityController } from './admin-security.controller.js';
import { AdminUserController } from './admin-user.controller.js';
import { LocalUploadController } from './local-upload.controller.js';
import { AdminDashboardController } from './admin-dashboard.controller.js';
import { AdminDiagnosticsController } from './admin-diagnostics.controller.js';
import { AdminService } from './admin.service.js';
import { AdminAuditService } from './admin-audit.service.js';
import { AdminBookingService } from './admin-booking.service.js';
import { AdminOperationsService } from './admin-operations.service.js';
import { AdminSupportContentService } from './admin-support-content.service.js';
import { AdminSeatOperationsService } from './admin-seat-operations.service.js';
import { AdminCutoverService } from './admin-cutover.service.js';
import { AdminSecurityService } from './admin-security.service.js';
import { AdminUserService } from './admin-user.service.js';
import { UploadService } from './upload.service.js';
import { AdminDashboardService } from './admin-dashboard.service.js';

@Module({
  imports: [PerformanceModule, PaymentModule, BookingModule, RefundModule],
  controllers: [
    AdminPerformanceController,
    AdminBannerController,
    AdminBookingController,
    AdminOperationsController,
    AdminSupportContentController,
    AdminSeatOperationsController,
    AdminAuditController,
    AdminCutoverController,
    AdminSecurityController,
    AdminUserController,
    LocalUploadController,
    AdminDashboardController,
    AdminDiagnosticsController,
  ],
  providers: [
    AdminService,
    AdminAuditService,
    AdminCapabilitiesGuard,
    AdminBookingService,
    AdminOperationsService,
    AdminSupportContentService,
    AdminSeatOperationsService,
    AdminCutoverService,
    AdminUserService,
    {
      provide: AdminSecurityService,
      useFactory: (db: DrizzleDB, audit: AdminAuditService) =>
        new AdminSecurityService(db, audit),
      inject: [DRIZZLE, AdminAuditService],
    },
    UploadService,
    AdminDashboardService,
  ],
})
export class AdminModule {}
