import { cn } from '@/lib';

type CurrencyDisplayProps = {
  krwAmount: number;
  className?: string;
};

export function CurrencyDisplay({
  krwAmount,
  className,
}: CurrencyDisplayProps) {
  return (
    <span className={cn('font-semibold text-gray-900', className)}>
      KRW {formatWholeNumber(krwAmount)}
    </span>
  );
}

function formatWholeNumber(value: number): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(value);
}
