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

describe('localized legal documents', () => {
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
    ['th', TermsPage, 'ข้อกำหนดการใช้บริการ'],
    ['th', PrivacyPage, 'นโยบายความเป็นส่วนตัว'],
    ['th', MarketingPage, 'ความยินยอมในการรับข้อมูลการตลาด'],
    ['zh-CN', TermsPage, '服务条款'],
    ['zh-CN', PrivacyPage, '隐私政策'],
    ['zh-CN', MarketingPage, '营销信息接收同意书'],
  ] as const)('renders the %s document %s in its own language', async (locale, Page, heading) => {
    getLocaleMock.mockResolvedValue(locale);
    await renderPage(Page);
    expect(screen.getByRole('heading', { name: heading, level: 1 })).toBeInTheDocument();
    expect(document.querySelector('[data-legal-fallback-locale]')).toBeNull();
  });
});
