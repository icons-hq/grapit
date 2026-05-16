'use client';

import Link from 'next/link';
import { useLocale } from 'next-intl';
import { SectionSkeleton } from '@/components/skeletons';
import { PerformanceCard } from '@/components/performance/performance-card';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import { useNewPerformances } from '@/hooks/use-performances';
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

  return (
    <section className="mt-8 md:mt-12">
      <div className="mb-4 flex items-end justify-between md:mb-6">
        <h2 className="text-xl font-semibold leading-tight text-gray-950 md:text-display md:leading-[1.2]">
          New
        </h2>
        <Link
          href={`${getLocalizedPathname('/genre/artist_celebrity', activeLocale)}?sort=latest`}
          className="rounded-lg px-2 py-1 text-sm font-semibold text-gray-600 hover:bg-gray-100 hover:text-gray-900"
        >
          {copy.home.more}
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-6 md:grid-cols-4 md:gap-6">
        {performances.map((p) => (
          <div
            key={p.id}
            className="min-w-0"
          >
            <PerformanceCard performance={p} />
          </div>
        ))}
      </div>
    </section>
  );
}
