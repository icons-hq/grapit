import { Module } from '@nestjs/common';
import { PgBossShutdownService } from './pgboss-shutdown.service.js';
import { pgbossProvider } from './pgboss.provider.js';

@Module({
  providers: [pgbossProvider, PgBossShutdownService],
  exports: [pgbossProvider],
})
export class PgbossModule {}
