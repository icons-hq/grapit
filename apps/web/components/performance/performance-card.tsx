'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useLocale } from 'next-intl';
import { Ticket } from 'lucide-react';
import { formatCatalogDateRange } from '@/lib/performance/catalog-format';
import { cn } from '@/lib/cn';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import { getVisibleCopy, resolveVisibleCopyLocale } from '@/lib/i18n/visible-copy';
import { getTicketCopy } from '@/lib/i18n/ticket-copy';
import { useRuntimeFlags } from '@/hooks/use-runtime-flags';
import { useServerTimeReached } from '@/hooks/use-server-clock';
import { getDisplayPerformanceStatus, StatusBadge } from './status-badge';
import { parseBookingStartMs, resolveBookingStartPerformanceStatus, formatBookingOpensAtKst } from './performance-display-status';
import type { PerformanceCardData } from '@grabit/shared';

interface PerformanceCardProps {
  performance: PerformanceCardData;
  className?: string;
  priority?: boolean;
  variant?: 'poster' | 'opening' | 'ranking';
  rank?: number;
  rankPlacement?: 'poster' | 'body';
}

export function PerformanceCard({ performance, className, priority = false, variant = 'poster', rank, rankPlacement = 'poster' }: PerformanceCardProps) {
  const locale = resolveVisibleCopyLocale(useLocale());
  const copy = getVisibleCopy(locale);
  const ticket = getTicketCopy(locale);
  const { bookingEnabled, isResolved: flagsResolved } = useRuntimeFlags();
  const reached = useServerTimeReached(parseBookingStartMs(performance.bookingStartsAt));
  const saleStatus = resolveBookingStartPerformanceStatus(performance.status, performance.bookingStartsAt, !reached);
  const displayStatus = getDisplayPerformanceStatus(saleStatus, bookingEnabled, flagsResolved);
  const opening = formatBookingOpensAtKst(performance.bookingStartsAt, locale);
  return <Link href={getLocalizedPathname(`/performance/${performance.id}`, locale)}
    className={cn('ticket-card', variant === 'opening' && 'ticket-card-opening', variant === 'ranking' && 'ticket-card-ranking', className)}>
    <div className="ticket-card-art">
      {performance.posterUrl ? <>
        {variant === 'opening' && <Image src={performance.posterUrl} alt="" fill sizes="250px" className="ticket-card-backdrop" aria-hidden="true" />}
        <Image src={performance.posterUrl} alt={`${performance.title} ${copy.performance.posterAltSuffix}`} fill
          className="ticket-card-poster" sizes="(max-width: 767px) 45vw, (max-width: 1024px) 30vw, 240px" priority={priority} />
      </> : <div className="ticket-poster-missing"><Ticket size={32} aria-hidden="true" /><span>{ticket.untitledPoster}</span></div>}
      {rank !== undefined && rankPlacement === 'poster' && <span className="ticket-card-rank" aria-label={`${rank}`}>{rank}</span>}
    </div>
    <div className="ticket-card-body">
      {rank !== undefined && rankPlacement === 'body' && <strong className="ticket-card-body-rank">{rank}</strong>}
      {variant === 'opening' && <p className="ticket-opening-date">{opening ?? ticket.openingTbd}</p>}
      <h3>{performance.title}</h3>
      {variant !== 'opening' && <>
        {performance.venueName && <p className="ticket-card-venue">{performance.venueName}</p>}
        <p className="ticket-card-date">{formatCatalogDateRange(performance.startDate, performance.endDate, locale) ?? copy.home.dateUnknown}</p>
      </>}
      <div className="ticket-card-meta"><StatusBadge status={displayStatus} locale={locale} /></div>
      {variant === 'poster' && performance.minPrice != null && <p className="ticket-card-price">
        {copy.home.priceFrom.replace('{price}', `KRW ${new Intl.NumberFormat(locale).format(performance.minPrice)}`)}
        <span>{copy.home.feeSeparate}</span>
      </p>}
    </div>
  </Link>;
}
