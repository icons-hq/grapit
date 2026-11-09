'use client';

import { useId } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, LockKeyhole, Ticket } from 'lucide-react';
import type { PerformanceListResponse } from '@grabit/shared';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import { apiClient } from '@/lib/api-client';
import { canUseAdminBookingBypass } from '@/lib/booking/admin-booking-bypass';
import { getTicketCopy } from '@/lib/i18n/ticket-copy';
import { resolveVisibleCopyLocale } from '@/lib/i18n/visible-copy';
import { formatCatalogDateRange } from '@/lib/performance/catalog-format';
import { useAuthStore } from '@/stores/use-auth-store';

/** Private discovery is separate from the shared, public catalog cache. */
export function AdminBookingPreviews() {
  const userId = useAuthStore((state) =>
    state.isInitialized && state.accessToken && canUseAdminBookingBypass(state.user)
      ? state.user!.id
      : null,
  );
  // Unmount immediately on logout or a role change, including pending requests.
  return userId ? <AdminBookingPreviewList key={userId} userId={userId} /> : null;
}

function AdminBookingPreviewList({ userId }: { userId: string }) {
  const headingId = useId();
  const locale = resolveVisibleCopyLocale(useLocale());
  const copy = getTicketCopy(locale);
  const query = useQuery({
    queryKey: ['admin', 'performances', 'booking-previews', userId],
    queryFn: () => apiClient.get<PerformanceListResponse>(
      '/api/v1/admin/performances?status=upcoming&page=1&limit=100',
      { showErrorToast: false },
    ),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  const performances = (query.data?.data ?? []).filter(
    (performance) => performance.publishState === 'draft' && performance.status === 'upcoming',
  );
  if (!query.isPending && !query.isError && performances.length === 0) return null;

  return <div className="ticket-container">
    <section aria-labelledby={headingId} className="my-6 rounded-2xl border border-violet-200 bg-violet-50/60 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={headingId} className="flex items-center gap-2 text-lg font-bold text-violet-950">
          <LockKeyhole size={18} aria-hidden="true" />{copy.adminBookingHeading}
        </h2>
        <Link href="/admin/performances" className="text-sm font-semibold text-violet-700 hover:underline">
          {copy.adminPerformances}<ArrowUpRight className="ml-1 inline" size={15} aria-hidden="true" />
        </Link>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">{copy.adminBookingDescription}</p>
      {query.isError ? <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        <p>{copy.loadError}</p>
        <button type="button" className="font-semibold text-violet-700 underline" onClick={() => void query.refetch()}>{copy.retry}</button>
      </div> : query.isPending ? <p role="status" className="mt-4 text-sm text-slate-600">{copy.adminBookingLoading}</p>
        : <ul className="mt-4 grid gap-3">
          {performances.map((performance) => {
            const bookingHref = getLocalizedPathname(`/booking/${performance.id}`, locale);
            return <li key={performance.id} className="flex flex-wrap items-center gap-4 rounded-xl border border-violet-100 bg-white p-4">
              <div className="relative flex h-24 w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100">
                {performance.posterUrl
                  ? <Image src={performance.posterUrl} alt="" fill sizes="72px" className="object-contain" />
                  : <Ticket className="text-violet-400" size={28} aria-hidden="true" />}
              </div>
              <div className="min-w-0 flex-1 basis-36">
                <span className="text-xs font-semibold text-violet-700">{copy.privatePerformance}</span>
                <h3 className="mt-1 break-words font-bold text-slate-950">
                  <Link href={bookingHref} className="hover:underline">{performance.title}</Link>
                </h3>
                {performance.venueName && <p className="mt-1 text-sm text-slate-600">{performance.venueName}</p>}
                <p className="mt-1 text-sm text-slate-500">{formatCatalogDateRange(performance.startDate, performance.endDate, locale)}</p>
              </div>
              <Link href={bookingHref} aria-label={`${performance.title} · ${copy.adminBookingTest}`}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-violet-700 px-5 py-3 text-sm font-semibold text-white hover:bg-violet-800 sm:w-auto">
                {copy.adminBookingTest}<ArrowUpRight size={16} aria-hidden="true" />
              </Link>
            </li>;
          })}
        </ul>}
    </section>
  </div>;
}
