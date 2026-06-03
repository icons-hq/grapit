'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

interface PaginationNavProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  labels?: PaginationNavLabels;
}

interface PaginationNavLabels {
  navigation: string;
  previous: string;
  next: string;
}

const DEFAULT_LABELS: PaginationNavLabels = {
  navigation: '페이지 네비게이션',
  previous: '이전 페이지',
  next: '다음 페이지',
};

function getPageNumbers(current: number, total: number): (number | '...')[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages: (number | '...')[] = [];

  if (current <= 4) {
    for (let i = 1; i <= 5; i++) pages.push(i);
    pages.push('...');
    pages.push(total);
  } else if (current >= total - 3) {
    pages.push(1);
    pages.push('...');
    for (let i = total - 4; i <= total; i++) pages.push(i);
  } else {
    pages.push(1);
    pages.push('...');
    pages.push(current - 1);
    pages.push(current);
    pages.push(current + 1);
    pages.push('...');
    pages.push(total);
  }

  return pages;
}

export function PaginationNav({
  currentPage,
  totalPages,
  onPageChange,
  labels = DEFAULT_LABELS,
}: PaginationNavProps) {
  if (totalPages <= 1) return null;

  const pages = getPageNumbers(currentPage, totalPages);

  function handlePageChange(page: number) {
    onPageChange(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <nav aria-label={labels.navigation} className="flex items-center justify-center gap-1">
      <button
        type="button"
        disabled={currentPage === 1}
        onClick={() => handlePageChange(currentPage - 1)}
        aria-label={labels.previous}
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-lg text-sm',
          currentPage === 1
            ? 'cursor-not-allowed opacity-50'
            : 'text-gray-900 hover:bg-gray-200',
        )}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      {pages.map((page, idx) =>
        page === '...' ? (
          <span
            key={`ellipsis-${idx}`}
            className="flex h-9 w-9 items-center justify-center text-sm text-gray-500"
          >
            ...
          </span>
        ) : (
          <button
            key={page}
            type="button"
            onClick={() => handlePageChange(page)}
            aria-current={page === currentPage ? 'page' : undefined}
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-lg text-sm font-normal',
              page === currentPage
                ? 'bg-primary text-white'
                : 'bg-[#F5F5F7] text-gray-900 hover:bg-gray-200',
            )}
          >
            {page}
          </button>
        ),
      )}

      <button
        type="button"
        disabled={currentPage === totalPages}
        onClick={() => handlePageChange(currentPage + 1)}
        aria-label={labels.next}
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-lg text-sm',
          currentPage === totalPages
            ? 'cursor-not-allowed opacity-50'
            : 'text-gray-900 hover:bg-gray-200',
        )}
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </nav>
  );
}
