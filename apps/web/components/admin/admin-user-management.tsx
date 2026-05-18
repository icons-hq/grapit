'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import {
  BadgeCheck,
  CalendarClock,
  CheckCircle2,
  History,
  Mail,
  MessageSquareText,
  Phone,
  Search,
  ShieldCheck,
  Ticket,
  UserRound,
  XCircle,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { PaginationNav } from '@/components/performance/pagination-nav';
import {
  ADMIN_CAPABILITIES,
  ADMIN_CAPABILITY_BUNDLE_CAPABILITIES,
  ADMIN_CAPABILITY_BUNDLES,
  useAdminUserDetail,
  useAdminUsers,
  useHardDeleteAdminUser,
  useUpdateAdminUserPermissions,
  useWithdrawAdminUser,
  type AdminCapability,
  type AdminCapabilityBundle,
  type AdminUserDetail,
  type AdminUserListItem,
  type AdminUserListParams,
  type AdminUserReservationStatus,
  type AdminUserRole,
  type AdminUserVerificationFilter,
} from '@/hooks/use-admin-users';

type BundleSelectValue = AdminCapabilityBundle | 'none';

const VERIFICATION_FILTERS: Array<{
  value: AdminUserVerificationFilter;
  label: string;
}> = [
  { value: 'all', label: '전체 인증' },
  { value: 'verified', label: '이메일+휴대폰 인증' },
  { value: 'unverified', label: '인증 미완료 포함' },
  { value: 'email_unverified', label: '이메일 미인증' },
  { value: 'phone_unverified', label: '휴대폰 미인증' },
];

const ROLE_LABELS: Record<AdminUserRole, string> = {
  user: '일반 회원',
  admin: '관리자',
};

const BUNDLE_LABELS: Record<AdminCapabilityBundle, string> = {
  operator: '운영자',
  reviewer: '검수자',
  approver: '승인자',
  finance: '정산 담당',
  admin: '전체 관리자',
};

const CAPABILITY_LABELS: Record<AdminCapability, string> = {
  'event.write': '공연 편집',
  'event.publish': '공연 게시',
  'support.manage': 'CS 처리',
  'support.escalate': 'CS 에스컬레이션',
  'reservations.export_raw': '예매 원본 내보내기',
  'seat.disable': '좌석 비활성화',
  'seat.reactivate': '좌석 재활성화',
  'seat.manual_open': '취소 좌석 즉시 개방',
  'banner.manage': '배너 관리',
  'audit.read': '감사 조회',
  'security.manage': '보안 권한 관리',
};

const RESERVATION_STATUS_LABELS: Record<AdminUserReservationStatus, string> = {
  PENDING_PAYMENT: '결제 대기',
  CONFIRMED: '예매 확정',
  CANCELLED: '취소',
  FAILED: '실패',
  REFUNDED: '환불',
};

const RESERVATION_STATUS_CLASS: Record<AdminUserReservationStatus, string> = {
  PENDING_PAYMENT: 'bg-[#FFFBEB] text-[#8B6306] border-transparent',
  CONFIRMED: 'bg-[#F0FDF4] text-[#15803D] border-transparent',
  CANCELLED: 'bg-[#F5F5F7] text-gray-700 border-transparent',
  FAILED: 'bg-[#FEF2F2] text-[#C62828] border-transparent',
  REFUNDED: 'bg-[#EFF6FF] text-[#1D4ED8] border-transparent',
};

const EMPTY_ADMIN_USERS: AdminUserListItem[] = [];

export function AdminUserManagement() {
  const [searchText, setSearchText] = useState('');
  const [filters, setFilters] = useState<AdminUserListParams>({
    verification: 'all',
    page: 1,
    limit: 25,
  });
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const usersQuery = useAdminUsers(filters);
  const users = usersQuery.data?.items ?? EMPTY_ADMIN_USERS;
  const activeUserId = useMemo(() => {
    if (usersQuery.isPlaceholderData) return null;
    if (selectedUserId && users.some((user) => user.id === selectedUserId)) {
      return selectedUserId;
    }
    return users[0]?.id ?? null;
  }, [selectedUserId, users, usersQuery.isPlaceholderData]);
  const detailQuery = useAdminUserDetail(activeUserId);

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFilters((current) => ({
      ...current,
      search: searchText,
      page: 1,
    }));
    setSelectedUserId(null);
  }

  function handleVerificationChange(value: AdminUserVerificationFilter) {
    setFilters((current) => ({
      ...current,
      verification: value,
      page: 1,
    }));
    setSelectedUserId(null);
  }

  function handlePageChange(page: number) {
    setSelectedUserId(null);
    setFilters((current) => ({
      ...current,
      page,
    }));
  }

  return (
    <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[390px_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4">
        <form
          onSubmit={handleSearch}
          className="grid gap-3 rounded-lg bg-white p-4 shadow-sm"
        >
          <Label htmlFor="admin-user-search">회원 검색</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="admin-user-search"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="이름, 이메일, 전화번호"
              aria-label="회원 검색어"
              className="h-11 min-w-0"
            />
            <Button type="submit" className="h-11 w-full shrink-0 sm:w-auto">
              <Search className="h-4 w-4" />
              검색
            </Button>
          </div>
          <div className="space-y-2">
            <Label htmlFor="admin-user-verification-filter">인증 필터</Label>
            <Select
              value={filters.verification ?? 'all'}
              onValueChange={(value) =>
                handleVerificationChange(value as AdminUserVerificationFilter)
              }
            >
              <SelectTrigger
                id="admin-user-verification-filter"
                aria-label="인증 필터"
                className="h-11 w-full bg-white"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VERIFICATION_FILTERS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </form>

        <UserList
          users={users}
          selectedUserId={activeUserId}
          total={usersQuery.data?.total ?? 0}
          page={usersQuery.data?.page ?? filters.page ?? 1}
          limit={usersQuery.data?.limit ?? filters.limit ?? 25}
          totalPages={usersQuery.data?.totalPages ?? 0}
          isLoading={usersQuery.isLoading}
          isError={usersQuery.isError}
          onSelect={setSelectedUserId}
          onPageChange={handlePageChange}
        />
      </div>

      <UserDetailPanel
        user={detailQuery.data}
        selectedUserId={activeUserId}
        isLoading={detailQuery.isLoading}
        isError={detailQuery.isError}
        onDeleted={() => setSelectedUserId(null)}
      />
    </section>
  );
}

function UserList({
  users,
  selectedUserId,
  total,
  page,
  limit,
  totalPages,
  isLoading,
  isError,
  onSelect,
  onPageChange,
}: {
  users: AdminUserListItem[];
  selectedUserId: string | null;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  isLoading: boolean;
  isError: boolean;
  onSelect: (id: string) => void;
  onPageChange: (page: number) => void;
}) {
  const displayTotalPages = Math.max(1, totalPages);
  const firstVisible = total > 0 ? (page - 1) * limit + 1 : 0;
  const lastVisible = total > 0 ? Math.min(page * limit, total) : 0;

  return (
    <aside className="max-w-full overflow-hidden rounded-lg bg-white shadow-sm">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">회원 목록</h2>
          <p className="mt-1 text-xs text-gray-600">
            총 {total.toLocaleString('ko-KR')}명 · {page}/{displayTotalPages} 페이지
          </p>
          {total > 0 && (
            <p className="mt-0.5 text-xs text-gray-500">
              {firstVisible.toLocaleString('ko-KR')}-{lastVisible.toLocaleString('ko-KR')}명 표시
            </p>
          )}
        </div>
        <UserRound className="h-5 w-5 text-gray-500" aria-hidden="true" />
      </div>

      {isError && (
        <div
          role="alert"
          className="border-b bg-[#FEF2F2] px-4 py-3 text-sm font-semibold text-[#C62828]"
        >
          회원 목록을 불러오지 못했습니다. 검색 조건과 접근 권한을 확인하세요.
        </div>
      )}

      {isLoading && (
        <div className="space-y-3 p-4">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={`admin-user-skeleton-${index}`} className="space-y-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ))}
        </div>
      )}

      {!isLoading && users.length === 0 && (
        <div className="px-4 py-12 text-center">
          <p className="text-base font-semibold text-gray-900">
            조회된 회원이 없습니다
          </p>
          <p className="mt-2 text-sm text-gray-600">
            검색어 또는 인증 필터를 조정해 다시 조회하세요.
          </p>
        </div>
      )}

      {!isLoading && users.length > 0 && (
        <div className="max-h-[68vh] overflow-y-auto divide-y xl:max-h-[calc(100vh-18rem)]">
          {users.map((user) => {
            const isSelected = selectedUserId === user.id;
            return (
              <button
                key={user.id}
                type="button"
                onClick={() => onSelect(user.id)}
                aria-label={`${user.name} 회원 상세 보기`}
                className={cn(
                  'block w-full px-4 py-4 text-left transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
                  isSelected && 'bg-[#F3EFFF]',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-gray-900">
                      {user.name}
                    </p>
                    <p className="mt-1 truncate text-xs text-gray-600">
                      {user.maskedEmail}
                    </p>
                  </div>
                  <Badge className={roleBadgeClass(user.role)}>
                    {ROLE_LABELS[user.role]}
                  </Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <VerificationBadge
                    icon="email"
                    verified={user.verification.email}
                    label="이메일"
                  />
                  <VerificationBadge
                    icon="phone"
                    verified={user.verification.phone}
                    label="휴대폰"
                  />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-gray-600">
                  <Metric label="예매" value={user.reservations.total} />
                  <Metric label="확정" value={user.reservations.confirmed} />
                  <Metric label="CS" value={user.support.openThreads} />
                </div>
              </button>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="border-t bg-white px-3 py-3">
          <PaginationNav
            currentPage={page}
            totalPages={totalPages}
            onPageChange={onPageChange}
          />
        </div>
      )}
    </aside>
  );
}

function UserDetailPanel({
  user,
  selectedUserId,
  isLoading,
  isError,
  onDeleted,
}: {
  user: AdminUserDetail | undefined;
  selectedUserId: string | null;
  isLoading: boolean;
  isError: boolean;
  onDeleted: () => void;
}) {
  if (!selectedUserId) {
    return (
      <section className="rounded-lg bg-white p-8 text-center text-sm text-gray-600 shadow-sm">
        회원을 검색하거나 목록에서 선택하면 상세 컨텍스트가 표시됩니다.
      </section>
    );
  }

  if (isLoading) {
    return (
      <section className="space-y-4 rounded-lg bg-white p-5 shadow-sm">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
        <div className="grid gap-3 md:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={`admin-user-detail-${index}`} className="h-20" />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      {isError && (
        <div
          role="alert"
          className="rounded-lg bg-[#FEF2F2] px-4 py-3 text-sm font-semibold text-[#C62828] shadow-sm"
        >
          회원 상세를 불러오지 못했습니다. 현재 선택은 유지됩니다. 새로고침하거나 다시 선택하세요.
        </div>
      )}

      {user ? (
        <>
          <AccountOverview user={user} />
          <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-4">
              <ReservationContext user={user} />
              <SupportContext user={user} />
              <AuditContext user={user} />
            </div>
            <div className="space-y-4">
              <PermissionEditor user={user} />
              <AccountLifecyclePanel user={user} onDeleted={onDeleted} />
            </div>
          </div>
        </>
      ) : (
        <div className="rounded-lg bg-white p-8 text-center text-sm text-gray-600 shadow-sm">
          상세 정보를 기다리고 있습니다.
        </div>
      )}
    </section>
  );
}

function AccountOverview({ user }: { user: AdminUserDetail }) {
  return (
    <div className="rounded-lg bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-heading font-semibold leading-[1.2] text-gray-900">
              {user.name}
            </h2>
            <Badge className={roleBadgeClass(user.role)}>
              {ROLE_LABELS[user.role]}
            </Badge>
            <Badge className={accountStatusBadgeClass(user.accountStatus)}>
              {user.accountStatus === 'withdrawn' ? '탈퇴 처리' : '활성'}
            </Badge>
            {user.adminCapabilityBundle && (
              <Badge className="border-transparent bg-[#EFF6FF] text-[#1D4ED8]">
                {BUNDLE_LABELS[user.adminCapabilityBundle]}
              </Badge>
            )}
          </div>
          <p className="mt-2 break-all text-sm text-gray-600">{user.id}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <VerificationBadge
            icon="email"
            verified={user.verification.email}
            label="이메일"
          />
          <VerificationBadge
            icon="phone"
            verified={user.verification.phone}
            label="휴대폰"
          />
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
        <InfoTile icon={Mail} label="이메일" value={user.email ?? user.maskedEmail} />
        <InfoTile icon={Phone} label="휴대폰" value={user.phone ?? user.maskedPhone} />
        <InfoTile icon={BadgeCheck} label="국가/언어" value={`${user.country} · ${user.preferredLocale}`} />
        <InfoTile
          icon={CalendarClock}
          label="가입/최근 활동"
          value={`${formatDate(user.createdAt)} · ${formatDate(user.lastActivityAt)}`}
        />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <MetricCard label="마케팅 동의" value={user.marketingConsent ? '동의' : '미동의'} />
        <MetricCard label="계정 상태" value={user.accountStatus === 'withdrawn' ? '탈퇴 처리' : '활성'} />
        <MetricCard label="최근 로그인" value={formatDate(user.lastLoginAt)} />
      </div>
      {user.accountStatus === 'withdrawn' && (
        <div className="mt-4 rounded-lg border border-[#FEE2E2] bg-[#FEF2F2] p-3 text-sm text-[#991B1B]">
          탈퇴 시각: {formatDate(user.withdrawnAt)} · 사유: {user.withdrawalReason || '기록 없음'}
        </div>
      )}
    </div>
  );
}

function ReservationContext({ user }: { user: AdminUserDetail }) {
  return (
    <div className="rounded-lg bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <Ticket className="h-5 w-5 text-gray-600" aria-hidden="true" />
        <h3 className="text-base font-semibold text-gray-900">예매 컨텍스트</h3>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <MetricCard label="전체" value={user.reservations.total} />
        <MetricCard label="확정" value={user.reservations.confirmed} />
        <MetricCard label="결제 대기" value={user.reservations.pendingPayment} />
        <MetricCard label="취소" value={user.reservations.cancelled} />
        <MetricCard
          label="총 결제"
          value={formatCurrency(user.reservations.totalAmount)}
        />
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border">
        <Table className="min-w-[680px]">
          <TableHeader>
            <TableRow className="bg-[#F5F5F7]">
              <TableHead>예매번호</TableHead>
              <TableHead>공연</TableHead>
              <TableHead>상태</TableHead>
              <TableHead>금액</TableHead>
              <TableHead>일시</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {user.recentReservations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-gray-600">
                  최근 예매 내역이 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              user.recentReservations.map((reservation) => (
                <TableRow key={reservation.id}>
                  <TableCell className="font-semibold text-gray-900">
                    {reservation.reservationNumber}
                  </TableCell>
                  <TableCell className="max-w-[220px] truncate">
                    {reservation.performanceTitle}
                  </TableCell>
                  <TableCell>
                    <Badge className={RESERVATION_STATUS_CLASS[reservation.status]}>
                      {RESERVATION_STATUS_LABELS[reservation.status]}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatCurrency(reservation.totalAmount)}</TableCell>
                  <TableCell>{formatDate(reservation.showDateTime ?? reservation.createdAt)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function SupportContext({ user }: { user: AdminUserDetail }) {
  return (
    <div className="rounded-lg bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <MessageSquareText className="h-5 w-5 text-gray-600" aria-hidden="true" />
        <h3 className="text-base font-semibold text-gray-900">CS 컨텍스트</h3>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <MetricCard label="열린 문의" value={user.support.openThreads} />
        <MetricCard label="전체 문의" value={user.support.totalThreads ?? 0} />
        <MetricCard label="최근 문의" value={formatDate(user.support.latestThreadAt)} />
      </div>
      <div className="mt-4 space-y-2">
        {user.supportThreads.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-gray-600">
            연결된 support thread가 없습니다.
          </p>
        ) : (
          user.supportThreads.slice(0, 3).map((thread) => (
            <div key={thread.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-gray-900">{thread.subject}</p>
                <Badge className="border-transparent bg-[#F5F5F7] text-gray-700">
                  {thread.status}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-gray-600">
                {thread.category ?? 'general'} · {formatDate(thread.lastMessageAt ?? thread.createdAt)}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function AuditContext({ user }: { user: AdminUserDetail }) {
  return (
    <div className="rounded-lg bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <History className="h-5 w-5 text-gray-600" aria-hidden="true" />
        <h3 className="text-base font-semibold text-gray-900">Masked audit 컨텍스트</h3>
      </div>
      <div className="mt-4 space-y-2">
        {user.recentAuditEvents.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-gray-600">
            최근 감사 로그가 없습니다.
          </p>
        ) : (
          user.recentAuditEvents.slice(0, 5).map((event) => (
            <div key={event.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <code className="text-sm font-semibold text-gray-900">
                  {event.action}
                </code>
                <Badge className={auditStatusClass(event.status)}>{event.status}</Badge>
              </div>
              <p className="mt-2 text-sm text-gray-600">
                {event.reason || '사유 없음'} · masked IP {event.ipAddress ?? '-'}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {formatDate(event.createdAt)} · changed {event.changedFields.join(', ') || '-'}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function PermissionEditor({ user }: { user: AdminUserDetail }) {
  const mutation = useUpdateAdminUserPermissions();
  const detailCapabilitiesKey = user.adminCapabilities.join('|');
  const [role, setRole] = useState<AdminUserRole>(user.role);
  const [bundle, setBundle] = useState<BundleSelectValue>(
    user.adminCapabilityBundle ?? 'none',
  );
  const [capabilities, setCapabilities] = useState<AdminCapability[]>(
    user.adminCapabilities,
  );
  const [reason, setReason] = useState('');
  const [impactConfirmed, setImpactConfirmed] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    setRole(user.role);
    setBundle(user.adminCapabilityBundle ?? 'none');
    setCapabilities(user.adminCapabilities);
    setReason('');
    setImpactConfirmed(false);
    setConfirmOpen(false);
  }, [user.id, user.role, user.adminCapabilityBundle, detailCapabilitiesKey]);

  const changedFields = useMemo(() => {
    const nextBundle = bundle === 'none' ? null : bundle;
    const fields: string[] = [];
    if (role !== user.role) fields.push('role');
    if (nextBundle !== user.adminCapabilityBundle) {
      fields.push('adminCapabilityBundle');
    }
    if (capabilities.join('|') !== user.adminCapabilities.join('|')) {
      fields.push('adminCapabilities');
    }
    return fields;
  }, [bundle, capabilities, role, user.adminCapabilities, user.adminCapabilityBundle, user.role]);

  const canSubmit =
    reason.trim().length > 0 &&
    impactConfirmed &&
    changedFields.length > 0 &&
    !mutation.isPending;

  function handleBundleChange(value: BundleSelectValue) {
    setBundle(value);
    setCapabilities(value === 'none' ? [] : [...ADMIN_CAPABILITY_BUNDLE_CAPABILITIES[value]]);
  }

  function handleCapabilityChange(
    capability: AdminCapability,
    checked: boolean | 'indeterminate',
  ) {
    setCapabilities((current) => {
      if (checked === true) {
        return ADMIN_CAPABILITIES.filter(
          (item) => item === capability || current.includes(item),
        );
      }
      return current.filter((item) => item !== capability);
    });
  }

  async function handleConfirm() {
    const nextBundle = bundle === 'none' ? null : bundle;
    try {
      await mutation.mutateAsync({
        userId: user.id,
        role,
        adminCapabilityBundle: nextBundle,
        adminCapabilities: capabilities,
        reason,
        confirmed: true,
      });
      toast.success('회원 권한 변경이 감사 로그와 함께 저장되었습니다.');
      setReason('');
      setImpactConfirmed(false);
      setConfirmOpen(false);
    } catch {
      toast.error('회원 권한 변경에 실패했습니다. 사유와 권한을 확인하세요.');
    }
  }

  return (
    <aside className="rounded-lg bg-white p-5 shadow-sm" aria-label="권한 편집">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-gray-600" aria-hidden="true" />
        <h3 className="text-base font-semibold text-gray-900">
          Role / capability 편집
        </h3>
      </div>
      <p className="mt-2 text-sm text-gray-600">
        권한 변경은 `security.manage`가 필요하며 reason과 확인을 함께 전송합니다.
      </p>

      <div className="mt-4 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="admin-user-role">Role</Label>
          <Select value={role} onValueChange={(value) => setRole(value as AdminUserRole)}>
            <SelectTrigger id="admin-user-role" aria-label="Role" className="h-11 w-full bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="user">일반 회원</SelectItem>
              <SelectItem value="admin">관리자</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="admin-user-bundle">Capability bundle</Label>
          <Select value={bundle} onValueChange={(value) => handleBundleChange(value as BundleSelectValue)}>
            <SelectTrigger id="admin-user-bundle" aria-label="Capability bundle" className="h-11 w-full bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">없음</SelectItem>
              {ADMIN_CAPABILITY_BUNDLES.map((item) => (
                <SelectItem key={item} value={item}>
                  {BUNDLE_LABELS[item]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-gray-700">
            개별 capability
          </legend>
          <div className="grid gap-2">
            {ADMIN_CAPABILITIES.map((capability) => (
              <label
                key={capability}
                className="flex min-h-11 items-start gap-3 rounded-lg border p-3 text-sm"
              >
                <Checkbox
                  checked={capabilities.includes(capability)}
                  onCheckedChange={(checked) =>
                    handleCapabilityChange(capability, checked)
                  }
                  aria-label={CAPABILITY_LABELS[capability]}
                />
                <span>
                  <span className="block font-semibold text-gray-900">
                    {CAPABILITY_LABELS[capability]}
                  </span>
                  <code className="mt-0.5 block text-xs text-gray-500">
                    {capability}
                  </code>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="space-y-2">
          <Label htmlFor="admin-user-permission-reason">변경 사유</Label>
          <Textarea
            id="admin-user-permission-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="권한 변경 사유를 입력하세요"
            aria-label="권한 변경 사유"
            className="min-h-28"
          />
        </div>

        <label className="flex min-h-11 items-start gap-3 rounded-lg bg-[#FFFBEB] p-3 text-sm text-[#8B6306]">
          <Checkbox
            checked={impactConfirmed}
            onCheckedChange={(checked) => setImpactConfirmed(checked === true)}
            aria-label="권한 변경 영향 확인"
          />
          <span className="font-semibold">
            권한 변경이 관리자 접근과 감사 책임에 영향을 준다는 점을 확인했습니다.
          </span>
        </label>

        {mutation.isError && (
          <div
            role="alert"
            className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-sm font-semibold text-[#C62828]"
          >
            권한 변경에 실패했습니다. 현재 상세 화면은 유지됩니다.
          </div>
        )}

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <Button
            type="button"
            className="h-11 w-full"
            disabled={!canSubmit}
            onClick={() => setConfirmOpen(true)}
          >
            <ShieldCheck className="h-4 w-4" />
            권한 변경 검토
          </Button>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {user.name} 회원 권한을 변경하시겠습니까?
              </AlertDialogTitle>
              <AlertDialogDescription>
                이 작업은 `confirmed: true`와 함께 전송되며 masked audit log에 기록됩니다.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="rounded-lg bg-[#F5F5F7] p-3 text-sm text-gray-700">
              변경 필드: {changedFields.join(', ')}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>취소</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => void handleConfirm()}
              >
                변경 확정
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </aside>
  );
}

function AccountLifecyclePanel({
  user,
  onDeleted,
}: {
  user: AdminUserDetail;
  onDeleted: () => void;
}) {
  const withdrawMutation = useWithdrawAdminUser();
  const hardDeleteMutation = useHardDeleteAdminUser();
  const [withdrawReason, setWithdrawReason] = useState('');
  const [deleteReason, setDeleteReason] = useState('');
  const [withdrawConfirmed, setWithdrawConfirmed] = useState(false);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBlockers, setDeleteBlockers] = useState<string[]>([]);

  useEffect(() => {
    setWithdrawReason('');
    setDeleteReason('');
    setWithdrawConfirmed(false);
    setDeleteConfirmed(false);
    setWithdrawOpen(false);
    setDeleteOpen(false);
    setDeleteBlockers([]);
  }, [user.id]);

  async function handleWithdraw() {
    try {
      await withdrawMutation.mutateAsync({
        userId: user.id,
        reason: withdrawReason,
        confirmed: true,
      });
      toast.success('회원이 탈퇴 처리되었습니다.');
      setWithdrawOpen(false);
    } catch {
      toast.error('회원 탈퇴 처리에 실패했습니다.');
    }
  }

  async function handleHardDelete() {
    setDeleteBlockers([]);
    try {
      await hardDeleteMutation.mutateAsync({
        userId: user.id,
        reason: deleteReason,
        confirmed: true,
      });
      toast.success('회원이 DB에서 삭제되었습니다.');
      setDeleteOpen(false);
      onDeleted();
    } catch (error) {
      const blockers = extractBlockerLabels(error);
      setDeleteBlockers(blockers);
      toast.error('회원 DB 삭제에 실패했습니다.');
    }
  }

  return (
    <aside className="rounded-lg bg-white p-5 shadow-sm" aria-label="계정 생명주기 관리">
      <div className="flex items-center gap-2">
        <XCircle className="h-5 w-5 text-gray-600" aria-hidden="true" />
        <h3 className="text-base font-semibold text-gray-900">계정 생명주기</h3>
      </div>
      <p className="mt-2 text-sm text-gray-600">
        탈퇴 처리는 로그인과 세션을 차단합니다. DB 완전 삭제는 탈퇴 처리 후 연결 이력이 없을 때만 가능합니다.
      </p>

      <div className="mt-4 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="admin-user-withdraw-reason">탈퇴 처리 사유</Label>
          <Textarea
            id="admin-user-withdraw-reason"
            value={withdrawReason}
            onChange={(event) => setWithdrawReason(event.target.value)}
            placeholder="탈퇴 처리 사유를 입력하세요"
            className="min-h-24"
          />
          <label className="flex min-h-11 items-start gap-3 rounded-lg bg-[#FFFBEB] p-3 text-sm text-[#8B6306]">
            <Checkbox
              checked={withdrawConfirmed}
              onCheckedChange={(checked) => setWithdrawConfirmed(checked === true)}
              aria-label="회원 탈퇴 처리 확인"
            />
            <span className="font-semibold">해당 회원의 로그인과 활성 세션이 종료됨을 확인했습니다.</span>
          </label>
          <AlertDialog open={withdrawOpen} onOpenChange={setWithdrawOpen}>
            <Button
              type="button"
              variant="destructive"
              className="h-11 w-full"
              disabled={
                user.accountStatus === 'withdrawn' ||
                withdrawReason.trim().length === 0 ||
                !withdrawConfirmed ||
                withdrawMutation.isPending
              }
              onClick={() => setWithdrawOpen(true)}
            >
              탈퇴 처리
            </Button>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{user.name} 회원을 탈퇴 처리하시겠습니까?</AlertDialogTitle>
                <AlertDialogDescription>
                  이 작업은 감사 로그에 기록되며, 회원의 재로그인과 refresh를 차단합니다.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>취소</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => void handleWithdraw()}
                >
                  탈퇴 처리 확정
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <div className="space-y-2 rounded-lg border border-[#FEE2E2] p-3">
          <Label htmlFor="admin-user-hard-delete-reason">DB 완전 삭제 사유</Label>
          <Textarea
            id="admin-user-hard-delete-reason"
            value={deleteReason}
            onChange={(event) => setDeleteReason(event.target.value)}
            placeholder="DB 삭제 사유를 입력하세요"
            className="min-h-24"
          />
          <label className="flex min-h-11 items-start gap-3 rounded-lg bg-[#FEF2F2] p-3 text-sm text-[#991B1B]">
            <Checkbox
              checked={deleteConfirmed}
              onCheckedChange={(checked) => setDeleteConfirmed(checked === true)}
              aria-label="회원 DB 완전 삭제 확인"
            />
            <span className="font-semibold">DB에서 회원 row를 물리적으로 삭제하는 작업임을 확인했습니다.</span>
          </label>
          {deleteBlockers.length > 0 && (
            <div role="alert" className="rounded-lg bg-[#FEF2F2] p-3 text-sm font-semibold text-[#C62828]">
              삭제 차단: {deleteBlockers.join(', ')}
            </div>
          )}
          <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <Button
              type="button"
              variant="destructive"
              className="h-11 w-full"
              disabled={
                user.accountStatus !== 'withdrawn' ||
                deleteReason.trim().length === 0 ||
                !deleteConfirmed ||
                hardDeleteMutation.isPending
              }
              onClick={() => setDeleteOpen(true)}
            >
              DB에서 완전 삭제
            </Button>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{user.name} 회원을 DB에서 완전 삭제하시겠습니까?</AlertDialogTitle>
                <AlertDialogDescription>
                  연결된 예매, 감사, 좌석 운영 이력이 있으면 API가 삭제를 차단합니다.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>취소</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => void handleHardDelete()}
                >
                  DB 삭제 확정
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </aside>
  );
}

function VerificationBadge({
  icon,
  verified,
  label,
}: {
  icon: 'email' | 'phone';
  verified: boolean;
  label: string;
}) {
  const Icon = icon === 'email' ? Mail : Phone;
  const StateIcon = verified ? CheckCircle2 : XCircle;

  return (
    <Badge
      className={cn(
        'gap-1 border-transparent',
        verified ? 'bg-[#F0FDF4] text-[#15803D]' : 'bg-[#FEF2F2] text-[#C62828]',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
      <StateIcon className="h-3.5 w-3.5" />
    </Badge>
  );
}

function InfoTile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Mail;
  label: string;
  value: string | number | null | undefined;
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-gray-600">
        <Icon className="h-4 w-4" aria-hidden="true" />
        {label}
      </div>
      <p className="mt-2 break-words text-sm font-semibold text-gray-900">
        {value ?? '-'}
      </p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <span className="block font-semibold text-gray-900">{value}</span>
      <span>{label}</span>
    </div>
  );
}

function MetricCard({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs font-semibold text-gray-600">{label}</p>
      <p className="mt-2 break-words text-sm font-semibold text-gray-900">
        {value ?? '-'}
      </p>
    </div>
  );
}

function roleBadgeClass(role: AdminUserRole) {
  return cn(
    'border-transparent',
    role === 'admin'
      ? 'bg-[#EFF6FF] text-[#1D4ED8]'
      : 'bg-[#F5F5F7] text-gray-700',
  );
}

function accountStatusBadgeClass(status: AdminUserDetail['accountStatus']) {
  return cn(
    'border-transparent',
    status === 'withdrawn'
      ? 'bg-[#FEF2F2] text-[#C62828]'
      : 'bg-[#F0FDF4] text-[#15803D]',
  );
}

function auditStatusClass(status: 'success' | 'denied' | 'failed') {
  if (status === 'success') return 'border-transparent bg-[#F0FDF4] text-[#15803D]';
  if (status === 'denied') return 'border-transparent bg-[#FFFBEB] text-[#8B6306]';
  return 'border-transparent bg-[#FEF2F2] text-[#C62828]';
}

function formatDate(value: string | null | undefined) {
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

function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined) return '-';
  return new Intl.NumberFormat('ko-KR', {
    style: 'currency',
    currency: 'KRW',
    maximumFractionDigits: 0,
  }).format(value);
}

function extractBlockerLabels(error: unknown): string[] {
  const maybeResponse = error as {
    response?: { data?: { blockers?: Array<{ label?: string; key?: string; count?: number }> } };
    data?: { blockers?: Array<{ label?: string; key?: string; count?: number }> };
    blockers?: Array<{ label?: string; key?: string; count?: number }>;
  };
  const blockers =
    maybeResponse.response?.data?.blockers ??
    maybeResponse.data?.blockers ??
    maybeResponse.blockers ??
    [];
  return blockers
    .map((blocker) => {
      const label = blocker.label ?? blocker.key ?? 'unknown';
      return `${label} ${blocker.count ?? 0}건`;
    })
    .filter((label) => label.length > 0);
}
