'use client';

import { cn } from '@/lib/cn';

const STATUS_OPTIONS = [
  { label: '전체', value: '' },
  { label: '판매 중', value: 'selling' },
  { label: '판매 예정', value: 'upcoming' },
  { label: '판매 종료', value: 'ended' },
] as const;

interface StatusFilterProps {
  value: string;
  onChange: (status: string) => void;
}

export function StatusFilter({ value, onChange }: StatusFilterProps) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="공연 판매 상태">
      {STATUS_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'min-h-10 rounded-sm border border-border px-4 py-2 text-sm font-semibold transition-colors',
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
