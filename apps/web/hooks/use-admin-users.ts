'use client';

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  ADMIN_CAPABILITIES,
  ADMIN_CAPABILITY_BUNDLE_CAPABILITIES,
  ADMIN_CAPABILITY_BUNDLES,
  type AdminCapability,
  type AdminCapabilityBundle,
  type AdminUserDetail as ApiAdminUserDetail,
  type AdminUserListItem as ApiAdminUserListItem,
  type AdminUserListResponse as ApiAdminUserListResponse,
  type AdminUserRecentReservation as ApiAdminUserRecentReservation,
  type AdminUserSupportThreadSummary as ApiAdminUserSupportThreadSummary,
} from '@grabit/shared';
import { apiClient } from '@/lib/api-client';

export {
  ADMIN_CAPABILITIES,
  ADMIN_CAPABILITY_BUNDLE_CAPABILITIES,
  ADMIN_CAPABILITY_BUNDLES,
};

export type {
  AdminCapability,
  AdminCapabilityBundle,
};

export type AdminUserRole = 'user' | 'admin';
export type AdminUserVerificationFilter =
  | 'all'
  | 'verified'
  | 'unverified'
  | 'email_unverified'
  | 'phone_unverified';
export type AdminUserReservationStatus =
  | 'PENDING_PAYMENT'
  | 'CONFIRMED'
  | 'CANCELLED'
  | 'FAILED'
  | 'REFUNDED';

export interface AdminUserListParams {
  search?: string;
  verification?: AdminUserVerificationFilter;
  page?: number;
  limit?: number;
}

export interface AdminUserVerificationState {
  email: boolean;
  phone: boolean;
}

export interface AdminUserReservationSummary {
  total: number;
  pendingPayment: number;
  confirmed: number;
  cancelled: number;
  failed?: number;
  refunded?: number;
  totalAmount?: number;
}

export interface AdminUserSupportSummary {
  openThreads: number;
  totalThreads?: number;
  latestThreadAt?: string | null;
  latestSubject?: string | null;
}

export interface AdminUserAuditSummary {
  lastActionAt?: string | null;
  lastAction?: string | null;
}

export interface AdminUserListItem {
  id: string;
  name: string;
  maskedEmail: string;
  maskedPhone: string;
  role: AdminUserRole;
  preferredLocale: string;
  country: string;
  marketingConsent: boolean;
  adminCapabilityBundle: AdminCapabilityBundle | null;
  adminCapabilities: AdminCapability[];
  verification: AdminUserVerificationState;
  reservations: AdminUserReservationSummary;
  support: AdminUserSupportSummary;
  audit: AdminUserAuditSummary;
  createdAt: string;
  lastActivityAt?: string | null;
}

export interface AdminUserListResponse {
  items: AdminUserListItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AdminUserReservationRow {
  id: string;
  reservationNumber: string;
  performanceTitle: string;
  status: AdminUserReservationStatus;
  totalAmount: number;
  createdAt: string;
  showDateTime?: string | null;
}

export interface AdminUserSupportThread {
  id: string;
  subject: string;
  status: 'open' | 'in_progress' | 'resolved' | 'archived';
  category?: string | null;
  lastMessageAt?: string | null;
  createdAt: string;
}

export interface AdminUserAuditEvent {
  id: string;
  actorUserId: string;
  action: string;
  status: 'success' | 'denied' | 'failed';
  reason: string | null;
  changedFields: string[];
  ipAddress: string | null;
  createdAt: string;
}

export interface AdminUserDetail extends AdminUserListItem {
  email?: string | null;
  phone?: string | null;
  gender?: 'male' | 'female' | 'unspecified' | null;
  birthDate?: string | null;
  accountStatus?: 'active' | 'suspended' | 'deleted' | 'pending' | string;
  lastLoginAt?: string | null;
  recentReservations: AdminUserReservationRow[];
  supportThreads: AdminUserSupportThread[];
  recentAuditEvents: AdminUserAuditEvent[];
}

export interface UpdateAdminUserPermissionsInput {
  userId: string;
  role: AdminUserRole;
  adminCapabilityBundle: AdminCapabilityBundle | null;
  adminCapabilities: AdminCapability[];
  reason: string;
  confirmed: true;
}

export const adminUsersQueryKey = ['admin', 'users'] as const;

export function useAdminUsers(params: AdminUserListParams = {}) {
  const normalized = normalizeAdminUserListParams(params);

  return useQuery({
    queryKey: [...adminUsersQueryKey, normalized],
    queryFn: () => {
      const searchParams = buildAdminUserSearchParams(normalized);
      const query = searchParams.toString();
      return apiClient
        .get<ApiAdminUserListResponse | AdminUserListResponse>(
        `/api/v1/admin/users${query ? `?${query}` : ''}`,
        )
        .then(mapListResponse);
    },
    placeholderData: keepPreviousData,
  });
}

export function useAdminUserDetail(userId: string | null) {
  return useQuery({
    queryKey: [...adminUsersQueryKey, 'detail', userId],
    queryFn: () =>
      apiClient
        .get<ApiAdminUserDetail | AdminUserDetail>(
          `/api/v1/admin/users/${userId}`,
        )
        .then(mapDetail),
    enabled: Boolean(userId),
  });
}

export function useUpdateAdminUserPermissions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      userId,
      role,
      adminCapabilityBundle,
      adminCapabilities,
      reason,
      confirmed,
    }: UpdateAdminUserPermissionsInput) =>
      apiClient.patch<AdminUserDetail>(
        `/api/v1/admin/users/${userId}/permissions`,
        {
          role,
          adminCapabilityBundle,
          adminCapabilities: normalizeAdminCapabilities(adminCapabilities),
          reason: reason.trim(),
          confirmed,
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminUsersQueryKey });
      queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
    },
  });
}

function normalizeAdminUserListParams(
  params: AdminUserListParams,
): AdminUserListParams {
  const page = Number.isFinite(params.page)
    ? Math.max(1, Math.floor(params.page ?? 1))
    : 1;
  const limit = Number.isFinite(params.limit)
    ? Math.min(100, Math.max(1, Math.floor(params.limit ?? 25)))
    : 25;

  return Object.fromEntries(
    Object.entries({
      search: params.search?.trim(),
      verification:
        params.verification && params.verification !== 'all'
          ? params.verification
          : undefined,
      page,
      limit,
    }).filter(([, value]) => value !== undefined && value !== ''),
  ) as AdminUserListParams;
}

function buildAdminUserSearchParams(params: AdminUserListParams) {
  const searchParams = new URLSearchParams();

  if (params.search) searchParams.set('search', params.search);
  if (params.verification) searchParams.set('verification', params.verification);
  if (params.page) searchParams.set('page', String(params.page));
  if (params.limit) searchParams.set('limit', String(params.limit));

  return searchParams;
}

function normalizeAdminCapabilities(
  capabilities: readonly AdminCapability[],
): AdminCapability[] {
  return ADMIN_CAPABILITIES.filter((capability) =>
    capabilities.includes(capability),
  );
}

function mapListResponse(
  response: ApiAdminUserListResponse | AdminUserListResponse,
): AdminUserListResponse {
  const total = Math.max(0, response.total);
  const limit = Math.max(1, response.limit);
  const computedTotalPages = Math.max(1, Math.ceil(total / limit));

  return {
    ...response,
    total,
    limit,
    totalPages: 'totalPages' in response
      ? Math.max(computedTotalPages, response.totalPages)
      : computedTotalPages,
    items: response.items.map(mapListItem),
  };
}

function mapDetail(response: ApiAdminUserDetail | AdminUserDetail): AdminUserDetail {
  if (isUiDetail(response)) {
    return {
      ...response,
      adminCapabilities: resolveEffectiveCapabilities(
        response.adminCapabilityBundle,
        response.adminCapabilities,
      ),
      support: normalizeSupportSummary(response.support),
      audit: normalizeAuditSummary(response.audit, response.recentAuditEvents),
      recentReservations: response.recentReservations.map(normalizeReservation),
      supportThreads: response.supportThreads,
    };
  }

  const support = mapSupportSummary(response.supportThreads);
  const recentAuditEvents = (response.recentAuditEvents ?? []).map(mapAuditEvent);

  return {
    ...mapListItem(response),
    gender: response.account.gender,
    birthDate: response.account.birthDate,
    accountStatus: 'active',
    lastLoginAt: null,
    recentReservations: response.recentReservations.map(mapApiReservation),
    support,
    supportThreads: response.supportThreads.recentThreads.map((thread) => ({
      id: thread.id,
      subject: thread.title,
      status: normalizeSupportStatus(thread.status),
      category: thread.category,
      lastMessageAt: thread.updatedAt ?? thread.createdAt,
      createdAt: thread.createdAt,
    })),
    recentAuditEvents,
    audit: normalizeAuditSummary(undefined, recentAuditEvents),
  };
}

function mapListItem(
  item: ApiAdminUserListItem | AdminUserListItem,
): AdminUserListItem {
  if (isUiListItem(item)) {
    return {
      ...item,
      adminCapabilities: resolveEffectiveCapabilities(
        item.adminCapabilityBundle,
        item.adminCapabilities,
      ),
      support: normalizeSupportSummary(item.support),
      audit: normalizeAuditSummary(item.audit),
    };
  }

  return {
    id: item.id,
    name: item.name,
    maskedEmail: item.maskedEmail,
    maskedPhone: item.maskedPhone,
    role: item.role,
    preferredLocale: item.preferredLocale,
    country: item.country,
    marketingConsent: item.marketingConsent,
    adminCapabilityBundle: item.adminCapabilityBundle,
    adminCapabilities: resolveEffectiveCapabilities(
      item.adminCapabilityBundle,
      item.adminCapabilities,
    ),
    verification: {
      email: item.verificationState.emailVerified,
      phone: item.verificationState.phoneVerified,
    },
    reservations: {
      total: item.reservationSummary.total,
      pendingPayment: item.reservationSummary.statuses.pendingPayment,
      confirmed: item.reservationSummary.statuses.confirmed,
      cancelled: item.reservationSummary.statuses.cancelled,
      failed: item.reservationSummary.statuses.failed,
    },
    support: normalizeSupportSummary(),
    audit: normalizeAuditSummary(),
    createdAt: item.createdAt,
    lastActivityAt: item.lastActivityAt,
  };
}

function isUiListItem(
  item: ApiAdminUserListItem | AdminUserListItem,
): item is AdminUserListItem {
  return 'verification' in item && 'reservations' in item;
}

function isUiDetail(
  item: ApiAdminUserDetail | AdminUserDetail,
): item is AdminUserDetail {
  return 'verification' in item && Array.isArray(item.supportThreads);
}

function resolveEffectiveCapabilities(
  bundle: AdminCapabilityBundle | null,
  capabilities: readonly AdminCapability[],
): AdminCapability[] {
  const normalized = normalizeAdminCapabilities(capabilities);
  if (normalized.length > 0) return normalized;
  if (bundle) return [...ADMIN_CAPABILITY_BUNDLE_CAPABILITIES[bundle]];
  return [];
}

function normalizeSupportSummary(
  support?: AdminUserSupportSummary,
): AdminUserSupportSummary {
  return {
    openThreads: support?.openThreads ?? 0,
    totalThreads: support?.totalThreads ?? 0,
    latestThreadAt: support?.latestThreadAt ?? null,
    latestSubject: support?.latestSubject ?? null,
  };
}

function mapSupportSummary(
  support: ApiAdminUserSupportThreadSummary,
): AdminUserSupportSummary {
  const latestThread = [...support.recentThreads].sort(
    (left, right) =>
      Date.parse(right.updatedAt ?? right.createdAt) -
      Date.parse(left.updatedAt ?? left.createdAt),
  )[0];

  return {
    openThreads: support.open,
    totalThreads: support.total,
    latestThreadAt: latestThread?.updatedAt ?? latestThread?.createdAt ?? null,
    latestSubject: latestThread?.title ?? null,
  };
}

function normalizeAuditSummary(
  audit?: AdminUserAuditSummary,
  events: AdminUserAuditEvent[] = [],
): AdminUserAuditSummary {
  const latest = events[0];
  return {
    lastActionAt: audit?.lastActionAt ?? latest?.createdAt ?? null,
    lastAction: audit?.lastAction ?? latest?.action ?? null,
  };
}

function mapAuditEvent(event: ApiAdminUserDetail['recentAuditEvents'][number]): AdminUserAuditEvent {
  return {
    id: event.id,
    actorUserId: event.actorUserId,
    action: event.action,
    status: event.status,
    reason: event.reason ?? null,
    changedFields: event.changedFields,
    ipAddress: event.ipAddress ?? null,
    createdAt: event.createdAt,
  };
}

function normalizeReservation(
  reservation: AdminUserReservationRow,
): AdminUserReservationRow {
  return {
    ...reservation,
    performanceTitle: reservation.performanceTitle || '공연 정보 없음',
  };
}

function mapApiReservation(
  reservation: ApiAdminUserRecentReservation,
): AdminUserReservationRow {
  return {
    id: reservation.id,
    reservationNumber: reservation.reservationNumber,
    performanceTitle: '공연 정보 없음',
    status: reservation.status,
    totalAmount: reservation.totalAmount,
    createdAt: reservation.createdAt,
    showDateTime: reservation.createdAt,
  };
}

function normalizeSupportStatus(
  status: string,
): AdminUserSupportThread['status'] {
  if (
    status === 'open' ||
    status === 'in_progress' ||
    status === 'resolved' ||
    status === 'archived'
  ) {
    return status;
  }
  return status === 'closed' ? 'resolved' : 'open';
}
