'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

export const ADMIN_AUDIT_REQUIRED_CAPABILITY = 'audit.read' as const;
export const ADMIN_SECURITY_REQUIRED_CAPABILITY = 'security.manage' as const;

export type AdminAuditStatus = 'success' | 'denied' | 'failed';

export interface AdminAuditFilters {
  actorUserId?: string;
  action?: string;
  status?: AdminAuditStatus | '';
  resourceType?: string;
  resourceId?: string;
  requestId?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export interface AdminAuditEvent {
  id: string;
  actorUserId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  status: AdminAuditStatus;
  reason: string | null;
  changedFields: string[];
  diff: {
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  };
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: string;
}

export interface AdminSecurityStatusResponse {
  mfa: {
    status: 'deferred_accepted_risk';
    note?: string;
  };
  ipAllowlist: {
    mode: 'disabled' | 'monitoring' | 'enforced';
    activeRecords: number;
    lastChangedAt: string | null;
  };
  lastAuditEventAt: string | null;
  currentRequest: {
    allowed: boolean;
    source:
      | 'env_bootstrap'
      | 'db_managed'
      | 'temporary_exception'
      | 'non_production_bypass'
      | 'denied';
    maskedIpAddress: string;
    matchedCidr: string | null;
    allowlistRecordId: string | null;
    reason: string | null;
  };
  deferredMfaCopy: string;
  requiredCapability: typeof ADMIN_SECURITY_REQUIRED_CAPABILITY;
}

export interface CreateAllowlistRecordInput {
  cidr: string;
  label: string;
  source: 'db_managed' | 'temporary_exception';
  reason: string;
  expiresAt?: string | null;
}

export interface CreateAllowlistRecordResponse {
  id: string;
  requiredCapability: typeof ADMIN_SECURITY_REQUIRED_CAPABILITY;
}

export const adminAuditQueryKey = ['admin', 'audit'] as const;
export const adminSecurityQueryKey = ['admin', 'security'] as const;

export function useAdminAudit(filters: AdminAuditFilters = {}) {
  const normalized = normalizeAuditFilters(filters);

  return useQuery({
    queryKey: [...adminAuditQueryKey, normalized],
    queryFn: () => {
      const params = buildAuditSearchParams(normalized);
      const query = params.toString();
      return apiClient.get<AdminAuditEvent[]>(
        `/api/v1/admin/audit${query ? `?${query}` : ''}`,
      );
    },
    placeholderData: keepPreviousData,
  });
}

export function useAdminSecurityStatus() {
  return useQuery({
    queryKey: [...adminSecurityQueryKey, 'status'],
    queryFn: () =>
      apiClient.get<AdminSecurityStatusResponse>(
        '/api/v1/admin/security/status',
      ),
  });
}

export function useCreateAdminAllowlistRecord() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateAllowlistRecordInput) =>
      apiClient.post<CreateAllowlistRecordResponse>(
        '/api/v1/admin/security/allowlist',
        {
          ...input,
          cidr: input.cidr.trim(),
          label: input.label.trim(),
          reason: input.reason.trim(),
          expiresAt: input.expiresAt || null,
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminSecurityQueryKey });
      queryClient.invalidateQueries({ queryKey: adminAuditQueryKey });
    },
  });
}

function normalizeAuditFilters(filters: AdminAuditFilters): AdminAuditFilters {
  return Object.fromEntries(
    Object.entries({
      ...filters,
      actorUserId: filters.actorUserId?.trim(),
      action: filters.action?.trim(),
      resourceType: filters.resourceType?.trim(),
      resourceId: filters.resourceId?.trim(),
      requestId: filters.requestId?.trim(),
      limit: filters.limit ?? 50,
    }).filter(([, value]) => value !== undefined && value !== ''),
  ) as AdminAuditFilters;
}

function buildAuditSearchParams(filters: AdminAuditFilters) {
  const params = new URLSearchParams();

  if (filters.actorUserId) params.set('actorUserId', filters.actorUserId);
  if (filters.action) params.set('action', filters.action);
  if (filters.status) params.set('status', filters.status);
  if (filters.resourceType) params.set('resourceType', filters.resourceType);
  if (filters.resourceId) params.set('resourceId', filters.resourceId);
  if (filters.requestId) params.set('requestId', filters.requestId);
  if (filters.from) params.set('from', toApiDateTime(filters.from) ?? filters.from);
  if (filters.to) params.set('to', toApiDateTime(filters.to) ?? filters.to);
  if (filters.limit) params.set('limit', String(filters.limit));

  return params;
}

function toApiDateTime(value?: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString();
}
