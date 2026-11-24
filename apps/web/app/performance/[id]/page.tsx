'use client';

import { catalogText, formatPerformanceAge, formatPerformanceRuntime } from '@grabit/shared';

import { use, useEffect, useState } from 'react';
import Image from 'next/image';
import { useLocale } from 'next-intl';
import { Ticket, MapPin } from 'lucide-react';
import { FIXED_TICKET_CANCELLATION_FEE_KRW, stripStandardCancellationCopy } from '@grabit/shared';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { StatusBadge, getDisplayPerformanceStatus } from '@/components/performance/status-badge';
import { AutomaticTranslationLabel } from '@/components/i18n/automatic-translation-label';
import { CurrencyDisplay } from '@/components/i18n/currency-display';
import { formatBookingOpensAtKst, parseBookingStartMs, resolveBookingStartPerformanceStatus } from '@/components/performance/performance-display-status';
import { PerformancePeriod } from '@/components/performance/performance-period';
import { DetailImageGallery } from '@/components/performance/detail-image-gallery';
import { SalesInfo } from '@/components/performance/sales-info';
import { InstagramSupportLink } from '@/components/support/instagram-support-link';
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
const cancellationFee = FIXED_TICKET_CANCELLATION_FEE_KRW.toLocaleString('en-US');

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
  const showDescription = performance.descriptionVisible !== false;
  const showSales = performance.salesInfoVisible !== false;
  const salesInfo = showSales ? stripStandardCancellationCopy(performance.salesInfo ?? null) : null;
  const nav = [
    {id:'detail-images',label:copy.performance.detailImagesTitle},
    ...(performance.castings.length ? [{id:'cast',label:ticket.cast}] : []),
    ...(showDescription ? [{id:'detail-copy',label:copy.performance.detailTab}] : []),
    {id:'prices',label:ticket.prices},
    showSales
      ? { id: 'sales-copy', label: copy.performance.salesTab }
      : { id: 'cancellation-policy', label: copy.performance.refundTitle },
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
      <div className="ticket-detail-meta"><StatusBadge status={status} locale={locale} /><span>{copy.genres[performance.genre]}{performance.subcategory ? ` · ${catalogText(performance.subcategory, locale)}` : ''}</span></div>
      <nav className="ticket-detail-nav" aria-label={ticket.details}>{nav.map((item) => <a href={`#${item.id}`} key={item.id}>{item.label}</a>)}</nav>
      <dl className="ticket-detail-facts">
        {performance.venue && <><dt>{copy.performance.venueLabel}</dt><dd><a href="#venue">{catalogText(performance.venue.name, locale)} ›</a></dd></>}
        <dt>{copy.performance.scheduleLabel}</dt><dd><PerformancePeriod startDate={performance.startDate} endDate={performance.endDate} locale={locale} fallback={copy.home.dateUnknown} />
          {opening && <p className="ticket-detail-opening" data-testid="performance-booking-opens-at">{copy.home.bookingOpens.replace('{date}',opening)}</p>}</dd>
        {performance.runtime && <><dt>{copy.performance.runtimeLabel}</dt><dd>{formatPerformanceRuntime(performance.runtime, locale)}</dd></>}
        <dt>{copy.performance.ageLabel}</dt><dd>{formatPerformanceAge(performance.ageRating, locale)}</dd>
      </dl>
      {performance.castings.length > 0 && <section id="cast" className="ticket-detail-section"><h2>{ticket.cast}</h2><div className="ticket-cast-list">{performance.castings.map((member) => <div key={member.id}>
        <div className="ticket-cast-photo">{member.photoUrl ? <Image src={member.photoUrl} alt={member.actorName} width={88} height={88} /> : <span>{member.actorName.slice(0,1)}</span>}</div>
        {member.roleName && <p>{member.roleName}</p>}<strong>{member.actorName}</strong>
      </div>)}</div></section>}
      <DetailImageGallery locale={locale} images={performance.detailImages} title={performance.title} copy={copy.performance} />
      {showDescription && <section id="detail-copy" className="ticket-detail-section"><h2>{copy.performance.detailTab}</h2><p className="whitespace-pre-wrap">{performance.description || copy.performance.noDetail}</p></section>}
      <section id="prices" className="ticket-detail-section"><h2>{copy.performance.priceLabel}</h2>
        <dl className="ticket-price-list">{performance.priceTiers.map((tier) => <div key={tier.id}><dt>{tier.tierName}</dt><dd><CurrencyDisplay krwAmount={tier.price} /></dd></div>)}</dl>
        <p className="ticket-fee-note">{copy.home.feeSeparate}</p>
      </section>
      <section id={showSales ? 'sales-copy' : 'cancellation-policy'} className="ticket-detail-section">
        <h2>{showSales ? copy.performance.salesTab : copy.performance.refundTitle}</h2>
        {salesInfo && <SalesInfo text={salesInfo} label={copy.performance.salesTab} />}
        <p className="my-4">{copy.support.title} · <InstagramSupportLink copy={copy.support} /></p>
        {showSales && <h3 id="cancellation-policy" className="scroll-mt-24">{copy.performance.refundTitle}</h3>}
        <SalesInfo
          text={copy.performance.cancellationPolicy.join('\n').replace('{fee}', cancellationFee)}
          label={copy.performance.refundTitle}
        />
      </section>
      {performance.venue && <section id="venue" className="ticket-detail-section"><h2>{ticket.venue}</h2><h3>{catalogText(performance.venue.name, locale)}</h3>
        {performance.venue.address && <p className="flex items-start gap-2"><MapPin size={18} className="mt-1 shrink-0" />{catalogText(performance.venue.address, locale)}</p>}
        {performance.venue.transportSummary && <p className="whitespace-pre-wrap">{catalogText(performance.venue.transportSummary, locale)}</p>}
        {performance.venue.accessNotes && <p className="whitespace-pre-wrap">{catalogText(performance.venue.accessNotes, locale)}</p>}
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
