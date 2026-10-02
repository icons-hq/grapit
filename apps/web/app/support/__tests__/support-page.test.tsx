import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const localeMock = vi.hoisted(() => ({
  activeLocale: 'en',
}));

const supportContentMock = vi.hoisted(() => ({
  result: {
    data: undefined as unknown,
    isError: false,
  },
}));

vi.mock('next-intl', () => ({
  useLocale: () => localeMock.activeLocale,
}));

vi.mock('@/hooks/use-support-content', () => ({
  useSupportContent: () => supportContentMock.result,
}));

import SupportPage from '../page';

describe('SupportPage', () => {
  beforeEach(() => {
    localeMock.activeLocale = 'en';
    supportContentMock.result = {
      data: undefined,
      isError: false,
    };
  });

  it('renders published API notices and FAQs for the active locale', () => {
    supportContentMock.result = {
      isError: false,
      data: {
        notices: [
          {
            id: 'notice-1',
            category: 'payment',
            locale: 'en',
            title: 'Payment window notice',
            body: 'Complete payment before the timer expires.',
            priority: 'high',
            publishedAt: '2026-06-03T08:00:00.000Z',
          },
        ],
        faqs: [
          {
            id: 'faq-1',
            category: 'booking',
            locale: 'en',
            question: 'When does booking open?',
            answer: 'Booking opens from the event detail page.',
            sortOrder: 0,
            isPinned: true,
            updatedAt: '2026-06-03T08:00:00.000Z',
          },
        ],
      },
    };

    render(<SupportPage />);

    expect(screen.getByRole('heading', { name: 'Support' })).toBeInTheDocument();
    expect(screen.getByText('Payment window notice')).toBeInTheDocument();
    expect(
      screen.getByText('Complete payment before the timer expires.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Complete payment before the timer expires.'),
    ).toHaveClass('break-words');
    expect(screen.getByText('When does booking open?')).toBeInTheDocument();
    expect(
      screen.getByText('Booking opens from the event detail page.'),
    ).toBeInTheDocument();
    expect(screen.getByText('wecordofficial_cs@mariannekate.com')).toHaveAttribute(
      'href',
      'mailto:wecordofficial_cs@mariannekate.com',
    );
  });

  it('renders static launch support copy when API content is empty or unavailable', () => {
    supportContentMock.result = {
      data: { notices: [], faqs: [] },
      isError: true,
    };

    render(<SupportPage />);

    expect(
      screen.getByText('We could not load the latest help content. Try again or contact us by email below.'),
    ).toBeInTheDocument();
    expect(screen.getByText('When does booking open?')).toBeInTheDocument();
    expect(screen.getByText('Payment and QR entry')).toBeInTheDocument();
    expect(screen.getByText('Refund or account support')).toBeInTheDocument();
    expect(screen.getByText('wecordofficial_cs@mariannekate.com')).toBeVisible();
  });

  it('labels urgent notices with category and KST posting time (audit #134)', () => {
    localeMock.activeLocale = 'ko';
    supportContentMock.result = {
      isError: false,
      data: {
        notices: [
          {
            id: 'notice-urgent',
            category: 'urgent',
            locale: 'ko',
            title: '결제 장애 안내',
            body: '결제가 지연되고 있습니다.',
            priority: 'urgent',
            publishedAt: '2026-06-03T08:00:00.000Z',
          },
        ],
        faqs: [],
      },
    };

    render(<SupportPage />);

    expect(screen.getByText('긴급')).toBeInTheDocument();
    expect(screen.getByText('게시 2026.06.03 17:00 KST')).toBeInTheDocument();
    expect(
      screen.queryByText(/원문 공지입니다/),
    ).not.toBeInTheDocument();
  });

  it('marks a Korean fallback notice shown on another locale page (audit #168)', () => {
    localeMock.activeLocale = 'th';
    supportContentMock.result = {
      isError: false,
      data: {
        notices: [
          {
            id: 'notice-ko-fallback',
            category: 'payment',
            locale: 'ko',
            title: '결제 장애 안내',
            body: '결제가 지연되고 있습니다.',
            priority: 'urgent',
            publishedAt: '2026-06-03T08:00:00.000Z',
          },
        ],
        faqs: [],
      },
    };

    render(<SupportPage />);

    expect(screen.getByText('결제 장애 안내')).toBeInTheDocument();
    expect(
      screen.getByText('แสดงเป็นภาษาเกาหลีระหว่างเตรียมคำแปล'),
    ).toBeInTheDocument();
    expect(screen.getByText('การชำระเงิน')).toBeInTheDocument();
    expect(screen.getByText('결제 장애 안내').closest('article')).toHaveAttribute(
      'lang',
      'ko',
    );
  });
});
