'use client';

import { useState } from 'react';
import Image from 'next/image';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import { getVisibleCopy } from '@/lib/i18n/visible-copy';
import type { Banner, SupportedLocale } from '@grabit/shared';

interface BannerCarouselProps { banners: Banner[]; isLoading?: boolean; locale?: SupportedLocale }

export function BannerCarousel({ banners, isLoading = false, locale = 'ko' }: BannerCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const copy = getVisibleCopy(locale).home;
  if (isLoading) return <Skeleton className="aspect-[1290/600] w-full rounded-xl md:h-[400px]" />;
  if (!banners.length) return null;
  const index = activeIndex % banners.length;
  const banner = banners[index]!;
  const href = banner.linkUrl?.startsWith('/') && !banner.linkUrl.startsWith('//')
    ? getLocalizedPathname(banner.linkUrl, locale) : banner.linkUrl;
  const artwork = <Image src={banner.imageUrl} alt={copy.promotionAlt} fill className="object-contain" sizes="(min-width:1280px) 1200px, 100vw" priority={index === 0} />;

  return <section className="relative overflow-hidden rounded-xl bg-muted" aria-label={copy.promotionAlt}>
    <div className="relative aspect-[1290/600] w-full md:h-[400px]">
      {href ? <a className="relative block h-full w-full focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-primary" href={href}>{artwork}</a> : artwork}
    </div>
    {banners.length > 1 && <div className="absolute bottom-3 right-3 flex items-center gap-2 rounded-full bg-black/70 px-2 py-1 text-white">
      <button className="flex size-9 items-center justify-center rounded-full hover:bg-white/20" onClick={() => setActiveIndex((index + banners.length - 1) % banners.length)} aria-label={copy.previousBanner}><ChevronLeft className="size-4" /></button>
      <span className="min-w-10 text-center text-xs" aria-live="polite" aria-label={copy.bannerPosition.replace('{current}',String(index+1)).replace('{total}',String(banners.length))}>{index + 1} / {banners.length}</span>
      <button className="flex size-9 items-center justify-center rounded-full hover:bg-white/20" onClick={() => setActiveIndex((index + 1) % banners.length)} aria-label={copy.nextBanner}><ChevronRight className="size-4" /></button>
    </div>}
  </section>;
}
