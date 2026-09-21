'use client';

import { createContext, useContext, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { resolveAdminCapabilitySnapshot, type AdminCapability } from '@grabit/shared';
import { useAuthStore } from '@/stores/use-auth-store';
import { useAdminPerformanceDetail, useAdminPerformances } from '@/hooks/use-admin';
import { formatAdminKstDateTime } from '@/lib/admin-datetime';
import { cn } from '@/lib/cn';

type EventContextValue = {
  performanceId: string;
  performanceTitle: string | null;
  showtimeId: string;
  bookingId: string | null;
  invalidShowtime: boolean;
  selectPerformance: (id: string) => void;
  selectShowtime: (id: string) => void;
  href: (path: string) => string;
};
const EventContext = createContext<EventContextValue | null>(null);

export function useAdminEventContext() {
  return useContext(EventContext);
}

export function AdminEventContextProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const routeId = pathname.match(/^\/admin\/performances\/([\da-f-]{36})(?:\/|$)/)?.[1];
  const requestedPerformanceId = routeId ?? params.get('performanceId') ?? '';
  const performanceId = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(requestedPerformanceId) ? requestedPerformanceId : '';
  const selectedPerformance = useAdminPerformanceDetail(performanceId);
  const requestedShowtimeId = params.get('showtimeId') ?? '';
  const showtimeId = selectedPerformance.data?.showtimes.some((showtime) => showtime.id === requestedShowtimeId) ? requestedShowtimeId : '';
  const invalidShowtime = Boolean(requestedShowtimeId && selectedPerformance.isSuccess && !showtimeId);
  function replace(nextPerformance: string, nextShowtime: string, changePerformance = false) {
    const query = new URLSearchParams(params.toString());
    if (nextPerformance) query.set('performanceId', nextPerformance); else query.delete('performanceId');
    if (nextShowtime) query.set('showtimeId', nextShowtime); else query.delete('showtimeId');
    query.delete('bookingId');
    let path = pathname;
    if (changePerformance && routeId) {
      path = nextPerformance ? `/admin/performances/${nextPerformance}` : '/admin/performances';
      query.delete('draftId'); query.delete('step');
    }
    router.replace(`${path}${query.size ? `?${query}` : ''}`, { scroll: false });
  }
  function href(path: string) {
    const [base, supplied] = path.split('?');
    const query = new URLSearchParams(supplied);
    if (performanceId && !query.has('performanceId')) query.set('performanceId', performanceId);
    if (showtimeId && !query.has('showtimeId')) query.set('showtimeId', showtimeId);
    return `${base}${query.size ? `?${query}` : ''}`;
  }
  return <EventContext.Provider value={{ performanceId, performanceTitle: selectedPerformance.data?.title ?? null, showtimeId, invalidShowtime, bookingId: params.get('bookingId'),
    selectPerformance: (id) => replace(id, '', true), selectShowtime: (id) => replace(performanceId, id), href }}>
    {children}
  </EventContext.Provider>;
}

export function AdminEventContextBar() {
  const context = useAdminEventContext();
  const pathname = usePathname();
  const user = useAuthStore((state) => state.user);
  const snapshot = resolveAdminCapabilitySnapshot(user);
  const can = (capability: AdminCapability) => snapshot.superuser || snapshot.capabilities.includes(capability);
  const list = useAdminPerformances({ page: 1, limit: 200 });
  const detail = useAdminPerformanceDetail(context?.performanceId ?? '');
  if (!context || !/^\/admin\/(performances|bookings|benefits|operations|seat-operations|field-monitor|settlement|translations)(\/|$)/.test(pathname)
    || pathname.endsWith('/new')) return null;
  const options: Array<{ id: string; title: string }> = [...(list.data?.data ?? [])];
  if (detail.data && !options.some((item) => item.id === detail.data.id)) options.push(detail.data);
  const tabs: Array<{ label: string; path: string; cap: AdminCapability }> = [
    { label: '준비', path: context.performanceId ? `/admin/performances/${context.performanceId}` : '/admin/performances', cap: 'event.write' },
    { label: '판매·예매', path: '/admin/bookings', cap: 'reservations.read' },
    { label: '고객 대응', path: '/admin/operations', cap: 'support.manage' },
    { label: '좌석', path: '/admin/seat-operations', cap: 'seat.disable' },
    { label: '특전', path: '/admin/benefits', cap: 'benefits.manage' },
    { label: '현장', path: '/admin/field-monitor', cap: 'field.scan.verify' },
    { label: '정산', path: '/admin/settlement', cap: 'settlement.export' },
  ];
  return <section aria-label="선택한 공연과 회차" className="mb-7 space-y-4 border-b border-gray-200 pb-4">
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(200px,0.65fr)]">
      <label className="space-y-1 text-sm font-medium text-gray-600">공연
        <select aria-label="업무 공연 선택" value={context.performanceId} onChange={(event) => context.selectPerformance(event.target.value)}
          className="h-11 w-full rounded-lg border border-gray-200 bg-white px-3 text-gray-950" disabled={list.isLoading || list.isError}>
          <option value="">{list.isError ? '공연 목록 조회 실패' : list.isLoading ? '공연 불러오는 중' : '공연을 선택하세요'}</option>
          {options.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}
        </select>
      </label>
      <label className="space-y-1 text-sm font-medium text-gray-600">회차 · 한국 시간
        <select aria-label="업무 회차 선택" value={context.showtimeId} onChange={(event) => context.selectShowtime(event.target.value)}
          className="h-11 w-full rounded-lg border border-gray-200 bg-white px-3 text-gray-950" disabled={!context.performanceId || detail.isLoading || detail.isError}>
          <option value="">{detail.isError ? '회차 조회 실패' : !context.performanceId ? '공연을 먼저 선택하세요' : detail.isLoading ? '회차 불러오는 중' : '전체 회차'}</option>
          {(detail.data?.showtimes ?? []).map((showtime) => <option key={showtime.id} value={showtime.id}>{formatAdminKstDateTime(showtime.dateTime).replace('T', ' ')} KST</option>)}
        </select>
      </label>
    </div>
    {(list.isError || detail.isError) && <button className="text-sm underline" onClick={() => { void list.refetch(); if (context.performanceId) void detail.refetch(); }}>선택 목록 다시 불러오기</button>}
    {context.invalidShowtime && <p role="alert" className="text-sm text-amber-800">이 공연에 속하지 않는 회차입니다. 위에서 회차를 다시 선택해주세요.</p>}
    <nav aria-label="공연 업무" className="flex flex-wrap gap-x-5 gap-y-2">
      {tabs.filter((tab) => can(tab.cap)).map((tab) => <Link key={tab.label} href={context.href(tab.path)}
        className={cn('border-b-2 pb-2 text-sm font-semibold', pathname === tab.path || (tab.label === '준비' && pathname.startsWith('/admin/performances'))
          ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-500 hover:text-gray-900')}>{tab.label}</Link>)}
    </nav>
  </section>;
}
