'use client';

import { cn } from '@/lib/cn';

const STATUS_OPTIONS = [
  { label: '전체', value: '' },
  { label: '오픈', value: 'selling' },
  { label: '오픈예정', value: 'upcoming' },
  { label: '판매종료', value: 'ended' },
] as const;

interface StatusFilterProps {
  value: string;
  onChange: (status: string) => void;
}

export function StatusFilter({ value, onChange }: StatusFilterProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {STATUS_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-full px-4 py-1.5 text-sm font-semibold transition-colors',
            value === option.value
              ? 'bg-primary text-white'
              : 'bg-[#F5F5F7] text-gray-900 hover:bg-gray-200',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
