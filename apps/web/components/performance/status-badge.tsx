'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';
import type { PerformanceStatus, SupportedLocale } from '@grabit/shared';
import { STATUS_LABELS } from '@grabit/shared';

const STATUS_STYLES: Record<PerformanceStatus, string> = {
  selling: 'bg-success text-white hover:bg-success',
  closing_soon: 'bg-warning text-foreground hover:bg-warning',
  ended: 'bg-gray-400 text-white hover:bg-gray-400',
  upcoming: 'bg-primary text-white hover:bg-primary',
};

interface StatusBadgeProps {
  status: PerformanceStatus;
  className?: string;
  locale?: SupportedLocale;
}

const LOCALIZED_STATUS_LABELS: Record<
  SupportedLocale,
  Record<PerformanceStatus, string>
> = {
  ko: STATUS_LABELS,
  en: {
    selling: 'On sale',
    closing_soon: 'Closing soon',
    ended: 'Ended',
    upcoming: 'Coming soon',
  },
  th: {
    selling: 'เปิดขาย',
    closing_soon: 'ใกล้ปิดขาย',
    ended: 'สิ้นสุดแล้ว',
    upcoming: 'เร็วๆ นี้',
  },
  'zh-CN': {
    selling: '销售中',
    closing_soon: '即将截止',
    ended: '已结束',
    upcoming: '即将开售',
  },
  ja: {
    selling: '販売中',
    closing_soon: 'まもなく終了',
    ended: '終了',
    upcoming: '近日公開',
  },
};

export function StatusBadge({
  status,
  className,
  locale = 'ko',
}: StatusBadgeProps) {
  const label = LOCALIZED_STATUS_LABELS[locale][status];

  return (
    <Badge
      className={cn(
        'border-transparent text-xs',
        STATUS_STYLES[status],
        className,
      )}
      aria-label={`${locale === 'ko' ? '상태' : 'Status'}: ${label}`}
    >
      {label}
    </Badge>
  );
}
