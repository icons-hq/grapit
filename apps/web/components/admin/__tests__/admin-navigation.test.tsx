import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminCapability } from '@grabit/shared';
import { useAuthStore } from '@/stores/use-auth-store';
import { AdminSidebar } from '../admin-sidebar';
import { AdminEventContextBar, AdminEventContextProvider, useAdminEventContext } from '../admin-event-context';
const route = vi.hoisted(() => ({ path: '/admin', query: '', replace: vi.fn(), list: vi.fn(() => ({ data: { data: [], total: 401, totalPages: 3 } })), detail: vi.fn(() => ({ data: { id: '00000000-0000-4000-8000-000000000023', title: '공연', showtimes: [{ id: 'showtime-1', dateTime: '2026-09-22T10:00:00Z' }] } })) }));
vi.mock('next/navigation', () => ({ usePathname: () => route.path, useSearchParams: () => new URLSearchParams(route.query), useRouter: () => ({ replace: route.replace }) }));
vi.mock('@/hooks/use-admin', () => ({ useAdminPerformances: route.list, useAdminPerformanceDetail: route.detail }));
function setCapabilities(capabilities: AdminCapability[]) {
  useAuthStore.getState().setAuth('local-test', { id: 'operator', email: 'operator@example.test', name: '운영자', role: 'admin', adminCapabilityBundle: null, adminCapabilities: capabilities,
    phone: '+82100000000', gender: 'unspecified', country: 'KR', birthDate: '1990-01-01', preferredLocale: 'ko', isEmailVerified: true, isPhoneVerified: true, marketingConsent: false, createdAt: '2026-01-01T00:00:00Z' });
}
function ContextLink() { const context = useAdminEventContext(); return <a href={context?.href('/admin/bookings')}>예매로</a>; }
describe('관리자 메뉴와 공연 범위', () => {
  beforeEach(() => { route.path = '/admin'; route.query = ''; vi.clearAllMocks(); setCapabilities(['reservations.read', 'audit.read']); });
  it('finds renamed menus without exposing unauthorized work', async () => {
    render(<AdminSidebar />);
    expect(screen.queryByRole('link', { name: '공연 관리' })).not.toBeInTheDocument();
    await userEvent.setup().type(screen.getByRole('searchbox', { name: '관리자 메뉴 검색' }), '컷오버');
    expect(screen.getByRole('link', { name: '판매 시작 점검' })).toHaveAttribute('href', '/admin/cutover');
    expect(screen.queryByRole('link', { name: '예매·취소' })).not.toBeInTheDocument();
  });
  it('keeps the current submenu open and marks the current page', () => {
    route.path = '/admin/audit'; render(<AdminSidebar />);
    expect(screen.getByRole('link', { name: '관리자 활동 기록' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: '설정·기록' })).toHaveAttribute('aria-expanded', 'true');
  });
  it('does not fetch or show an unrelated performance selector on the catalog', () => {
    route.path = '/admin/performances'; render(<AdminEventContextBar />);
    expect(route.list).not.toHaveBeenCalled(); expect(screen.queryByLabelText('업무 공연 선택')).not.toBeInTheDocument();
  });
  it('preserves showtime across related work and clears booking selection when filters change', async () => {
    route.path = '/admin/bookings'; route.query = 'performanceId=00000000-0000-4000-8000-000000000023&showtimeId=showtime-1&bookingId=old-booking';
    render(<AdminEventContextProvider><ContextLink /><AdminEventContextBar /></AdminEventContextProvider>);
    expect(screen.getByRole('link', { name: '예매로' })).toHaveAttribute('href', '/admin/bookings?performanceId=00000000-0000-4000-8000-000000000023&showtimeId=showtime-1');
    await userEvent.setup().selectOptions(screen.getByLabelText('업무 회차 선택'), '');
    expect(route.replace).toHaveBeenCalledWith('/admin/bookings?performanceId=00000000-0000-4000-8000-000000000023', { scroll: false });
  });
  it('searches all performances and resets pagination without losing the selected event', async () => {
    route.path = '/admin/benefits'; route.query = 'performanceId=00000000-0000-4000-8000-000000000023';
    render(<AdminEventContextProvider><AdminEventContextBar /></AdminEventContextProvider>);
    const user = userEvent.setup();
    await user.click(screen.getByText('공연 찾기 · 전체 401개'));
    await user.click(screen.getByRole('button', { name: '공연 목록 다음 페이지' }));
    expect(route.list).toHaveBeenLastCalledWith({ page: 2, limit: 200 });
    await user.type(screen.getByRole('searchbox', { name: '전체 공연 이름 검색' }), '이전 공연');
    await user.click(screen.getByRole('button', { name: '검색' }));
    expect(route.list).toHaveBeenLastCalledWith({ page: 1, limit: 200, search: '이전 공연' });
    expect(screen.getByLabelText('업무 공연 선택')).toHaveValue('00000000-0000-4000-8000-000000000023');
    expect(route.replace).not.toHaveBeenCalled();
  });
});
