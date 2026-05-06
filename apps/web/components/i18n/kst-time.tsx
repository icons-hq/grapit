import type { SupportedLocale } from '@grabit/shared';
import { cn } from '@/lib';
import { formatEventTimeWithKstAnchor } from '@/lib/i18n/format';

type KstTimeProps = {
  value: string | Date;
  locale: SupportedLocale;
  localTimeZone?: string;
  className?: string;
};

export function KstTime({
  value,
  locale,
  localTimeZone,
  className,
}: KstTimeProps) {
  const formatted = formatEventTimeWithKstAnchor(value, locale, {
    localTimeZone,
  });
  const localLabel = locale === 'ko' ? '현지 시간' : 'local time';

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
