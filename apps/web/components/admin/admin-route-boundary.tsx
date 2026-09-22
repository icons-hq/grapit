'use client';
import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { resolveAdminCapabilitySnapshot } from '@grabit/shared';
import { ADMIN_NAVIGATION, adminLocation, canAccessAdminItem } from '@/lib/admin-navigation';
import { useAuthStore } from '@/stores/use-auth-store';

export function AdminRouteBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const user = useAuthStore((state) => state.user);
  const capabilities = resolveAdminCapabilitySnapshot(user);
  const { item } = adminLocation(pathname);
  if (item && !canAccessAdminItem(item, capabilities)) {
    const destination = ADMIN_NAVIGATION.flatMap((group) => group.items).find((candidate) => canAccessAdminItem(candidate, capabilities))?.href ?? '/';
    return <section role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-gray-900">
      <h1 className="text-xl font-semibold">이 업무에 필요한 권한이 없습니다</h1>
      <p className="mt-3 text-sm">현재 계정에 허용된 업무를 선택해주세요.</p>
      <Link className="mt-4 inline-block font-semibold text-violet-700 underline" href={destination}>허용된 업무로 이동</Link>
    </section>;
  }
  return children;
}
