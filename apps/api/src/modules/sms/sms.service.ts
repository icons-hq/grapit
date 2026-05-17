import {
  Inject, Injectable, BadRequestException, GoneException, HttpException,
  HttpStatus, Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type IORedis from 'ioredis';
import { REDIS_CLIENT } from '../booking/providers/redis.provider.js';
import {
  TwilioVerifyApiError,
  TwilioVerifyClient,
} from './twilio-verify-client.js';
import {
  getE164Country,
  parseE164,
} from './phone.util.js';

// Phase 10 constants (retained)
const SMS_LOCAL_RATE_LIMITS_ENABLED = false; // Hotfix 260517: unblock signup; provider limits still apply.
const RESEND_COOLDOWN_MS = 30_000;           // D-11: 30s resend cooldown
const SEND_PHONE_LIMIT = 5;                  // D-06: phone 5/3600s
const SEND_PHONE_WINDOW_SEC = 3600;          // D-06: 1h window
const VERIFY_PHONE_LIMIT = 10;               // D-07: phone 10/900s
const VERIFY_PHONE_WINDOW_SEC = 900;         // D-07: 15min window

const VERIFIED_FLAG_TTL_SEC = 600;           // verified flag 10min for signup re-check
const PHONE_VERIFICATION_TOKEN_TTL_MS = VERIFIED_FLAG_TTL_SEC * 1000;
export const SMS_VERIFICATION_PURPOSES = [
  'signup',
  'social_registration',
  'profile_phone_change',
] as const;
export type SmsVerificationPurpose = (typeof SMS_VERIFICATION_PURPOSES)[number];

/**
 * [Phase 10] Lua atomic INCR + conditional EXPIRE for phone axis rate-limit counters.
 * First INCR (result==1) sets TTL. Already-existing keys are incremented only.
 * Prevents zombie keys on process crash.
 * Returns: current count (number).
 */
const ATOMIC_INCR_LUA = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
return count
`;

/**
 * [Phase 10.1 / hash-tag 적용 Phase 14] Atomic OTP verify + attempt counter + verified flag.
 * KEYS:
 *   [1] {sms:{e164}}:otp        — 6-digit OTP body (TTL 180s)
 *   [2] {sms:{e164}}:attempts   — wrong-attempt counter (TTL 900s on first INCR)
 *   [3] {sms:{e164}}:verified   — verified flag (SETEX on VERIFIED, TTL 600s)
 * ARGV:
 *   [1] user-provided code (6 digits)
 *   [2] max attempts (e.g. '5')
 *   [3] verified flag TTL seconds (e.g. '600')
 * Returns: [result_string, number]
 *   {'VERIFIED', attempts}        -- correct. otp/attempts DEL, verified SETEX.
 *   {'WRONG', remaining}          -- wrong. attempts INCR(+EXPIRE if first).
 *   {'EXPIRED', 0}                -- otp expired/missing.
 *   {'NO_MORE_ATTEMPTS', 0}       -- exceeded. otp/attempts DEL.
 *
 * Hash tag `{sms:{e164}}` ensures all 3 keys hash to the same Redis Cluster slot.
 */
export const VERIFY_AND_INCREMENT_LUA = `
local stored = redis.call('GET', KEYS[1])
if stored == false then
  return {'EXPIRED', 0}
end

local attempts = redis.call('INCR', KEYS[2])
if attempts == 1 then
  redis.call('EXPIRE', KEYS[2], 900)
end

local max = tonumber(ARGV[2])
if attempts > max then
  redis.call('DEL', KEYS[1], KEYS[2])
  return {'NO_MORE_ATTEMPTS', 0}
end

if stored == ARGV[1] then
  redis.call('DEL', KEYS[1], KEYS[2])
  redis.call('SETEX', KEYS[3], tonumber(ARGV[3]), '1')
  return {'VERIFIED', attempts}
end

return {'WRONG', max - attempts}
`;

// [Phase 14 / D-01 D-02 D-13] Hash-tag keyed SMS storage keys.
// All keys MUST share the `{sms:${e164}}` hash tag so CRC16 maps them
// to the same Redis Cluster slot — otherwise `VERIFY_AND_INCREMENT_LUA`
// (multi-key EVAL) raises `CROSSSLOT Keys in request don't hash to the same slot`
// on cluster-mode Valkey / Memorystore. Pattern lifted from
// booking.service.ts (commit b382e39).
//
// [Phase 14 / WR-01] Counter/cooldown siblings (resend, send-count,
// verify-count) were historically un-hash-tagged because each is only ever
// touched by single-key commands (SET/DECR/Lua EVAL with a single KEY/DEL/
// PTTL). That is safe today, but leaves the cluster invariant visibly split
// (`{sms:...}:otp` vs. `sms:phone:send:...`) and means the rollback path
// (`Promise.allSettled([DEL cooldown, DECR counter])`) would immediately
// resurrect CROSSSLOT if a future change pipelines it with the OTP keys or
// wraps it in a MULTI/EXEC. Unifying every per-phone SMS key under the same
// hash tag makes the contract uniform and future-proof.
//
// NOTE: changing key names is a deploy-time counter reset; old keys expire
// naturally via TTL (cooldown 30s, send-count 1h, verify-count 15m).
//
// [Phase 14 / WR-02] Defend the hash-tag contract at the boundary: every
// builder asserts ITU-T E.164 (`/^\+\d{6,15}$/`) on its input. Redis Cluster
// uses only the content between the first `{` and the next `}` for slot
// mapping, so a payload like `}x:"+"+821012345678` would split the tag and
// silently resurrect CROSSSLOT. parseE164() already strips `{`/`}` during
// digit normalization and then re-validates via libphonenumber, so its
// output is always bare E.164. Formalizing the invariant at each builder
// means any caller that forgets to route through parseE164() fails fast
// instead of corrupting cluster placement.
const E164_RE = /^\+\d{6,15}$/;
function assertE164(s: string): void {
  if (!E164_RE.test(s)) {
    // Mask all but first 4 chars (country code prefix) to keep PII out of
    // error messages / Sentry. `+82` + 1 digit is enough to triage KR
    // vs. foreign without leaking the subscriber number.
    throw new Error(`[sms] non-E164 key input: ${s.slice(0, 4)}***`);
  }
}
export const smsOtpKey           = (e164: string): string => { assertE164(e164); return `{sms:${e164}}:otp`; };
export const smsAttemptsKey      = (e164: string): string => { assertE164(e164); return `{sms:${e164}}:attempts`; };
export const smsVerifiedKey      = (e164: string): string => { assertE164(e164); return `{sms:${e164}}:verified`; };
export const smsResendKey        = (e164: string): string => { assertE164(e164); return `{sms:${e164}}:resend`; };
export const smsSendCounterKey   = (e164: string): string => { assertE164(e164); return `{sms:${e164}}:send-count`; };
export const smsVerifyCounterKey = (e164: string): string => { assertE164(e164); return `{sms:${e164}}:verify-count`; };

export interface SendResult { success: boolean; message: string }
export interface VerifyResult {
  verified: boolean;
  message?: string;
  verificationToken?: string;
}

interface PhoneVerificationTokenPayload {
  v: 1;
  phone: string;
  purpose: SmsVerificationPurpose;
  exp: number;
  nonce: string;
}

const PHONE_VALIDATION_MESSAGE = '올바른 휴대폰 번호를 입력해주세요';
const SMS_CAPABLE_PHONE_MESSAGE = 'SMS를 받을 수 있는 휴대폰 번호를 입력해주세요';

function parseE164OrBadRequest(phone: string): string {
  try {
    return parseE164(phone);
  } catch (err) {
    if (err instanceof Error && err.message === PHONE_VALIDATION_MESSAGE) {
      throw new BadRequestException(PHONE_VALIDATION_MESSAGE);
    }
    throw err;
  }
}

function maskE164ForLog(e164: string): string {
  if (e164.length <= 6) return `${e164.slice(0, 3)}***`;
  return `${e164.slice(0, 4)}${'*'.repeat(Math.max(3, e164.length - 6))}${e164.slice(-2)}`;
}

function mapTwilioSendFailure(err: TwilioVerifyApiError): BadRequestException {
  if (err.isUnsupportedLandline) {
    return new BadRequestException(SMS_CAPABLE_PHONE_MESSAGE);
  }
  if (err.isInvalidRecipient) {
    return new BadRequestException(PHONE_VALIDATION_MESSAGE);
  }
  return new BadRequestException('인증번호 발송에 실패했습니다. 잠시 후 다시 시도해주세요.');
}

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly client: TwilioVerifyClient | null;
  private readonly isDevMock: boolean;
  private readonly verificationTokenSecret: string;

  constructor(
    configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: IORedis,
  ) {
    const accountSid = configService.get<string>('TWILIO_ACCOUNT_SID')?.trim() ?? '';
    const authToken = configService.get<string>('TWILIO_AUTH_TOKEN')?.trim() ?? '';
    const apiKeySid = configService.get<string>('TWILIO_API_KEY_SID')?.trim() ?? '';
    const apiKeySecret =
      configService.get<string>('TWILIO_API_KEY_SECRET')?.trim() ?? '';
    const verifyServiceSid =
      configService.get<string>('TWILIO_VERIFY_SERVICE_SID')?.trim() ?? '';
    const verifyLocale =
      configService.get<string>('TWILIO_VERIFY_LOCALE')?.trim() || undefined;
    const isProduction = process.env['NODE_ENV'] === 'production';
    const verificationTokenSecret =
      configService.get<string>('SMS_VERIFICATION_TOKEN_SECRET')?.trim() ??
      configService.get<string>('JWT_SECRET')?.trim() ??
      configService.get<string>('auth.jwtSecret')?.trim() ??
      '';

    const hasApiKeyCredentials = Boolean(apiKeySid && apiKeySecret);
    const hasAuthTokenCredentials = Boolean(authToken);
    const missing = [
      !accountSid && 'TWILIO_ACCOUNT_SID',
      !verifyServiceSid && 'TWILIO_VERIFY_SERVICE_SID',
      !hasAuthTokenCredentials &&
        !hasApiKeyCredentials &&
        'TWILIO_AUTH_TOKEN or TWILIO_API_KEY_SID/TWILIO_API_KEY_SECRET',
      apiKeySid && !apiKeySecret && 'TWILIO_API_KEY_SECRET',
      apiKeySecret && !apiKeySid && 'TWILIO_API_KEY_SID',
    ].filter(Boolean) as string[];

    if (isProduction && missing.length > 0) {
      throw new Error(
        `[sms] ${missing.join(', ')} required in production. Silent dev mock disabled.`,
      );
    }

    if (isProduction && !verificationTokenSecret) {
      throw new Error(
        '[sms] SMS_VERIFICATION_TOKEN_SECRET or JWT_SECRET required in production.',
      );
    }

    this.isDevMock = !isProduction && missing.length > 0;
    this.client = this.isDevMock
      ? null
      : new TwilioVerifyClient(
          hasApiKeyCredentials
            ? { accountSid, apiKeySid, apiKeySecret }
            : { accountSid, authToken },
          verifyServiceSid,
          verifyLocale,
        );
    this.verificationTokenSecret =
      verificationTokenSecret || 'dev-sms-verification-token-secret';

    if (this.isDevMock) {
      this.logger.warn({ event: 'sms.credential_missing', mode: 'dev_mock' });
    }
  }

  /**
   * [Phase 10] Atomic INCR + conditional EXPIRE via Lua.
   * Returns current count.
   */
  private async atomicIncr(key: string, windowSec: number): Promise<number> {
    return (await this.redis.eval(
      ATOMIC_INCR_LUA, 1, key, windowSec,
    )) as number;
  }

  async sendVerificationCode(phone: string): Promise<SendResult> {
    const e164 = parseE164OrBadRequest(phone);
    const country = getE164Country(e164) ?? 'unknown';

    // Dev mock -- cooldown/counter/Twilio all skipped
    if (this.isDevMock) {
      this.logger.log({ event: 'sms.sent', mode: 'dev_mock', phone: e164 });
      return { success: true, message: '인증번호가 발송되었습니다' };
    }

    let cooldownKey: string | undefined;
    let sendCounterKey: string | undefined;

    if (SMS_LOCAL_RATE_LIMITS_ENABLED) {
      // D-11: 30s resend cooldown via Valkey SET NX
      cooldownKey = smsResendKey(e164);
      const acquired = await this.redis.set(cooldownKey, '1', 'PX', RESEND_COOLDOWN_MS, 'NX');
      if (acquired === null) {
        const ttl = await this.redis.pttl(cooldownKey);
        this.logger.warn({ event: 'sms.rate_limited', phone: e164, layer: 'resend_cooldown' });
        throw new HttpException(
          { statusCode: 429, message: '잠시 후 다시 시도해주세요', retryAfterMs: Math.max(ttl, 0) },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      // D-06: phone axis send 5/3600s -- Lua atomic INCR+EXPIRE
      sendCounterKey = smsSendCounterKey(e164);
      const sendCount = await this.atomicIncr(
        sendCounterKey, SEND_PHONE_WINDOW_SEC,
      );
      if (sendCount > SEND_PHONE_LIMIT) {
        this.logger.warn({
          event: 'sms.rate_limited', phone: e164, layer: 'phone_axis_send', count: sendCount,
        });
        throw new HttpException(
          { statusCode: 429, message: '잠시 후 다시 시도해주세요', retryAfterMs: SEND_PHONE_WINDOW_SEC * 1000 },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    try {
      const sent = await this.client!.sendVerification(e164);
      this.logger.log({
        event: 'sms.sent',
        phone: e164,
        country,
        providerStatus: sent.status,
        providerChannel: sent.channel,
        verificationSid: sent.sid,
      });
      return { success: true, message: '인증번호가 발송되었습니다' };
    } catch (err) {
      // [Phase 10 review + Issue 2] Rollback policy
      // Twilio 5xx/429/timeout/network -> user didn't receive SMS -> release BOTH the
      //   30s cooldown AND the phone-axis hourly send slot. Otherwise a
      //   transient provider outage would burn the user's 5/hour quota
      //   without delivering anything (Issue 2 from PR #16 review).
      // Twilio permanent 4xx -> keep both cooldown and counter (abuse mitigation).
      const shouldRollback =
        !(err instanceof TwilioVerifyApiError) || err.shouldRollbackQuota;
      if (shouldRollback && SMS_LOCAL_RATE_LIMITS_ENABLED && cooldownKey && sendCounterKey) {
        // [WR-02] Emit per-op rollback failures so ops can detect stuck-quota
        // states. Silently swallowing `.catch(() => {})` meant a Valkey blip
        // during rollback could pin a user in the 30s cooldown or retain
        // their phone-axis slot with zero observability.
        const rollbackResults = await Promise.allSettled([
          this.redis.del(cooldownKey),
          this.redis.decr(sendCounterKey),
        ]);
        rollbackResults.forEach((r, i) => {
          if (r.status === 'rejected') {
            this.logger.warn({
              event: 'sms.rollback_failed',
              phone: e164,
              op: i === 0 ? 'cooldown_del' : 'counter_decr',
              err: (r.reason as Error).message,
            });
          }
        });
      }

      Sentry.withScope((scope) => {
        scope.setTag('provider', 'twilio_verify');
        scope.setTag('country', country);
        if (err instanceof TwilioVerifyApiError) {
          scope.setTag('http_status', String(err.status));
          if (err.code !== undefined) {
            scope.setTag('twilio_code', String(err.code));
          }
        }
        scope.setLevel('error');
        Sentry.captureException(err);
      });
      this.logger.error({
        event: 'sms.send_failed',
        phone: maskE164ForLog(e164),
        country,
        providerStatus: err instanceof TwilioVerifyApiError ? err.status : undefined,
        providerCode: err instanceof TwilioVerifyApiError ? err.code : undefined,
        err: (err as Error).message,
      });
      if (err instanceof TwilioVerifyApiError) {
        throw mapTwilioSendFailure(err);
      }
      throw new BadRequestException('인증번호 발송에 실패했습니다. 잠시 후 다시 시도해주세요.');
    }
  }

  /**
   * Verify a user-supplied OTP through Twilio Verify.
   *
   * SECURITY NOTE: `verifyCode` is NOT a standalone authentication primitive.
   * A `{ verified: true }` response means "this phone successfully verified an
   * OTP within the last 10 minutes" — it does NOT prove that the CURRENT
   * request originated from the device that completed the original send/verify
   * handshake. Consumers (signup, password-reset) MUST correlate the verify
   * response with the session/state that initiated `/send-code` (e.g. a
   * server-issued token bound to the phone at verify-time). Without such
   * correlation, anyone who knows a just-verified phone number can spoof the
   * "verified" signal.
   *
   * Additionally, the phone-axis verify counter (D-07 — 10/900s) is
   * incremented before the provider call so Twilio status differences cannot
   * be probed without consuming local verification quota.
   */
  async verifyCode(
    phone: string,
    code: string,
    purpose: SmsVerificationPurpose = 'signup',
  ): Promise<VerifyResult> {
    const e164 = parseE164OrBadRequest(phone);

    // Dev mock: 000000 universal
    if (this.isDevMock) {
      if (code === '000000') {
        this.logger.log({ event: 'sms.verified', mode: 'dev_mock', phone: e164 });
        return {
          verified: true,
          verificationToken: this.createPhoneVerificationToken(e164, purpose),
        };
      }
      return { verified: false, message: '인증번호가 일치하지 않습니다' };
    }

    const verifyCounterKey = smsVerifyCounterKey(e164);
    if (SMS_LOCAL_RATE_LIMITS_ENABLED) {
      // D-07 local phone-axis rate limit runs before the provider call.
      const verifyCount = await this.atomicIncr(
        verifyCounterKey, VERIFY_PHONE_WINDOW_SEC,
      );
      if (verifyCount > VERIFY_PHONE_LIMIT) {
        this.logger.warn({
          event: 'sms.rate_limited', phone: e164, layer: 'phone_axis_verify', count: verifyCount,
        });
        throw new HttpException(
          { statusCode: 429, message: '잠시 후 다시 시도해주세요', retryAfterMs: VERIFY_PHONE_WINDOW_SEC * 1000 },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    try {
      const result = await this.client!.checkVerification(e164, code);
      if (result.valid && result.status === 'approved') {
        await this.redis.set(
          smsVerifiedKey(e164),
          '1',
          'EX',
          VERIFIED_FLAG_TTL_SEC,
        );
        this.logger.log({
          event: 'sms.verified',
          phone: e164,
          providerStatus: result.status,
          verificationSid: result.sid,
        });
        return {
          verified: true,
          verificationToken: this.createPhoneVerificationToken(e164, purpose),
        };
      }

      this.logger.warn({
        event: 'sms.verify_wrong',
        phone: e164,
        providerStatus: result.status,
      });
      return { verified: false, message: '인증번호가 일치하지 않습니다' };
    } catch (err) {
      if (err instanceof GoneException) throw err;
      if (err instanceof TwilioVerifyApiError && err.isExpiredOrExhausted) {
        throw new GoneException('인증번호가 만료되었습니다. 재발송해주세요');
      }
      if (err instanceof TwilioVerifyApiError && err.isRateLimited) {
        if (SMS_LOCAL_RATE_LIMITS_ENABLED) {
          await this.redis
            .decr(verifyCounterKey)
            .catch((rollbackErr: unknown) => {
              this.logger.warn({
                event: 'sms.rollback_failed',
                phone: e164,
                op: 'verify_counter_decr',
                err: (rollbackErr as Error).message,
              });
            });
        }
        throw new HttpException(
          { statusCode: 429, message: '잠시 후 다시 시도해주세요', retryAfterMs: VERIFY_PHONE_WINDOW_SEC * 1000 },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      // Transient Twilio/Valkey failure: the user got no verification
      // outcome, so release the verify slot that atomicIncr just consumed.
      // Mirrors the sendVerificationCode rollback policy for 5xx/network
      // failures. Without this, each Valkey blip burns one of the user's
      // 10/15min verify attempts without producing any result.
      if (SMS_LOCAL_RATE_LIMITS_ENABLED && (!(err instanceof TwilioVerifyApiError) || err.shouldRollbackQuota)) {
        await this.redis
          .decr(verifyCounterKey)
          .catch((rollbackErr: unknown) => {
            this.logger.warn({
              event: 'sms.rollback_failed',
              phone: e164,
              op: 'verify_counter_decr',
              err: (rollbackErr as Error).message,
            });
          });
      }
      // Provider failure etc. -- log + propagate as user-facing generic message
      Sentry.withScope((scope) => {
        scope.setTag('provider', 'twilio_verify');
        if (err instanceof TwilioVerifyApiError) {
          scope.setTag('http_status', String(err.status));
          if (err.code !== undefined) {
            scope.setTag('twilio_code', String(err.code));
          }
        }
        scope.setLevel('error');
        Sentry.captureException(err);
      });
      this.logger.error({ event: 'sms.verify_failed', phone: e164, err: (err as Error).message });
      return { verified: false, message: '인증번호 확인에 실패했습니다. 잠시 후 다시 시도해주세요.' };
    }
  }

  /**
   * [hotfix 260427-kch] Idempotency probe for downstream consumers.
   *
   * After a successful Twilio Verify check, the `{sms:{e164}}:verified` flag
   * (TTL 600s) is left behind so downstream consumers can probe "this phone
   * was verified within the last 10 min" without calling Twilio again.
   *
   * SECURITY: This is NOT an authentication primitive. Callers MUST only
   * consult this AFTER verifyCode() has thrown GoneException. Calling this
   * standalone (or wiring it to a controller) reintroduces the [CR-01]
   * impersonation primitive that was removed when the verify-flag
   * short-circuit was deleted from verifyCode itself.
   *
   * Returns false in dev-mock mode — the dev flow uses the '000000'
   * fast-path inside verifyCode and does not need this fallback.
   */
  async isPhoneVerified(phone: string): Promise<boolean> {
    if (this.isDevMock) return false;
    const e164 = parseE164OrBadRequest(phone);
    try {
      const flag = await this.redis.get(smsVerifiedKey(e164));
      return flag === '1';
    } catch (err) {
      // Fail closed: a Valkey blip should not let a request slip through
      // unverified. The caller will re-throw the original GoneException.
      this.logger.warn({
        event: 'sms.is_phone_verified_failed',
        phone: e164,
        err: (err as Error).message,
      });
      return false;
    }
  }

  verifyPhoneVerificationToken(
    token: string,
    options: { phone: string; purpose: SmsVerificationPurpose },
  ): void {
    const e164 = parseE164OrBadRequest(options.phone);
    const payload = this.parsePhoneVerificationToken(token);

    if (
      payload.phone !== e164 ||
      payload.purpose !== options.purpose ||
      payload.exp < Date.now()
    ) {
      throw new BadRequestException('전화번호 인증이 완료되지 않았습니다');
    }
  }

  private createPhoneVerificationToken(
    e164: string,
    purpose: SmsVerificationPurpose,
  ): string {
    const payload: PhoneVerificationTokenPayload = {
      v: 1,
      phone: e164,
      purpose,
      exp: Date.now() + PHONE_VERIFICATION_TOKEN_TTL_MS,
      nonce: randomBytes(16).toString('base64url'),
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString(
      'base64url',
    );
    return `${encodedPayload}.${this.signPhoneVerificationPayload(encodedPayload)}`;
  }

  private parsePhoneVerificationToken(token: string): PhoneVerificationTokenPayload {
    const [encodedPayload, signature] = token.split('.');
    if (!encodedPayload || !signature) {
      throw new BadRequestException('전화번호 인증이 완료되지 않았습니다');
    }

    const expectedSignature = this.signPhoneVerificationPayload(encodedPayload);
    const expected = Buffer.from(expectedSignature, 'utf8');
    const actual = Buffer.from(signature, 'utf8');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new BadRequestException('전화번호 인증이 완료되지 않았습니다');
    }

    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    } catch {
      throw new BadRequestException('전화번호 인증이 완료되지 않았습니다');
    }

    if (!this.isPhoneVerificationPayload(payload)) {
      throw new BadRequestException('전화번호 인증이 완료되지 않았습니다');
    }

    return payload;
  }

  private signPhoneVerificationPayload(encodedPayload: string): string {
    return createHmac('sha256', this.verificationTokenSecret)
      .update(encodedPayload)
      .digest('base64url');
  }

  private isPhoneVerificationPayload(
    payload: unknown,
  ): payload is PhoneVerificationTokenPayload {
    if (!payload || typeof payload !== 'object') return false;
    const candidate = payload as Partial<PhoneVerificationTokenPayload>;
    return (
      candidate.v === 1 &&
      typeof candidate.phone === 'string' &&
      SMS_VERIFICATION_PURPOSES.includes(candidate.purpose as SmsVerificationPurpose) &&
      typeof candidate.exp === 'number' &&
      typeof candidate.nonce === 'string'
    );
  }
}
