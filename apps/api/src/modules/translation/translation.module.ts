import { Module } from '@nestjs/common';
import { TranslationController } from './translation.controller.js';
import { TranslationService } from './translation.service.js';

@Module({
  controllers: [TranslationController],
  providers: [TranslationService],
  exports: [TranslationService],
})
export class TranslationModule {}
