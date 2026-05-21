import { Controller, Get, Inject, UseGuards } from '@nestjs/common';

import { AdminCapabilities } from '../../common/decorators/admin-capabilities.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { AdminCapabilitiesGuard } from '../../common/guards/admin-capabilities.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { AdminCutoverService } from './admin-cutover.service.js';

@Controller('admin/cutover')
@UseGuards(RolesGuard, AdminCapabilitiesGuard)
@Roles('admin')
export class AdminCutoverController {
  constructor(
    @Inject(AdminCutoverService)
    private readonly cutoverService: AdminCutoverService,
  ) {}

  @Get('gates')
  @AdminCapabilities('audit.read')
  async getGateSummary() {
    return this.cutoverService.getGateSummary();
  }
}
