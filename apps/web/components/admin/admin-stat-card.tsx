'use client';

import type { LucideIcon } from 'lucide-react';

interface AdminStatCardProps {
  label: string;
  value: number;
  icon: LucideIcon;
  format: 'count' | 'currency' | 'percent' | 'seats';
  description?: string;
}

function formatValue(value: number, format: 'count' | 'currency' | 'percent' | 'seats'): string {
  switch (format) {
    case 'seats':
      return `${value.toLocaleString('ko-KR')}석`;
    case 'count':
      return `${value.toLocaleString('ko-KR')}건`;
    case 'currency':
      return `${value.toLocaleString('ko-KR')}원`;
    case 'percent':
      return `${value.toFixed(1)}%`;
  }
}

export function AdminStatCard({
  label,
  value,
  icon: Icon,
  format,
  description,
}: AdminStatCardProps) {
  return (
    <div role="group" aria-label={label} className="admin-stat-card flex min-h-[124px] flex-col gap-3 rounded-sm border border-border bg-white p-4">
      <div className="flex items-center justify-between gap-2"><p className="text-xs text-gray-600">{label}</p><Icon className="size-4 shrink-0 text-gray-400" aria-hidden="true" /></div>
      <div>

        <p className="text-xl font-semibold tabular-nums text-gray-900">
          {formatValue(value, format)}
        </p>
        {description && (
          <p className="mt-1 text-xs text-gray-500">{description}</p>
        )}
      </div>
    </div>
  );
}
