import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrewarmController } from './prewarm.controller.js';
import { PrewarmService } from './prewarm.service.js';

@Module({
  imports: [ConfigModule],
  controllers: [PrewarmController],
  providers: [PrewarmService],
  exports: [PrewarmService],
})
export class PrewarmModule {}
