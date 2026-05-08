import { Module } from '@nestjs/common';
import { TrafficDefenseService } from './traffic-defense.service.js';

@Module({
  providers: [TrafficDefenseService],
  exports: [TrafficDefenseService],
})
export class TrafficModule {}
