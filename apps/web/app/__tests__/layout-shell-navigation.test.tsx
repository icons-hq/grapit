import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const state = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => state.pathname }));
vi.mock('@/components/layout/gnb', () => ({ GNB: () => null }));
vi.mock('@/components/layout/footer', () => ({ Footer: () => null }));
vi.mock('@/components/i18n/locale-suggestion', () => ({ LocaleSuggestion: () => null }));
vi.mock('@/components/layout/mobile-tab-bar', () => ({
  MobileTabBar: () => <nav aria-label="모바일 탐색" />,
}));
import { LayoutShell } from '../layout-shell';

describe('LayoutShell mobile navigation', () => {
  beforeEach(() => { state.pathname = '/'; });

  it.each(['/ranking', '/upcoming', '/genre/concert', '/en/ranking', '/th/genre/concert'])(
    'keeps navigation available on the catalog route %s', (pathname) => {
      state.pathname = pathname;
      render(<LayoutShell><p>공연 목록</p></LayoutShell>);
      expect(screen.getByRole('navigation', { name: '모바일 탐색' })).toBeDefined();
    },
  );

  it.each(['/performance/show', '/booking/show', '/booking/show/confirm', '/admin', '/field/check-in'])(
    'does not obstruct the focused task on %s', (pathname) => {
      state.pathname = pathname;
      render(<LayoutShell><p>작업 화면</p></LayoutShell>);
      expect(screen.queryByRole('navigation', { name: '모바일 탐색' })).toBeNull();
    },
  );
});
