'use client';

import { use, type ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import {
  Calendar,
  Clock,
  CreditCard,
  Image as ImageIcon,
  Info,
  MapPin,
  Ticket,
  User,
} from 'lucide-react';
import { DEFAULT_LOCALE, GENRE_LABELS, isSupportedLocale } from '@grabit/shared';
import type { SupportedLocale } from '@grabit/shared';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { StatusBadge } from '@/components/performance/status-badge';
import { AutomaticTranslationLabel } from '@/components/i18n/automatic-translation-label';
import { CurrencyDisplay } from '@/components/i18n/currency-display';
import { KstTime } from '@/components/i18n/kst-time';
import { usePerformanceDetail } from '@/hooks/use-performances';
import { useBookingAvailability } from '@/hooks/use-booking-availability';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import { getVisibleCopy } from '@/lib/i18n/visible-copy';

function DetailSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-6 py-8">
      <div className="flex flex-col gap-8 lg:flex-row">
        {/* Left column: poster + tabs skeleton */}
        <div className="w-full lg:max-w-[380px] shrink-0">
          <Skeleton className="aspect-[2/3] w-full max-w-[280px] mx-auto lg:mx-0 lg:max-w-[380px] rounded-lg" />
          <div className="mt-8 space-y-4">
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-[300px] w-full rounded-lg" />
          </div>
        </div>
        {/* Right column: info panel skeleton */}
        <div className="flex-1 space-y-4 order-first lg:order-none">
          <Skeleton className="h-7 w-3/4" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-5 w-1/4" />
          <Skeleton className="mt-4 h-12 w-full" />
        </div>
      </div>
    </div>
  );
}

export default function PerformanceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const activeLocale = useActiveLocale();
  const copy = getVisibleCopy(activeLocale);
  const { data: performance, isLoading, isError } = usePerformanceDetail(id);
  const { bookingAvailable, bookingDisabledMessage } = useBookingAvailability({
    performanceStatus: performance?.status,
  });
  const showAutomaticTranslationLabel =
    hasAutomaticTranslationMetadata(performance);
  const detailImages = performance?.detailImages ?? [];

  if (isLoading) return <DetailSkeleton />;

  if (isError || !performance) {
    return (
      <main className="mx-auto max-w-[1200px] px-6 py-8">
        <div className="flex flex-col items-center py-16">
          <p className="text-base text-gray-900">
            {copy.performance.loadError}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-lg bg-primary px-6 py-2 text-sm font-semibold text-white"
          >
            {copy.performance.retry}
          </button>
        </div>
      </main>
    );
  }

  return (
    <>
      <main className="pb-24 lg:pb-12">
        <section className="border-b border-gray-200 bg-white">
          <div className="mx-auto grid w-full max-w-[1180px] gap-8 px-5 py-8 md:px-6 lg:grid-cols-[360px_minmax(0,1fr)] lg:py-12">
            <div className="mx-auto w-full max-w-[320px] lg:max-w-none">
              <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-gray-100 shadow-md">
                {performance.posterUrl ? (
                  <Image
                    src={performance.posterUrl}
                    alt={`${performance.title} ${copy.performance.posterAltSuffix}`}
                    fill
                    className="object-cover"
                    sizes="(max-width: 1024px) 320px, 360px"
                    priority
                  />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <Ticket className="h-16 w-16 text-gray-400" />
                  </div>
                )}
                <StatusBadge
                  status={performance.status}
                  locale={activeLocale}
                  className="absolute left-3 top-3"
                />
              </div>
            </div>

            <div className="flex min-w-0 flex-col justify-center">
              <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-primary">
                <span>{GENRE_LABELS[performance.genre]}</span>
                {performance.subcategory && (
                  <>
                    <span aria-hidden="true" className="text-gray-300">
                      /
                    </span>
                    <span>{performance.subcategory}</span>
                  </>
                )}
              </div>

              <h1 className="mt-3 max-w-[760px] text-3xl font-semibold leading-tight text-gray-900 md:text-4xl">
                {performance.title}
              </h1>
              {showAutomaticTranslationLabel && (
                <div className="mt-3">
                  <AutomaticTranslationLabel locale={activeLocale} />
                </div>
              )}

              <div className="mt-7 grid gap-3 sm:grid-cols-2">
                {performance.venue && (
                  <DetailFact
                    icon={<MapPin className="h-4 w-4" />}
                    label="장소"
                    value={performance.venue.name}
                  />
                )}
                <DetailFact
                  icon={<Calendar className="h-4 w-4" />}
                  label="일정"
                  value={
                    performance.status === 'upcoming' ? (
                      '오픈예정'
                    ) : (
                      <span className="flex min-w-0 flex-wrap items-start gap-x-2 gap-y-1">
                        <KstTime
                          value={performance.startDate}
                          locale={activeLocale}
                        />
                        <span aria-hidden="true" className="text-gray-400">
                          ~
                        </span>
                        <KstTime
                          value={performance.endDate}
                          locale={activeLocale}
                        />
                      </span>
                    )
                  }
                />
                {performance.runtime && (
                  <DetailFact
                    icon={<Clock className="h-4 w-4" />}
                    label="공연시간"
                    value={performance.runtime}
                  />
                )}
                <DetailFact
                  icon={<User className="h-4 w-4" />}
                  label="관람연령"
                  value={performance.ageRating}
                />
              </div>

              {performance.priceTiers.length > 0 && (
                <div className="mt-7 rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
                    <CreditCard className="h-4 w-4 text-primary" />
                    가격
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {performance.priceTiers.map((tier) => (
                      <div
                        key={tier.id}
                        className="flex items-start justify-between gap-4 rounded-lg bg-white px-3 py-2 text-sm"
                      >
                        <span className="font-semibold text-gray-900">
                          {tier.tierName}
                        </span>
                        <CurrencyDisplay krwAmount={tier.price} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {bookingAvailable ? (
                <Link
                  href={getLocalizedPathname(
                    `/booking/${performance.id}`,
                    activeLocale,
                  )}
                  className="mt-7 hidden w-full max-w-[360px] rounded-lg bg-primary py-3 text-center text-base font-semibold text-white transition-colors hover:bg-primary/90 lg:block"
                >
                  {copy.performance.bookCta}
                </Link>
              ) : (
                <div
                  role="status"
                  className="mt-7 hidden w-full max-w-[360px] rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm font-semibold text-amber-800 lg:block"
                >
                  {bookingDisabledMessage}
                </div>
              )}
            </div>
          </div>
        </section>

        <div className="mx-auto grid w-full max-w-[1180px] gap-8 px-5 py-10 md:px-6 lg:grid-cols-[172px_minmax(0,1fr)]">
          <aside className="hidden lg:block">
            <nav className="sticky top-20 space-y-2 text-sm font-semibold text-gray-600">
              {detailImages.length > 0 && (
                <a
                  href="#detail-images"
                  className="flex items-center gap-2 rounded-md px-3 py-2 hover:bg-gray-100 hover:text-gray-900"
                >
                  <ImageIcon className="h-4 w-4" />
                  {getDetailImagesNavLabel(activeLocale)}
                </a>
              )}
              <a
                href="#detail-copy"
                className="flex items-center gap-2 rounded-md px-3 py-2 hover:bg-gray-100 hover:text-gray-900"
              >
                <Info className="h-4 w-4" />
                {getDetailCopyNavLabel(activeLocale)}
              </a>
              <a
                href="#sales-copy"
                className="flex items-center gap-2 rounded-md px-3 py-2 hover:bg-gray-100 hover:text-gray-900"
              >
                <Ticket className="h-4 w-4" />
                {getSalesCopyNavLabel(activeLocale)}
              </a>
            </nav>
          </aside>

          <div className="min-w-0 space-y-12">
            {detailImages.length > 0 && (
              <section id="detail-images" className="scroll-mt-24">
                <SectionHeader
                  eyebrow={`${detailImages.length} images`}
                  title="상세 이미지"
                />
                <div className="mt-5 space-y-5">
                  {detailImages.map((image, index) => (
                    <figure
                      key={`${image.imageUrl}-${index}`}
                      className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
                    >
                      <img
                        src={image.imageUrl}
                        alt={
                          image.altText
                          || `${performance.title} 상세 이미지 ${index + 1}`
                        }
                        className="h-auto w-full object-contain"
                        loading={index === 0 ? 'eager' : 'lazy'}
                      />
                    </figure>
                  ))}
                </div>
              </section>
            )}

            <section id="detail-copy" className="scroll-mt-24">
              <SectionHeader
                eyebrow="information"
                title={copy.performance.detailTab}
              />
              {performance.description ? (
                <div className="mt-5 rounded-xl border border-gray-200 bg-white p-5 text-sm leading-7 text-gray-800 shadow-sm">
                  <p className="whitespace-pre-wrap">
                    {performance.description}
                  </p>
                </div>
              ) : (
                <p className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-5 text-center text-sm text-gray-500">
                  {copy.performance.noDetail}
                </p>
              )}
            </section>

            <section id="sales-copy" className="scroll-mt-24">
              <SectionHeader
                eyebrow="ticket policy"
                title={copy.performance.salesTab}
              />
              {performance.salesInfo ? (
                <div className="mt-5 rounded-xl border border-gray-200 bg-white p-5 text-sm leading-7 text-gray-800 shadow-sm">
                  <p className="whitespace-pre-wrap">
                    {performance.salesInfo}
                  </p>
                </div>
              ) : (
                <div className="mt-5 rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-600 shadow-sm">
                  <h3 className="mb-2 font-semibold text-gray-900">
                    {copy.performance.refundTitle}
                  </h3>
                  <ul className="list-inside list-disc space-y-1">
                    {copy.performance.refundItems.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          </div>
        </div>
      </main>

      {/* Mobile CTA fixed bottom bar — offset by MobileTabBar height (h-14=56px) */}
      <div className="fixed bottom-[56px] left-0 right-0 z-40 flex h-16 items-center border-t bg-white px-6 shadow-[0_-4px_6px_rgba(0,0,0,0.05)] lg:hidden">
        {bookingAvailable ? (
          <Link
            href={getLocalizedPathname(
              `/booking/${performance.id}`,
              activeLocale,
            )}
            className="w-full rounded-lg bg-primary py-3 text-center text-base font-semibold text-white hover:bg-primary/90 transition-colors"
          >
            {copy.performance.bookCta}
          </Link>
        ) : (
          <button
            type="button"
            disabled
            className="min-h-12 w-full rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm font-semibold leading-snug text-amber-800"
          >
            {bookingDisabledMessage}
          </button>
        )}
      </div>
    </>
  );
}

function useActiveLocale(): SupportedLocale {
  const locale = useLocale();
  return isSupportedLocale(locale) ? locale : DEFAULT_LOCALE;
}

function getDetailImagesNavLabel(locale: SupportedLocale): string {
  const labels: Record<SupportedLocale, string> = {
    ko: '이미지 안내',
    en: 'Image guide',
    th: 'คู่มือรูปภาพ',
    'zh-CN': '图片导览',
    'zh-TW': '圖片導覽',
  };

  return labels[locale];
}

function getDetailCopyNavLabel(locale: SupportedLocale): string {
  const labels: Record<SupportedLocale, string> = {
    ko: '공연 안내',
    en: 'Overview',
    th: 'ภาพรวม',
    'zh-CN': '演出导览',
    'zh-TW': '演出導覽',
  };

  return labels[locale];
}

function getSalesCopyNavLabel(locale: SupportedLocale): string {
  const labels: Record<SupportedLocale, string> = {
    ko: '예매 안내',
    en: 'Ticket guide',
    th: 'คู่มือตั๋ว',
    'zh-CN': '票务指南',
    'zh-TW': '票務指南',
  };

  return labels[locale];
}

function DetailFact({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-semibold text-gray-500">
        <span className="text-primary">{icon}</span>
        <span>{label}</span>
      </div>
      <div className="mt-2 text-sm font-semibold leading-6 text-gray-900">
        {value}
      </div>
    </div>
  );
}

function SectionHeader({
  eyebrow,
  title,
}: {
  eyebrow: string;
  title: string;
}) {
  return (
    <div className="border-b border-gray-200 pb-3">
      <p className="text-xs font-semibold uppercase text-primary">
        {eyebrow}
      </p>
      <h2 className="mt-1 text-2xl font-semibold text-gray-900">{title}</h2>
    </div>
  );
}

function hasAutomaticTranslationMetadata(performance: unknown): boolean {
  if (!performance || typeof performance !== 'object') return false;

  const record = performance as Record<string, unknown>;
  if (
    record.automaticTranslationLabel === true ||
    record.isMachineTranslated === true ||
    typeof record.translatedBy === 'string'
  ) {
    return true;
  }

  return ['titleTranslation', 'descriptionTranslation', 'salesInfoTranslation'].some(
    (key) => hasAutomaticTranslationMetadata(record[key]),
  );
}
