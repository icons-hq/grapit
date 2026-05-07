import {
  Inject, Injectable, BadRequestException, GoneException, HttpException,
  HttpStatus, Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type IORedis from 'ioredis';
import { REDIS_CLIENT } from '../booking/providers/redis.provider.js';
import { InfobipClient, InfobipApiError } from './infobip-client.js';
import { parseE164, isChinaMainland } from './phone.util.js';
import { formatSmsOtpMessage } from './sms-copy.js';

// Phase 10 constants (retained)
const RESEND_COOLDOWN_MS = 30_000;           // D-11: 30s resend cooldown
const SEND_PHONE_LIMIT = 5;                  // D-06: phone 5/3600s
const SEND_PHONE_WINDOW_SEC = 3600;          // D-06: 1h window
const VERIFY_PHONE_LIMIT = 10;               // D-07: phone 10/900s
const VERIFY_PHONE_WINDOW_SEC = 900;         // D-07: 15min window

// Phase 10.1 new constants
const OTP_TTL_MS = 180_000;                  // 3min -- matches message copy
const OTP_MAX_ATTEMPTS = 5;                  // replaces Infobip pinAttempts
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

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly client: InfobipClient | null;
  private readonly isDevMock: boolean;
  private readonly verificationTokenSecret: string;

  constructor(
    configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: IORedis,
  ) {
    // Phase 10.1: env 3 vars (APPLICATION_ID/MESSAGE_ID removed, SENDER added)
    const apiKey  = configService.get<string>('INFOBIP_API_KEY')?.trim()  ?? '';
    const baseUrl = configService.get<string>('INFOBIP_BASE_URL')?.trim() ?? '';
    const sender  = configService.get<string>('INFOBIP_SENDER')?.trim()   ?? '';
    const isProduction = process.env['NODE_ENV'] === 'production';
    const verificationTokenSecret =
      configService.get<string>('SMS_VERIFICATION_TOKEN_SECRET')?.trim() ??
      configService.get<string>('JWT_SECRET')?.trim() ??
      configService.get<string>('auth.jwtSecret')?.trim() ??
      '';

    const missing = [
      !apiKey  && 'INFOBIP_API_KEY',
      !baseUrl && 'INFOBIP_BASE_URL',
      !sender  && 'INFOBIP_SENDER',
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

    // [WR-03] In production, reject alphanumeric sender IDs. KR MNOs silently
    // rewrite non-numeric senders, which causes Infobip to return 4xx for every
    // send. Our rollback policy keeps the phone-axis counter on 4xx (abuse
    // mitigation), so a sender-ID typo like `INFOBIP_SENDER=Grabit` would
    // permanently drain every user's 5/hour quota with zero delivery.
    // KISA-registered numeric senders (landline or pre-approved short codes)
    // are typically 4-15 digits. If Grabit adds non-KR routes later, relax
    // this to "numeric OR <= 11 alphanumeric chars" per Infobip sender-ID docs.
    if (isProduction && sender && !/^[0-9]{4,15}$/.test(sender)) {
      // [WR-03] Always mask to first 2 chars + ***. Previous `length <= 3 ?
      // sender : ...` branch leaked the full value for 1-3 char inputs (the
      // error lands in Cloud Run stdout -> Cloud Logging). For values shorter
      // than 2 chars, emit only '***' since the prefix would be the entire
      // value.
      const masked = sender.length <= 2 ? '***' : `${sender.slice(0, 2)}***`;
      throw new Error(
        `[sms] INFOBIP_SENDER must be a KISA-registered numeric ID (got "${masked}"). ` +
          'Alphanumeric senders are silently rewritten by KR MNOs and cause every send ' +
          'to fail with Infobip 4xx, draining users\' hourly quotas.',
      );
    }

    this.isDevMock = !isProduction && missing.length > 0;
    this.client = this.isDevMock ? null : new InfobipClient(baseUrl, apiKey, sender);
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

  /**
   * [Phase 10.1] 6-digit OTP. node:crypto.randomInt (OWASP A02 -- CSPRNG).
   */
  private generateOtp(): string {
    return String(randomInt(100000, 1000000));
  }

  async sendVerificationCode(phone: string): Promise<SendResult> {
    const e164 = parseE164OrBadRequest(phone);

    // D-03: China mainland reject
    if (isChinaMainland(e164)) {
      throw new BadRequestException(
        '현재 중국 본토 SMS 인증은 지원되지 않습니다. 다른 국가 번호로 가입해 주세요',
      );
    }

    // Dev mock -- cooldown/counter/Infobip all skipped
    if (this.isDevMock) {
      this.logger.log({ event: 'sms.sent', mode: 'dev_mock', phone: e164 });
      return { success: true, message: '인증번호가 발송되었습니다' };
    }

    // D-11: 30s resend cooldown via Valkey SET NX
    const cooldownKey = smsResendKey(e164);
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
    const sendCount = await this.atomicIncr(
      smsSendCounterKey(e164), SEND_PHONE_WINDOW_SEC,
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

    // [Phase 10.1] Self-managed OTP generation + Valkey storage
    const otp = this.generateOtp();
    const text = formatSmsOtpMessage(otp, 'ko');

    try {
      // Store OTP first -- SMS delivery only matters after user receives it.
      // On sendSms failure, OTP naturally expires via TTL 180s. Next send overwrites.
      //
      // [Issue 1 / PR #16 review] Reset attempts counter atomically with new
      // OTP storage. {sms:{e164}}:attempts TTL is 900s (set inside
      // VERIFY_AND_INCREMENT_LUA on first INCR), longer than OTP TTL 180s.
      // Without this DEL, a user who failed N attempts on OTP#1 and then
      // re-sends would start OTP#2 with attempts=N already counted in Valkey
      // — the very first verify on the fresh OTP could trigger
      // NO_MORE_ATTEMPTS.
      //
      // ioredis pipeline keeps both ops in a single round trip and adjacent.
      // The verify path reads OTP first (KEYS[1]), so a Lua script is not
      // required — pipeline ordering is observably atomic for the consumer.
      const pipeline = this.redis.pipeline();
      pipeline.set(smsOtpKey(e164), otp, 'PX', OTP_TTL_MS);
      pipeline.del(smsAttemptsKey(e164));
      const results = await pipeline.exec();
      // ioredis pipeline.exec returns Array<[Error|null, unknown]> | null.
      // Treat any op error as a failed send — flow into the catch below so the
      // SMS is NOT sent (otherwise the user would receive an unverifiable code).
      //
      // [WR-01] Guard against null per-entry: older @types/ioredis and
      // defensive codepaths in the repo elsewhere type entries as
      // `[Error|null, unknown] | null`. If Valkey returns null for a single op
      // (e.g. mid-pipeline connection reset), destructuring would throw a
      // TypeError inside `.some` and skip the "pipeline failed" guard. Use
      // index access instead of destructuring so null entries are handled
      // uniformly.
      if (!results || results.some((r) => !r || r[0])) {
        throw new Error('Failed to store OTP / reset attempts in Valkey');
      }

      await this.client!.sendSms(e164, text);
      this.logger.log({ event: 'sms.sent', phone: e164 });
      return { success: true, message: '인증번호가 발송되었습니다' };
    } catch (err) {
      // [Phase 10 review + Issue 2] Rollback policy
      // 5xx/timeout/network -> user didn't receive SMS -> release BOTH the
      //   30s cooldown AND the phone-axis hourly send slot. Otherwise a
      //   transient Infobip outage would burn the user's 5/hour quota
      //   without delivering anything (Issue 2 from PR #16 review).
      // 4xx (incl. groupId=5 REJECTED, converted by InfobipClient) -> permanent
      //   rejection -> keep both cooldown and counter (abuse mitigation).
      const shouldRollback =
        !(err instanceof InfobipApiError) || err.status >= 500;
      if (shouldRollback) {
        // [WR-02] Emit per-op rollback failures so ops can detect stuck-quota
        // states. Silently swallowing `.catch(() => {})` meant a Valkey blip
        // during rollback could pin a user in the 30s cooldown or retain
        // their phone-axis slot with zero observability.
        const rollbackResults = await Promise.allSettled([
          this.redis.del(cooldownKey),
          this.redis.decr(smsSendCounterKey(e164)),
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

      const country = e164.startsWith('+82') ? 'KR' : 'unknown';
      Sentry.withScope((scope) => {
        scope.setTag('provider', 'infobip');
        scope.setTag('country', country);
        if (err instanceof InfobipApiError) {
          scope.setTag('http_status', String(err.status));
        }
        scope.setLevel('error');
        Sentry.captureException(err);
      });
      this.logger.error({ event: 'sms.send_failed', phone: e164, err: (err as Error).message });
      throw new BadRequestException('인증번호 발송에 실패했습니다. 잠시 후 다시 시도해주세요.');
    }
  }

  /**
   * Verify a user-supplied OTP against the Valkey-stored code.
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
   * incremented BEFORE any idempotent-verify short-circuit to prevent a 10-min
   * enumeration oracle: without this ordering, an attacker could POST
   * `/verify-code { phone, code: "000000" }` for arbitrary phones and
   * distinguish verified-within-10min vs not based on response shape,
   * regardless of the code supplied.
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

    // [WR-02] D-07 rate limit MUST run before any short-circuit — it is the
    // only signal that resists enumeration of the `{sms:{e164}}:verified` flag.
    // If we checked the verified flag first and returned early, the counter
    // would not increment and an attacker could probe unlimited phones to
    // distinguish "verified within last 10 min" vs not.
    const verifyCount = await this.atomicIncr(
      smsVerifyCounterKey(e164), VERIFY_PHONE_WINDOW_SEC,
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

    // [CR-01] SECURITY: previously we short-circuited to `{ verified: true }`
    // whenever `{sms:{e164}}:verified` was '1', regardless of the submitted code.
    // During the 600s flag TTL, any caller who knew a recently-verified phone
    // could pass verification with `code: "000000"` (or anything). This was an
    // impersonation primitive against every downstream consumer of verifyCode
    // (signup, password-reset, etc.).
    //
    // Mitigation: remove the short-circuit entirely. Every verify call must
    // evaluate the Lua script against the actual OTP. A successful verification
    // returns a signed, phone/purpose-bound token for downstream consumers.
    //
    // The `{sms:{e164}}:verified` flag is still SETEX'd inside the Lua script on
    // VERIFIED; it remains available for downstream consumers to query
    // explicitly if they need telemetry, but it no longer gates signup or
    // profile mutation authorization.

    // [Phase 10.1] Valkey Lua atomic OTP verify
    try {
      const result = (await this.redis.eval(
        VERIFY_AND_INCREMENT_LUA,
        3,
        smsOtpKey(e164),
        smsAttemptsKey(e164),
        smsVerifiedKey(e164),
        code,
        String(OTP_MAX_ATTEMPTS),
        String(VERIFIED_FLAG_TTL_SEC),
      )) as [string, number];

      const [status] = result;
      switch (status) {
        case 'VERIFIED':
          this.logger.log({ event: 'sms.verified', phone: e164, attempts: result[1] });
          return {
            verified: true,
            verificationToken: this.createPhoneVerificationToken(e164, purpose),
          };
        case 'WRONG':
          this.logger.warn({ event: 'sms.verify_wrong', phone: e164, remaining: result[1] });
          return { verified: false, message: '인증번호가 일치하지 않습니다' };
        case 'EXPIRED':
          throw new GoneException('인증번호가 만료되었습니다. 재발송해주세요');
        case 'NO_MORE_ATTEMPTS':
          this.logger.warn({ event: 'sms.verify_exhausted', phone: e164 });
          throw new GoneException('인증번호가 만료되었습니다. 재발송해주세요');
        default: {
          // Unreachable -- Lua script returns one of the above.
          const exhaustive: never = status as never;
          throw new Error(`Unknown VERIFY_AND_INCREMENT result: ${exhaustive}`);
        }
      }
    } catch (err) {
      if (err instanceof GoneException) throw err;
      // [WR-04] Transient Valkey eval failure: the user got no verification
      // outcome, so release the verify slot that atomicIncr just consumed.
      // Mirrors the sendVerificationCode rollback policy for 5xx/network
      // failures. Without this, each Valkey blip burns one of the user's
      // 10/15min verify attempts without producing any result.
      await this.redis
        .decr(smsVerifyCounterKey(e164))
        .catch((rollbackErr: unknown) => {
          this.logger.warn({
            event: 'sms.rollback_failed',
            phone: e164,
            op: 'verify_counter_decr',
            err: (rollbackErr as Error).message,
          });
        });
      // Valkey eval failure etc. -- log + propagate as user-facing generic message
      Sentry.withScope((scope) => {
        scope.setTag('provider', 'valkey');
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
   * After a successful verifyCode() call the OTP key is DEL'd, so a second
   * verifyCode() with the same code returns EXPIRED (GoneException). Per the
   * design note above verifyCode (sms.service.ts:385-403), the
   * `{sms:{e164}}:verified` flag (TTL 600s) is left behind specifically so
   * downstream consumers can probe "this phone was verified within the last
   * 10 min" WITHOUT re-running the Lua script.
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
