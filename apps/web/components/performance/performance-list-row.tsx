import Image from 'next/image';
import Link from 'next/link';
import { CalendarDays, ChevronRight, MapPin, Ticket } from 'lucide-react';
import type { PerformanceCardData, SupportedLocale } from '@grabit/shared';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import { getVisibleCopy } from '@/lib/i18n/visible-copy';
import { formatEventTimeWithKstAnchor } from '@/lib/i18n/format';
import { formatCatalogDateRange } from '@/lib/performance/catalog-format';
import { getDisplayPerformanceStatus, StatusBadge } from './status-badge';

export function PerformanceListRow({ performance, locale, bookingEnabled }: {
  performance: PerformanceCardData; locale: SupportedLocale; bookingEnabled: boolean;
}) {
  const copy = getVisibleCopy(locale).home;
  const status = getDisplayPerformanceStatus(performance.status, bookingEnabled);
  const validStart = Boolean(performance.startDate) && Number.isFinite(Date.parse(performance.startDate));
  const start = formatCatalogDateRange(performance.startDate, performance.endDate, locale) ?? copy.dateUnknown;
  const price = performance.minPrice == null ? copy.priceUnknown
    : copy.priceFrom.replace('{price}', `KRW ${new Intl.NumberFormat(locale).format(performance.minPrice)}`);
  const opensAt = performance.status === 'upcoming' && performance.bookingStartsAt
    ? formatEventTimeWithKstAnchor(performance.bookingStartsAt, locale, { includeLocalTime: false }).kst : null;

  return <li className="border-b border-border last:border-b-0">
    <Link href={getLocalizedPathname(`/performance/${performance.id}`, locale)}
      className="group grid grid-cols-[88px_minmax(0,1fr)] gap-4 rounded-md py-5 outline-offset-4 transition-colors hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-primary sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-6 md:grid-cols-[176px_minmax(0,1fr)_220px_24px] md:items-center md:py-6">
      <div className="relative aspect-[3/2] overflow-hidden rounded-md bg-muted max-sm:aspect-[3/4]">
        {performance.posterUrl ? <Image src={performance.posterUrl} alt="" fill sizes="(min-width:768px) 176px, 25vw" className="object-cover transition-transform group-hover:scale-[1.02]" />
          : <div className="flex h-full items-center justify-center"><Ticket className="size-8 text-muted-foreground" aria-hidden="true" /></div>}
      </div>
      <div className="min-w-0 space-y-2">
        <h3 className="text-base font-semibold leading-snug tracking-tight sm:text-xl">{performance.title}</h3>
        <p className="flex items-start gap-2 text-xs text-muted-foreground sm:text-sm"><CalendarDays className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><time dateTime={validStart ? performance.startDate : undefined}>{start}</time></p>
        {performance.venueName && <p className="flex items-start gap-2 text-xs text-muted-foreground sm:text-sm"><MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{performance.venueName}</p>}
        <p className="text-sm font-medium">{price}<span className="ml-2 text-xs font-normal text-muted-foreground">{performance.minPrice != null ? copy.feeSeparate : ''}</span></p>
        <span className="inline-block md:hidden"><StatusBadge status={status} locale={locale} /></span>
      </div>
      <div className="col-start-2 space-y-2 md:col-auto">
        <span className="hidden md:inline-block"><StatusBadge status={status} locale={locale} /></span>
        <p className="text-xs text-muted-foreground sm:text-sm">{opensAt ? copy.bookingOpens.replace('{date}', opensAt) : copy.statusHelp[status]}</p>
      </div>
      <ChevronRight className="hidden size-5 text-muted-foreground md:block" aria-hidden="true" />
    </Link>
  </li>;
}
