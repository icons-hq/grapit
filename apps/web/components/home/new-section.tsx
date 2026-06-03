'use client';

import Link from 'next/link';
import { useLocale } from 'next-intl';
import { SectionSkeleton } from '@/components/skeletons';
import { PerformanceCard } from '@/components/performance/performance-card';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import { useNewPerformances } from '@/hooks/use-performances';
import { cn } from '@/lib/cn';
import {
  getVisibleCopy,
  resolveVisibleCopyLocale,
} from '@/lib/i18n/visible-copy';

export function NewSection() {
  const activeLocale = resolveVisibleCopyLocale(useLocale());
  const copy = getVisibleCopy(activeLocale);
  const { data: performances, isLoading } = useNewPerformances();

  if (isLoading) return <SectionSkeleton />;
  if (!performances?.length) return null;

  const isSinglePerformance = performances.length === 1;

  return (
    <section className="mt-8 md:mt-12">
      <div className="mb-4 flex items-end justify-between md:mb-6">
        <h2 className="text-xl font-semibold leading-tight text-gray-950 md:text-display md:leading-[1.2]">
          {copy.home.newOpen}
        </h2>
        <Link
          href={`${getLocalizedPathname('/genre/artist_celebrity', activeLocale)}?sort=latest`}
          className="rounded-lg px-2 py-1 text-sm font-semibold text-gray-600 hover:bg-gray-100 hover:text-gray-900"
        >
          {copy.home.more}
        </Link>
      </div>
      <div
        className={cn(
          isSinglePerformance
            ? 'flex justify-center gap-x-3 gap-y-6 md:gap-6'
            : 'grid grid-cols-2 gap-x-3 gap-y-6 md:grid-cols-4 md:gap-6',
        )}
      >
        {performances.map((p) => (
          <div
            key={p.id}
            className={cn(
              'min-w-0',
              isSinglePerformance &&
                'w-[calc((100%_-_0.75rem)/2)] md:w-[calc((100%_-_4.5rem)/4)]',
            )}
          >
            <PerformanceCard performance={p} />
          </div>
        ))}
      </div>
    </section>
  );
}
