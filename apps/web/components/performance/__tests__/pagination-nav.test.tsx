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
      <PaginationNav
        currentPage={1}
        totalPages={5}
        onPageChange={vi.fn()}
        labels={{
          navigation: 'Search results pages',
          previous: 'Previous page',
          next: 'Next page',
        }}
      />,
    );
    expect(
      screen.getByRole('navigation', { name: 'Search results pages' }),
    ).toBeDefined();
  });

  it('localizes previous and next button labels', () => {
    render(
      <PaginationNav
        currentPage={2}
        totalPages={5}
        onPageChange={vi.fn()}
        labels={{
          navigation: 'Search results pages',
          previous: 'Previous page',
          next: 'Next page',
        }}
      />,
    );

    expect(screen.getByLabelText('Previous page')).toBeDefined();
    expect(screen.getByLabelText('Next page')).toBeDefined();
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
