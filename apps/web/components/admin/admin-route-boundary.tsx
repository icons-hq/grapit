'use client';
import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { resolveAdminCapabilitySnapshot, SEAT_OPERATION_CAPABILITIES, type AdminCapability } from '@grabit/shared';
import { useAuthStore } from '@/stores/use-auth-store';

const ROUTE_CAPABILITIES: Record<string, readonly AdminCapability[]> = {
  performances: ['event.write'], translations: ['event.write'], bookings: ['reservations.read'],
  operations: ['support.manage'], 'support-content': ['support.manage'], benefits: ['benefits.manage'],
  settlement: ['settlement.export'], 'seat-operations': SEAT_OPERATION_CAPABILITIES,
  'field-monitor': ['field.scan.verify'], users: ['security.manage'], banners: ['banner.manage'],
  audit: ['audit.read'], 'consent-audit': ['audit.read'], security: ['security.manage'], cutover: ['audit.read'],
};
export function AdminRouteBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const user = useAuthStore((state) => state.user);
  const capabilities = resolveAdminCapabilitySnapshot(user);
  const page = pathname.split('/')[2] ?? '';
  const required = page ? ROUTE_CAPABILITIES[page] : ['reservations.read' as const];
  if (!capabilities.superuser && required && !required.some((capability) => capabilities.capabilities.includes(capability))) {
    const destination = capabilities.capabilities.includes('field.scan.verify') ? '/admin/field-monitor'
      : capabilities.capabilities.includes('settlement.export') ? '/admin/settlement'
        : capabilities.capabilities.includes('event.write') ? '/admin/performances' : '/';
    return <section role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-gray-900">
      <h1 className="text-xl font-semibold">이 업무에 필요한 권한이 없습니다</h1>
      <p className="mt-3 text-sm">현재 계정에 허용된 업무를 선택해주세요.</p>
      <Link className="mt-4 inline-block font-semibold text-violet-700 underline" href={destination}>허용된 업무로 이동</Link>
    </section>;
  }
  return children;
}
