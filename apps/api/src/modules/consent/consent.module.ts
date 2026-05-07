import { Module } from '@nestjs/common';
import { ConsentAuditController } from './consent-audit.controller.js';
import { ConsentController } from './consent.controller.js';
import { ConsentService } from './consent.service.js';

@Module({
  controllers: [ConsentController, ConsentAuditController],
  providers: [ConsentService],
  exports: [ConsentService],
})
export class ConsentModule {}
