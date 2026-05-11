import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import * as Sentry from '@sentry/nestjs';
import { PasswordResetEmail } from './templates/password-reset.js';
import { EmailVerificationEmail } from './templates/email-verification.js';
import { emailVerificationCopy, type EmailVerificationLocale } from './templates/email-verification.copy.js';

export interface SendEmailResult {
  success: boolean;
  id?: string;
  error?: string;
}

export interface SendQrTicketReminderEmailInput {
  reservationNumber: string;
  performanceTitle: string;
  showDateTime: string;
  venue: string;
  ticketToken: string;
  ticketUrl: string;
  locale?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// [Phase 15 WR-01] Bounded in-process retry for transient Resend failures.
// auth.service intentionally swallows the result for enumeration defense, so a
// single transient failure (rate limit, 5xx, network blip) leaves the user
// without a reset link. Resend documents these classes as retryable; cap at 3
// attempts with exponential backoff (250ms, 500ms) — total worst-case ~750ms
// stays well within Cloud Run request lifetime.
const MAX_SEND_ATTEMPTS = 3;
const RETRY_BASE_MS = 250;
const RETRYABLE_ERROR = (msg: string): boolean =>
  /rate.?limit|timeout|temporar|5\d\d|ECONN|ETIMEDOUT/i.test(msg);

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null;
  private readonly from: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    const fromEmail = this.configService.get<string>('RESEND_FROM_EMAIL');
    const nodeEnv = this.configService.get<string>('NODE_ENV');
    // Tighten production check: anything except development/test requires the key.
    // Prevents staging/preview environments (NODE_ENV=staging) from silently
    // falling back to dev-mock and writing reset tokens to shared logs.
    const isNonDev = nodeEnv !== 'development' && nodeEnv !== 'test';

    // Phase 7 REDIS_URL hard-fail 원칙 복제 (RESEARCH §Example 3).
    // Silent console.log fallback in production would swallow missed password
    // reset emails and make misconfiguration look like a transient issue.
    if (isNonDev && !apiKey) {
      throw new Error(
        '[email] RESEND_API_KEY is required outside development/test environments. ' +
          'Silent console.log fallback is disabled to prevent missed password reset emails. ' +
          'Check Cloud Run secret binding.',
      );
    }

    // REVIEWS.md MED: RESEND_FROM_EMAIL must also be hard-required outside dev/test.
    // onboarding@resend.dev fallback is dev-only (phishing + deliverability risk).
    if (isNonDev) {
      if (!fromEmail || !EMAIL_PATTERN.test(fromEmail)) {
        throw new Error(
          '[email] RESEND_FROM_EMAIL must be a valid email outside development/test. ' +
            `Received: ${fromEmail ?? '<unset>'}. ` +
            'Phishing/deliverability risk — configure a verified sender in Resend dashboard.',
        );
      }
      this.from = fromEmail;
    } else {
      this.from = fromEmail ?? 'onboarding@resend.dev';
    }

    if (apiKey === undefined) {
      this.resend = null;
      this.logger.warn('Email Service running in DEV MOCK mode (no RESEND_API_KEY)');
    } else {
      this.resend = new Resend(apiKey);
    }
  }

  async sendPasswordResetEmail(to: string, resetLink: string): Promise<SendEmailResult> {
    if (this.resend === null) {
      this.logger.log(`DEV EMAIL: password reset link for ${to}: ${resetLink}`);
      return { success: true };
    }

    const toDomain = to.split('@')[1] ?? 'unknown';

    for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
      // Resend returns { data, error } — it does NOT throw (RESEARCH §Pitfall 2).
      // Do not wrap in try/catch; branch on `error` instead.
      const { data, error } = await this.resend.emails.send({
        from: this.from,
        to,
        subject: '[Grabit] 비밀번호 재설정',
        react: PasswordResetEmail({ resetLink }),
      });

      if (!error) {
        if (attempt > 1) {
          this.logger.log(`Resend recovered on attempt ${attempt} (toDomain=${toDomain})`);
        }
        return { success: true, id: data?.id };
      }

      const isFinalAttempt = attempt === MAX_SEND_ATTEMPTS;
      const isTransient = RETRYABLE_ERROR(error.message);

      if (isFinalAttempt || !isTransient) {
        this.logger.error(
          `Resend send failed for ${toDomain} after ${attempt} attempt(s): ${error.message}`,
        );
        // [Phase 15 D-11] auth.service intentionally swallows result for enumeration defense; capture here for ops visibility.
        Sentry.withScope((scope) => {
          scope.setTag('component', 'email-service');
          scope.setTag('provider', 'resend');
          scope.setLevel('error');
          scope.setContext('email', {
            from: this.from,
            toDomain,
            attempts: attempt,
          });
          Sentry.captureException(new Error(`Resend send failed: ${error.message}`));
        });
        return { success: false, error: error.message };
      }

      const delayMs = RETRY_BASE_MS * 2 ** (attempt - 1);
      this.logger.warn(
        `Resend transient error on attempt ${attempt}/${MAX_SEND_ATTEMPTS} (toDomain=${toDomain}): ${error.message} — retrying in ${delayMs}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    // Unreachable: loop body returns on every attempt outcome (success, non-retryable, or final-attempt exhaustion).
    throw new Error('email retry loop exited unexpectedly');
  }

  async sendEmailVerificationEmail(
    to: string,
    verificationLink: string,
    locale: string = 'ko',
  ): Promise<SendEmailResult> {
    const resolvedLocale = resolveEmailVerificationLocale(locale);
    const copy = emailVerificationCopy[resolvedLocale];

    if (this.resend === null) {
      const toDomain = to.split('@')[1] ?? 'unknown';
      this.logger.log(`DEV EMAIL: email verification requested for ${toDomain} (${resolvedLocale})`);
      return { success: true };
    }

    const toDomain = to.split('@')[1] ?? 'unknown';

    for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
      const { data, error } = await this.resend.emails.send({
        from: this.from,
        to,
        subject: copy.subject,
        react: EmailVerificationEmail({ verificationLink, locale: resolvedLocale }),
      });

      if (!error) {
        if (attempt > 1) {
          this.logger.log(`Resend recovered on attempt ${attempt} (toDomain=${toDomain})`);
        }
        return { success: true, id: data?.id };
      }

      const isFinalAttempt = attempt === MAX_SEND_ATTEMPTS;
      const isTransient = RETRYABLE_ERROR(error.message);

      if (isFinalAttempt || !isTransient) {
        this.logger.error(
          `Resend verification send failed for ${toDomain} after ${attempt} attempt(s): ${error.message}`,
        );
        Sentry.withScope((scope) => {
          scope.setTag('component', 'email-service');
          scope.setTag('provider', 'resend');
          scope.setTag('emailType', 'verification');
          scope.setLevel('error');
          scope.setContext('email', {
            from: this.from,
            toDomain,
            attempts: attempt,
          });
          Sentry.captureException(new Error(`Resend verification send failed: ${error.message}`));
        });
        return { success: false, error: error.message };
      }

      const delayMs = RETRY_BASE_MS * 2 ** (attempt - 1);
      this.logger.warn(
        `Resend transient verification error on attempt ${attempt}/${MAX_SEND_ATTEMPTS} (toDomain=${toDomain}): ${error.message} — retrying in ${delayMs}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    throw new Error('email verification retry loop exited unexpectedly');
  }

  async sendQrTicketReminderEmail(
    to: string,
    input: SendQrTicketReminderEmailInput,
  ): Promise<SendEmailResult> {
    const showDateTime = new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Seoul',
    }).format(new Date(input.showDateTime));

    const html = [
      '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;line-height:1.6;color:#111827">',
      '<h1 style="font-size:20px;margin:0 0 16px">QR 티켓 안내</h1>',
      `<p style="margin:0 0 12px"><strong>${escapeHtml(input.performanceTitle)}</strong> 공연의 QR 티켓을 다시 보내드립니다.</p>`,
      `<p style="margin:0 0 4px">예매번호: <strong>${escapeHtml(input.reservationNumber)}</strong></p>`,
      `<p style="margin:0 0 4px">공연일시: ${escapeHtml(showDateTime)}</p>`,
      `<p style="margin:0 0 16px">장소: ${escapeHtml(input.venue)}</p>`,
      `<p style="margin:0 0 8px">마이페이지에서 바로 확인:</p>`,
      `<p style="margin:0 0 16px"><a href="${escapeHtml(input.ticketUrl)}">${escapeHtml(input.ticketUrl)}</a></p>`,
      '<p style="margin:0 0 8px">QR 토큰</p>',
      `<pre style="white-space:pre-wrap;word-break:break-all;background:#F3F4F6;padding:12px;border-radius:8px">${escapeHtml(input.ticketToken)}</pre>`,
      '</div>',
    ].join('');

    if (this.resend === null) {
      const toDomain = to.split('@')[1] ?? 'unknown';
      this.logger.log(
        `DEV EMAIL: QR ticket reminder requested for ${toDomain} (${input.locale ?? 'ko'})`,
      );
      return { success: true };
    }

    const toDomain = to.split('@')[1] ?? 'unknown';

    for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
      const { data, error } = await this.resend.emails.send({
        from: this.from,
        to,
        subject: `[Grabit] QR 티켓 안내 - ${input.performanceTitle}`,
        html,
      });

      if (!error) {
        if (attempt > 1) {
          this.logger.log(`Resend recovered on attempt ${attempt} (toDomain=${toDomain})`);
        }
        return { success: true, id: data?.id };
      }

      const isFinalAttempt = attempt === MAX_SEND_ATTEMPTS;
      const isTransient = RETRYABLE_ERROR(error.message);

      if (isFinalAttempt || !isTransient) {
        this.logger.error(
          `Resend QR reminder send failed for ${toDomain} after ${attempt} attempt(s): ${error.message}`,
        );
        Sentry.withScope((scope) => {
          scope.setTag('component', 'email-service');
          scope.setTag('provider', 'resend');
          scope.setTag('emailType', 'qr-reminder');
          scope.setLevel('error');
          scope.setContext('email', {
            from: this.from,
            toDomain,
            attempts: attempt,
          });
          Sentry.captureException(new Error(`Resend QR reminder send failed: ${error.message}`));
        });
        return { success: false, error: error.message };
      }

      const delayMs = RETRY_BASE_MS * 2 ** (attempt - 1);
      this.logger.warn(
        `Resend transient QR reminder error on attempt ${attempt}/${MAX_SEND_ATTEMPTS} (toDomain=${toDomain}): ${error.message} — retrying in ${delayMs}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    throw new Error('qr reminder retry loop exited unexpectedly');
  }
}

function resolveEmailVerificationLocale(locale: string): EmailVerificationLocale {
  return locale in emailVerificationCopy ? (locale as EmailVerificationLocale) : 'ko';
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
