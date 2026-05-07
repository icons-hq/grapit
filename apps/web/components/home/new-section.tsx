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
    <section className="mt-10">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-display font-semibold leading-[1.2]">
          {copy.home.newOpen}
        </h2>
        <Link
          href={`${getLocalizedPathname('/genre/artist_celebrity', activeLocale)}?sort=latest`}
          className="text-sm text-gray-600 hover:text-gray-900"
        >
          {copy.home.more}
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
        {performances.map((p) => (
          <PerformanceCard key={p.id} performance={p} />
        ))}
      </div>
    </section>
  );
}
