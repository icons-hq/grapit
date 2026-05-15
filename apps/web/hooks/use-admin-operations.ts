'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

export type OperationsInboxSource =
  | 'qna'
  | 'cs_ticket'
  | 'refund_dispute'
  | 'signup_failure'
  | 'notice_followup';

export type OperationsInboxPriority =
  | 'normal'
  | 'due_soon'
  | 'overdue'
  | 'escalated';

export type OperationsInboxSlaState =
  | 'within_sla'
  | 'due_soon'
  | 'overdue'
  | 'responded';

export interface OperationsInboxFilters {
  source?: OperationsInboxSource | '';
  category?: string;
  status?: 'open' | 'in_progress' | 'resolved' | 'archived' | '';
  priority?: OperationsInboxPriority | '';
  includeResolved?: boolean;
}

export interface OperationsInboxRow {
  id: string;
  source: OperationsInboxSource;
  sourceLabel: string;
  category: string;
  categoryLabel: string;
  subject: string;
  summary: string | null;
  locale: string;
  status: 'open' | 'in_progress' | 'resolved' | 'archived';
  queue: string;
  assignee: {
    id: string | null;
    name: string;
    email: string | null;
  };
  requester: {
    id: string | null;
    email: string;
    phone: string;
    name: string;
  };
  priority: OperationsInboxPriority;
  escalation: {
    state: string;
    escalated: boolean;
    label: string;
  };
  sla: {
    dueAt: string;
    remainingMinutes: number;
    state: OperationsInboxSlaState;
    label: string;
  };
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  reservationId: string | null;
  refundDispute: {
    refundId: string;
    status: string | null;
    retainedForAudit: true;
    requestedAt: string | null;
    expectedDepositAt: string | null;
  } | null;
  signupFailure: {
    emailHash: string | null;
    phoneHash: string | null;
  } | null;
}

export interface OperationsInboxResponse {
  generatedAt: string;
  rows: OperationsInboxRow[];
  totals: {
    all: number;
    escalated: number;
    overdue: number;
    dueSoon: number;
  };
}

export interface AnswerOperationInput {
  id: string;
  body: string;
  visibility?: 'public' | 'internal';
  internalNote?: boolean;
  markResolved?: boolean;
}

export interface EscalateOperationInput {
  id: string;
  reason: string;
}

export interface ReassignOperationInput {
  id: string;
  assigneeUserId: string | null;
  reason: string;
}

function buildOperationsSearchParams(filters: OperationsInboxFilters) {
  const params = new URLSearchParams();

  if (filters.source) params.set('source', filters.source);
  if (filters.category) params.set('category', filters.category);
  if (filters.status) params.set('status', filters.status);
  if (filters.priority) params.set('priority', filters.priority);
  if (filters.includeResolved) params.set('includeResolved', 'true');

  return params;
}

export function useAdminOperationsInbox(filters: OperationsInboxFilters = {}) {
  return useQuery({
    queryKey: ['admin', 'operations', filters],
    queryFn: () => {
      const params = buildOperationsSearchParams(filters);
      const query = params.toString();
      return apiClient.get<OperationsInboxResponse>(
        `/api/v1/admin/operations/inbox${query ? `?${query}` : ''}`,
      );
    },
  });
}

export function useAnswerOperation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: AnswerOperationInput) =>
      apiClient.post(`/api/v1/admin/operations/inbox/${id}/answer`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'operations'] });
    },
  });
}

export function useEscalateOperation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: EscalateOperationInput) =>
      apiClient.post(`/api/v1/admin/operations/inbox/${id}/escalate`, {
        reason,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'operations'] });
    },
  });
}

export function useReassignOperation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: ReassignOperationInput) =>
      apiClient.patch(`/api/v1/admin/operations/inbox/${id}/reassign`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'operations'] });
    },
  });
}
