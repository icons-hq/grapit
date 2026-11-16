'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { useLocale } from 'next-intl';
import { parsePhoneNumberFromString } from 'libphonenumber-js/min';
import { isValidPhoneNumber } from 'react-phone-number-input';
import {
  DEFAULT_LOCALE,
  SMS_CODE_EXPIRY_SECONDS,
  SMS_RESEND_COOLDOWN_SECONDS,
} from '@grabit/shared';
import { apiClient, ApiClientError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PhoneInput } from '@/components/ui/phone-input';
import { getAuthLaunchCopy } from './auth-launch-copy';

interface PhoneVerificationProps {
  phone: string;
  onPhoneChange: (phone: string) => void;
  onVerified: (verificationToken: string) => void;
  isVerified: boolean;
  error?: string;
  locale?: SupportedLocale;
  purpose?: SmsVerificationPurpose;
}

const PHONE_VERIFICATION_LOCALES = ['ko', 'en', 'th', 'zh-CN'] as const;

type SupportedLocale = (typeof PHONE_VERIFICATION_LOCALES)[number];
type SmsVerificationPurpose =
  | 'signup'
  | 'social_registration'
  | 'profile_phone_change';
type SendRetryReason = 'cooldown' | 'phone' | 'service' | 'unknown';
type SendRetry = { phone: string; until: number; reason?: SendRetryReason };

function readSendRetry(err: unknown, phone: string, now: number): SendRetry | null {
  if (!(err instanceof ApiClientError) || err.statusCode !== 429) return null;
  const data = err.data as { retryAfterMs?: unknown; errorCode?: unknown } | null;
  const delay = data?.retryAfterMs;
  if (typeof delay !== 'number' || !Number.isFinite(delay) || delay <= 0) return null;
  const reason: SendRetryReason = data?.errorCode === 'SMS_PHONE_SEND_LIMIT' ? 'phone'
    : data?.errorCode === 'SMS_GLOBAL_SEND_LIMIT' ? 'service'
    : data?.errorCode === 'SMS_RESEND_COOLDOWN' ? 'cooldown' : 'unknown';
  return { phone, until: now + Math.min(delay, 24 * 60 * 60_000), reason };
}
type SmsSendErrorCode =
  | 'SMS_PHONE_INVALID'
  | 'SMS_CAPABLE_PHONE_REQUIRED'
  | 'SMS_RECIPIENT_BLOCKED'
  | 'SMS_PROVIDER_RATE_LIMITED'
  | 'SMS_SEND_FAILED';

function readSmsErrorCode(data: unknown): SmsSendErrorCode | null {
  if (!data || typeof data !== 'object' || !('errorCode' in data)) return null;
  const value = (data as { errorCode?: unknown }).errorCode;
  if (
    value === 'SMS_PHONE_INVALID' ||
    value === 'SMS_CAPABLE_PHONE_REQUIRED' ||
    value === 'SMS_RECIPIENT_BLOCKED' ||
    value === 'SMS_PROVIDER_RATE_LIMITED' ||
    value === 'SMS_SEND_FAILED'
  ) {
    return value;
  }
  return null;
}

function mapSmsSendErrorCodeToCopy(
  errorCode: SmsSendErrorCode,
  copy: ReturnType<typeof getAuthLaunchCopy>['otp'],
): string {
  const byCode = {
    SMS_PHONE_INVALID: copy.invalidPhone,
    SMS_CAPABLE_PHONE_REQUIRED: copy.smsCapablePhoneRequired,
    SMS_RECIPIENT_BLOCKED: copy.recipientBlocked,
    SMS_PROVIDER_RATE_LIMITED: copy.providerRateLimited,
    SMS_SEND_FAILED: copy.sendFailed,
  } satisfies Record<SmsSendErrorCode, string>;

  return byCode[errorCode];
}

function mapErrorToCopy(
  err: unknown,
  copy: ReturnType<typeof getAuthLaunchCopy>['otp'],
  phase: 'send' | 'verify',
): string {
  if (err instanceof ApiClientError) {
    const smsErrorCode = readSmsErrorCode(err.data);
    if (smsErrorCode === 'SMS_RECIPIENT_BLOCKED'
      && (err.data as { providerCode?: unknown }).providerCode === 60410) return copy.providerBlocked;
    if (smsErrorCode) return mapSmsSendErrorCodeToCopy(smsErrorCode, copy);
    if (err.statusCode === 429) return copy.throttled;
    if (err.statusCode === 410 || err.statusCode === 422) return copy.expired;
    if (err.statusCode === 400) {
      if (phase === 'send') return copy.invalidPhone;
      return copy.invalidCode;
    }
    if (err.statusCode >= 500) return copy.systemError;
  }
  return copy.systemError;
}

function formatSecondsCopy(template: string, seconds: number): string {
  return template.replace('{seconds}', String(seconds));
}

function usePhoneVerificationLocale(localeOverride: SupportedLocale | undefined): SupportedLocale {
  const contextLocale = useLocale();

  if (localeOverride) return localeOverride;
  return contextLocale && isPhoneVerificationLocale(contextLocale)
    ? contextLocale
    : DEFAULT_LOCALE;
}

function isPhoneVerificationLocale(value: string): value is SupportedLocale {
  return PHONE_VERIFICATION_LOCALES.includes(value as SupportedLocale);
}

function formatOtpTemplate(template: string, phone: string): string {
  return template.replace('{phone}', phone);
}

function getMaskedSmsDestination(phone: string): string | null {
  const parsed = parsePhoneNumberFromString(phone);
  if (!parsed?.isValid()) return null;

  const callingCode = `+${parsed.countryCallingCode}`;
  const nationalNumber = parsed.nationalNumber;
  if (nationalNumber.length <= 2) return callingCode;

  return `${callingCode} ****${nationalNumber.slice(-2)}`;
}

export function PhoneVerification({
  phone,
  onPhoneChange,
  onVerified,
  isVerified,
  error,
  locale,
  purpose = 'signup',
}: PhoneVerificationProps) {
  const activeLocale = usePhoneVerificationLocale(locale);
  const authCopy = getAuthLaunchCopy(activeLocale);
  const otpCopy = authCopy.otp;
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const [sendRetry, setSendRetry] = useState<SendRetry | null>(null);
  const [clockNow, setClockNow] = useState(Date.now);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const phoneRef = useRef(phone);
  phoneRef.current = phone;
  const smsDestination = useMemo(() => getMaskedSmsDestination(phone), [phone]);
  const retryForPhone = sendRetry?.phone === phone || sendRetry?.reason === 'service';
  const resendCooldown = sendRetry && retryForPhone
    ? Math.max(0, Math.ceil((sendRetry.until - clockNow) / 1000)) : 0;
  const retryReason = resendCooldown > 0 ? sendRetry?.reason : undefined;

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return clearTimer;
  }, [clearTimer]);

  // Expiry timer (Twilio Verify default: 10 min)
  useEffect(() => {
    if (timeLeft <= 0) {
      clearTimer();
      return;
    }

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearTimer();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return clearTimer;
  }, [timeLeft, clearTimer]);

  // Use a deadline, not timer ticks: background-tab throttling must not turn
  // a one-hour limit into an even longer wait when the buyer returns.
  useEffect(() => {
    if (!sendRetry || isVerified) return;
    const tick = () => {
      setClockNow(Date.now());
      if (Date.now() >= sendRetry.until) clearInterval(timer);
    };
    const timer = setInterval(tick, 1000);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [sendRetry, isVerified]);

  const isExpired = codeSent && timeLeft === 0 && !isVerified;

  function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  async function handleSendCode() {
    if (!phone || !isValidPhoneNumber(phone) || isSending || resendCooldown > 0) return;

    setIsSending(true);
    setVerifyError(null);
    setStatusMessage(null);
    const wasResend = codeSent;
    try {
      await apiClient.post(
        '/api/v1/sms/send-code',
        { phone },
        { showErrorToast: false },
      );
      if (phoneRef.current !== phone) return;
      setCodeSent(true);
      setCode('');
      setTimeLeft(SMS_CODE_EXPIRY_SECONDS);
      const now = Date.now();
      setClockNow(now);
      setSendRetry({ phone, until: now + SMS_RESEND_COOLDOWN_SECONDS * 1000 });
      if (smsDestination) {
        setStatusMessage(
          formatOtpTemplate(
            wasResend ? otpCopy.resendSuccessTo : otpCopy.sentTo,
            smsDestination,
          ),
        );
      } else {
        setStatusMessage(wasResend ? otpCopy.resendSuccess : otpCopy.sent);
      }
    } catch (err) {
      if (phoneRef.current !== phone) return;
      const now = Date.now();
      const retry = readSendRetry(err, phone, now);
      if (retry) {
        setClockNow(now);
        setSendRetry(retry);
      } else {
        setVerifyError(mapErrorToCopy(err, otpCopy, 'send'));
      }
    } finally {
      setIsSending(false);
    }
  }

  async function handleVerifyCode() {
    if (code.length !== 6) return;

    setIsVerifying(true);
    setVerifyError(null);
    setStatusMessage(null);
    try {
      const res = await apiClient.post<{
        verified: boolean;
        message?: string;
        verificationToken?: string;
      }>(
        '/api/v1/sms/verify-code',
        { phone, code, purpose },
        { showErrorToast: false },
      );
      if (res.verified && res.verificationToken) {
        clearTimer();
        onVerified(res.verificationToken);
      } else {
        // [D-07] 서버가 system error context 를 message 로 내려준 경우 (예: Valkey EVAL
        // 장애 → '인증번호 확인에 실패했습니다. 잠시 후 다시 시도해주세요.') 하드코드 대신
        // 서버 문구를 우선 표시해 "틀린 OTP" vs "시스템 에러" 를 사용자 관점에서 구분.
        // [D-08] 빈 문자열 방어: res.message 가 undefined 이거나 길이 0 이면 fallback.
        // [REVIEWS.md LOW#6] generic 이 message?: string 이므로 typeof-string 가드가
        // 타입 narrowing 도 겸한다 (undefined 제거 + length 확인).
        const serverMessage =
          typeof res.message === 'string' && res.message.length > 0
            ? res.message
            : null;
        setVerifyError(serverMessage ?? otpCopy.invalidCode);
      }
    } catch (err) {
      const copy = mapErrorToCopy(err, otpCopy, 'verify');
      setVerifyError(copy);
      // 410/422 expired -> force expired state
      if (
        err instanceof ApiClientError &&
        (err.statusCode === 410 || err.statusCode === 422)
      ) {
        setTimeLeft(0);
      }
    } finally {
      setIsVerifying(false);
    }
  }

  // Button disabled logic
  const sendButtonDisabled =
    isVerified ||
    isSending ||
    resendCooldown > 0 ||
    !isValidPhoneNumber(phone);

  const retryLabel = otpCopy.retryButtonLabel.replace('{time}', formatTime(resendCooldown));
  const retryMessage = retryReason === 'phone' ? otpCopy.phoneSendLimit
    : retryReason === 'service' ? otpCopy.sendServiceBusy
    : retryReason === 'cooldown' ? otpCopy.resendTooSoon : otpCopy.throttled;

  // Button aria-label for cooldown
  const sendButtonAriaLabel =
    retryReason ? retryLabel : resendCooldown > 0
      ? formatSecondsCopy(otpCopy.cooldownAriaLabel, resendCooldown)
      : undefined;

  return (
    <div className="space-y-4">
      {/* Phone input + send button */}
      <div className="space-y-2">
        <PhoneInput
          locale={activeLocale}
          value={phone}
          onChange={(nextPhone) => {
            setCodeSent(false);
            setCode('');
            setTimeLeft(0);
            setVerifyError(null);
            setStatusMessage(null);
            onPhoneChange(nextPhone);
          }}
          aria-label={authCopy.signup.phoneLabel}
          autoComplete="tel"
          disabled={isVerified || isSending || isVerifying}
          className="w-full"
        />
        <Button
          type="button"
          variant={isSending ? 'default' : codeSent ? 'outline' : 'default'}
          size="lg"
          onClick={handleSendCode}
          disabled={sendButtonDisabled}
          aria-label={sendButtonAriaLabel}
          className="w-full"
        >
          {isSending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {codeSent ? otpCopy.resendLoading : otpCopy.sendLoading}
            </>
          ) : retryReason ? (
            retryLabel
          ) : resendCooldown > 0 ? (
            formatSecondsCopy(otpCopy.cooldownLabel, resendCooldown)
          ) : codeSent ? (
            otpCopy.resendCta
          ) : (
            otpCopy.sendCta
          )}
        </Button>
      </div>

      {retryReason && !isVerified && (
        <div className="space-y-1 text-caption text-error">
          <p role="alert">{retryMessage}</p>
          <p aria-live="off">{otpCopy.retryWait.replace('{time}', formatTime(resendCooldown))}</p>
        </div>
      )}

      {smsDestination && !codeSent && !isVerified && (
        <p className="text-caption text-gray-500" role="status">
          {formatOtpTemplate(otpCopy.destinationPreview, smsDestination)}
        </p>
      )}

      {/* Error from phone field */}
      {error && !verifyError && (
        <p className="text-caption text-error">{error}</p>
      )}

      {/* Code input + timer */}
      {codeSent && !isVerified && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              aria-label={otpCopy.codeAriaLabel}
              value={code}
              onChange={(e) => {
                const v = e.target.value.replace(/[^0-9]/g, '');
                setCode(v.slice(0, 6));
              }}
              disabled={isExpired}
              className="flex-1"
            />
            <Button
              type="button"
              size="lg"
              onClick={handleVerifyCode}
              disabled={code.length !== 6 || isVerifying || isExpired}
              className="shrink-0"
            >
              {isVerifying ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                otpCopy.verifyCta
              )}
            </Button>
          </div>

          <div
            className="flex items-center gap-2"
            aria-live={timeLeft === 0 ? 'polite' : 'off'}
          >
            {timeLeft > 0 ? (
              <span className="text-caption text-error">
                {formatTime(timeLeft)}
              </span>
            ) : !verifyError ? (
              <span role="alert" className="text-caption text-error">
                {otpCopy.expired}
              </span>
            ) : null}
          </div>
        </div>
      )}

      {statusMessage && !verifyError && !isExpired && (
        <p
          role="status"
          aria-live="polite"
          className="text-caption text-success animate-in fade-in duration-150"
        >
          {statusMessage}
        </p>
      )}

      {/* Verify error */}
      {verifyError && (
        <p
          role="alert"
          className="text-caption text-error animate-in fade-in duration-150"
        >
          {verifyError}
        </p>
      )}

      {/* Verified state */}
      {isVerified && (
        <div className="flex items-center gap-2" role="status">
          <CheckCircle2 className="h-5 w-5 text-success" />
          <span className="text-caption text-success">{otpCopy.verified}</span>
        </div>
      )}
    </div>
  );
}
