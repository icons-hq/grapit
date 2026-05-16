'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useLocale } from 'next-intl';
import { Ticket } from 'lucide-react';
import { cn } from '@/lib/cn';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import {
  getVisibleCopy,
  resolveVisibleCopyLocale,
} from '@/lib/i18n/visible-copy';
import { StatusBadge } from './status-badge';
import type { PerformanceCardData } from '@grabit/shared';

function formatDate(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}.${m}.${day}`;
}

function formatPerformanceDateRange(performance: PerformanceCardData): string {
  if (performance.status === 'upcoming') {
    return '오픈예정';
  }

  return `${formatDate(performance.startDate)} ~ ${formatDate(performance.endDate)}`;
}

interface PerformanceCardProps {
  performance: PerformanceCardData;
  className?: string;
  priority?: boolean;
}

export function PerformanceCard({
  performance,
  className,
  priority = false,
}: PerformanceCardProps) {
  const activeLocale = resolveVisibleCopyLocale(useLocale());
  const copy = getVisibleCopy(activeLocale);

  return (
    <Link
      href={getLocalizedPathname(`/performance/${performance.id}`, activeLocale)}
      className={cn(
        'group block overflow-hidden rounded-lg border border-gray-100 bg-white shadow-sm transition-shadow duration-150 hover:shadow-md',
        className,
      )}
    >
      {/* Poster */}
      <div className="relative aspect-[2/3] overflow-hidden rounded-t-lg bg-gray-200">
        {performance.posterUrl ? (
          <Image
            src={performance.posterUrl}
            alt={`${performance.title} ${copy.performance.posterAltSuffix}`}
            fill
            className="object-cover transition-transform duration-150 group-hover:scale-[1.02]"
            sizes="(max-width: 768px) 50vw, 25vw"
            quality={75}
            priority={priority}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Ticket className="h-12 w-12 text-gray-400" />
          </div>
        )}
        <StatusBadge
          status={performance.status}
          locale={activeLocale}
          className="absolute left-2 top-2"
        />
      </div>

      {/* Info */}
      <div className="min-h-[104px] p-3 md:min-h-[116px] md:p-4">
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-gray-950 md:text-base">
          {performance.title}
        </h3>
        {performance.venueName && (
          <p className="mt-1.5 line-clamp-1 text-xs font-medium text-gray-600 md:text-sm">
            {performance.venueName}
          </p>
        )}
        <p className="mt-1 line-clamp-1 text-xs text-gray-500 md:text-sm">
          {formatPerformanceDateRange(performance)}
        </p>
      </div>
    </Link>
  );
}
