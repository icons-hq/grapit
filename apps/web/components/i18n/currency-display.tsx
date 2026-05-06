import type { SupportedLocale } from '@grabit/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib';
import {
  type ExchangeRateEstimate,
  formatKrwWithEstimate,
} from '@/lib/i18n/format';

type CurrencyDisplayProps = {
  krwAmount: number;
  locale: SupportedLocale;
  exchangeRate?: ExchangeRateEstimate;
  className?: string;
};

export function CurrencyDisplay({
  krwAmount,
  locale,
  exchangeRate,
  className,
}: CurrencyDisplayProps) {
  const formatted = formatKrwWithEstimate(krwAmount, locale, exchangeRate);

  return (
    <span className={cn('inline-flex min-w-0 flex-col items-end gap-1', className)}>
      <span className="font-semibold text-gray-900">{formatted.source}</span>
      <span className="text-xs text-gray-600">{formatted.estimate}</span>
      <Badge
        variant="outline"
        className="max-w-[220px] justify-end whitespace-normal border-amber-200 bg-amber-50 text-right text-[11px] leading-snug text-amber-800"
      >
        {formatted.disclaimer}
      </Badge>
    </span>
  );
}
