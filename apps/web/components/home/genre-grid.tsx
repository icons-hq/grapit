'use client';

import Link from 'next/link';
import { useLocale } from 'next-intl';
import { Users } from 'lucide-react';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import {
  getVisibleCopy,
  resolveVisibleCopyLocale,
} from '@/lib/i18n/visible-copy';
import { PUBLIC_GENRES, type PublicGenre } from '@/lib/performance/public-genres';
import type { LucideIcon } from 'lucide-react';

const GENRE_ICONS: Record<PublicGenre, LucideIcon> = {
  artist_celebrity: Users,
};

const GENRE_LIST = PUBLIC_GENRES;

// 빈 상태 발생 시: SearchIcon 대신 Telescope 또는 LayoutGrid 아이콘 사용
// 장르 바로가기는 정적 컴포넌트로 현재 빈 상태 없음
export function GenreGrid() {
  const activeLocale = resolveVisibleCopyLocale(useLocale());
  const copy = getVisibleCopy(activeLocale);

  return (
    <section className="mt-8 pb-12 md:mt-12">
      <h2 className="mb-4 text-xl font-semibold leading-tight text-gray-950 md:mb-6 md:text-display md:leading-[1.2]">
        {copy.home.genreShortcuts}
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        {GENRE_LIST.map((genre) => {
          const Icon = GENRE_ICONS[genre];
          return (
            <Link
              key={genre}
              href={getLocalizedPathname(`/genre/${genre}`, activeLocale)}
              className="flex min-h-16 items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 shadow-sm transition-colors hover:bg-gray-50 md:flex-col md:gap-2 md:border-0 md:bg-transparent md:p-2 md:shadow-none"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#F5F5F7] md:h-16 md:w-16">
                <Icon className="h-5 w-5 text-gray-700 md:h-7 md:w-7" />
              </div>
              <span className="text-sm font-semibold text-gray-900 md:font-normal">
                {copy.genres[genre]}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
