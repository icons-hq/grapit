import type { ProviderChargeQuote, SupportedLocale } from '@grabit/shared';
import { getCheckoutCopy } from '@/lib/booking/checkout-copy';

/** The stored provider amount is a historical charge, never a new FX estimate. */
export function ProviderChargeAmount({ quote, locale }: { quote?: ProviderChargeQuote | null; locale: SupportedLocale }) {
  if (!quote) return null;
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3 rounded-lg bg-primary/5 p-3 text-sm">
      <span className="text-muted-foreground">{getCheckoutCopy(locale).charge}</span>
      <strong className="text-base tabular-nums text-primary">{quote.currency} {quote.amountDecimal}</strong>
    </div>
  );
}
