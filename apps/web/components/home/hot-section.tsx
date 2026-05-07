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
    <section className="mt-10">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-display font-semibold leading-[1.2]">
          {copy.home.hot}
        </h2>
        <Link
          href={`${getLocalizedPathname('/genre/artist_celebrity', activeLocale)}?sort=popular`}
          className="text-sm text-gray-600 hover:text-gray-900"
        >
          {copy.home.more}
        </Link>
      </div>
      <Swiper
        modules={[FreeMode]}
        freeMode
        slidesPerView={1.5}
        spaceBetween={16}
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
