import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { periodQuerySchema } from '@grabit/shared';
import type { DashboardPeriod } from '@grabit/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AdminCapabilitiesGuard } from '../../common/guards/admin-capabilities.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { AdminCapabilities } from '../../common/decorators/admin-capabilities.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { AdminDashboardService } from './admin-dashboard.service.js';

/**
 * AdminDashboardController — 5 read-only endpoints under /admin/dashboard.
 *
 * 모든 라우트는 admin 역할과 `reservations.read` capability를 요구한다
 * (T-11-03 Elevation of Privilege mitigation). 비인증 → 401, 비관리자 또는
 * 매출·예매 조회 권한이 없는 제한 계정(현장 scanner 등) → 403. 웹 관리자 홈
 * 메뉴(admin-navigation.ts)와 같은 capability 경계다.
 *
 * period 쿼리는 `periodQuerySchema` (z.enum(['7d','30d','90d']).default('30d'))
 * 로 validate — T-11-04 Tampering mitigation.
 */
@Controller('admin/dashboard')
@UseGuards(RolesGuard, AdminCapabilitiesGuard)
@Roles('admin')
@AdminCapabilities('reservations.read')
export class AdminDashboardController {
  constructor(
    @Inject(AdminDashboardService)
    private readonly service: AdminDashboardService,
  ) {}

  @Get('summary')
  async getSummary() {
    return this.service.getSummary();
  }

  @Get('revenue')
  async getRevenue(
    @Query(new ZodValidationPipe(periodQuerySchema)) query: { period: DashboardPeriod },
  ) {
    return this.service.getRevenueTrend(query.period);
  }

  @Get('genre')
  async getGenre(
    @Query(new ZodValidationPipe(periodQuerySchema)) query: { period: DashboardPeriod },
  ) {
    return this.service.getGenreDistribution(query.period);
  }

  @Get('payment')
  async getPayment(
    @Query(new ZodValidationPipe(periodQuerySchema)) query: { period: DashboardPeriod },
  ) {
    return this.service.getPaymentDistribution(query.period);
  }

  @Get('top-performances')
  async getTopPerformances() {
    return this.service.getTopPerformances();
  }
}
