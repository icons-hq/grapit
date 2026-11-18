import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type IORedis from 'ioredis';

export const SENS_OTP_TTL_MS = 600_000;
export const SENS_SEND_LEASE_MS = 30_000;
const CHECK_WINDOW_MS = 900_000;
const MAX_CHECKS = 10;

export function sensOtpKeys(e164: string) {
  if (!/^\+86\d{6,12}$/.test(e164)) throw new Error('[sms] Invalid China OTP key');
  const prefix = '{sms:' + e164 + '}:';
  return {
    active: prefix + 'sens:active',
    candidate: prefix + 'sens:candidate',
    lease: prefix + 'sens:send-lease',
    checks: prefix + 'sens:checks',
    twilioPending: prefix + 'pending',
    verified: prefix + 'verified',
  };
}

export class SensOtpWaitError extends Error {
  constructor(readonly retryAfterMs: number, readonly reason: 'switch' | 'sending' | 'checks' | 'pending') {
    super('China OTP wait: ' + reason);
    this.name = 'SensOtpWaitError';
  }
}

export interface PreparedSensOtp {
  /** Ephemeral transport input: never persist or log this object/code. */
  code: string;
  record: string;
  nonce: string;
}

// A live Twilio code stays verifiable during cutover. These checks and the
// inverse guard in TWILIO_CHINA_PENDING_LUA are atomic on the same hash slot.
export const PREPARE_SENS_OTP_LUA = `
if redis.call('EXISTS', KEYS[1]) == 1 then
  return {'switch', math.max(1000, redis.call('PTTL', KEYS[1]))}
end
if redis.call('EXISTS', KEYS[4]) == 1 then
  return {'sending', math.max(1000, redis.call('PTTL', KEYS[4]))}
end
-- A previous request has no definitive acknowledgement. Keep its code usable
-- and do not risk a second billable send until it is consumed or expires.
if redis.call('EXISTS', KEYS[3]) == 1 then
  return {'pending', math.max(1000, redis.call('PTTL', KEYS[3]))}
end
if tonumber(redis.call('GET', KEYS[5]) or '0') >= tonumber(ARGV[5]) then
  return {'checks', math.max(1000, redis.call('PTTL', KEYS[5]))}
end
redis.call('SET', KEYS[4], ARGV[1], 'PX', ARGV[3])
redis.call('SET', KEYS[3], ARGV[2], 'PX', ARGV[4])
return {'ready', 0}
`;

export const COMMIT_SENS_OTP_LUA = `
if redis.call('GET', KEYS[3]) ~= ARGV[1] then return 0 end
if redis.call('GET', KEYS[2]) ~= ARGV[2] then return 0 end
local ttl = redis.call('PTTL', KEYS[2])
if ttl <= 0 then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'PX', ttl)
redis.call('DEL', KEYS[2])
return 1
`;

export const FINISH_SENS_SEND_LUA = `
if ARGV[3] == 'rejected' and redis.call('GET', KEYS[1]) == ARGV[2] then
  redis.call('DEL', KEYS[1])
end
if redis.call('GET', KEYS[2]) == ARGV[1] then redis.call('DEL', KEYS[2]) end
return 1
`;

export const VERIFY_SENS_OTP_LUA = `
local active = redis.call('GET', KEYS[1])
local candidate = redis.call('GET', KEYS[2])
if active == false and candidate == false then return {'expired', 0} end
local count = redis.call('INCR', KEYS[3])
if count == 1 then redis.call('PEXPIRE', KEYS[3], ARGV[3]) end
if count > tonumber(ARGV[2]) then
  return {'checks', math.max(1000, redis.call('PTTL', KEYS[3]))}
end
if ARGV[1] ~= '' and (active == ARGV[1] or candidate == ARGV[1]) then
  redis.call('DEL', KEYS[1], KEYS[2])
  redis.call('SET', KEYS[4], '1', 'PX', ARGV[4])
  return {'verified', 0}
end
return {'wrong', 0}
`;

export const TWILIO_CHINA_PENDING_LUA = `
local wait = 0
for i = 2, 4 do
  if redis.call('EXISTS', KEYS[i]) == 1 then
    wait = math.max(wait, math.max(1000, redis.call('PTTL', KEYS[i])))
  end
end
if wait > 0 then return {'switch', wait} end
local existed = redis.call('EXISTS', KEYS[1])
redis.call('SET', KEYS[1], '1', 'PX', ARGV[1])
return 1 - existed
`;

/**
 * Local OTP state for the send-only SENS transport. No plaintext code is stored:
 * HMAC includes a random challenge nonce and phone so a Redis snapshot cannot
 * brute-force six digits without the server secret. A prepared candidate is
 * persisted BEFORE sending; a received code can be checked even if the HTTP
 * acknowledgement/commit is lost. Failed resends preserve the previous code.
 */
export class SensOtpStore {
  constructor(private readonly redis: Pick<IORedis, 'eval' | 'mget'>, private readonly secret: string) {}

  private digest(e164: string, nonce: string, code: string): string {
    return createHmac('sha256', this.secret)
      .update('grabit:sens-otp:v1\0' + e164 + '\0' + nonce + '\0' + code)
      .digest('hex');
  }

  async prepare(e164: string): Promise<PreparedSensOtp> {
    const keys = sensOtpKeys(e164);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const nonce = randomBytes(16).toString('hex');
    const record = JSON.stringify({ v: 1, nonce, digest: this.digest(e164, nonce, code) });
    const [status, delay] = await this.redis.eval(
      PREPARE_SENS_OTP_LUA, 5,
      keys.twilioPending, keys.active, keys.candidate, keys.lease, keys.checks,
      nonce, record, SENS_SEND_LEASE_MS, SENS_OTP_TTL_MS, MAX_CHECKS,
    ) as [string, number];
    if (status !== 'ready') {
      if (status !== 'switch' && status !== 'sending' && status !== 'checks' && status !== 'pending') {
        throw new Error('[sms] Unexpected SENS prepare result');
      }
      throw new SensOtpWaitError(delay, status);
    }
    return { code, nonce, record };
  }

  async commit(e164: string, prepared: PreparedSensOtp): Promise<void> {
    const keys = sensOtpKeys(e164);
    // A code may already have been consumed while the provider was in flight.
    // CAS prevents its delayed acknowledgement from resurrecting it.
    await this.redis.eval(COMMIT_SENS_OTP_LUA, 3,
      keys.active, keys.candidate, keys.lease, prepared.nonce, prepared.record);
  }

  async finish(e164: string, prepared: PreparedSensOtp, rejected: boolean): Promise<void> {
    const keys = sensOtpKeys(e164);
    await this.redis.eval(FINISH_SENS_SEND_LUA, 2, keys.candidate, keys.lease,
      prepared.nonce, prepared.record, rejected ? 'rejected' : 'keep');
  }

  /** null means no SENS challenge; the caller may still check a live Twilio code. */
  async verify(e164: string, code: string): Promise<'verified' | 'wrong' | 'expired' | null> {
    const keys = sensOtpKeys(e164);
    const records = await this.redis.mget(keys.active, keys.candidate);
    if (!records.some(Boolean)) return null;
    let matchingRecord = '';
    for (const raw of records) {
      if (!raw) continue;
      // Malformed state fails closed; never silently switches to Twilio.
      const record = JSON.parse(raw) as { v: number; nonce: string; digest: string };
      if (record.v !== 1 || !/^[a-f0-9]{32}$/.test(record.nonce)
        || !/^[a-f0-9]{64}$/.test(record.digest)) {
        throw new Error('[sms] Invalid SENS OTP state');
      }
      if (timingSafeEqual(Buffer.from(this.digest(e164, record.nonce, code), 'hex'),
        Buffer.from(record.digest, 'hex'))) matchingRecord = raw;
    }
    const [status, delay] = await this.redis.eval(VERIFY_SENS_OTP_LUA, 4,
      keys.active, keys.candidate, keys.checks, keys.verified,
      matchingRecord, MAX_CHECKS, CHECK_WINDOW_MS, SENS_OTP_TTL_MS,
    ) as [string, number];
    if (status === 'checks') throw new SensOtpWaitError(delay, 'checks');
    if (status !== 'verified' && status !== 'wrong' && status !== 'expired') {
      throw new Error('[sms] Unexpected SENS verify result');
    }
    return status;
  }
}
