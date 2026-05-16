'use client';

import Image from 'next/image';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Autoplay, Pagination } from 'swiper/modules';
import { Skeleton } from '@/components/ui/skeleton';
import type { Banner } from '@grabit/shared';
import 'swiper/css';
import 'swiper/css/pagination';

interface BannerCarouselProps {
  banners: Banner[];
  isLoading?: boolean;
}

export function BannerCarousel({
  banners,
  isLoading = false,
}: BannerCarouselProps) {
  if (isLoading) {
    return (
      <div className="mx-auto mt-3 w-full max-w-[1200px] px-4 md:mt-0 md:max-w-none md:px-0">
        <Skeleton className="aspect-[1290/600] w-full rounded-lg md:aspect-auto md:h-[400px] md:rounded-none" />
      </div>
    );
  }

  if (banners.length === 0) {
    return (
      <div className="mx-auto mt-3 flex aspect-[1290/600] w-[calc(100%-2rem)] max-w-[1200px] items-center justify-center rounded-lg bg-gray-100 md:mt-0 md:aspect-auto md:h-[400px] md:w-full md:max-w-none md:rounded-none">
        <p className="text-sm text-gray-500">배너가 없습니다</p>
      </div>
    );
  }

  return (
    <div className="relative mx-auto mt-3 w-full max-w-[1200px] px-4 md:mt-0 md:max-w-none md:px-0">
      <Swiper
        modules={[Autoplay, Pagination]}
        autoplay={{ delay: 4000, disableOnInteraction: false }}
        pagination={{ clickable: true }}
        loop={banners.length > 1}
        className="aspect-[1290/600] w-full overflow-hidden rounded-lg md:aspect-auto md:h-[400px] md:rounded-none"
      >
        {banners.map((banner) => (
          <SwiperSlide key={banner.id}>
            {banner.linkUrl ? (
              <a href={banner.linkUrl} className="relative block h-full w-full">
                <Image
                  src={banner.imageUrl}
                  alt="프로모션 배너"
                  fill
                  className="object-cover"
                  priority
                  loading="eager"
                />
              </a>
            ) : (
              <div className="relative h-full w-full">
                <Image
                  src={banner.imageUrl}
                  alt="프로모션 배너"
                  fill
                  className="object-cover"
                  priority
                  loading="eager"
                />
              </div>
            )}
          </SwiperSlide>
        ))}
      </Swiper>
    </div>
  );
}
