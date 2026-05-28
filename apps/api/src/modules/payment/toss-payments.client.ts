import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface TossPaymentResponse {
  paymentKey: string;
  orderId: string;
  method: string;
  totalAmount: number;
  status: string;
  approvedAt: string;
  cancels?: Array<{
    cancelAmount: number;
    cancelReason: string;
    canceledAt: string;
  }>;
}

export interface TossPaymentRequestOptions {
  idempotencyKey?: string;
}

export interface TossPaymentCancelOptions extends TossPaymentRequestOptions {
  cancelAmount?: number;
}

export class TossPaymentError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'TossPaymentError';
    this.code = code;
  }
}

@Injectable()
export class TossPaymentsClient {
  private readonly secretKey: string;
  private readonly baseUrl = 'https://api.tosspayments.com/v1';

  constructor(private readonly configService: ConfigService) {
    this.secretKey = this.configService.get<string>('TOSS_SECRET_KEY', '');
  }

  private getAuthHeader(): string {
    return `Basic ${Buffer.from(this.secretKey + ':').toString('base64')}`;
  }

  private buildHeaders(
    options: TossPaymentRequestOptions = {},
  ): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: this.getAuthHeader(),
      'Content-Type': 'application/json',
    };

    if (options.idempotencyKey) {
      headers['Idempotency-Key'] = options.idempotencyKey;
    }

    return headers;
  }

  private toPaymentError(data: unknown, fallbackMessage: string): TossPaymentError {
    const errorBody = data as Record<string, unknown>;
    return new TossPaymentError(
      typeof errorBody.code === 'string' ? errorBody.code : 'UNKNOWN_ERROR',
      this.redactSensitiveMessage(
        typeof errorBody.message === 'string'
          ? errorBody.message
          : fallbackMessage,
      ),
    );
  }

  private redactSensitiveMessage(message: string): string {
    let redacted = message;

    if (this.secretKey) {
      redacted = redacted.replace(
        new RegExp(this.escapeRegExp(this.secretKey), 'g'),
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
  }): Promise<TossPaymentResponse> {
    const response = await fetch(`${this.baseUrl}/payments/confirm`, {
      method: 'POST',
      headers: this.buildHeaders({ idempotencyKey: params.idempotencyKey }),
      body: JSON.stringify({
        paymentKey: params.paymentKey,
        orderId: params.orderId,
        amount: params.amount,
      }),
    });

    const data: unknown = await response.json();

    if (!response.ok) {
      throw this.toPaymentError(data, '결제 승인에 실패했습니다');
    }

    // TODO: zod 스키마로 런타임 검증 추가 (현재는 타입 단언만 수행)
    return data as TossPaymentResponse;
  }

  async cancelPayment(
    paymentKey: string,
    reason: string,
    options: TossPaymentCancelOptions = {},
  ): Promise<TossPaymentResponse> {
    const body: { cancelReason: string; cancelAmount?: number } = {
      cancelReason: reason,
    };

    if (options.cancelAmount !== undefined) {
      body.cancelAmount = options.cancelAmount;
    }

    const response = await fetch(
      `${this.baseUrl}/payments/${encodeURIComponent(paymentKey)}/cancel`,
      {
        method: 'POST',
        headers: this.buildHeaders(options),
        body: JSON.stringify(body),
      },
    );

    const data: unknown = await response.json();

    if (!response.ok) {
      throw this.toPaymentError(data, '결제 취소에 실패했습니다');
    }

    // TODO: zod 스키마로 런타임 검증 추가 (현재는 타입 단언만 수행)
    return data as TossPaymentResponse;
  }

  async queryPayment(paymentKey: string): Promise<TossPaymentResponse> {
    const response = await fetch(
      `${this.baseUrl}/payments/${encodeURIComponent(paymentKey)}`,
      {
        method: 'GET',
        headers: {
          Authorization: this.getAuthHeader(),
        },
      },
    );

    const data: unknown = await response.json();

    if (!response.ok) {
      throw this.toPaymentError(data, '결제 상태 조회에 실패했습니다');
    }

    // TODO: zod 스키마로 런타임 검증 추가 (현재는 타입 단언만 수행)
    return data as TossPaymentResponse;
  }
}
