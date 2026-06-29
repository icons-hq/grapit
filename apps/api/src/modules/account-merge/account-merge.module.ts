import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { DrizzleModule } from '../../database/drizzle.module.js';
import { AccountMergeService } from './account-merge.service.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '../../.env',
    }),
    DrizzleModule,
  ],
  providers: [AccountMergeService],
  exports: [AccountMergeService],
})
export class AccountMergeModule {}
