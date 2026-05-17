import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  NotFoundException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import {
  performanceQuerySchema,
  type PerformanceQuery,
} from './dto/performance.dto.js';
import { PerformanceService } from './performance.service.js';

@Public()
@SkipThrottle()
@Controller()
export class PerformanceController {
  constructor(private readonly performanceService: PerformanceService) {}

  @Get('performances')
  async listPerformances(
    @Query(new ZodValidationPipe(performanceQuerySchema)) query: PerformanceQuery,
  ) {
    const genre = query.genre ?? 'artist_celebrity';
    return this.performanceService.findByGenre(genre, query);
  }

  @Get('performances/:id')
  async getPerformance(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(performanceQuerySchema)) query?: PerformanceQuery,
  ) {
    if (!isUuid(id)) {
      throw new BadRequestException('올바른 공연 ID가 아닙니다');
    }

    const result = await this.performanceService.findById(id, query?.locale);
    if (!result) {
      throw new NotFoundException('공연을 찾을 수 없습니다');
    }
    return result;
  }

  @Get('home/banners')
  async getHomeBanners() {
    return this.performanceService.getHomeBanners();
  }

  @Get('home/hot')
  async getHotPerformances(
    @Query(new ZodValidationPipe(performanceQuerySchema)) query?: PerformanceQuery,
  ) {
    return this.performanceService.getHotPerformances(query?.locale);
  }

  @Get('home/new')
  async getNewPerformances(
    @Query(new ZodValidationPipe(performanceQuerySchema)) query?: PerformanceQuery,
  ) {
    return this.performanceService.getNewPerformances(query?.locale);
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
