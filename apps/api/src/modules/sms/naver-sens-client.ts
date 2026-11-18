import { createHmac } from 'node:crypto';

export interface NaverSensConfig {
  accessKey: string;
  secretKey: string;
  serviceId: string;
  from: string;
  companyName: string;
}

/** Never retain a response body, request, cause, phone or OTP in this error. */
export class NaverSensApiError extends Error {
  constructor(
    readonly status: number,
    readonly outcome: 'rejected' | 'unknown',
  ) {
    super('NAVER SENS API ' + status + ' (' + outcome + ')');
    this.name = 'NaverSensApiError';
  }
}

export const SENS_REQUEST_TIMEOUT_MS = 10_000;

export function validateNaverSensConfig(config: NaverSensConfig): void {
  for (const [name, value] of Object.entries(config)) {
    if (!value || value !== value.trim()) throw new Error('[sms] Invalid SENS ' + name);
  }
  if (!/^[A-Za-z0-9:_-]{1,200}$/.test(config.serviceId)) {
    throw new Error('[sms] Invalid SENS serviceId');
  }
  if (!/^\d{8,15}$/.test(config.from)) throw new Error('[sms] Invalid SENS from');
  // Keep the approved template ASCII, without brackets/newlines/URLs supplied
  // by a caller. This also stays below SENS's 90-byte SMS limit (EUC-KR).
  if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{0,39}$/.test(config.companyName)) {
    throw new Error('[sms] Invalid SENS companyName');
  }
}

/** Send-only transport. OTP creation/verification belongs to SensOtpStore. */
export class NaverSensClient {
  constructor(private readonly config: NaverSensConfig) {
    validateNaverSensConfig(config);
  }

  async sendCode(e164: string, code: string): Promise<{ requestId: string }> {
    if (!/^\+861\d{10}$/.test(e164) || !/^\d{6}$/.test(code)) {
      throw new Error('[sms] Invalid China OTP request');
    }
    const path = '/sms/v2/services/' + this.config.serviceId + '/messages';
    const timestamp = String(Date.now());
    const signature = createHmac('sha256', this.config.secretKey)
      .update('POST ' + path + '\n' + timestamp + '\n' + this.config.accessKey)
      .digest('base64');
    let response: Response;
    try {
      response = await fetch('https://sens.apigw.ntruss.com' + path, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(SENS_REQUEST_TIMEOUT_MS),
        headers: {
          'Content-Type': 'application/json',
          'x-ncp-apigw-timestamp': timestamp,
          'x-ncp-iam-access-key': this.config.accessKey,
          'x-ncp-apigw-signature-v2': signature,
        },
        body: JSON.stringify({
          type: 'SMS',
          contentType: 'COMM',
          countryCode: '86',
          from: this.config.from,
          content: '[' + this.config.companyName + '] verification: ' + code,
          messages: [{ to: e164.slice(3) }],
        }),
      });
    } catch {
      // A timeout may have delivered a billable SMS. Never retry automatically
      // or tell the caller it is safe to release the send budget.
      throw new NaverSensApiError(0, 'unknown');
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new NaverSensApiError(
        response.status,
        response.status >= 500 || response.status === 408 ? 'unknown' : 'rejected',
      );
    }
    let body: { statusCode?: unknown; statusName?: unknown; requestId?: unknown };
    try {
      body = await response.json() as typeof body;
    } catch {
      throw new NaverSensApiError(response.status, 'unknown');
    }
    if (response.status !== 202 || body?.statusCode !== '202'
      || body.statusName !== 'success' || typeof body.requestId !== 'string'
      || !/^[A-Za-z0-9_-]{1,200}$/.test(body.requestId)) {
      throw new NaverSensApiError(response.status, 'unknown');
    }
    return { requestId: body.requestId };
  }
}
