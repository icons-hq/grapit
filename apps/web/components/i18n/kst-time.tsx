import type { SupportedLocale } from '@grabit/shared';
import { cn } from '@/lib';
import { formatEventTimeWithKstAnchor } from '@/lib/i18n/format';
import { getVisibleCopy } from '@/lib/i18n/visible-copy';

type KstTimeProps = {
  value: string | Date;
  locale: SupportedLocale;
  localTimeZone?: string;
  className?: string;
};

/**
 * An exact instant (such as a showtime) anchored in KST with the viewer's local
 * time as secondary text. Date-only values such as the performance period must
 * use PerformancePeriod instead, or the local line shows the previous day.
 */
export function KstTime({
  value,
  locale,
  localTimeZone,
  className,
}: KstTimeProps) {
  const formatted = formatEventTimeWithKstAnchor(value, locale, {
    localTimeZone,
  });
  const localLabel = getVisibleCopy(locale).locale.localTime;

  return (
    <span className={cn('inline-flex min-w-0 flex-col gap-0.5', className)}>
      <time className="font-semibold text-gray-900" dateTime={toDateTime(value)}>
        {formatted.kst}
      </time>
      {formatted.local && (
        <span className="text-xs text-gray-500">
          {localLabel}: {formatted.local}
        </span>
      )}
    </span>
  );
}

function toDateTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
