'use client';

import Image from 'next/image';
import { ArrowUpRight } from 'lucide-react';
import {
  AREUN_GL_PROMO,
  buildAreunGlPromoHref,
  getAreunGlPromoCopy,
  isAreunGlPromoActive,
  isAreunGlPromoGenre,
  type AreunGlPromoPlacement,
} from '@/lib/promo/areun-gl-promo';

interface AreunGlPromoCardProps {
  placement: AreunGlPromoPlacement;
  locale: string;
  className?: string;
}

/** Partner promo card. Renders nothing once the campaign window has closed. */
export function AreunGlPromoCard({ placement, locale, className }: AreunGlPromoCardProps) {
  if (!isAreunGlPromoActive()) return null;
  const copy = getAreunGlPromoCopy(locale);

  return (
    <aside
      className={className ? `areun-promo ${className}` : 'areun-promo'}
      aria-label={copy.regionLabel}
      lang={copy.language}
      data-testid={`areun-gl-promo-${placement}`}
    >
      <a
        className="areun-promo-link"
        href={buildAreunGlPromoHref(placement, copy.language)}
        target="_blank"
        rel="sponsored noopener"
      >
        <span className="areun-promo-media" aria-hidden="true">
          <Image
            className="areun-promo-art"
            src={AREUN_GL_PROMO.imageSrc}
            alt=""
            fill
            sizes="(max-width: 767px) 100vw, 800px"
          />
        </span>
        <span className="areun-promo-copy">
          <span className="areun-promo-badge">
            <span>{copy.badge}</span>
            {copy.brand}
          </span>
          <strong className="areun-promo-title">{copy.title}</strong>
          <span className="areun-promo-body">{copy.body}</span>
          {copy.note && <span className="areun-promo-note">{copy.note}</span>}
          <span className="areun-promo-cta">
            {copy.cta}
            <ArrowUpRight size={16} aria-hidden="true" />
          </span>
          <span className="sr-only"> ({copy.newTab})</span>
        </span>
      </a>
    </aside>
  );
}

interface AreunGlPerformancePromoProps extends AreunGlPromoCardProps {
  /** `ReservationDetail.performanceGenre`; absent on older API responses, which hides the card. */
  genre: string | null | undefined;
}

/**
 * Shows the promo only for bookings of a target genre. The genre arrives with the
 * reservation itself, so the booking screens make no extra catalog read (the public
 * detail endpoint records a view and would skew popularity ranking).
 */
export function AreunGlPerformancePromo({ genre, ...cardProps }: AreunGlPerformancePromoProps) {
  if (!isAreunGlPromoGenre(genre)) return null;
  return <AreunGlPromoCard {...cardProps} />;
}
