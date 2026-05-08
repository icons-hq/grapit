import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { redisProvider } from '../booking/providers/redis.provider.js';
import { AdmissionGuard } from './guards/admission.guard.js';
import { QueueController } from './queue.controller.js';
import { QueueGateway } from './queue.gateway.js';
import { QueueService } from './queue.service.js';

@Global()
@Module({
  imports: [ConfigModule],
  controllers: [QueueController],
  providers: [
    QueueService,
    QueueGateway,
    AdmissionGuard,
    redisProvider,
  ],
  exports: [QueueService, QueueGateway, AdmissionGuard],
})
export class QueueModule {}
