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
        <h2 className="text-display font-semibold leading-[1.2]">New</h2>
        <Link
          href={`${getLocalizedPathname('/genre/artist_celebrity', activeLocale)}?sort=latest`}
          className="text-sm text-gray-600 hover:text-gray-900"
        >
          {copy.home.more}
        </Link>
      </div>
      <div className="flex flex-wrap justify-center gap-6">
        {performances.map((p) => (
          <div
            key={p.id}
            className="w-[calc(50%-0.75rem)] min-w-0 md:w-[calc(25%-1.125rem)]"
          >
            <PerformanceCard performance={p} />
          </div>
        ))}
      </div>
    </section>
  );
}
