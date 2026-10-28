'use client';

import { use, useEffect, useState } from 'react';
import Image from 'next/image';
import { useLocale } from 'next-intl';
import { Ticket, MapPin } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { StatusBadge, getDisplayPerformanceStatus } from '@/components/performance/status-badge';
import { AutomaticTranslationLabel } from '@/components/i18n/automatic-translation-label';
import { CurrencyDisplay } from '@/components/i18n/currency-display';
import { formatBookingOpensAtKst, parseBookingStartMs, resolveBookingStartPerformanceStatus } from '@/components/performance/performance-display-status';
import { PerformancePeriod } from '@/components/performance/performance-period';
import { TicketActions } from '@/components/performance/ticket-actions';
import { TicketBookingPanel } from '@/components/performance/ticket-booking-panel';
import { usePerformanceDetail } from '@/hooks/use-performances';
import { useBookingAvailability } from '@/hooks/use-booking-availability';
import { useRuntimeFlags } from '@/hooks/use-runtime-flags';
import { rememberPerformance } from '@/hooks/use-ticket-library';
import { getVisibleCopy, resolveVisibleCopyLocale } from '@/lib/i18n/visible-copy';
import { getTicketCopy } from '@/lib/i18n/ticket-copy';

function DetailSkeleton() {
  return <main className="ticket-container ticket-detail-grid"><div><Skeleton className="aspect-[2.34] w-full rounded-3xl" /><Skeleton className="mt-6 h-7 w-2/3" /><Skeleton className="mt-6 h-40 w-full" /></div><Skeleton className="hidden h-[560px] rounded-3xl lg:block" /></main>;
}
export default function PerformanceDetailPage({ params }: { params: Promise<{id:string}> }) {
  const { id } = use(params);
  const locale = resolveVisibleCopyLocale(useLocale());
  const copy = getVisibleCopy(locale);
  const ticket = getTicketCopy(locale);
  const { data:performance,isLoading,isError,refetch } = usePerformanceDetail(id);
  const availability = useBookingAvailability({performanceStatus:performance?.status,bookingStartsAt:performance?.bookingPolicy?.bookingStartsAt});
  useRuntimeFlags({resyncClockBeforeMs:parseBookingStartMs(performance?.bookingPolicy?.bookingStartsAt)});
  const [posterOpen,setPosterOpen] = useState(false);
  useEffect(() => { if(performance?.id) rememberPerformance(performance.id); },[performance?.id]);
  if(isLoading) return <DetailSkeleton />;
  if(isError || !performance) return <main className="ticket-container ticket-page"><div className="ticket-empty" role="alert"><p>{copy.performance.loadError}</p><button type="button" onClick={() => void refetch()}>{copy.performance.retry}</button></div></main>;
  const saleStatus = resolveBookingStartPerformanceStatus(performance.status,performance.bookingPolicy?.bookingStartsAt,availability.isBeforeScheduledBookingStart);
  const status = getDisplayPerformanceStatus(saleStatus,availability.bookingEnabled,availability.isResolved);
  const opening = saleStatus === 'upcoming' ? formatBookingOpensAtKst(performance.bookingPolicy?.bookingStartsAt,locale) : null;
  const detailImages = performance.detailImages ?? [];
  const showDescription = performance.descriptionVisible !== false;
  const showSales = performance.salesInfoVisible !== false;
  const nav = [
    ...(detailImages.length ? [{id:'detail-images',label:copy.performance.detailImagesTitle}] : []),
    ...(performance.castings.length ? [{id:'cast',label:ticket.cast}] : []),
    ...(showDescription ? [{id:'detail-copy',label:copy.performance.detailTab}] : []),
    {id:'prices',label:ticket.prices},
    ...(showSales ? [{id:'sales-copy',label:copy.performance.salesTab}] : []),
    ...(performance.venue ? [{id:'venue',label:ticket.venue}] : []),
  ];
  return <main className="ticket-container ticket-detail-grid">
    <article className="ticket-detail-content">
      <button type="button" className="ticket-detail-gallery" aria-label={`${performance.title} ${copy.performance.posterAltSuffix}`} disabled={!performance.posterUrl} onClick={() => setPosterOpen(true)}>
        {performance.posterUrl ? <><Image src={performance.posterUrl} alt="" fill sizes="840px" className="ticket-detail-backdrop" aria-hidden="true" />
          <Image src={performance.posterUrl} alt={`${performance.title} ${copy.performance.posterAltSuffix}`} fill sizes="(max-width: 767px) 200px, 260px" className="ticket-detail-poster" priority /></>
          : <div className="ticket-poster-missing"><Ticket size={40} /><span>{ticket.untitledPoster}</span></div>}
        <span className="ticket-media-count">1 / 1</span>
      </button>
      <div className="ticket-detail-title"><h1>{performance.title}</h1><TicketActions performanceId={id} /></div>
      {hasAutomaticTranslationMetadata(performance) && <div className="mt-3"><AutomaticTranslationLabel locale={locale} /></div>}
      <div className="ticket-detail-meta"><StatusBadge status={status} locale={locale} /><span>{copy.genres[performance.genre]}{performance.subcategory ? ` · ${performance.subcategory}` : ''}</span></div>
      <nav className="ticket-detail-nav" aria-label={ticket.details}>{nav.map((item) => <a href={`#${item.id}`} key={item.id}>{item.label}</a>)}</nav>
      <dl className="ticket-detail-facts">
        {performance.venue && <><dt>{copy.performance.venueLabel}</dt><dd><a href="#venue">{performance.venue.name} ›</a></dd></>}
        <dt>{copy.performance.scheduleLabel}</dt><dd><PerformancePeriod startDate={performance.startDate} endDate={performance.endDate} locale={locale} fallback={copy.home.dateUnknown} />
          {opening && <p className="ticket-detail-opening" data-testid="performance-booking-opens-at">{copy.home.bookingOpens.replace('{date}',opening)}</p>}</dd>
        {performance.runtime && <><dt>{copy.performance.runtimeLabel}</dt><dd>{performance.runtime}</dd></>}
        <dt>{copy.performance.ageLabel}</dt><dd>{performance.ageRating}</dd>
      </dl>
      {performance.castings.length > 0 && <section id="cast" className="ticket-detail-section"><h2>{ticket.cast}</h2><div className="ticket-cast-list">{performance.castings.map((member) => <div key={member.id}>
        <div className="ticket-cast-photo">{member.photoUrl ? <Image src={member.photoUrl} alt={member.actorName} width={88} height={88} /> : <span>{member.actorName.slice(0,1)}</span>}</div>
        {member.roleName && <p>{member.roleName}</p>}<strong>{member.actorName}</strong>
      </div>)}</div></section>}
      {detailImages.length > 0 && <section id="detail-images" className="ticket-detail-section"><h2>{copy.performance.detailImagesTitle}</h2><div className="ticket-detail-images">
        {detailImages.map((image,index) => <img key={`${image.imageUrl}-${index}`} src={image.imageUrl} alt={image.altText || copy.performance.detailImageAlt.replace('{title}',performance.title).replace('{index}',String(index+1))} loading={index === 0 ? 'eager':'lazy'} />)}
      </div></section>}
      {showDescription && <section id="detail-copy" className="ticket-detail-section"><h2>{copy.performance.detailTab}</h2><p className="whitespace-pre-wrap">{performance.description || copy.performance.noDetail}</p></section>}
      <section id="prices" className="ticket-detail-section"><h2>{copy.performance.priceLabel}</h2>
        <dl className="ticket-price-list">{performance.priceTiers.map((tier) => <div key={tier.id}><dt>{tier.tierName}</dt><dd><CurrencyDisplay krwAmount={tier.price} /></dd></div>)}</dl>
        <p className="ticket-fee-note">{copy.home.feeSeparate}</p>
      </section>
      {showSales && <section id="sales-copy" className="ticket-detail-section"><h2>{copy.performance.salesTab}</h2>
        {performance.salesInfo ? <p className="whitespace-pre-wrap">{performance.salesInfo}</p> : <><h3>{copy.performance.refundTitle}</h3><ul className="list-disc pl-5">{copy.performance.refundItems.map((item) => <li key={item}>{item}</li>)}</ul></>}
      </section>}
      {performance.venue && <section id="venue" className="ticket-detail-section"><h2>{ticket.venue}</h2><h3>{performance.venue.name}</h3>
        {performance.venue.address && <p className="flex items-start gap-2"><MapPin size={18} className="mt-1 shrink-0" />{performance.venue.address}</p>}
        {performance.venue.transportSummary && <p className="whitespace-pre-wrap">{performance.venue.transportSummary}</p>}
        {performance.venue.accessNotes && <p className="whitespace-pre-wrap">{performance.venue.accessNotes}</p>}
      </section>}
    </article>
    <TicketBookingPanel performance={performance} locale={locale} available={availability.bookingAvailable || (availability.bookingOpen && availability.verificationRequiredForBooking)}
      verificationRequired={availability.verificationRequiredForBooking} disabledMessage={availability.bookingDisabledMessage} />
    <Dialog open={posterOpen} onOpenChange={setPosterOpen}><DialogContent className="ticket-dialog ticket-poster-dialog" aria-describedby={undefined}><DialogTitle className="sr-only">{performance.title}</DialogTitle>
      {performance.posterUrl && <img src={performance.posterUrl} alt={performance.title} className="max-h-[80dvh] w-full object-contain" />}
    </DialogContent></Dialog>
  </main>;
}

function hasAutomaticTranslationMetadata(performance: unknown): boolean {
  if (!performance || typeof performance !== 'object') return false;
  const record = performance as Record<string, unknown>;
  if (record.automaticTranslationLabel === true || record.isMachineTranslated === true || typeof record.translatedBy === 'string') return true;
  return ['titleTranslation', 'descriptionTranslation', 'salesInfoTranslation'].some((key) => hasAutomaticTranslationMetadata(record[key]));
}
