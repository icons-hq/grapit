import type { ProviderChargeQuote, SupportedLocale } from '@grabit/shared';
import { getCheckoutCopy } from '@/lib/booking/checkout-copy';
import { getPaymentRecoveryCopy } from '@/lib/booking/payment-recovery-copy';

/** The stored provider amount is a historical charge, never a new FX estimate. */
export function ProviderChargeAmount({ quote, locale, paid = true }: { quote?: ProviderChargeQuote | null; locale: SupportedLocale; paid?: boolean }) {
  if (!quote) return null;
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3 rounded-lg bg-primary/5 p-3 text-sm">
      <span className="text-muted-foreground">{paid ? getCheckoutCopy(locale).charge : getPaymentRecoveryCopy(locale).pendingCharge}</span>
      <strong className="text-base tabular-nums text-primary">{quote.currency} {quote.amountDecimal}</strong>
    </div>
  );
}
