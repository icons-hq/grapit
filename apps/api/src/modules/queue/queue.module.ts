import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from '../booking/providers/redis.module.js';
import { AdmissionGuard } from './guards/admission.guard.js';
import { QueueController } from './queue.controller.js';
import { QueueGateway } from './queue.gateway.js';
import { QueueService } from './queue.service.js';

@Global()
@Module({
  imports: [ConfigModule, RedisModule],
  controllers: [QueueController],
  providers: [
    QueueService,
    QueueGateway,
    AdmissionGuard,
  ],
  exports: [QueueService, QueueGateway, AdmissionGuard],
})
export class QueueModule {}
