import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type ParsedDecimalRate = {
  normalized: string;
  numerator: bigint;
  scale: bigint;
};

export type PaypalProviderChargeQuote = {
  currency: 'USD';
  amountMinor: number;
  amountDecimal: string;
  rate: string;
  quotedAt: string;
};

@Injectable()
export class ProviderChargeQuoteService {
  private readonly paypalCheckoutEnabled: boolean;
  private readonly paypalRate?: ParsedDecimalRate;

  constructor(private readonly configService: ConfigService) {
    this.paypalCheckoutEnabled =
      this.configService.get<string>('PAYPAL_CHECKOUT_ENABLED')?.trim().toLowerCase()
      === 'true';

    if (!this.paypalCheckoutEnabled) {
      return;
    }

    const rate = this.configService.get<string>('PAYPAL_KRW_USD_RATE');
    this.paypalRate = this.parseRate(rate);
  }

  isPaypalCheckoutEnabled(): boolean {
    return this.paypalCheckoutEnabled;
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

  createPaypalQuote(input: {
    reservationPayableAmount: number;
    now: Date;
  }): PaypalProviderChargeQuote {
    if (!this.paypalCheckoutEnabled || !this.paypalRate) {
      throw new Error('PAYPAL_CHECKOUT_ENABLED is false');
    }
    if (!Number.isInteger(input.reservationPayableAmount) || input.reservationPayableAmount <= 0) {
      throw new Error('reservationPayableAmount must be a positive integer');
    }

    const krw = BigInt(input.reservationPayableAmount);
    const unroundedCents = krw * this.paypalRate.numerator * 100n;
    const amountMinorBigInt =
      (unroundedCents + this.paypalRate.scale / 2n) / this.paypalRate.scale;

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
      rate: this.paypalRate.normalized,
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
