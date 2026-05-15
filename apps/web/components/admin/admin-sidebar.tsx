'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Theater,
  Image as ImageIcon,
  Ticket,
  LayoutDashboard,
  ClipboardList,
  Languages,
  Inbox,
  FileQuestion,
  Armchair,
  ScrollText,
  ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/cn';

const NAV_GROUPS = [
  {
    label: '개요',
    items: [
      {
        label: '대시보드',
        href: '/admin',
        icon: LayoutDashboard,
      },
    ],
  },
  {
    label: '이벤트·콘텐츠',
    items: [
      {
        label: '공연 관리',
        href: '/admin/performances',
        icon: Theater,
      },
      {
        label: '배너 관리',
        href: '/admin/banners',
        icon: ImageIcon,
      },
      {
        label: 'FAQ/공지',
        href: '/admin/support-content',
        icon: FileQuestion,
      },
      {
        label: '번역 검수',
        href: '/admin/translations',
        icon: Languages,
      },
    ],
  },
  {
    label: '운영',
    items: [
      {
        label: '운영 인박스',
        href: '/admin/operations',
        icon: Inbox,
      },
      {
        label: '예매 관리',
        href: '/admin/bookings',
        icon: Ticket,
      },
      {
        label: '좌석 운영',
        href: '/admin/seat-operations',
        icon: Armchair,
      },
    ],
  },
  {
    label: '감사·보안',
    items: [
      {
        label: '동의 감사',
        href: '/admin/consent-audit',
        icon: ClipboardList,
      },
      {
        label: '감사 로그',
        href: '/admin/audit',
        icon: ScrollText,
      },
      {
        label: '보안 설정',
        href: '/admin/security',
        icon: ShieldCheck,
      },
    ],
  },
] as const;

interface AdminSidebarProps {
  variant?: 'desktop' | 'drawer';
}

export function AdminSidebar({ variant = 'desktop' }: AdminSidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        'w-[240px] shrink-0 border-r bg-white',
        variant === 'desktop' && 'hidden lg:block',
      )}
    >
      <div className="flex h-16 items-center border-b px-6">
        <Link href="/admin" className="text-sm font-semibold">
          Grabit Admin
        </Link>
      </div>
      <nav className="flex flex-col gap-5 p-4" aria-label="관리자 네비게이션">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="space-y-1.5">
            <p className="px-3 text-sm font-semibold text-gray-500">
              {group.label}
            </p>
            <div className="flex flex-col gap-1">
              {group.items.map((item) => {
                const isActive =
                  item.href === '/admin'
                    ? pathname === '/admin'
                    : pathname.startsWith(item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors',
                      isActive
                        ? 'border-l-[3px] border-primary bg-primary/5 text-primary'
                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
