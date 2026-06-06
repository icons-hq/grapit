import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type ParsedDecimalRate = {
  normalized: string;
  numerator: bigint;
  scale: bigint;
};

const DEFAULT_LOCAL_TEST_KRW_USD_RATE = '0.00068';

export type PaypalProviderChargeQuote = {
  currency: 'USD';
  amountMinor: number;
  amountDecimal: string;
  rate: string;
  quotedAt: string;
};

export type ForeignEasyPayProviderChargeQuote = PaypalProviderChargeQuote;
export type OverseasCardProviderChargeQuote = PaypalProviderChargeQuote;

@Injectable()
export class ProviderChargeQuoteService {
  private readonly paypalCheckoutEnabled: boolean;
  private readonly alipayCheckoutRequested: boolean;
  private readonly alipayCheckoutEnabled: boolean;
  private readonly alipaySecretConfigured: boolean;
  private readonly overseasCardSecretConfigured: boolean;
  private readonly overseasCardWidgetSecretConfigured: boolean;
  private readonly paypalRate?: ParsedDecimalRate;

  constructor(private readonly configService: ConfigService) {
    const paypalCheckoutFlag = this.configService
      .get<string>('PAYPAL_CHECKOUT_ENABLED')
      ?.trim()
      .toLowerCase();
    const isPaypalExplicitlyConfigured =
      paypalCheckoutFlag !== undefined && paypalCheckoutFlag.length > 0;
    const useLocalTestDefault =
      !isPaypalExplicitlyConfigured && this.isLocalTestKeyEnvironment();

    this.paypalCheckoutEnabled = isPaypalExplicitlyConfigured
      ? paypalCheckoutFlag === 'true'
      : useLocalTestDefault;

    const alipayCheckoutFlag = this.configService
      .get<string>('ALIPAY_CHECKOUT_ENABLED')
      ?.trim()
      .toLowerCase();
    this.alipayCheckoutRequested = alipayCheckoutFlag === 'true';
    this.alipaySecretConfigured =
      (this.configService.get<string>('TOSS_FOREIGN_EASY_PAY_SECRET_KEY') ?? '').trim().length > 0;
    this.alipayCheckoutEnabled =
      this.alipayCheckoutRequested && this.alipaySecretConfigured;
    this.overseasCardSecretConfigured =
      (this.configService.get<string>('TOSS_OVERSEAS_CARD_SECRET_KEY') ?? '').trim().length > 0;
    this.overseasCardWidgetSecretConfigured = this.isWidgetSecretKey(
      this.configService.get<string>('TOSS_OVERSEAS_CARD_SECRET_KEY') ?? '',
    );

    const paypalRate =
      this.configService.get<string>('PAYPAL_KRW_USD_RATE')
      ?? (useLocalTestDefault ? DEFAULT_LOCAL_TEST_KRW_USD_RATE : undefined);
    if (
      this.paypalCheckoutEnabled
      || this.alipayCheckoutEnabled
      || this.overseasCardSecretConfigured
    ) {
      this.paypalRate = this.parseRate(paypalRate);
    }
  }

  isPaypalCheckoutEnabled(): boolean {
    return this.paypalCheckoutEnabled;
  }

  isAlipayCheckoutEnabled(): boolean {
    return this.alipayCheckoutEnabled;
  }

  getPaypalAvailability(): { enabled: boolean; disabledReason?: string } {
    if (this.paypalCheckoutEnabled) {
      return { enabled: true };
    }

    return {
      enabled: false,
      disabledReason: 'PAYPAL_CHECKOUT_DISABLED',
    };
  }

  getAlipayAvailability(): { enabled: boolean; disabledReason?: string } {
    if (this.alipayCheckoutEnabled) {
      return { enabled: true };
    }

    if (this.alipayCheckoutRequested && !this.alipaySecretConfigured) {
      return {
        enabled: false,
        disabledReason: 'ALIPAY_SECRET_KEY_MISSING',
      };
    }

    return {
      enabled: false,
      disabledReason: 'ALIPAY_CHECKOUT_DISABLED',
    };
  }

  getForeignEasyPayAvailability(): { enabled: boolean; disabledReason?: string } {
    return this.getPaypalAvailability();
  }

  getOverseasCardAvailability(): { enabled: boolean; disabledReason?: string } {
    if (this.overseasCardWidgetSecretConfigured) {
      return { enabled: true };
    }

    if (this.overseasCardSecretConfigured) {
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

  createPaypalQuote(input: {
    reservationPayableAmount: number;
    now: Date;
  }): PaypalProviderChargeQuote {
    if (!this.paypalCheckoutEnabled) {
      throw new Error('PAYPAL_CHECKOUT_ENABLED is false');
    }

    return this.createProviderChargeQuote(input, this.paypalRate);
  }

  createForeignEasyPayQuote(input: {
    reservationPayableAmount: number;
    now: Date;
  }): ForeignEasyPayProviderChargeQuote {
    if ((!this.paypalCheckoutEnabled && !this.alipayCheckoutEnabled) || !this.paypalRate) {
      throw new Error('foreign easy pay checkout is disabled');
    }

    return this.createProviderChargeQuote(input, this.paypalRate);
  }

  createOverseasCardQuote(input: {
    reservationPayableAmount: number;
    now: Date;
  }): OverseasCardProviderChargeQuote {
    if (!this.overseasCardSecretConfigured) {
      throw new Error('TOSS_OVERSEAS_CARD_SECRET_KEY is missing');
    }
    if (!this.overseasCardWidgetSecretConfigured) {
      throw new Error('TOSS_OVERSEAS_CARD_SECRET_KEY must be a Toss payment widget secret key');
    }

    return this.createProviderChargeQuote(input, this.paypalRate);
  }

  private createProviderChargeQuote(input: {
    reservationPayableAmount: number;
    now: Date;
  }, rate: ParsedDecimalRate | undefined): ForeignEasyPayProviderChargeQuote {
    if (!rate) {
      throw new Error('PAYPAL_KRW_USD_RATE must be configured');
    }
    if (!Number.isInteger(input.reservationPayableAmount) || input.reservationPayableAmount <= 0) {
      throw new Error('reservationPayableAmount must be a positive integer');
    }

    const krw = BigInt(input.reservationPayableAmount);
    const unroundedCents = krw * rate.numerator * 100n;
    const amountMinorBigInt =
      (unroundedCents + rate.scale / 2n) / rate.scale;

    if (amountMinorBigInt <= 0n) {
      throw new Error('provider charge amount must be positive');
    }
    if (amountMinorBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('provider charge amount exceeds safe integer range');
    }

    const amountMinor = Number(amountMinorBigInt);

    return {
      currency: 'USD',
      amountMinor,
      amountDecimal: this.formatMinorToDecimal(amountMinor),
      rate: rate.normalized,
      quotedAt: input.now.toISOString(),
    };
  }

  parseProviderDecimalToMinor(value: string): number {
    const trimmed = value.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
      throw new Error('provider charge amount must be a decimal string with up to 2 digits');
    }

    const [whole, fraction = ''] = trimmed.split('.');
    const amountMinorBigInt =
      BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0');

    if (
      amountMinorBigInt <= 0n
      || amountMinorBigInt > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      throw new Error('provider charge amount is too large');
    }

    return Number(amountMinorBigInt);
  }

  private parseRate(value: string | undefined): ParsedDecimalRate {
    const raw = value?.trim();
    if (!raw || !/^\d+(\.\d+)?$/.test(raw)) {
      throw new Error('PAYPAL_KRW_USD_RATE must be a positive decimal string');
    }

    const normalized = this.normalizeDecimalString(raw);
    const [whole, fraction = ''] = normalized.split('.');
    const scale = 10n ** BigInt(fraction.length);
    const numerator = BigInt(`${whole}${fraction}`);

    if (numerator <= 0n) {
      throw new Error('PAYPAL_KRW_USD_RATE must be a positive decimal string');
    }

    return { normalized, numerator, scale };
  }

  private isLocalTestKeyEnvironment(): boolean {
    const nodeEnv = this.configService.get<string>('NODE_ENV')?.trim().toLowerCase();
    if (nodeEnv === 'production') {
      return false;
    }

    return this.configService.get<string>('TOSS_SECRET_KEY')?.startsWith('test_') === true;
  }

  private isWidgetSecretKey(value: string): boolean {
    return /^(test|live)_gsk_/.test(value.trim());
  }

  private normalizeDecimalString(value: string): string {
    if (!value.includes('.')) {
      return value.replace(/^0+(?=\d)/, '') || '0';
    }

    const [wholePart, fractionPart] = value.split('.');
    const whole = wholePart.replace(/^0+(?=\d)/, '') || '0';
    const trimmedFraction = fractionPart.replace(/0+$/, '');
    return `${whole}.${trimmedFraction || '0'}`;
  }

  private formatMinorToDecimal(amountMinor: number): string {
    const whole = Math.floor(amountMinor / 100);
    const fraction = String(amountMinor % 100).padStart(2, '0');
    return `${whole}.${fraction}`;
  }
}
