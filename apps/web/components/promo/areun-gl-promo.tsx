'use client';

import Image from 'next/image';
import { ArrowUpRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { PerformanceWithDetails } from '@grabit/shared';
import { apiClient } from '@/lib/api-client';
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
  performanceId: string | null | undefined;
}

/**
 * Shows the promo only for bookings of a target genre. The genre lookup is a
 * public, cached catalog read; failures stay silent so the booking screens never
 * surface an error for the promo.
 */
export function AreunGlPerformancePromo({ performanceId, ...cardProps }: AreunGlPerformancePromoProps) {
  const active = isAreunGlPromoActive();
  const genre = useQuery({
    queryKey: ['promo', 'areun-gl', 'performance-genre', performanceId],
    queryFn: async () => {
      const performance = await apiClient.get<Pick<PerformanceWithDetails, 'genre'>>(
        `/api/v1/performances/${encodeURIComponent(performanceId ?? '')}`,
        { showErrorToast: false },
      );
      return performance.genre;
    },
    enabled: active && !!performanceId,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });

  if (!active || !isAreunGlPromoGenre(genre.data)) return null;
  return <AreunGlPromoCard {...cardProps} />;
}
