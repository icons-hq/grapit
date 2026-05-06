'use client';

import { use } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { MapPin, Calendar, Clock, User, Ticket } from 'lucide-react';
import { DEFAULT_LOCALE, isSupportedLocale } from '@grabit/shared';
import type { SupportedLocale } from '@grabit/shared';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { StatusBadge } from '@/components/performance/status-badge';
import { CurrencyDisplay } from '@/components/i18n/currency-display';
import { KstTime } from '@/components/i18n/kst-time';
import { usePerformanceDetail } from '@/hooks/use-performances';

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
  const { data: performance, isLoading, isError } = usePerformanceDetail(id);

  if (isLoading) return <DetailSkeleton />;

  if (isError || !performance) {
    return (
      <main className="mx-auto max-w-[1200px] px-6 py-8">
        <div className="flex flex-col items-center py-16">
          <p className="text-base text-gray-900">
            공연 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-lg bg-primary px-6 py-2 text-sm font-semibold text-white"
          >
            다시 시도
          </button>
        </div>
      </main>
    );
  }

  return (
    <>
      <main className="mx-auto w-full max-w-[1200px] px-6 pt-8 pb-20 lg:pb-8">
        {/* 2-column layout: left (poster + tabs) / right (info panel) */}
        <div className="flex flex-col gap-8 lg:flex-row">
          {/* Left column: poster + tabs */}
          <div className="w-full lg:max-w-[380px] shrink-0">
            {/* Poster */}
            <div className="relative aspect-[2/3] w-full max-w-[280px] mx-auto lg:mx-0 shrink-0 overflow-hidden rounded-lg bg-gray-200 lg:max-w-[380px]">
              {performance.posterUrl ? (
                <Image
                  src={performance.posterUrl}
                  alt={`${performance.title} 포스터`}
                  fill
                  className="object-cover"
                  sizes="(max-width: 1024px) 100vw, 380px"
                  priority
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <Ticket className="h-16 w-16 text-gray-400" />
                </div>
              )}
              <StatusBadge
                status={performance.status}
                className="absolute left-3 top-3"
              />
            </div>

            {/* Tab section -- below poster on desktop */}
            <div className="mt-8">
              <Tabs defaultValue="casting">
                <TabsList className="w-full">
                  <TabsTrigger value="casting">캐스팅</TabsTrigger>
                  <TabsTrigger value="detail">상세정보</TabsTrigger>
                  <TabsTrigger value="sales">판매정보</TabsTrigger>
                </TabsList>

                <TabsContent value="casting">
                  {performance.castings.length > 0 ? (
                    <div className="grid grid-cols-2 gap-6 md:grid-cols-3 lg:grid-cols-2">
                      {performance.castings.map((cast) => (
                        <div
                          key={cast.id}
                          className="flex flex-col items-center text-center"
                        >
                          <div className="relative h-16 w-16 overflow-hidden rounded-full bg-gray-200">
                            {cast.photoUrl ? (
                              <Image
                                src={cast.photoUrl}
                                alt={cast.actorName}
                                fill
                                className="object-cover"
                                sizes="64px"
                              />
                            ) : (
                              <div className="flex h-full items-center justify-center">
                                <User className="h-6 w-6 text-gray-400" />
                              </div>
                            )}
                          </div>
                          <p className="mt-2 text-sm font-semibold text-gray-900">
                            {cast.actorName}
                          </p>
                          {cast.roleName && (
                            <p className="text-sm text-gray-600">
                              {cast.roleName}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-center text-sm text-gray-500">
                      캐스팅 정보가 없습니다
                    </p>
                  )}
                </TabsContent>

                <TabsContent value="detail">
                  {performance.description ? (
                    <div className="prose max-w-prose text-sm text-gray-900">
                      <p className="whitespace-pre-wrap">
                        {performance.description}
                      </p>
                    </div>
                  ) : (
                    <p className="text-center text-sm text-gray-500">
                      상세 정보가 없습니다
                    </p>
                  )}
                </TabsContent>

                <TabsContent value="sales">
                  {performance.salesInfo ? (
                    <div className="prose max-w-prose text-sm text-gray-900">
                      <p className="whitespace-pre-wrap">
                        {performance.salesInfo}
                      </p>
                    </div>
                  ) : (
                    <div className="text-sm text-gray-600">
                      <h3 className="mb-2 font-semibold text-gray-900">
                        취소/환불 안내
                      </h3>
                      <ul className="list-inside list-disc space-y-1">
                        <li>예매 후 취소 시 취소수수료가 발생할 수 있습니다.</li>
                        <li>공연일 기준 취소 시점에 따라 수수료율이 달라집니다.</li>
                        <li>자세한 내용은 예매 시 확인해주세요.</li>
                      </ul>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          </div>

          {/* Right column: info panel (sticky on desktop, first on mobile) */}
          <div className="flex-1 lg:sticky lg:top-20 lg:self-start order-first lg:order-none">
            <h1 className="text-xl font-semibold text-gray-900">
              {performance.title}
            </h1>

            <div className="mt-4 space-y-2">
              {performance.venue && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <MapPin className="h-4 w-4 shrink-0" />
                  <span>{performance.venue.name}</span>
                </div>
              )}
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Calendar className="h-4 w-4 shrink-0" />
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
              </div>
              {performance.runtime && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Clock className="h-4 w-4 shrink-0" />
                  <span>{performance.runtime}</span>
                </div>
              )}
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <User className="h-4 w-4 shrink-0" />
                <span>{performance.ageRating}</span>
              </div>
            </div>

            {/* Price table */}
            {performance.priceTiers.length > 0 && (
              <>
                <Separator className="my-6" />
                <div className="space-y-2">
                  {performance.priceTiers.map((tier) => (
                    <div
                      key={tier.id}
                      className="flex items-start justify-between gap-4 text-sm"
                    >
                      <span className="font-semibold text-gray-900">
                        {tier.tierName}
                      </span>
                      <CurrencyDisplay
                        krwAmount={tier.price}
                        locale={activeLocale}
                      />
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* CTA button */}
            <Link
              href={`/booking/${performance.id}`}
              className="mt-6 hidden w-full rounded-lg bg-primary py-3 text-center text-base font-semibold text-white hover:bg-primary/90 transition-colors lg:block"
            >
              예매하기
            </Link>
          </div>
        </div>
      </main>

      {/* Mobile CTA fixed bottom bar — offset by MobileTabBar height (h-14=56px) */}
      <div className="fixed bottom-[56px] left-0 right-0 z-40 flex h-16 items-center border-t bg-white px-6 shadow-[0_-4px_6px_rgba(0,0,0,0.05)] lg:hidden">
        <Link
          href={`/booking/${performance.id}`}
          className="w-full rounded-lg bg-primary py-3 text-center text-base font-semibold text-white hover:bg-primary/90 transition-colors"
        >
          예매하기
        </Link>
      </div>
    </>
  );
}

function useActiveLocale(): SupportedLocale {
  const locale = useLocale();
  return isSupportedLocale(locale) ? locale : DEFAULT_LOCALE;
}
