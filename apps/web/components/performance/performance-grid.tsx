'use client';

import { SearchIcon } from 'lucide-react';
import { PerformanceCardSkeleton } from '@/components/skeletons';
import { PerformanceCard } from './performance-card';
import type { PerformanceCardData } from '@grabit/shared';

interface PerformanceGridProps {
  performances: PerformanceCardData[];
  isLoading?: boolean;
  emptyHeading?: string;
  emptyBody?: string;
}

export function PerformanceGrid({
  performances,
  isLoading = false,
  emptyHeading = '등록된 공연이 없습니다',
  emptyBody = '곧 새로운 공연이 등록될 예정입니다',
}: PerformanceGridProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <PerformanceCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (performances.length === 0) {
    return (
      <div className="flex flex-col items-center py-16">
        <SearchIcon className="h-12 w-12 text-gray-400" />
        <h3 className="mt-4 text-xl font-semibold text-gray-900">
          {emptyHeading}
        </h3>
        <p className="mt-2 text-sm text-gray-600">{emptyBody}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-3 lg:grid-cols-4">
      {performances.map((p, index) => (
        <PerformanceCard key={p.id} performance={p} priority={index === 0} />
      ))}
    </div>
  );
}
