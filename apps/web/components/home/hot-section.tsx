'use client';

import Link from 'next/link';
import { useLocale } from 'next-intl';
import { Swiper, SwiperSlide } from 'swiper/react';
import { FreeMode } from 'swiper/modules';
import { SectionSkeleton } from '@/components/skeletons';
import { PerformanceCard } from '@/components/performance/performance-card';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import { useHotPerformances } from '@/hooks/use-performances';
import {
  getVisibleCopy,
  resolveVisibleCopyLocale,
} from '@/lib/i18n/visible-copy';
import 'swiper/css';
import 'swiper/css/free-mode';

export function HotSection() {
  const activeLocale = resolveVisibleCopyLocale(useLocale());
  const copy = getVisibleCopy(activeLocale);
  const { data: performances, isLoading } = useHotPerformances();

  if (isLoading) return <SectionSkeleton />;
  if (!performances?.length) return null;

  return (
    <section className="mt-8 md:mt-12">
      <div className="mb-4 flex items-end justify-between md:mb-6">
        <h2 className="text-xl font-semibold leading-tight text-gray-950 md:text-display md:leading-[1.2]">
          {copy.home.hot}
        </h2>
        <Link
          href={`${getLocalizedPathname('/genre/artist_celebrity', activeLocale)}?sort=popular`}
          className="rounded-lg px-2 py-1 text-sm font-semibold text-gray-600 hover:bg-gray-100 hover:text-gray-900"
        >
          {copy.home.more}
        </Link>
      </div>
      <Swiper
        modules={[FreeMode]}
        freeMode
        slidesPerView={2.12}
        spaceBetween={12}
        breakpoints={{
          768: { slidesPerView: 2.5 },
          1024: { slidesPerView: 4, spaceBetween: 24 },
        }}
      >
        {performances.map((p, i) => (
          <SwiperSlide key={p.id}>
            <PerformanceCard performance={p} priority={i < 2} />
          </SwiperSlide>
        ))}
      </Swiper>
    </section>
  );
}
