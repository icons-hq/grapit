'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle, MessageSquareReply, Search, UserRoundPlus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/cn';
import type {
  OperationsInboxFilters,
  OperationsInboxPriority,
  OperationsInboxRow,
  OperationsInboxSlaState,
} from '@/hooks/use-admin-operations';

export type {
  OperationsInboxFilters,
  OperationsInboxPriority,
  OperationsInboxRow,
} from '@/hooks/use-admin-operations';

interface OperationsInboxProps {
  rows: OperationsInboxRow[];
  isLoading: boolean;
  isError: boolean;
  filters?: OperationsInboxFilters;
  onFilterChange: (filters: OperationsInboxFilters) => void;
  onEscalate: (input: { id: string; reason: string }) => Promise<unknown> | void;
  onAnswer: (input: { id: string; body: string; markResolved?: boolean }) => Promise<unknown> | void;
  onReassign: (input: { id: string; assigneeUserId: string | null; reason: string }) => Promise<unknown> | void;
}

const PRIORITY_OPTIONS: Array<{ value: OperationsInboxPriority | ''; label: string }> = [
  { value: '', label: '전체 심각도' },
  { value: 'escalated', label: '즉시 확인' },
  { value: 'overdue', label: '기한 초과' },
  { value: 'due_soon', label: '마감 임박' },
  { value: 'normal', label: '일반' },
];

const CATEGORY_OPTIONS = [
  { value: '', label: '전체 카테고리' },
  { value: 'payment_error', label: '결제 오류' },
  { value: 'refund_unprocessed', label: '환불 미처리' },
  { value: 'refund_dispute', label: '환불 분쟁' },
  { value: 'signup_failure', label: '가입 실패' },
  { value: 'abuse_fraud', label: '부정 이용 의심' },
  { value: 'booking', label: '예매' },
  { value: 'general', label: '일반 문의' },
];

const SLA_BADGE_CLASS: Record<OperationsInboxSlaState, string> = {
  overdue: 'bg-[#FEF2F2] text-[#C62828] border-transparent',
  due_soon: 'bg-[#FFFBEB] text-[#8B6306] border-transparent',
  within_sla: 'bg-[#F5F5F7] text-gray-700 border-transparent',
  responded: 'bg-[#F0FDF4] text-[#15803D] border-transparent',
};

const PRIORITY_SORT_RANK: Record<OperationsInboxPriority, number> = {
  escalated: 4,
  overdue: 3,
  due_soon: 2,
  normal: 1,
};

function formatDateTime(value: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function sortOperationsRows(rows: OperationsInboxRow[]) {
  return [...rows].sort((left, right) => {
    const escalatedRank =
      Number(right.escalation.escalated) - Number(left.escalation.escalated);
    if (escalatedRank !== 0) return escalatedRank;

    const priorityRank =
      PRIORITY_SORT_RANK[right.priority] - PRIORITY_SORT_RANK[left.priority];
    if (priorityRank !== 0) return priorityRank;

    return Date.parse(right.createdAt) - Date.parse(left.createdAt);
  });
}

export function OperationsInbox({
  rows,
  isLoading,
  isError,
  filters,
  onFilterChange,
  onEscalate,
  onAnswer,
  onReassign,
}: OperationsInboxProps) {
  const [priority, setPriority] = useState<OperationsInboxPriority | ''>(
    filters?.priority ?? '',
  );
  const [category, setCategory] = useState(filters?.category ?? '');
  const [selectedRow, setSelectedRow] = useState<OperationsInboxRow | null>(null);
  const [answer, setAnswer] = useState('');
  const [reason, setReason] = useState('');
  const [assigneeUserId, setAssigneeUserId] = useState('');

  const sortedRows = useMemo(() => sortOperationsRows(rows), [rows]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onFilterChange({
      ...filters,
      priority,
      category: category.trim() || undefined,
    });
  }

  async function handleAnswer(markResolved = false) {
    if (!selectedRow || !answer.trim()) return;
    await onAnswer({
      id: selectedRow.id,
      body: answer.trim(),
      markResolved,
    });
    setAnswer('');
  }

  async function handleEscalate() {
    if (!selectedRow || !reason.trim()) return;
    await onEscalate({ id: selectedRow.id, reason: reason.trim() });
    setReason('');
  }

  async function handleReassign() {
    if (!selectedRow || !reason.trim()) return;
    await onReassign({
      id: selectedRow.id,
      assigneeUserId: assigneeUserId.trim() || null,
      reason: reason.trim(),
    });
    setAssigneeUserId('');
    setReason('');
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={handleSubmit}
        className="grid gap-3 rounded-lg bg-white p-4 shadow-sm md:grid-cols-3"
      >
        <div className="space-y-2">
          <Label htmlFor="operations-priority-filter">심각도</Label>
          <select
            id="operations-priority-filter"
            value={priority}
            onChange={(event) =>
              setPriority(event.target.value as OperationsInboxPriority | '')
            }
            className="flex h-11 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {PRIORITY_OPTIONS.map((option) => (
              <option key={option.value || 'all'} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="operations-category-filter">카테고리</Label>
          <select
            id="operations-category-filter"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="flex h-11 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {CATEGORY_OPTIONS.map((option) => (
              <option key={option.value || 'all'} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <Button type="submit" className="h-11 w-full">
            <Search className="h-4 w-4" />
            조회
          </Button>
        </div>
      </form>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="overflow-hidden rounded-lg bg-white shadow-sm">
          {isError && (
            <div
              role="alert"
              className="border-b bg-[#FEF2F2] px-4 py-3 text-sm font-semibold text-[#C62828]"
            >
              운영 데이터를 불러오지 못했습니다. 새로고침 후 다시 시도하고, 반복되면 접근 권한 또는 API 상태를 확인하세요.
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow className="bg-[#F5F5F7]">
                <TableHead scope="col">항목</TableHead>
                <TableHead scope="col">카테고리</TableHead>
                <TableHead scope="col">요청자</TableHead>
                <TableHead scope="col">큐/담당</TableHead>
                <TableHead scope="col">SLA</TableHead>
                <TableHead scope="col">상태</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading &&
                Array.from({ length: 5 }).map((_, index) => (
                  <TableRow key={`operations-skeleton-${index}`}>
                    <TableCell><Skeleton className="h-4 w-44" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                  </TableRow>
                ))}

              {!isLoading && sortedRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-12 text-center">
                    <p className="text-base font-semibold text-gray-900">
                      처리할 운영 항목이 없습니다
                    </p>
                    <p className="mx-auto mt-2 max-w-[520px] text-sm text-gray-600">
                      미답변 문의, 검토 요청, 환불 분쟁이 생기면 여기에 표시됩니다. 필터를 조정하거나 새 공지 또는 FAQ를 등록하세요.
                    </p>
                  </TableCell>
                </TableRow>
              )}

              {!isLoading &&
                sortedRows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-testid="operations-inbox-row"
                    role="button"
                    tabIndex={0}
                    aria-label={`${row.subject} 운영 항목 상세 보기`}
                    className={cn(
                      'min-h-11 cursor-pointer hover:bg-gray-50',
                      selectedRow?.id === row.id && 'bg-[#F3EFFF]',
                      row.escalation.escalated && 'border-l-4 border-l-[#C62828]',
                    )}
                    onClick={() => setSelectedRow(row)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedRow(row);
                      }
                    }}
                  >
                    <TableCell className="max-w-[240px]">
                      <div className="flex flex-col gap-1">
                        <span className="font-semibold text-gray-900">{row.subject}</span>
                        <span className="text-sm text-gray-600">{row.sourceLabel} · {row.locale}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className="border-transparent bg-[#F5F5F7] text-gray-700">
                        {row.categoryLabel}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-gray-700">
                      <div className="flex flex-col gap-0.5">
                        <span>{row.requester.email}</span>
                        <span>{row.requester.phone}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-gray-700">
                      <div className="flex flex-col gap-0.5">
                        <span>{row.queue}</span>
                        <span>{row.assignee.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={SLA_BADGE_CLASS[row.sla.state]}>
                        {row.sla.label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={cn(
                          'border-transparent',
                          row.escalation.escalated
                            ? 'bg-[#FEF2F2] text-[#C62828]'
                            : 'bg-[#F5F5F7] text-gray-700',
                        )}
                      >
                        {row.escalation.label}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>

        <aside className="rounded-lg bg-white p-4 shadow-sm" aria-label="운영 항목 상세">
          {selectedRow ? (
            <div className="space-y-4">
              <div>
                <h2 className="text-heading font-semibold leading-[1.2]">
                  {selectedRow.subject}
                </h2>
                <p className="mt-2 text-sm text-gray-600">{selectedRow.summary ?? '요약 없음'}</p>
              </div>
              <dl className="grid gap-3 text-sm">
                <div>
                  <dt className="font-semibold text-gray-600">마지막 업데이트</dt>
                  <dd className="mt-1 text-gray-900">{formatDateTime(selectedRow.updatedAt)}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-gray-600">환불 분쟁 보존</dt>
                  <dd className="mt-1 text-gray-900">
                    {selectedRow.refundDispute
                      ? `${selectedRow.refundDispute.status ?? '상태 미확인'} · audit retained`
                      : '-'}
                  </dd>
                </div>
              </dl>
              <div className="space-y-2">
                <Label htmlFor="operations-answer">답변</Label>
                <Textarea
                  id="operations-answer"
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  placeholder="운영 답변을 입력하세요"
                />
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void handleAnswer(false)}
                    disabled={!answer.trim()}
                  >
                    <MessageSquareReply className="h-4 w-4" />
                    답변 저장
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void handleAnswer(true)}
                    disabled={!answer.trim()}
                  >
                    해결 처리
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="operations-reason">변경 사유</Label>
                <Textarea
                  id="operations-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="에스컬레이션 또는 담당자 변경 사유"
                />
                <Input
                  value={assigneeUserId}
                  onChange={(event) => setAssigneeUserId(event.target.value)}
                  placeholder="담당자 userId"
                  aria-label="담당자 userId"
                />
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void handleReassign()}
                    disabled={!reason.trim()}
                  >
                    <UserRoundPlus className="h-4 w-4" />
                    담당 변경
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => void handleEscalate()}
                    disabled={!reason.trim()}
                  >
                    <AlertTriangle className="h-4 w-4" />
                    에스컬레이션
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-10 text-center text-sm text-gray-600">
              항목을 선택하면 답변, 에스컬레이션, 담당자 변경을 처리할 수 있습니다.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
