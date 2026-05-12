import twilio from 'twilio';

export interface SendVerificationResult {
  sid: string;
  status: string;
  channel: string;
}

export interface CheckVerificationResult {
  sid: string;
  status: string;
  valid: boolean;
}

export type TwilioVerifyCredentials =
  | {
      accountSid: string;
      authToken: string;
      apiKeySid?: never;
      apiKeySecret?: never;
    }
  | {
      accountSid: string;
      apiKeySid: string;
      apiKeySecret: string;
      authToken?: never;
    };

export class TwilioVerifyApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: number | undefined,
    public readonly body: string,
  ) {
    super(`Twilio Verify API ${status}: ${body}`);
    this.name = 'TwilioVerifyApiError';
  }

  get shouldRollbackQuota(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }

  get isRateLimited(): boolean {
    return this.status === 429 || this.code === 60203 || this.code === 60212;
  }

  get isExpiredOrExhausted(): boolean {
    return this.status === 404 || this.code === 20404 || this.code === 60202;
  }
}

function toTwilioVerifyApiError(err: unknown): TwilioVerifyApiError {
  if (err instanceof TwilioVerifyApiError) return err;

  const candidate = err as {
    status?: number;
    code?: number;
    message?: string;
    moreInfo?: string;
  };
  const status = typeof candidate.status === 'number' ? candidate.status : 0;
  const code = typeof candidate.code === 'number' ? candidate.code : undefined;
  const detail = [
    candidate.message,
    candidate.moreInfo,
  ].filter(Boolean).join(' ');

  return new TwilioVerifyApiError(
    status,
    code,
    detail || (err instanceof Error ? err.message : 'Unknown Twilio Verify error'),
  );
}

/**
 * Twilio Verify client for Grabit phone OTP.
 *
 * Twilio Verify owns OTP generation, delivery, expiry, fraud guard, and code
 * checking. Grabit keeps local cooldown/rate-limit guards and issues its own
 * purpose-bound verification token after Twilio approves the code.
 */
export class TwilioVerifyClient {
  private readonly client: ReturnType<typeof twilio>;

  constructor(
    credentials: TwilioVerifyCredentials,
    private readonly serviceSid: string,
    private readonly locale?: string,
  ) {
    this.client =
      'apiKeySid' in credentials
        ? twilio(credentials.apiKeySid, credentials.apiKeySecret, {
            accountSid: credentials.accountSid,
          })
        : twilio(credentials.accountSid, credentials.authToken);
  }

  async sendVerification(e164: string): Promise<SendVerificationResult> {
    try {
      const verification = await this.client.verify.v2
        .services(this.serviceSid)
        .verifications.create({
          to: e164,
          channel: 'sms',
          ...(this.locale ? { locale: this.locale } : {}),
        });

      return {
        sid: verification.sid,
        status: verification.status,
        channel: verification.channel,
      };
    } catch (err) {
      throw toTwilioVerifyApiError(err);
    }
  }

  async checkVerification(e164: string, code: string): Promise<CheckVerificationResult> {
    try {
      const check = await this.client.verify.v2
        .services(this.serviceSid)
        .verificationChecks.create({
          to: e164,
          code,
        });

      return {
        sid: check.sid,
        status: check.status,
        valid: check.valid,
      };
    } catch (err) {
      throw toTwilioVerifyApiError(err);
    }
  }
}
