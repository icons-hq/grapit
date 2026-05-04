import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';
import type IORedis from 'ioredis';

import {
  getRedisRuntimeMetadata,
  REDIS_CLIENT,
} from '../modules/booking/providers/redis.provider.js';

const REDIS_URL_PATTERN = /\brediss?:\/\/[^\s`'")]+/gi;
const AUTH_HEADER_PATTERN = /\bAuthorization:\s*Bearer\s+[^\s`'")]+/gi;
const COOKIE_HEADER_PATTERN = /\bCookie:\s*[^`\n\r]+/gi;
const JWT_LABEL_PATTERN = /\bJWT:\s*[^\s`'")]+/gi;
const JWT_VALUE_PATTERN = /[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;

function sanitizeHealthMessage(message: string): string {
  return message
    .replace(REDIS_URL_PATTERN, '[redacted redis url]')
    .replace(AUTH_HEADER_PATTERN, '[redacted authorization header]')
    .replace(COOKIE_HEADER_PATTERN, '[redacted cookie header]')
    .replace(JWT_LABEL_PATTERN, '[redacted jwt]')
    .replace(JWT_VALUE_PATTERN, '[jwt:redacted]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[redacted host]')
    .replace(/\+\d{6,15}\b/g, '[redacted phone]')
    .replace(/\b(paymentKey|orderId|token|secret)=\S+/gi, '$1=[redacted]');
}

/**
 * Custom Terminus health indicator for Valkey/Redis.
 *
 * Calls `redis.ping()` and reports up/down via HealthIndicatorService.check(key).
 *
 * Why this exists: Cloud Run's liveness probe hits /api/v1/health. Without a
 * Redis check, a degraded connection (e.g. VPC PSC endpoint lost, Memorystore
 * instance paused, network flap) leaves the API reporting healthy while seat
 * locking silently fails. Per 07-REVIEWS.md MEDIUM consensus #7 and Cloud Run
 * startup probe best practice.
 *
 * Terminus 11.1 API: we inject HealthIndicatorService and call
 * `service.check(key).up()` / `.down(data)`. The old `HealthIndicator` base
 * class pattern is deprecated in Terminus 11.
 */
@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    @Inject(REDIS_CLIENT) private readonly redis: IORedis,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    const maybeRedis = this.redis as { ping?: () => Promise<string> | string };
    const metadata = getRedisRuntimeMetadata(this.redis);

    if (typeof maybeRedis.ping !== 'function') {
      if (metadata.client !== 'in-memory' || metadata.configured !== false) {
        return indicator.down({
          ...metadata,
          message: 'redis ping unavailable',
        });
      }

      return indicator.up({
        ...metadata,
        message: 'ping unavailable; assuming local in-memory Redis mock',
      });
    }

    try {
      const pong = await maybeRedis.ping();
      if (pong !== 'PONG') {
        return indicator.down({
          ...metadata,
          message: sanitizeHealthMessage(`unexpected ping response: ${String(pong)}`),
        });
      }
      return indicator.up({ ...metadata });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return indicator.down({
        ...metadata,
        message: sanitizeHealthMessage(message),
      });
    }
  }
}
