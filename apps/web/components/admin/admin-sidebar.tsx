'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowUpRight, ChevronDown, Search, LayoutDashboard, Ticket, Armchair, MessageSquare, Settings, X } from 'lucide-react';
import { resolveAdminCapabilitySnapshot } from '@grabit/shared';
import { cn } from '@/lib/cn';
import { useAuthStore } from '@/stores/use-auth-store';
import { ADMIN_NAVIGATION, adminLocation, canAccessAdminItem, isAdminPathActive } from '@/lib/admin-navigation';
import { useAdminEventContext } from './admin-event-context';

const GROUP_ICONS: Record<string, typeof Ticket> = { home: LayoutDashboard, sales: Ticket, field: Armchair, support: MessageSquare, settings: Settings };

export function AdminSidebar({ variant = 'desktop', onNavigate }: { variant?: 'desktop' | 'drawer'; onNavigate?: () => void }) {
  const pathname = usePathname();
  const user = useAuthStore((state) => state.user);
  const snapshot = resolveAdminCapabilitySnapshot(user);
  const context = useAdminEventContext();
  const location = adminLocation(pathname);
  const [query, setQuery] = useState('');
  const [openGroups, setOpenGroups] = useState<string[]>(['sales', 'field']);
  const id = useId();
  const search = query.trim().toLocaleLowerCase('ko-KR');
  const groups = ADMIN_NAVIGATION.map((group) => ({ ...group, items: group.items.filter((item) => canAccessAdminItem(item, snapshot) && (!search || `${group.label} ${item.label} ${item.description} ${item.keywords ?? ''}`.toLocaleLowerCase('ko-KR').includes(search))) })).filter((group) => group.items.length);

  const homeHref = ADMIN_NAVIGATION.flatMap((group) => group.items).find((item) => canAccessAdminItem(item, snapshot))?.href ?? '/';

  function navigate() { setQuery(''); onNavigate?.(); }

  return <aside className={cn('admin-sidebar', variant === 'desktop' ? 'hidden lg:flex' : 'admin-sidebar-drawer')}>
    <Link href={homeHref} onClick={navigate} className="admin-brand"><span>Grabit</span><span className="admin-brand-caption">관리자</span></Link>
    <div className="admin-menu-search">
      <Search size={16} aria-hidden="true" />
      <input type="search" aria-label="관리자 메뉴 검색" placeholder="메뉴 검색" value={query} onChange={(event) => setQuery(event.target.value)} />
      {query && <button type="button" aria-label="메뉴 검색어 지우기" onClick={() => setQuery('')}><X size={16} /></button>}
    </div>
    <nav aria-label="관리자 메뉴" className="admin-navigation">
      {groups.map((group) => {
        const Icon = GROUP_ICONS[group.id];
        const open = Boolean(search) || group.id === 'home' || location.group?.id === group.id || openGroups.includes(group.id);
        return <div key={group.id} className="admin-nav-group">
          <button className="admin-nav-group-toggle" type="button" disabled={group.id === 'home' || location.group?.id === group.id} aria-expanded={open} aria-controls={`${id}-${group.id}`}
            onClick={() => setOpenGroups((current) => current.includes(group.id) ? current.filter((value) => value !== group.id) : [...current, group.id])}>
            <span>{group.label}</span><ChevronDown size={14} className={cn(!open && '-rotate-90')} aria-hidden="true" />
          </button>
          <div id={`${id}-${group.id}`} hidden={!open}>
            {group.items.map((item) => <Link key={item.href} href={context?.href(item.href) ?? item.href} onClick={navigate}
              className="admin-nav-link" aria-current={isAdminPathActive(item.href, pathname) ? 'page' : undefined}>
              <Icon size={17} aria-hidden="true" /><span>{item.label}</span>
            </Link>)}
          </div>
        </div>;
      })}
      {!groups.length && <p role="status" className="px-3 py-6 text-sm text-muted-foreground">찾는 메뉴가 없습니다. 다른 이름으로 검색해주세요.</p>}
    </nav>
    <Link href="/" className="admin-sidebar-footer" onClick={navigate}><ArrowUpRight size={16} aria-hidden="true" />예매 사이트 보기</Link>
  </aside>;
}
