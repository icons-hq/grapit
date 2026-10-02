import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';

/**
 * Upper bounds for Toss calls so a stalled provider cannot hold a confirm
 * request (and its confirm lease and seat locks) until the platform timeout.
 * A timed-out call has an unknown provider outcome; callers must reconcile it.
 */
export const TOSS_CONFIRM_TIMEOUT_MS = 30_000;
export const TOSS_CANCEL_TIMEOUT_MS = 60_000;
export const TOSS_QUERY_TIMEOUT_MS = 15_000;

/**
 * Confirm failures whose provider outcome is unknown: the approval may or may
 * not have happened, so the payment must be looked up before deciding.
 */
export const TOSS_CONFIRM_OUTCOME_UNKNOWN_CODES = new Set([
  'PROVIDER_TIMEOUT',
  'NETWORK_ERROR',
  'INVALID_PROVIDER_RESPONSE',
  'ALREADY_PROCESSED_PAYMENT',
  'IDEMPOTENT_REQUEST_PROCESSING',
]);

const tossPaymentResponseSchema = z.object({
  paymentKey: z.string().min(1),
  orderId: z.string().min(1),
  status: z.string().min(1),
  totalAmount: z.number().finite(),
  currency: z.string().optional(),
  method: z.string().nullable().optional(),
  approvedAt: z.string().nullable().optional(),
}).passthrough();

/**
 * Returns the payment when the body has the minimal Toss payment shape
 * (paymentKey, orderId, status, totalAmount), otherwise null. A malformed
 * body proves nothing about the payment.
 */
export function parseTossPaymentResponse(data: unknown): TossPaymentResponse | null {
  const parsed = tossPaymentResponseSchema.safeParse(data);
  return parsed.success ? parsed.data as TossPaymentResponse : null;
}

export interface TossPaymentResponse {
  paymentKey: string;
  orderId: string;
  method?: string | null;
  isPartialCancelable?: boolean;
  totalAmount: number;
  currency?: string;
  balanceAmount?: number;
  status: string;
  approvedAt?: string | null;
  card?: { settlementStatus?: string | null } | null;
  transfer?: { settlementStatus?: string | null } | null;
  virtualAccount?: { settlementStatus?: string | null } | null;
  cancels?: Array<{
    cancelAmount: number;
    cancelReason: string;
    canceledAt: string;
    cancelStatus?: string;
    transactionKey?: string;
    cancelRequestId?: string | null;
  }>;
}

export interface TossPaymentRequestOptions {
  idempotencyKey?: string;
  secretKeyScope?: 'default' | 'overseas-card' | 'foreign-easy-pay';
}

export interface TossSettlementQueryOptions extends TossPaymentRequestOptions {
  startDate: string;
  endDate: string;
  dateType: 'soldDate' | 'paidOutDate';
}

export interface TossSettlementRow {
  paymentKey: string;
  transactionKey?: string;
  currency?: string;
  amount: number;
  fee: number;
  supplyAmount: number;
  vat: number;
  payOutAmount: number;
  soldDate: string;
  paidOutDate: string;
  method?: string | null;
}

const TOSS_SETTLEMENT_PAGE_SIZE = 5_000;

export interface TossPaymentCancelOptions extends TossPaymentRequestOptions {
  cancelAmount?: number;
  currency?: string;
  cancelRequestId?: string;
}

export class TossPaymentError extends Error {
  public readonly code: string;
  /** HTTP status returned by Toss; undefined when no response was received. */
  public readonly httpStatus?: number;

  constructor(code: string, message: string, httpStatus?: number) {
    super(message);
    this.name = 'TossPaymentError';
    this.code = code;
    if (httpStatus !== undefined) {
      this.httpStatus = httpStatus;
    }
  }
}

/**
 * True when a confirm call failed without proving that Toss did not approve
 * the payment (no response, timeout, malformed body, 5xx, or a duplicate
 * confirm). False only for provider rejections that prove non-approval.
 */
export function isTossConfirmOutcomeUnknown(error: unknown): boolean {
  if (!(error instanceof TossPaymentError)) {
    return true;
  }
  if (TOSS_CONFIRM_OUTCOME_UNKNOWN_CODES.has(error.code)) {
    return true;
  }
  return typeof error.httpStatus === 'number' && error.httpStatus >= 500;
}

@Injectable()
export class TossPaymentsClient {
  private readonly secretKey: string;
  private readonly overseasCardSecretKey: string;
  private readonly foreignEasyPaySecretKey: string;
  private readonly baseUrl = 'https://api.tosspayments.com/v1';

  constructor(private readonly configService: ConfigService) {
    this.secretKey = this.configService.get<string>('TOSS_SECRET_KEY', '');
    this.overseasCardSecretKey =
      this.configService.get<string>('TOSS_OVERSEAS_CARD_SECRET_KEY', '');
    this.foreignEasyPaySecretKey =
      this.configService.get<string>('TOSS_FOREIGN_EASY_PAY_SECRET_KEY', '');
  }

  getOverseasCardAvailability(): { enabled: boolean; disabledReason?: string } {
    if (this.isWidgetSecretKey(this.overseasCardSecretKey)) {
      return { enabled: true };
    }

    if (this.overseasCardSecretKey.trim().length > 0) {
      return {
        enabled: false,
        disabledReason: 'OVERSEAS_CARD_WIDGET_SECRET_KEY_INVALID',
      };
    }

    return {
      enabled: false,
      disabledReason: 'OVERSEAS_CARD_SECRET_KEY_MISSING',
    };
  }

  private getSecretKey(scope: TossPaymentRequestOptions['secretKeyScope']): string {
    if (scope === 'overseas-card') {
      if (!this.overseasCardSecretKey) {
        throw new TossPaymentError(
          'MISSING_OVERSEAS_CARD_SECRET_KEY',
          'TOSS_OVERSEAS_CARD_SECRET_KEY is required for overseas card payments',
        );
      }
      if (!this.isWidgetSecretKey(this.overseasCardSecretKey)) {
        throw new TossPaymentError(
          'INVALID_OVERSEAS_CARD_SECRET_KEY',
          'TOSS_OVERSEAS_CARD_SECRET_KEY must be a Toss payment widget secret key',
        );
      }
      return this.overseasCardSecretKey;
    }
    if (scope === 'foreign-easy-pay') {
      if (!this.foreignEasyPaySecretKey) {
        throw new TossPaymentError(
          'MISSING_FOREIGN_EASY_PAY_SECRET_KEY',
          'TOSS_FOREIGN_EASY_PAY_SECRET_KEY is required for foreign easy pay payments',
        );
      }
      return this.foreignEasyPaySecretKey;
    }

    return this.secretKey;
  }

  private getAuthHeader(scope?: TossPaymentRequestOptions['secretKeyScope']): string {
    return `Basic ${Buffer.from(this.getSecretKey(scope) + ':').toString('base64')}`;
  }

  private isWidgetSecretKey(value: string): boolean {
    return /^(test|live)_gsk_/.test(value.trim());
  }

  private buildHeaders(
    options: TossPaymentRequestOptions = {},
  ): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: this.getAuthHeader(options.secretKeyScope),
      'Content-Type': 'application/json',
    };

    if (options.idempotencyKey) {
      headers['Idempotency-Key'] = options.idempotencyKey;
    }

    return headers;
  }

  private toPaymentError(
    data: unknown,
    fallbackMessage: string,
    httpStatus?: number,
  ): TossPaymentError {
    const errorBody = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return new TossPaymentError(
      typeof errorBody.code === 'string' ? errorBody.code : 'UNKNOWN_ERROR',
      this.redactSensitiveMessage(
        typeof errorBody.message === 'string'
          ? errorBody.message
          : fallbackMessage,
      ),
      typeof httpStatus === 'number' ? httpStatus : undefined,
    );
  }

  private isTimeoutError(error: unknown): boolean {
    const name = (error as { name?: unknown } | null)?.name;
    return name === 'TimeoutError' || name === 'AbortError';
  }

  private redactSensitiveMessage(message: string): string {
    let redacted = message;

    if (this.secretKey) {
      redacted = redacted.replace(
        new RegExp(this.escapeRegExp(this.secretKey), 'g'),
        '[redacted toss secret]',
      );
    }
    if (this.overseasCardSecretKey) {
      redacted = redacted.replace(
        new RegExp(this.escapeRegExp(this.overseasCardSecretKey), 'g'),
        '[redacted toss secret]',
      );
    }
    if (this.foreignEasyPaySecretKey) {
      redacted = redacted.replace(
        new RegExp(this.escapeRegExp(this.foreignEasyPaySecretKey), 'g'),
        '[redacted toss secret]',
      );
    }

    return redacted
      .replace(/\b(?:test|live)_sk_[A-Za-z0-9_-]+/g, '[redacted toss secret]')
      .replace(/\bpay_[A-Za-z0-9_-]+/g, '[redacted paymentKey]');
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async confirmPayment(params: {
    paymentKey: string;
    orderId: string;
    amount: number;
    idempotencyKey?: string;
    secretKeyScope?: TossPaymentRequestOptions['secretKeyScope'];
  }): Promise<TossPaymentResponse> {
    // Built before the request so key configuration errors stay definitive
    // (nothing was sent to Toss).
    const headers = this.buildHeaders({
      idempotencyKey: params.idempotencyKey,
      secretKeyScope: params.secretKeyScope,
    });

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/payments/confirm`, {
        method: 'POST',
        signal: AbortSignal.timeout(TOSS_CONFIRM_TIMEOUT_MS),
        headers,
        body: JSON.stringify({
          paymentKey: params.paymentKey,
          orderId: params.orderId,
          amount: params.amount,
        }),
      });
    } catch (error) {
      throw this.isTimeoutError(error)
        ? new TossPaymentError('PROVIDER_TIMEOUT', '결제 승인 응답 시간이 초과되었습니다')
        : new TossPaymentError('NETWORK_ERROR', '결제 승인 요청 중 통신 오류가 발생했습니다');
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch (error) {
      throw this.isTimeoutError(error)
        ? new TossPaymentError('PROVIDER_TIMEOUT', '결제 승인 응답 시간이 초과되었습니다', response.status)
        : new TossPaymentError(
            'INVALID_PROVIDER_RESPONSE',
            '결제 승인 응답을 확인할 수 없습니다',
            response.status,
          );
    }

    if (!response.ok) {
      throw this.toPaymentError(data, '결제 승인에 실패했습니다', response.status);
    }

    const parsed = tossPaymentResponseSchema.safeParse(data);
    if (!parsed.success) {
      throw new TossPaymentError(
        'INVALID_PROVIDER_RESPONSE',
        '결제 승인 응답 형식을 확인할 수 없습니다',
        response.status,
      );
    }

    return parsed.data as TossPaymentResponse;
  }

  async cancelPayment(
    paymentKey: string,
    reason: string,
    options: TossPaymentCancelOptions = {},
  ): Promise<TossPaymentResponse> {
    const body: {
      cancelReason: string;
      cancelAmount?: number;
      currency?: string;
      cancelRequestId?: string;
    } = {
      cancelReason: reason,
    };

    if (options.cancelAmount !== undefined) {
      body.cancelAmount = options.cancelAmount;
    }
    if (options.currency !== undefined) {
      body.currency = options.currency;
    }
    if (options.cancelRequestId !== undefined) {
      body.cancelRequestId = options.cancelRequestId;
    }

    const response = await fetch(
      `${this.baseUrl}/payments/${encodeURIComponent(paymentKey)}/cancel`,
      {
        method: 'POST',
        // A timeout leaves the cancel outcome unknown; callers retry with the
        // same idempotency key or reconcile through queryPayment.
        signal: AbortSignal.timeout(TOSS_CANCEL_TIMEOUT_MS),
        headers: this.buildHeaders(options),
        body: JSON.stringify(body),
      },
    );

    const data: unknown = await response.json();

    if (!response.ok) {
      throw this.toPaymentError(data, '결제 취소에 실패했습니다', response.status);
    }

    // TODO: zod 스키마로 런타임 검증 추가 (현재는 타입 단언만 수행)
    return data as TossPaymentResponse;
  }

  async queryPayment(
    paymentKey: string,
    options: TossPaymentRequestOptions = {},
  ): Promise<TossPaymentResponse> {
    const response = await fetch(
      `${this.baseUrl}/payments/${encodeURIComponent(paymentKey)}`,
      {
        method: 'GET',
        signal: AbortSignal.timeout(TOSS_QUERY_TIMEOUT_MS),
        headers: {
          Authorization: this.getAuthHeader(options.secretKeyScope),
        },
      },
    );

    const data: unknown = await response.json();

    if (!response.ok) {
      throw this.toPaymentError(data, '결제 상태 조회에 실패했습니다', response.status);
    }

    // TODO: zod 스키마로 런타임 검증 추가 (현재는 타입 단언만 수행)
    return data as TossPaymentResponse;
  }

  async querySettlements(
    options: TossSettlementQueryOptions,
  ): Promise<TossSettlementRow[]> {
    const rows: TossSettlementRow[] = [];
    let page = 1;

    while (true) {
      const params = new URLSearchParams({
        startDate: options.startDate,
        endDate: options.endDate,
        dateType: options.dateType,
        page: String(page),
        size: String(TOSS_SETTLEMENT_PAGE_SIZE),
      });

      const response = await fetch(`${this.baseUrl}/settlements?${params.toString()}`, {
        method: 'GET',
        signal: AbortSignal.timeout(65_000),
        headers: {
          Authorization: this.getAuthHeader(options.secretKeyScope),
        },
      });

      const data: unknown = await response.json();

      if (!response.ok) {
        throw this.toPaymentError(data, '정산 내역 조회에 실패했습니다');
      }

      if (!Array.isArray(data)) throw new TossPaymentError('INVALID_SETTLEMENT_RESPONSE', '정산 응답 형식을 확인할 수 없습니다');
      const pageRows = data as TossSettlementRow[];
      rows.push(...pageRows);

      if (pageRows.length < TOSS_SETTLEMENT_PAGE_SIZE) {
        return rows;
      }

      page += 1;
    }
  }
}
