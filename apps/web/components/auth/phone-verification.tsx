'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { useLocale } from 'next-intl';
import { isValidPhoneNumber } from 'react-phone-number-input';
import {
  DEFAULT_LOCALE,
  SMS_CODE_EXPIRY_SECONDS,
  SMS_RESEND_COOLDOWN_SECONDS,
  isSupportedLocale,
  type SUPPORTED_LOCALES,
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

type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
type SmsVerificationPurpose =
  | 'signup'
  | 'social_registration'
  | 'profile_phone_change';

function mapErrorToCopy(
  err: unknown,
  copy: ReturnType<typeof getAuthLaunchCopy>['otp'],
): string {
  if (err instanceof ApiClientError) {
    if (err.statusCode === 429) return copy.throttled;
    if (err.statusCode === 410 || err.statusCode === 422) return copy.expired;
    if (err.statusCode === 400) {
      return copy.invalidCode;
    }
    if (err.statusCode >= 500) return copy.systemError;
  }
  return copy.systemError;
}

function usePhoneVerificationLocale(localeOverride: SupportedLocale | undefined): SupportedLocale {
  const contextLocale = useLocale();

  if (localeOverride) return localeOverride;
  return contextLocale && isSupportedLocale(contextLocale) ? contextLocale : DEFAULT_LOCALE;
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
  const otpCopy = getAuthLaunchCopy(activeLocale).otp;
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // Resend cooldown timer (30s, independent)
  useEffect(() => {
    if (resendCooldown <= 0) {
      if (cooldownTimerRef.current) {
        clearInterval(cooldownTimerRef.current);
        cooldownTimerRef.current = null;
      }
      return;
    }
    cooldownTimerRef.current = setInterval(() => {
      setResendCooldown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => {
      if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    };
  }, [resendCooldown]);

  const isExpired = codeSent && timeLeft === 0 && !isVerified;

  function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  async function handleSendCode() {
    if (!phone || !isValidPhoneNumber(phone)) return;

    setIsSending(true);
    setVerifyError(null);
    setStatusMessage(null);
    const wasResend = codeSent;
    try {
      await apiClient.post('/api/v1/sms/send-code', { phone });
      setCodeSent(true);
      setCode('');
      setTimeLeft(SMS_CODE_EXPIRY_SECONDS);
      setResendCooldown(SMS_RESEND_COOLDOWN_SECONDS);
      setStatusMessage(wasResend ? otpCopy.resendSuccess : otpCopy.sent);
    } catch (err) {
      setVerifyError(mapErrorToCopy(err, otpCopy));
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
      const copy = mapErrorToCopy(err, otpCopy);
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
    (codeSent && resendCooldown > 0) ||
    (!codeSent && !isValidPhoneNumber(phone));

  // Button aria-label for cooldown
  const sendButtonAriaLabel =
    codeSent && resendCooldown > 0
      ? `재발송 대기 중, ${resendCooldown}초 남음`
      : undefined;

  return (
    <div className="space-y-4">
      {/* Phone input + send button */}
      <div className="flex gap-2">
        <PhoneInput
          locale={activeLocale}
          value={phone}
          onChange={onPhoneChange}
          placeholder="010-0000-0000"
          autoComplete="tel"
          disabled={isVerified}
          className="flex-1"
        />
        <Button
          type="button"
          variant={isSending ? 'default' : codeSent ? 'outline' : 'default'}
          size="lg"
          onClick={handleSendCode}
          disabled={sendButtonDisabled}
          aria-label={sendButtonAriaLabel}
          className="shrink-0"
        >
          {isSending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {codeSent ? otpCopy.resendLoading : '발송 중...'}
            </>
          ) : codeSent && resendCooldown > 0 ? (
            `재발송 (${resendCooldown}s)`
          ) : codeSent ? (
            otpCopy.resendCta
          ) : (
            '인증번호 발송'
          )}
        </Button>
      </div>

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
              placeholder="인증번호 6자리"
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
                '확인'
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
          <span className="text-caption text-success">인증 완료</span>
        </div>
      )}
    </div>
  );
}
