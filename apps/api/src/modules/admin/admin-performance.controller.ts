import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import {
  createPerformanceSchema,
  updatePerformanceSchema,
  saveSeatMapPayloadSchema,
  type CreatePerformanceInput,
  type UpdatePerformanceInput,
  type SaveSeatMapPayloadInput,
} from '@grabit/shared';
import { AdminService } from './admin.service.js';
import { UploadService } from './upload.service.js';
import { PerformanceService } from '../performance/performance.service.js';

@Controller('admin')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminPerformanceController {
  constructor(
    private readonly adminService: AdminService,
    private readonly uploadService: UploadService,
    private readonly performanceService: PerformanceService,
  ) {}

  @Get('performances')
  async listPerformances(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.listPerformances({
      status,
      search,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
  }

  @Get('performances/:id')
  async getPerformance(@Param('id') id: string) {
    return this.performanceService.findById(id);
  }

  @Post('performances')
  async createPerformance(
    @Body(new ZodValidationPipe(createPerformanceSchema)) body: CreatePerformanceInput,
  ) {
    return this.adminService.createPerformance(body);
  }

  @Put('performances/:id')
  async updatePerformance(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updatePerformanceSchema)) body: UpdatePerformanceInput,
  ) {
    return this.adminService.updatePerformance(id, body);
  }

  @Delete('performances/:id')
  async deletePerformance(@Param('id') id: string) {
    await this.adminService.deletePerformance(id);
    return { message: '공연이 삭제되었습니다' };
  }

  @Post('performances/:id/seat-map')
  async saveSeatMap(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(saveSeatMapPayloadSchema))
    body: SaveSeatMapPayloadInput,
  ) {
    return this.adminService.saveSeatMap(id, body);
  }

  @Post('upload/presigned')
  async getPresignedUrl(
    @Body() body: { folder: string; contentType: string; extension: string },
  ) {
    return this.uploadService.generatePresignedUrl(
      body.folder,
      body.contentType,
      body.extension,
    );
  }

}
