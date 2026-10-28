'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { ChevronLeft, ChevronRight, Pause, Play, Plus } from 'lucide-react';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Autoplay, A11y, Keyboard } from 'swiper/modules';
import type { Swiper as SwiperInstance } from 'swiper';
import 'swiper/css';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import { getVisibleCopy } from '@/lib/i18n/visible-copy';
import { getTicketCopy } from '@/lib/i18n/ticket-copy';
import { formatCatalogDateRange } from '@/lib/performance/catalog-format';
import type { Banner, PerformanceCardData, SupportedLocale } from '@grabit/shared';

interface BannerCarouselProps {
  banners: Banner[];
  performances?: PerformanceCardData[];
  isLoading?: boolean;
  locale?: SupportedLocale;
}
export function localizedBannerHref(link: string | null, locale: SupportedLocale) {
  if (!link) return null;
  try {
    const url = new URL(link, 'https://heygrabit.com');
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const local = link.startsWith('/') && !link.startsWith('//');
    const canonical = url.protocol === 'https:' && ['heygrabit.com', 'www.heygrabit.com'].includes(url.hostname);
    return local || canonical ? `${getLocalizedPathname(url.pathname, locale)}${url.search}${url.hash}` : link;
  } catch { return null; }
}

export function BannerCarousel({ banners, performances = [], isLoading = false, locale = 'ko' }: BannerCarouselProps) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const swiper = useRef<SwiperInstance | null>(null);
  const copy = getVisibleCopy(locale).home;
  const ticket = getTicketCopy(locale);
  const slides = banners.length ? banners.map((banner) => ({
    id: banner.id, image: banner.imageUrl, href: localizedBannerHref(banner.linkUrl, locale), title: '', subtitle: '',
  })) : performances.filter((item) => item.posterUrl).slice(0, 8).map((item) => ({
    id: item.id, image: item.posterUrl!, href: getLocalizedPathname(`/performance/${item.id}`, locale),
    title: item.title, subtitle: [item.venueName, formatCatalogDateRange(item.startDate, item.endDate, locale)].filter(Boolean).join(' · '),
  }));
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const instance = swiper.current;
    if (!instance?.autoplay) return;
    if (paused || reducedMotion || allOpen) instance.autoplay.stop();
    else instance.autoplay.start();
  }, [paused, reducedMotion, allOpen]);
  if (isLoading) return <div className="ticket-hero-loading"><Skeleton className="h-full w-full rounded-3xl" /></div>;
  if (!slides.length) return null;
  function artwork(slide: typeof slides[number], eager = false) {
    return <div className={`ticket-hero-art ${slide.title ? 'ticket-hero-poster' : ''}`}>
      <Image src={slide.image} alt="" fill sizes="1240px" className="ticket-hero-backdrop" aria-hidden="true" />
      <Image src={slide.image} alt={slide.title || copy.promotionAlt} fill sizes="(max-width: 767px) 85vw, 1240px" priority={eager} className="ticket-hero-image" />
      {slide.title && <div className="ticket-hero-copy"><h2>{slide.title}</h2><p>{slide.subtitle}</p></div>}
    </div>;
  }
  return <section className="ticket-hero" aria-label={copy.promotionAlt}>
    <Swiper key={slides.map((slide) => slide.id).join(',')} modules={[Autoplay, A11y, Keyboard]} slidesPerView="auto" centeredSlides
      spaceBetween={20} loop={slides.length > 2} rewind={slides.length <= 2} watchOverflow keyboard={{ enabled: true, onlyInViewport: true }}
      autoplay={slides.length > 1 && !reducedMotion ? { delay: 5500, disableOnInteraction: false, pauseOnMouseEnter: true } : false}
      onSwiper={(instance) => { swiper.current = instance; }} onSlideChange={(instance) => setIndex(instance.realIndex)}
      className="ticket-hero-swiper">
      {slides.map((slide, i) => <SwiperSlide key={slide.id}>
        {slide.href ? <a href={slide.href} className="ticket-hero-link">{artwork(slide, i === 0)}</a> : artwork(slide, i === 0)}
      </SwiperSlide>)}
    </Swiper>
    {slides.length > 1 && <div className="ticket-hero-controls">
      <button type="button" className="ticket-hero-arrow prev" aria-label={copy.previousBanner} onClick={() => swiper.current?.slidePrev()}><ChevronLeft /></button>
      <button type="button" className="ticket-hero-arrow next" aria-label={copy.nextBanner} onClick={() => swiper.current?.slideNext()}><ChevronRight /></button>
      <div className="ticket-hero-counter">
        <button type="button" aria-label={paused || reducedMotion ? ticket.play : ticket.pause} onClick={() => { if (paused || reducedMotion) { setReducedMotion(false); setPaused(false); } else setPaused(true); }}>{paused || reducedMotion ? <Play size={13} /> : <Pause size={13} />}</button>
        <button type="button" aria-label={ticket.allBanners} onClick={() => setAllOpen(true)}><span>{Math.min(index + 1, slides.length)} / {slides.length}</span><Plus size={13} /></button>
      </div>
    </div>}
    <Dialog open={allOpen} onOpenChange={setAllOpen}><DialogContent className="ticket-dialog ticket-banners-dialog" aria-describedby={undefined}>
      <DialogTitle>{ticket.allBanners}</DialogTitle>
      <div className="ticket-all-banners">{slides.map((slide) => <div key={slide.id}>
        {slide.href ? <a href={slide.href}>{artwork(slide)}</a> : artwork(slide)}
      </div>)}</div>
    </DialogContent></Dialog>
  </section>;
}
