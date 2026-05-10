import { Module } from '@nestjs/common';
import { pgbossProvider } from './pgboss.provider.js';

@Module({
  providers: [pgbossProvider],
  exports: [pgbossProvider],
})
export class PgbossModule {}
