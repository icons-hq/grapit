import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const mockPathname = vi.fn<() => string>().mockReturnValue('/');

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
  useSearchParams: () => new URLSearchParams('q=girl&page=2'),
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

vi.mock('@/components/layout/gnb', () => ({
  GNB: () => <nav>desktop nav</nav>,
}));

vi.mock('@/components/layout/footer', () => ({
  Footer: () => <footer>footer</footer>,
}));

vi.mock('@/components/layout/mobile-tab-bar', () => ({
  MobileTabBar: () => <nav>mobile tabs</nav>,
}));

import { LayoutShell } from '@/app/layout-shell';

describe('locale suggestion shell wiring', () => {
  beforeEach(() => {
    mockPathname.mockReturnValue('/');
    window.sessionStorage.clear();
    document.cookie = 'locale-suggestion=; Max-Age=0; path=/';
    document.cookie = 'locale-suggestion=en; path=/';
  });

  it('renders suggest-never-redirect copy for the suggested locale from the public layout shell', () => {
    render(
      <LayoutShell>
        <main>public page</main>
      </LayoutShell>,
    );

    expect(screen.getByText('View this page in English?')).toBeDefined();
    expect(screen.getByRole('button', { name: /Later/ })).toBeDefined();
    expect(screen.getByText('public page')).toBeDefined();
  });

  it('uses the suggested locale copy even when the active route falls back to Korean', () => {
    document.cookie = 'locale-suggestion=; Max-Age=0; path=/';
    document.cookie = 'locale-suggestion=th; path=/';

    render(
      <LayoutShell>
        <main>public page</main>
      </LayoutShell>,
    );

    expect(screen.getByText('ดูหน้านี้เป็นภาษาไทยไหม?')).toBeDefined();
    expect(screen.getByRole('button', { name: /ภายหลัง/ })).toBeDefined();
  });

  it('hides locale suggestion on admin shell paths', () => {
    mockPathname.mockReturnValue('/admin');

    render(
      <LayoutShell>
        <main>admin page</main>
      </LayoutShell>,
    );

    expect(screen.queryByText('View this page in English?')).toBeNull();
  });

  it('hides locale suggestion on booking checkout shell paths', () => {
    mockPathname.mockReturnValue('/booking/perf-1/seat');

    render(
      <LayoutShell>
        <main>checkout page</main>
      </LayoutShell>,
    );

    expect(screen.queryByText('View this page in English?')).toBeNull();
  });

  it('ignores malformed locale suggestion cookies without crashing hydration', () => {
    document.cookie = 'locale-suggestion=; Max-Age=0; path=/';
    document.cookie = 'locale-suggestion=%; path=/';

    render(
      <LayoutShell>
        <main>public page</main>
      </LayoutShell>,
    );

    expect(screen.queryByText('View this page in English?')).toBeNull();
    expect(screen.getByText('public page')).toBeDefined();
  });

  it('does not use automatic redirect APIs in locale suggestion display', () => {
    const sourcePath = join(
      process.cwd(),
      'components/i18n/locale-suggestion.tsx',
    );

    expect(existsSync(sourcePath)).toBe(true);
    const source = readFileSync(sourcePath, 'utf8');
    expect(source).toContain('React.useState<SupportedLocale | null>(null)');
    expect(source).toContain('getVisibleCopy(locale).locale');
    expect(source).not.toContain('SUGGESTION_COPY');
    expect(source).not.toContain('나중에');
    expect(source).not.toContain('() => readSuggestedLocale()');
    expect(source).not.toMatch(
      /router\.replace|redirect\(|window\.location\.assign/,
    );
  });
});
