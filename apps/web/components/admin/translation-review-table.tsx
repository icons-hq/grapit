'use client';

import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type {
  TranslationDraft,
  TranslationQueueStatus,
  TranslationTargetLocale,
} from '@/hooks/use-admin';
import { cn } from '@/lib/cn';

export type TranslationQueueRow = TranslationDraft & {
  sourceTitle?: string;
  sourceText?: string;
  field?: string;
};

const STATUS_CONFIG: Record<
  TranslationQueueStatus,
  { label: string; className: string }
> = {
  draft: {
    label: '초안',
    className: 'bg-[#F5F5F7] text-gray-700 border-transparent',
  },
  review: {
    label: '검수 필요',
    className: 'bg-[#FFFBEB] text-[#8B6306] border-transparent',
  },
  published: {
    label: '게시됨',
    className: 'bg-[#F0FDF4] text-[#15803D] border-transparent',
  },
  stale: {
    label: '원문 변경됨',
    className: 'bg-[#FFFBEB] text-[#8B6306] border-transparent',
  },
  legal_blocked: {
    label: '자동 번역 불가',
    className: 'bg-[#FEF2F2] text-[#C62828] border-transparent',
  },
};

const LOCALE_LABELS: Record<TranslationTargetLocale, string> = {
  en: 'English',
  th: 'ไทย',
  'zh-CN': '简体中文',
};

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

interface TranslationReviewTableProps {
  rows: TranslationQueueRow[];
  isLoading: boolean;
  selectedDraftId: string | null;
  onSelectRow: (row: TranslationQueueRow) => void;
}

export function TranslationReviewTable({
  rows,
  isLoading,
  selectedDraftId,
  onSelectRow,
}: TranslationReviewTableProps) {
  return (
    <div className="overflow-hidden rounded-lg bg-white shadow-sm">
      <Table>
        <TableHeader>
          <TableRow className="bg-[#F5F5F7]">
            <TableHead scope="col">원문</TableHead>
            <TableHead scope="col">콘텐츠</TableHead>
            <TableHead scope="col">언어</TableHead>
            <TableHead scope="col">상태</TableHead>
            <TableHead scope="col" className="hidden lg:table-cell">
              업데이트
            </TableHead>
            <TableHead scope="col" className="hidden md:table-cell">
              검수자
            </TableHead>
            <TableHead scope="col">액션</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading &&
            Array.from({ length: 5 }).map((_, index) => (
              <TableRow key={`translation-skeleton-${index}`}>
                <TableCell>
                  <Skeleton
                    data-testid="translation-row-skeleton"
                    className="h-4 w-40"
                  />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-20" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-16" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-5 w-20" />
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  <Skeleton className="h-4 w-28" />
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <Skeleton className="h-4 w-24" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-12" />
                </TableCell>
              </TableRow>
            ))}

          {!isLoading && rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="py-12 text-center">
                <p className="text-base font-semibold text-gray-900">
                  검수할 항목이 없습니다
                </p>
                <p className="mt-1 text-sm text-gray-600">
                  한국어 원문을 저장하면 번역 초안과 검수 항목이 여기에 표시됩니다.
                </p>
              </TableCell>
            </TableRow>
          )}

          {!isLoading &&
            rows.map((row) => {
              const status = STATUS_CONFIG[row.status] ?? STATUS_CONFIG.draft;
              const title = row.sourceTitle || row.sourceText || row.sourceId;
              return (
                <TableRow
                  key={row.id}
                  role="button"
                  tabIndex={0}
                  className={cn(
                    'min-h-11 cursor-pointer hover:bg-gray-50',
                    selectedDraftId === row.id && 'bg-[#F3EFFF]',
                  )}
                  onClick={() => onSelectRow(row)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelectRow(row);
                    }
                  }}
                  aria-label={`${title} ${row.locale} 번역 검수`}
                >
                  <TableCell className="max-w-[220px] font-semibold">
                    <span className="line-clamp-2">{title}</span>
                  </TableCell>
                  <TableCell className="text-sm text-gray-600">
                    {row.contentType}
                  </TableCell>
                  <TableCell className="text-sm">
                    {LOCALE_LABELS[row.locale] ?? row.locale}
                  </TableCell>
                  <TableCell>
                    <Badge className={status.className}>{status.label}</Badge>
                  </TableCell>
                  <TableCell className="hidden text-sm text-gray-600 lg:table-cell">
                    {formatDateTime(row.updatedAt)}
                  </TableCell>
                  <TableCell className="hidden text-sm text-gray-600 md:table-cell">
                    {row.reviewerId ?? '-'}
                  </TableCell>
                  <TableCell className="text-sm font-semibold text-primary">
                    검수
                  </TableCell>
                </TableRow>
              );
            })}
        </TableBody>
      </Table>
    </div>
  );
}
