import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';

/**
 * Throttler increment script whose blocked requests are not counted.
 *
 * Same keys, arguments and return shape as @nest-lab/throttler-storage-redis
 * 1.2.0. The difference: a request that arrives while the bucket is blocked
 * is rejected before `INCR`. The stock script counts it first, so rejected
 * requests fill the next window while a block runs, and when the block ends
 * that window is already over the limit and blocks again at once. After one
 * fill, a few rejected requests per window would then renew the block
 * indefinitely: a shared bucket such as every user behind a NAT, or one
 * address's mail budget. Here each window that follows a block grants `limit`
 * requests again, which is also how @nestjs/throttler's in-memory storage
 * (dev, HTTP specs) behaves. Refilling an address's mail budget therefore
 * takes requests the route accepts, and those mail the owner
 * (`ThrottleEmailBody`).
 */
export const BLOCK_AWARE_THROTTLE_SCRIPT = `
  local hitKey = KEYS[1]
  local blockKey = KEYS[2]
  local ttl = tonumber(ARGV[2])
  local limit = tonumber(ARGV[3])
  local blockDuration = tonumber(ARGV[4])

  local timeToBlockExpire = redis.call('PTTL', blockKey)
  if timeToBlockExpire > 0 then
    local blockedHits = tonumber(redis.call('GET', hitKey) or '0')
    local blockedExpire = redis.call('PTTL', hitKey)
    if blockedExpire < 0 then
      blockedExpire = 0
    end
    return { blockedHits, blockedExpire, 1, timeToBlockExpire }
  end

  local totalHits = redis.call('INCR', hitKey)
  local timeToExpire = redis.call('PTTL', hitKey)
  if timeToExpire <= 0 then
    redis.call('PEXPIRE', hitKey, ttl)
    timeToExpire = ttl
  end

  if totalHits > limit then
    redis.call('SET', blockKey, 1, 'PX', blockDuration)
    return { totalHits, timeToExpire, 1, blockDuration }
  end

  return { totalHits, timeToExpire, 0, 0 }
`
  .replace(/^\s+/gm, '')
  .trim();

/**
 * Production throttler storage (Redis/Valkey). Only the script changes; key
 * names and their `{...}` hash tags stay the library's, so Valkey cluster
 * slot routing and the `increment` contract are unchanged.
 */
export class BlockAwareThrottlerStorageRedisService extends ThrottlerStorageRedisService {
  override getScriptSrc(): string {
    return BLOCK_AWARE_THROTTLE_SCRIPT;
  }
}
