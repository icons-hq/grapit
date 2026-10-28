'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLocale } from 'next-intl';
import type { PerformanceCardData } from '@grabit/shared';
import { PerformanceCard } from '@/components/performance/performance-card';
import { Skeleton } from '@/components/ui/skeleton';
import { getTicketCopy } from '@/lib/i18n/ticket-copy';

export function TicketShelf({ title, href, items = [], isLoading, isError, onRetry, variant = 'poster', children, empty, hideHeading = false }: {
  title: string; href?: string; items?: PerformanceCardData[]; isLoading?: boolean; isError?: boolean;
  onRetry?: () => void; variant?: 'poster' | 'opening' | 'ranking'; children?: ReactNode; empty?: string; hideHeading?: boolean;
}) {
  const copy = getTicketCopy(useLocale());
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [arrows, setArrows] = useState({ previous: false, next: false });
  useEffect(() => {
    const rail = ref.current;
    if (!rail) return;
    const update = () => setArrows({ previous: rail.scrollLeft > 5, next: rail.scrollLeft < rail.scrollWidth - rail.clientWidth - 5 });
    const observer = new ResizeObserver(update);
    observer.observe(rail); rail.addEventListener('scroll', update, { passive: true }); update();
    return () => { observer.disconnect(); rail.removeEventListener('scroll', update); };
  }, [items.length, isLoading, isError]);
  function scroll(direction: number) {
    const rail = ref.current;
    if (rail) rail.scrollBy({ left: direction * (rail.clientWidth + 16), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }
  return <section className="ticket-shelf" aria-labelledby={hideHeading ? undefined : id} aria-label={hideHeading ? title : undefined}>
    {!hideHeading && <div className="ticket-section-heading"><h2 id={id}>{title}</h2>{href && <Link href={href}>{copy.viewAll}<ChevronRight size={17} /></Link>}</div>}
    {children}
    {isError ? <div className="ticket-empty" role="alert"><p>{copy.loadError}</p><button type="button" onClick={onRetry}>{copy.retry}</button></div>
      : isLoading ? <div className="ticket-card-rail">{[0,1,2,3,4].map((key) => <div key={key} className="ticket-shelf-item"><Skeleton className="aspect-[3/4] w-full rounded-2xl" /><Skeleton className="mt-3 h-5 w-4/5" /><Skeleton className="mt-2 h-4 w-3/5" /></div>)}</div>
        : items.length ? <div className="ticket-shelf-content">
          <div className="ticket-card-rail" ref={ref}>{items.map((item, index) => <div className="ticket-shelf-item" key={item.id}>
            <PerformanceCard performance={item} variant={variant} rank={variant === 'ranking' ? index + 1 : undefined} />
          </div>)}</div>
          {arrows.previous && <button type="button" className="ticket-rail-arrow prev" aria-label={`${title}: ${copy.previous}`} onClick={() => scroll(-1)}><ChevronLeft /></button>}
          {arrows.next && <button type="button" className="ticket-rail-arrow next" aria-label={`${title}: ${copy.next}`} onClick={() => scroll(1)}><ChevronRight /></button>}
        </div> : <div className="ticket-empty" role="status"><p>{empty ?? copy.noShows}</p><span>{copy.noShowsBody}</span></div>}
  </section>;
}
