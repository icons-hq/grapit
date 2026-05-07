'use client';

import { cn } from '@/lib/cn';

type SortValue = 'latest' | 'popular';

interface SortToggleProps {
  value: SortValue;
  onChange: (v: SortValue) => void;
  labels?: {
    ariaLabel: string;
    latest: string;
    popular: string;
  };
}

const DEFAULT_LABELS: Required<SortToggleProps>['labels'] = {
  ariaLabel: '정렬 기준',
  latest: '최신순',
  popular: '인기순',
};

export function SortToggle({
  value,
  onChange,
  labels = DEFAULT_LABELS,
}: SortToggleProps) {
  const options: { value: SortValue; label: string }[] = [
    { value: 'latest', label: labels.latest },
    { value: 'popular', label: labels.popular },
  ];

  return (
    <div
      role="radiogroup"
      aria-label={labels.ariaLabel}
      className="flex items-center gap-1"
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            'px-3 py-1.5 text-sm font-semibold transition-colors duration-150',
            value === opt.value
              ? 'border-b-2 border-primary text-primary'
              : 'text-gray-500 hover:text-gray-700',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
