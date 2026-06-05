'use client';

import type { LucideIcon } from 'lucide-react';

interface AdminStatCardProps {
  label: string;
  value: number;
  icon: LucideIcon;
  format: 'count' | 'currency' | 'percent';
}

function formatValue(value: number, format: 'count' | 'currency' | 'percent'): string {
  switch (format) {
    case 'count':
      return `${value.toLocaleString('ko-KR')}건`;
    case 'currency':
      return `${value.toLocaleString('ko-KR')}원`;
    case 'percent':
      return `${value.toFixed(1)}%`;
  }
}

export function AdminStatCard({ label, value, icon: Icon, format }: AdminStatCardProps) {
  return (
    <div className="flex h-[100px] flex-col justify-between rounded-lg border bg-white p-4 shadow-sm">
      <Icon className="h-6 w-6 text-gray-400" />
      <div>
        <p className="text-sm text-gray-600">{label}</p>
        <p className="text-xl font-semibold text-gray-900">
          {formatValue(value, format)}
        </p>
      </div>
    </div>
  );
}
