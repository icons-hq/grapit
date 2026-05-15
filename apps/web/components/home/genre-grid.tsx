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
    <section className="mt-10 pb-12">
      <h2 className="mb-6 text-display font-semibold leading-[1.2]">
        {copy.home.genreShortcuts}
      </h2>
      <div className="grid grid-cols-4 gap-4 lg:grid-cols-8">
        {GENRE_LIST.map((genre) => {
          const Icon = GENRE_ICONS[genre];
          return (
            <Link
              key={genre}
              href={getLocalizedPathname(`/genre/${genre}`, activeLocale)}
              className="flex flex-col items-center gap-2 rounded-lg p-2 transition-colors hover:bg-gray-50"
            >
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#F5F5F7]">
                <Icon className="h-7 w-7 text-gray-700" />
              </div>
              <span className="text-sm text-gray-900">
                {copy.genres[genre]}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
