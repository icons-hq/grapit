import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator.js';
import { RedisHealthIndicator } from './redis.health.indicator.js';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly redisIndicator: RedisHealthIndicator,
  ) {}

  /** Valkey reachability (PING); the API startup probe and smoke checks. */
  @Public()
  @SkipThrottle()
  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.redisIndicator.isHealthy('redis'),
    ]);
  }

  /**
   * The API liveness probe. No dependency I/O: it fails only while a Valkey
   * client is stuck in the terminal `end` state, which only a restart fixes.
   * A Valkey or database outage keeps it up.
   */
  @Public()
  @SkipThrottle()
  @Get('live')
  @HealthCheck()
  live() {
    return this.health.check([
      () => this.redisIndicator.isLive('redis'),
    ]);
  }
}
