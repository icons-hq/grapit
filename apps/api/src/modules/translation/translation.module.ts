import { Module } from '@nestjs/common';
import { DeepLClient } from './deepl.client.js';
import { TranslationController } from './translation.controller.js';
import { TranslationService } from './translation.service.js';

@Module({
  controllers: [TranslationController],
  providers: [DeepLClient, TranslationService],
  exports: [TranslationService],
})
export class TranslationModule {}
