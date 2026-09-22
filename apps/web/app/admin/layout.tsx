'use client';

import { usePathname, useRouter } from 'next/navigation';
import { adminLocation } from '@/lib/admin-navigation';
import './admin.css';
import { Suspense, useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { AdminEventContextBar, AdminEventContextProvider } from '@/components/admin/admin-event-context';
import { AdminRouteBoundary } from '@/components/admin/admin-route-boundary';
import Link from 'next/link';
import { Menu, LogOut, ShieldAlert } from 'lucide-react';
import { useAuthStore } from '@/stores/use-auth-store';
import { AdminSidebar } from '@/components/admin/admin-sidebar';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
} from '@/components/ui/sheet';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const location = adminLocation(pathname);
  const user = useAuthStore((s) => s.user);
  const isInitialized = useAuthStore((s) => s.isInitialized);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); }, [pathname]);

  if (!isInitialized) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F5F5F7] px-6">
        <div className="rounded-lg bg-white px-6 py-5 text-sm font-semibold text-gray-700 shadow-sm">
          관리자 권한을 확인하고 있습니다.
        </div>
      </div>
    );
  }

  if (!user || user.role !== 'admin') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F5F5F7] px-6">
        <section
          role="alert"
          aria-labelledby="admin-access-denied-title"
          className="w-full max-w-lg rounded-lg border border-[#F3C7C7] bg-white p-6 shadow-sm"
        >
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[#FEF2F2] text-[#C62828]">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h1
                id="admin-access-denied-title"
                className="text-heading font-semibold leading-[1.2] text-gray-900"
              >
                관리자 접근 권한이 없습니다
              </h1>
              <p className="mt-3 text-base leading-[1.5] text-gray-700">
                이 화면은 운영 권한이 있는 계정만 사용할 수 있습니다.
              </p>
              <div className="mt-6 flex flex-col gap-2 sm:flex-row">
                <Button asChild className="h-11">
                  <Link href="/auth">관리자 계정으로 로그인</Link>
                </Button>
                <Button asChild variant="outline" className="h-11">
                  <Link href="/">홈으로 이동</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </div>
    );
  }

  async function handleLogout() {
    try { await apiClient.post('/api/v1/auth/logout'); } catch { /* Clear this device's session even when offline. */ }
    clearAuth();
    queryClient.clear();
    router.replace('/auth');
  }

  return (
    <Suspense fallback={<p className="p-8">운영 화면을 불러오고 있습니다.</p>}>
    <AdminEventContextProvider>
    <div className="grabit-admin flex min-h-screen">
      <a className="admin-skip-link" href="#admin-main">본문으로 바로가기</a>
      <AdminSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="admin-topbar">
          <div className="flex items-center gap-3 lg:hidden">
            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="메뉴 열기">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="grabit-admin w-[280px] max-w-[85vw] p-0">
                <SheetTitle className="sr-only">관리자 메뉴</SheetTitle>
                <AdminSidebar variant="drawer" onNavigate={() => setMenuOpen(false)} />
              </SheetContent>
            </Sheet>
          </div>
          <div className="admin-breadcrumb" aria-label="현재 위치"><span>{location.group?.label ?? '관리자'}</span><span aria-hidden="true">/</span><strong>{pathname.endsWith('/new') ? '공연 등록' : pathname.endsWith('/edit') ? '공연 편집' : location.item?.label ?? '운영'}</strong></div>
          <div className="ml-auto flex items-center gap-3">
            <span className="max-w-28 truncate text-sm text-gray-600">{user.name}</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleLogout}
              aria-label="로그아웃"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </header>
        <main id="admin-main" tabIndex={-1} className="admin-main"><AdminRouteBoundary><AdminEventContextBar />{children}</AdminRouteBoundary></main>
      </div>
    </div>
    </AdminEventContextProvider>
    </Suspense>
  );
}
