import { registerAs } from '@nestjs/config';

export const redisConfig = registerAs('redis', () => ({
  url: process.env['REDIS_URL'] ?? '',
  mode: process.env['VALKEY_MODE'] ?? '',
}));
