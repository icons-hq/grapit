'use client';

import Link from 'next/link';
import { useLocale } from 'next-intl';
import { LayoutGrid, Search, Ticket } from 'lucide-react';
import { BannerSkeleton } from '@/components/skeletons';
import { BannerCarousel } from '@/components/home/banner-carousel';
import { HotSection } from '@/components/home/hot-section';
import { NewSection } from '@/components/home/new-section';
import { GenreGrid } from '@/components/home/genre-grid';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import { useHomeBanners } from '@/hooks/use-performances';
import {
  getVisibleCopy,
  resolveVisibleCopyLocale,
} from '@/lib/i18n/visible-copy';
import { PUBLIC_GENRES } from '@/lib/performance/public-genres';

export default function HomePage() {
  const activeLocale = resolveVisibleCopyLocale(useLocale());
  const copy = getVisibleCopy(activeLocale);
  const { data: banners, isLoading: bannersLoading } = useHomeBanners();
  const primaryGenre = PUBLIC_GENRES[0];

  return (
    <main>
      <h1 className="sr-only">Grabit</h1>

      <section className="mx-auto w-full max-w-[1200px] px-4 pt-4 md:hidden">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-primary">
          <Ticket className="h-4 w-4" aria-hidden="true" />
          <span>Grabit</span>
        </div>
        <Link
          href={getLocalizedPathname('/search', activeLocale)}
          className="mt-3 flex min-h-12 items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 text-left shadow-sm"
          aria-label={copy.nav.searchAriaLabel}
        >
          <Search className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">
            {copy.nav.searchPlaceholder}
          </span>
        </Link>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Link
            href={getLocalizedPathname(
              `/genre/${primaryGenre}`,
              activeLocale,
            )}
            className="flex min-h-11 items-center gap-2 rounded-lg bg-gray-950 px-3 text-sm font-semibold text-white"
          >
            <LayoutGrid className="h-4 w-4" aria-hidden="true" />
            {copy.home.genreShortcuts}
          </Link>
          <Link
            href={`${getLocalizedPathname(`/genre/${primaryGenre}`, activeLocale)}?sort=popular`}
            className="flex min-h-11 items-center justify-center rounded-lg bg-[#F5F5F7] px-3 text-sm font-semibold text-gray-900"
          >
            {copy.home.hot}
          </Link>
        </div>
      </section>

      {bannersLoading ? (
        <BannerSkeleton />
      ) : (
        <BannerCarousel banners={banners ?? []} />
      )}

      {/* 빈 상태 안내 — 배너가 없고 로딩 완료인 경우 */}
      {!bannersLoading && (!banners || banners.length === 0) && (
        <div className="mx-auto w-full max-w-[1200px] px-4 pt-12 text-center md:px-6">
          <p className="text-gray-500">{copy.home.empty}</p>
        </div>
      )}

      <div className="mx-auto w-full max-w-[1200px] px-4 md:px-6">
        <HotSection />
        <NewSection />
        <GenreGrid />
      </div>
    </main>
  );
}
