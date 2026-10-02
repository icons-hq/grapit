import type { SupportedLocale } from '@grabit/shared';
import { formatCatalogDateRange } from '@/lib/performance/catalog-format';

/**
 * The performance period is a pair of KST calendar dates stored as KST-midnight
 * timestamps. It is shown as dates only (never as a 00:00 instant or converted
 * to the viewer's time zone) so every locale sees the same first and last day.
 */
export function PerformancePeriod({
  startDate,
  endDate,
  locale,
  fallback,
  className,
}: {
  startDate: string;
  endDate: string;
  locale: SupportedLocale;
  fallback: string;
  className?: string;
}) {
  const label = formatCatalogDateRange(startDate, endDate, locale);
  if (!label) return <span className={className}>{fallback}</span>;

  return (
    <time className={className} dateTime={toKstCalendarDate(startDate)}>
      {label}
    </time>
  );
}

function toKstCalendarDate(value: string): string | undefined {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  // en-CA formats as YYYY-MM-DD, a valid <time datetime> date string.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    calendar: 'gregory',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
