'use client';

import { useMemo, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useAdminEventContext } from './admin-event-context';
import { useAuthStore } from '@/stores/use-auth-store';
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
  { value: '', label: '전체 우선순위' },
  { value: 'escalated', label: '즉시 확인' },
  { value: 'overdue', label: '기한 초과' },
  { value: 'due_soon', label: '마감 임박' },
  { value: 'normal', label: '일반' },
];

const CATEGORY_OPTIONS = [
  { value: '', label: '전체 문의 유형' },
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
    timeZone: 'Asia/Seoul',
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
  const context = useAdminEventContext();
  const currentUser = useAuthStore((state) => state.user);
  const [includeResolved, setIncludeResolved] = useState(filters?.includeResolved ?? false);
  const [priority, setPriority] = useState<OperationsInboxPriority | ''>(
    filters?.priority ?? '',
  );
  const [category, setCategory] = useState(filters?.category ?? '');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedRow = isLoading || isError ? null : rows.find((row) => row.id === selectedId);
  const [answer, setAnswer] = useState('');
  const [reason, setReason] = useState('');
  const [assigneeUserId, setAssigneeUserId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const actionPending = useRef(false);

  const sortedRows = useMemo(() => sortOperationsRows(rows), [rows]);

  function selectRow(id: string) {
    if (actionPending.current || selectedId === id) return;
    setSelectedId(id);
    setAnswer('');
    setReason('');
    setAssigneeUserId('');
    setSaveError(null);
    if (window.innerWidth < 1536) requestAnimationFrame(() => {
      const detail = document.getElementById('admin-inquiry-detail');
      detail?.focus({ preventScroll: true });
      detail?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    });
  }

  async function saveAction(action: () => Promise<unknown> | void, onSuccess: () => void) {
    if (actionPending.current) return;
    actionPending.current = true;
    setIsSaving(true);
    setSaveError(null);
    try { await action(); onSuccess(); }
    catch { setSaveError('저장하지 못했습니다. 입력 내용은 유지됩니다. 연결을 확인하고 다시 시도해주세요.'); }
    finally { actionPending.current = false; setIsSaving(false); }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onFilterChange({
      ...filters,
      priority,
      includeResolved,
      category: category.trim() || undefined,
    });
  }

  async function handleAnswer(markResolved = false) {
    if (!selectedRow || !answer.trim()) return;
    await saveAction(() => onAnswer({
      id: selectedRow.id,
      body: answer.trim(),
      markResolved,
    }), () => setAnswer(''));
  }

  async function handleEscalate() {
    if (!selectedRow || !reason.trim()) return;
    await saveAction(() => onEscalate({ id: selectedRow.id, reason: reason.trim() }), () => setReason(''));
  }

  async function handleReassign() {
    if (!selectedRow || !reason.trim()) return;
    await saveAction(() => onReassign({
      id: selectedRow.id,
      assigneeUserId: assigneeUserId.trim() || null,
      reason: reason.trim(),
    }), () => { setAssigneeUserId(''); setReason(''); });
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={handleSubmit}
        className="grid gap-3 rounded-lg bg-white p-4 shadow-sm md:grid-cols-3"
      >
        <div className="space-y-2">
          <Label htmlFor="operations-priority-filter">우선순위</Label>
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
          <Label htmlFor="operations-category-filter">문의 유형</Label>
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
        <label className="flex items-center gap-2 text-sm text-muted-foreground md:col-span-3"><input type="checkbox" checked={includeResolved} onChange={(event) => setIncludeResolved(event.target.checked)} />완료·보관한 문의 포함</label>
      </form>

      <div className={cn("grid min-w-0 gap-4", selectedRow && "2xl:grid-cols-[minmax(0,1fr)_380px]")}>
        <div className="overflow-hidden rounded-lg bg-white shadow-sm">
          {isError && (
            <div
              role="alert"
              className="border-b bg-[#FEF2F2] px-4 py-3 text-sm font-semibold text-[#C62828]"
            >
              문의 목록을 불러오지 못했습니다. 다시 조회해주세요.
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow className="bg-[#F5F5F7]">
                <TableHead scope="col">항목</TableHead>
                <TableHead scope="col">문의 유형</TableHead>
                <TableHead scope="col">요청자</TableHead>
                <TableHead scope="col">담당자</TableHead>
                <TableHead scope="col">답변 기한</TableHead>
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

              {!isLoading && !isError && sortedRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-12 text-center">
                    <p className="text-base font-semibold text-gray-900">
                      처리할 문의가 없습니다
                    </p>
                    <p className="mx-auto mt-2 max-w-[520px] text-sm text-gray-600">
                      접수된 문의가 없거나 검색 조건에 맞는 문의가 없습니다. 조회 조건을 바꿔 확인할 수 있습니다.
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
                    aria-label={`${row.subject} 문의 상세 보기`}
                    className={cn(
                      'min-h-11 cursor-pointer hover:bg-gray-50',
                      selectedRow?.id === row.id && 'bg-[#F3EFFF]',
                      row.escalation.escalated && 'border-l-4 border-l-[#C62828]',
                    )}
                    onClick={() => selectRow(row.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        selectRow(row.id);
                      }
                    }}
                  >
                    <TableCell className="max-w-[320px] whitespace-normal">
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

        <aside hidden={!selectedRow} className="rounded-lg bg-white p-5 shadow-sm" aria-label="문의 상세" id="admin-inquiry-detail" tabIndex={-1} style={{ scrollMarginTop: 90 }}>
          <div className="mb-4 flex justify-end"><Button variant="ghost" size="sm" disabled={isSaving} onClick={() => setSelectedId(null)}>상세 닫기</Button></div>
          {selectedRow ? (
            <div className="space-y-4">
              {saveError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{saveError}</p>}
              {isSaving && <p role="status" className="text-sm text-gray-600">변경 사항을 저장하고 있습니다.</p>}
              <div>
                <h2 className="text-heading font-semibold leading-[1.2]">
                  {selectedRow.subject}
                </h2>
                <p className="mt-2 text-sm text-gray-600">{selectedRow.summary ?? '요약 없음'}</p>
                {selectedRow.reservationId && <Link className="mt-3 inline-block text-sm font-semibold text-violet-700 underline"
                  href={context?.href(`/admin/bookings?bookingId=${selectedRow.reservationId}`) ?? `/admin/bookings?bookingId=${selectedRow.reservationId}`}>연결된 예매·결제·티켓 확인 ›</Link>}
              </div>
              {currentUser && <Button variant="outline" size="sm" disabled={isSaving || selectedRow.assignee.id === currentUser.id} onClick={() => void saveAction(() => onReassign({ id: selectedRow.id, assigneeUserId: currentUser.id, reason: '현재 관리자가 직접 담당' }), () => setAssigneeUserId(''))}>내가 담당하기</Button>}
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
                  disabled={isSaving}
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  placeholder="운영 답변을 입력하세요"
                />
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void handleAnswer(false)}
                    disabled={isSaving || !answer.trim()}
                  >
                    <MessageSquareReply className="h-4 w-4" />
                    답변 저장
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void handleAnswer(true)}
                    disabled={isSaving || !answer.trim()}
                  >
                    해결 처리
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="operations-reason">변경 사유</Label>
                <Textarea
                  id="operations-reason"
                  disabled={isSaving}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="관리자 검토 요청 또는 담당자 변경 사유"
                />
                <Input
                  disabled={isSaving}
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
                    disabled={isSaving || !reason.trim()}
                  >
                    <UserRoundPlus className="h-4 w-4" />
                    담당 변경
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => void handleEscalate()}
                    disabled={isSaving || !reason.trim()}
                  >
                    <AlertTriangle className="h-4 w-4" />
                    관리자 검토 요청
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-10 text-center text-sm text-gray-600">
              항목을 선택하면 답변, 관리자 검토 요청, 담당자 변경을 처리할 수 있습니다.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
