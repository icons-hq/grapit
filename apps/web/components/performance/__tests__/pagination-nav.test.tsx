import { beforeAll, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PaginationNav } from '../pagination-nav';

describe('PaginationNav', () => {
  beforeAll(() => {
    Object.defineProperty(window, 'scrollTo', {
      value: vi.fn(),
      configurable: true,
    });
  });

  it('renders navigation with correct aria-label', () => {
    render(
      <PaginationNav currentPage={1} totalPages={5} onPageChange={vi.fn()} />,
    );
    expect(
      screen.getByRole('navigation', { name: '페이지 네비게이션' }),
    ).toBeDefined();
  });

  it('marks current page with aria-current', () => {
    render(
      <PaginationNav currentPage={3} totalPages={5} onPageChange={vi.fn()} />,
    );
    const currentBtn = screen.getByText('3');
    expect(currentBtn.getAttribute('aria-current')).toBe('page');
  });

  it('disables prev button on first page', () => {
    render(
      <PaginationNav currentPage={1} totalPages={5} onPageChange={vi.fn()} />,
    );
    const prevBtn = screen.getByLabelText(/이전/i);
    expect(prevBtn).toHaveProperty('disabled', true);
  });

  it('calls onPageChange when page button clicked', () => {
    const handler = vi.fn();
    render(
      <PaginationNav currentPage={1} totalPages={5} onPageChange={handler} />,
    );
    fireEvent.click(screen.getByText('3'));
    expect(handler).toHaveBeenCalledWith(3);
  });
});
