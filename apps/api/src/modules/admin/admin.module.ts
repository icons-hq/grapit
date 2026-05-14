import { Module } from '@nestjs/common';
import { AdminCapabilitiesGuard } from '../../common/guards/admin-capabilities.guard.js';
import { PerformanceModule } from '../performance/performance.module.js';
import { PaymentModule } from '../payment/payment.module.js';
import { BookingModule } from '../booking/booking.module.js';
import { RefundModule } from '../refund/refund.module.js';
import { AdminPerformanceController } from './admin-performance.controller.js';
import { AdminBannerController } from './admin-banner.controller.js';
import { AdminBookingController } from './admin-booking.controller.js';
import { AdminSeatOperationsController } from './admin-seat-operations.controller.js';
import { LocalUploadController } from './local-upload.controller.js';
import { AdminDashboardController } from './admin-dashboard.controller.js';
import { AdminDiagnosticsController } from './admin-diagnostics.controller.js';
import { AdminService } from './admin.service.js';
import { AdminAuditService } from './admin-audit.service.js';
import { AdminBookingService } from './admin-booking.service.js';
import { AdminSeatOperationsService } from './admin-seat-operations.service.js';
import { UploadService } from './upload.service.js';
import { AdminDashboardService } from './admin-dashboard.service.js';

@Module({
  imports: [PerformanceModule, PaymentModule, BookingModule, RefundModule],
  controllers: [
    AdminPerformanceController,
    AdminBannerController,
    AdminBookingController,
    AdminSeatOperationsController,
    LocalUploadController,
    AdminDashboardController,
    AdminDiagnosticsController,
  ],
  providers: [
    AdminService,
    AdminAuditService,
    AdminCapabilitiesGuard,
    AdminBookingService,
    AdminSeatOperationsService,
    UploadService,
    AdminDashboardService,
  ],
})
export class AdminModule {}
