import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { getLocale } from 'next-intl/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import MarketingPage from '../marketing/page';
import PrivacyPage from '../privacy/page';
import TermsPage from '../terms/page';

vi.mock('next-intl/server', () => ({
  getLocale: vi.fn(),
}));

const getLocaleMock = vi.mocked(getLocale);

async function renderPage(page: () => React.ReactNode | Promise<React.ReactNode>) {
  render(<>{await page()}</>);
}

describe('legal canonical locale fallback', () => {
  beforeEach(() => {
    getLocaleMock.mockReset();
  });

  it('renders Korean canonical terms copy without an English fallback label for ko', async () => {
    getLocaleMock.mockResolvedValue('ko');

    await renderPage(TermsPage);

    expect(screen.getByRole('heading', { name: '이용약관', level: 1 })).toBeInTheDocument();
    expect(screen.queryByText('영문 법적 고지로 확인합니다')).not.toBeInTheDocument();
  });

  it('renders English canonical terms copy without a fallback label for en', async () => {
    getLocaleMock.mockResolvedValue('en');

    await renderPage(TermsPage);

    expect(screen.getByRole('heading', { name: 'Terms of Service', level: 1 })).toBeInTheDocument();
    expect(screen.queryByText('영문 법적 고지로 확인합니다')).not.toBeInTheDocument();
  });

  it.each([
    ['th', TermsPage, 'Terms of Service'],
    ['zh-CN', PrivacyPage, 'Privacy Policy'],
  ])(
    'renders %s legal pages with English canonical copy and the fallback label',
    async (locale, Page, heading) => {
      getLocaleMock.mockResolvedValue(locale);

      await renderPage(Page);

      expect(screen.getByText('영문 법적 고지로 확인합니다')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: heading, level: 1 })).toBeInTheDocument();
      expect(screen.queryByText(/자동 번역|machine translated|automatic translation/i)).not.toBeInTheDocument();
    },
  );

  it('renders the Simplified Chinese fallback label without Japanese launch copy', async () => {
    getLocaleMock.mockResolvedValue('zh-CN');

    await renderPage(TermsPage);

    const fallbackLabel = screen.getByText('查看英文法律告知');

    expect(fallbackLabel).toBeInTheDocument();
    expect(fallbackLabel.closest('[data-legal-fallback-locale]')).toHaveAttribute(
      'data-legal-fallback-locale',
      'zh-CN',
    );
    expect(screen.queryByText('英語の法的通知を確認しています')).not.toBeInTheDocument();
  });
});
