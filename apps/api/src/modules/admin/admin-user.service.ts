import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  ADMIN_CAPABILITIES,
  adminUserExportRequestSchema,
  adminUserListQuerySchema,
  adminUserHardDeleteSchema,
  adminUserPermissionUpdateSchema,
  adminUserWithdrawalSchema,
  resolveAdminCapabilitySnapshot,
  type AdminCapability,
  type AdminCapabilityBundle,
  type AdminUserDeletionBlocker,
  type AdminUserDetail,
  type AdminUserExportRequest,
  type AdminUserHardDeleteInput,
  type AdminUserHardDeleteResponse,
  type AdminUserListItem,
  type AdminUserListQuery,
  type AdminUserListResponse,
  type AdminUserPermissionUpdate,
  type AdminUserRecentReservation,
  type AdminUserReservationSummary,
  type AdminUserStatsResponse,
  type AdminUserStatsRatio,
  type AdminUserSignupTrendBucket,
  type AdminUserSupportThreadSummary,
  type AdminUserWithdrawalInput,
} from '@grabit/shared';

import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import {
  adminAuditLogs,
  bookingOperationAuditLogs,
  refreshTokens,
  reservations,
  seatOperationHistory,
  socialAccounts,
  supportThreads,
  users,
} from '../../database/schema/index.js';
import {
  AdminAuditService,
  type MaskedAdminAuditEvent,
} from './admin-audit.service.js';
import { safeCsvRows } from './csv-export.util.js';
import { buildDailyBucketSkeleton, kstBoundaryToUtc } from './kst-boundary.js';

type UserRow = Pick<
  typeof users.$inferSelect,
  | 'id'
  | 'email'
  | 'name'
  | 'phone'
  | 'gender'
  | 'country'
  | 'birthDate'
  | 'preferredLocale'
  | 'isEmailVerified'
  | 'isPhoneVerified'
  | 'marketingConsent'
  | 'role'
  | 'adminCapabilityBundle'
  | 'adminCapabilities'
  | 'accountStatus'
  | 'withdrawnAt'
  | 'withdrawalReason'
  | 'withdrawnByUserId'
  | 'withdrawalSource'
  | 'createdAt'
  | 'updatedAt'
>;

type UserExportRow = Pick<
  typeof users.$inferSelect,
  | 'id'
  | 'email'
  | 'name'
  | 'phone'
  | 'gender'
  | 'country'
  | 'birthDate'
  | 'preferredLocale'
  | 'isPhoneVerified'
  | 'isEmailVerified'
  | 'marketingConsent'
  | 'role'
  | 'adminCapabilityBundle'
  | 'adminCapabilities'
  | 'accountStatus'
  | 'withdrawnAt'
  | 'withdrawalReason'
  | 'withdrawnByUserId'
  | 'withdrawalSource'
  | 'createdAt'
  | 'updatedAt'
>;

interface UserStatsSummaryRow {
  total: number;
  active: number;
  withdrawn: number;
  emailVerified: number;
  phoneVerified: number;
  fullyVerified: number;
  marketingConsented: number;
}

interface UserStatsRatioRow {
  value: string;
  count: number;
}

interface UserSignupTrendRow {
  date: string;
  count: number;
}

type ReservationRow = Pick<
  typeof reservations.$inferSelect,
  | 'id'
  | 'userId'
  | 'reservationNumber'
  | 'status'
  | 'totalAmount'
  | 'cancelledAt'
  | 'createdAt'
>;

type SupportThreadRow = Pick<
  typeof supportThreads.$inferSelect,
  | 'id'
  | 'userId'
  | 'title'
  | 'status'
  | 'priority'
  | 'category'
  | 'escalationState'
  | 'createdAt'
  | 'updatedAt'
>;

export interface AdminUserPermissionUpdateContext {
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface AdminUserExportServiceRequest {
  actorUserId: string;
  reason: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface AdminUserExportResult {
  filename: string;
  contentType: string;
  csv: string;
  rowCount: number;
}

const USER_EXPORT_HEADERS = [
  'id',
  'email',
  'name',
  'phone',
  'gender',
  'country',
  'birth_date',
  'preferred_locale',
  'is_phone_verified',
  'is_email_verified',
  'marketing_consent',
  'role',
  'admin_capability_bundle',
  'admin_capabilities',
  'account_status',
  'withdrawn_at',
  'withdrawal_reason',
  'withdrawn_by_user_id',
  'withdrawal_source',
  'created_at',
  'updated_at',
] as const;
const UTF8_BOM = '\uFEFF';

@Injectable()
export class AdminUserService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditService: AdminAuditService,
  ) {}

  async listUsers(query: AdminUserListQuery): Promise<AdminUserListResponse> {
    const parsed = adminUserListQuerySchema.parse(query);
    const predicates = buildUserPredicates(parsed);
    const whereClause = predicates.length > 0 ? and(...predicates) : undefined;
    const offset = (parsed.page - 1) * parsed.limit;

    const [totalRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(whereClause);

    const rows = await this.db
      .select(userSelectFields())
      .from(users)
      .where(whereClause)
      .orderBy(desc(users.updatedAt))
      .limit(parsed.limit)
      .offset(offset);

    const summaries = await this.fetchReservationSummaries(rows.map((row) => row.id));

    return {
      items: rows.map((row) =>
        toListItem(row, summaries.get(row.id) ?? emptyReservationSummary()),
      ),
      page: parsed.page,
      limit: parsed.limit,
      total: totalRow?.count ?? 0,
      totalPages: Math.ceil((totalRow?.count ?? 0) / parsed.limit),
    };
  }

  async getUserDetail(userId: string): Promise<AdminUserDetail> {
    const user = await this.findUserById(userId);
    const summaries = await this.fetchReservationSummaries([userId]);
    const recentReservations = await this.fetchRecentReservations(userId);
    const supportThreadSummary = await this.fetchSupportThreadSummary(userId);
    const recentAuditEvents = await this.auditService.query({
      resourceType: 'user',
      resourceId: userId,
      limit: 10,
    });

    return toDetail(
      user,
      summaries.get(user.id) ?? emptyReservationSummary(),
      recentReservations,
      supportThreadSummary,
      recentAuditEvents,
    );
  }

  async getUserStats(): Promise<AdminUserStatsResponse> {
    const [
      summary,
      countries,
      locales,
      signupRows,
    ] = await Promise.all([
      this.selectUserStatsSummary(),
      this.selectUserStatsRatioRows('country'),
      this.selectUserStatsRatioRows('locale'),
      this.selectUserSignupTrendRows(),
    ]);

    return {
      total: summary.total,
      active: summary.active,
      withdrawn: summary.withdrawn,
      verification: {
        emailVerified: summary.emailVerified,
        phoneVerified: summary.phoneVerified,
        fullyVerified: summary.fullyVerified,
      },
      marketing: {
        consented: summary.marketingConsented,
        notConsented: Math.max(0, summary.total - summary.marketingConsented),
      },
      countries: toRatioItems(countries, summary.total),
      locales: toRatioItems(locales, summary.total),
      signupTrend: buildSignupTrend(signupRows),
      generatedAt: new Date().toISOString(),
    };
  }

  async exportUsers(
    request: AdminUserExportServiceRequest,
  ): Promise<AdminUserExportResult> {
    const parsed: AdminUserExportRequest = adminUserExportRequestSchema.parse({
      reason: request.reason,
    });
    const rows = await this.selectUserExportRows();
    const csv = `${UTF8_BOM}${safeCsvRows([
      USER_EXPORT_HEADERS,
      ...rows.map(userExportRowToCsvValues),
    ])}`;

    await this.auditService.write({
      actorUserId: request.actorUserId,
      action: 'user.export_raw',
      resourceType: 'user_export',
      resourceId: 'raw_pii',
      status: 'success',
      reason: parsed.reason,
      changedFields: ['columns', 'rowCount'],
      before: {},
      after: {
        columns: [...USER_EXPORT_HEADERS],
        rowCount: rows.length,
      },
      ipAddress: request.ipAddress ?? null,
      userAgent: request.userAgent ?? null,
      requestId: request.requestId ?? null,
    });

    return {
      filename: `user-export-raw-${new Date().toISOString().slice(0, 10)}.csv`,
      contentType: 'text/csv; charset=utf-8',
      csv,
      rowCount: rows.length,
    };
  }

  async updatePermissions(
    actorUserId: string,
    targetUserId: string,
    input: AdminUserPermissionUpdate,
    context: AdminUserPermissionUpdateContext = {},
  ): Promise<AdminUserDetail> {
    const parsed = adminUserPermissionUpdateSchema.parse(input);
    const normalized = normalizePermissionUpdate(parsed);

    await this.db.transaction(async (tx) => {
      const target = await this.findUserById(targetUserId, tx as DrizzleDB);
      const actor = actorUserId === targetUserId
        ? target
        : await this.findUserById(actorUserId, tx as DrizzleDB);

      if (!hasSecurityManage(actor)) {
        throw new ForbiddenException('security.manage 권한이 필요합니다');
      }

      const beforeSnapshot = permissionSnapshot(target);
      const afterSnapshot = {
        role: normalized.role,
        adminCapabilityBundle: normalized.adminCapabilityBundle,
        adminCapabilities: normalized.adminCapabilities,
      };
      const changedFields = changedPermissionFields(beforeSnapshot, afterSnapshot);

      if (changedFields.length === 0) {
        return;
      }

      if (
        actorUserId === targetUserId &&
        hasSecurityManage(target) &&
        !hasSecurityManage({
          ...target,
          ...afterSnapshot,
        })
      ) {
        throw new BadRequestException('자기 자신의 security.manage 권한은 제거할 수 없습니다');
      }

      await this.assertAtLeastOneSecurityAdminRemains(
        targetUserId,
        afterSnapshot,
        tx as DrizzleDB,
      );

      await tx
        .update(users)
        .set({
          role: normalized.role,
          adminCapabilityBundle: normalized.adminCapabilityBundle,
          adminCapabilities: normalized.adminCapabilities,
          updatedAt: new Date(),
        })
        .where(eq(users.id, targetUserId));

      await this.auditService.write(
        {
          actorUserId,
          action: 'security.permission.update',
          resourceType: 'user',
          resourceId: targetUserId,
          status: 'success',
          reason: parsed.reason,
          changedFields,
          before: {
            ...beforeSnapshot,
            email: target.email,
            phone: target.phone,
          },
          after: {
            ...afterSnapshot,
            email: target.email,
            phone: target.phone,
          },
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
          requestId: context.requestId ?? null,
        },
        tx,
      );
    });

    return this.getUserDetail(targetUserId);
  }

  async withdrawUser(
    actorUserId: string,
    targetUserId: string,
    input: AdminUserWithdrawalInput,
    context: AdminUserPermissionUpdateContext = {},
  ): Promise<AdminUserDetail> {
    const parsed = adminUserWithdrawalSchema.parse(input);

    await this.db.transaction(async (tx) => {
      const target = await this.findUserById(targetUserId, tx as DrizzleDB);
      const actor = actorUserId === targetUserId
        ? target
        : await this.findUserById(actorUserId, tx as DrizzleDB);

      if (!hasSecurityManage(actor)) {
        throw new ForbiddenException('security.manage 권한이 필요합니다');
      }
      if (actorUserId === targetUserId) {
        throw new BadRequestException('관리자는 자기 계정을 관리자 화면에서 탈퇴 처리할 수 없습니다');
      }
      if (target.accountStatus === 'withdrawn') {
        return;
      }

      await this.assertAtLeastOneSecurityAdminRemains(
        targetUserId,
        {
          role: 'user',
          adminCapabilityBundle: null,
          adminCapabilities: [],
        },
        tx as DrizzleDB,
      );

      const now = new Date();
      await tx
        .update(users)
        .set({
          passwordHash: null,
          marketingConsent: false,
          role: 'user',
          adminCapabilityBundle: null,
          adminCapabilities: [],
          accountStatus: 'withdrawn',
          withdrawnAt: now,
          withdrawalReason: parsed.reason,
          withdrawnByUserId: actorUserId,
          withdrawalSource: 'admin',
          updatedAt: now,
        })
        .where(eq(users.id, targetUserId));

      await tx
        .update(refreshTokens)
        .set({ revokedAt: now })
        .where(and(eq(refreshTokens.userId, targetUserId), isNull(refreshTokens.revokedAt)));

      await tx
        .delete(socialAccounts)
        .where(eq(socialAccounts.userId, targetUserId));

      await this.auditService.write(
        {
          actorUserId,
          action: 'user.withdraw',
          resourceType: 'user',
          resourceId: targetUserId,
          status: 'success',
          reason: parsed.reason,
          changedFields: [
            'accountStatus',
            'withdrawnAt',
            'withdrawalSource',
            'role',
            'adminCapabilityBundle',
            'adminCapabilities',
            'marketingConsent',
            'socialAccounts',
          ],
          before: {
            accountStatus: target.accountStatus ?? 'active',
            email: target.email,
            phone: target.phone,
            role: target.role,
            adminCapabilityBundle: target.adminCapabilityBundle,
            adminCapabilities: target.adminCapabilities,
            marketingConsent: target.marketingConsent,
          },
          after: {
            accountStatus: 'withdrawn',
            withdrawnAt: now.toISOString(),
            withdrawalSource: 'admin',
            email: target.email,
            phone: target.phone,
            role: 'user',
            adminCapabilityBundle: null,
            adminCapabilities: [],
            marketingConsent: false,
          },
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
          requestId: context.requestId ?? null,
        },
        tx,
      );
    });

    return this.getUserDetail(targetUserId);
  }

  async hardDeleteUser(
    actorUserId: string,
    targetUserId: string,
    input: AdminUserHardDeleteInput,
    context: AdminUserPermissionUpdateContext = {},
  ): Promise<AdminUserHardDeleteResponse> {
    const parsed = adminUserHardDeleteSchema.parse(input);
    if (actorUserId === targetUserId) {
      throw new BadRequestException('자기 계정은 DB에서 완전 삭제할 수 없습니다');
    }

    const target = await this.findUserById(targetUserId);
    const actor = await this.findUserById(actorUserId);
    if (!hasSecurityManage(actor)) {
      throw new ForbiddenException('security.manage 권한이 필요합니다');
    }
    if (target.accountStatus !== 'withdrawn') {
      throw new BadRequestException('DB 완전 삭제는 탈퇴 처리된 회원만 가능합니다');
    }

    const blockers = await this.findHardDeleteBlockers(targetUserId);
    if (blockers.length > 0) {
      throw new ConflictException({
        code: 'USER_HARD_DELETE_BLOCKED',
        message: '연결된 이력 때문에 회원을 DB에서 삭제할 수 없습니다',
        blockers,
      });
    }

    await this.db.transaction(async (tx) => {
      await this.auditService.write(
        {
          actorUserId,
          action: 'user.hard_delete',
          resourceType: 'user',
          resourceId: targetUserId,
          status: 'success',
          reason: parsed.reason,
          changedFields: ['hardDeleted'],
          before: {
            accountStatus: target.accountStatus,
            email: target.email,
            phone: target.phone,
            withdrawnAt: target.withdrawnAt?.toISOString() ?? null,
          },
          after: {
            hardDeleted: true,
          },
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
          requestId: context.requestId ?? null,
        },
        tx,
      );

      await tx.delete(users).where(eq(users.id, targetUserId));
    });

    return { deleted: true, userId: targetUserId, blockers: [] };
  }

  private async findUserById(
    userId: string,
    db: Pick<DrizzleDB, 'select'> = this.db,
  ): Promise<UserRow> {
    const [row] = await db
      .select(userSelectFields())
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!row) {
      throw new NotFoundException('사용자를 찾을 수 없습니다');
    }

    return row;
  }

  private async selectUserStatsSummary(): Promise<UserStatsSummaryRow> {
    const [row] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${users.accountStatus} <> 'withdrawn')::int`,
        withdrawn: sql<number>`count(*) filter (where ${users.accountStatus} = 'withdrawn')::int`,
        emailVerified: sql<number>`count(*) filter (where ${users.isEmailVerified} = true)::int`,
        phoneVerified: sql<number>`count(*) filter (where ${users.isPhoneVerified} = true)::int`,
        fullyVerified: sql<number>`count(*) filter (where ${users.isEmailVerified} = true and ${users.isPhoneVerified} = true)::int`,
        marketingConsented: sql<number>`count(*) filter (where ${users.marketingConsent} = true)::int`,
      })
      .from(users);

    return row ?? {
      total: 0,
      active: 0,
      withdrawn: 0,
      emailVerified: 0,
      phoneVerified: 0,
      fullyVerified: 0,
      marketingConsented: 0,
    };
  }

  private async selectUserStatsRatioRows(
    dimension: 'country' | 'locale',
  ): Promise<UserStatsRatioRow[]> {
    const valueExpression = dimension === 'country'
      ? users.country
      : sql<string>`coalesce(${users.preferredLocale}::text, 'ko')`;

    return this.db
      .select({
        value: valueExpression,
        count: sql<number>`count(*)::int`,
      })
      .from(users)
      .groupBy(valueExpression)
      .orderBy(sql`count(*) desc`, valueExpression);
  }

  private async selectUserSignupTrendRows(): Promise<UserSignupTrendRow[]> {
    const { startUtc, endUtc } = kstBoundaryToUtc(30);
    const bucketExpr = sql.raw(
      `date_trunc('day', users.created_at AT TIME ZONE 'Asia/Seoul')`,
    );
    const bucketLabel = sql.raw(
      `to_char(date_trunc('day', users.created_at AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM-DD')`,
    );

    return this.db
      .select({
        date: sql<string>`${bucketLabel}`,
        count: sql<number>`count(*)::int`,
      })
      .from(users)
      .where(and(gte(users.createdAt, startUtc), lt(users.createdAt, endUtc)))
      .groupBy(bucketExpr)
      .orderBy(bucketExpr);
  }

  private async selectUserExportRows(): Promise<UserExportRow[]> {
    return this.db
      .select(userExportSelectFields())
      .from(users)
      .orderBy(desc(users.createdAt), asc(users.id));
  }

  private async fetchReservationSummaries(
    userIds: string[],
  ): Promise<Map<string, AdminUserReservationSummary>> {
    const summaries = new Map<string, AdminUserReservationSummary>();
    for (const userId of userIds) {
      summaries.set(userId, emptyReservationSummary());
    }
    if (userIds.length === 0) {
      return summaries;
    }

    const rows = await this.db
      .select({
        userId: reservations.userId,
        status: reservations.status,
        createdAt: reservations.createdAt,
      })
      .from(reservations)
      .where(inArray(reservations.userId, userIds));

    for (const row of rows) {
      const current = summaries.get(row.userId) ?? emptyReservationSummary();
      current.total += 1;
      incrementReservationStatus(current, row.status);
      if (
        !current.lastReservationAt ||
        row.createdAt.getTime() > new Date(current.lastReservationAt).getTime()
      ) {
        current.lastReservationAt = row.createdAt.toISOString();
      }
      summaries.set(row.userId, current);
    }

    return summaries;
  }

  private async fetchRecentReservations(
    userId: string,
  ): Promise<AdminUserRecentReservation[]> {
    const rows = await this.db
      .select({
        id: reservations.id,
        userId: reservations.userId,
        reservationNumber: reservations.reservationNumber,
        status: reservations.status,
        totalAmount: reservations.totalAmount,
        cancelledAt: reservations.cancelledAt,
        createdAt: reservations.createdAt,
      })
      .from(reservations)
      .where(eq(reservations.userId, userId))
      .orderBy(desc(reservations.createdAt))
      .limit(10);

    return rows.map(toRecentReservation);
  }

  private async fetchSupportThreadSummary(
    userId: string,
  ): Promise<AdminUserSupportThreadSummary> {
    const rows = await this.db
      .select({
        id: supportThreads.id,
        userId: supportThreads.userId,
        title: supportThreads.title,
        status: supportThreads.status,
        priority: supportThreads.priority,
        category: supportThreads.category,
        escalationState: supportThreads.escalationState,
        createdAt: supportThreads.createdAt,
        updatedAt: supportThreads.updatedAt,
      })
      .from(supportThreads)
      .where(eq(supportThreads.userId, userId))
      .orderBy(desc(supportThreads.updatedAt))
      .limit(10);

    return summarizeSupportThreads(rows);
  }

  private async assertAtLeastOneSecurityAdminRemains(
    targetUserId: string,
    targetAfter: Pick<UserRow, 'role' | 'adminCapabilityBundle' | 'adminCapabilities'>,
    db: Pick<DrizzleDB, 'select'>,
  ): Promise<void> {
    const adminRows = await db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        adminCapabilityBundle: users.adminCapabilityBundle,
        adminCapabilities: users.adminCapabilities,
      })
      .from(users)
      .where(eq(users.role, 'admin'));

    const remainingSecurityAdmins = adminRows.filter((row) => {
      const candidate = row.id === targetUserId
        ? { ...row, ...targetAfter }
        : row;
      return hasSecurityManage(candidate);
    });

    if (remainingSecurityAdmins.length === 0) {
      throw new BadRequestException('마지막 security.manage 관리자 권한은 제거할 수 없습니다');
    }
  }

  private async findHardDeleteBlockers(
    userId: string,
  ): Promise<AdminUserDeletionBlocker[]> {
    const [reservationCount] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(reservations)
      .where(eq(reservations.userId, userId));
    const [adminAuditCount] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(adminAuditLogs)
      .where(eq(adminAuditLogs.actorUserId, userId));
    const [seatOperationCount] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(seatOperationHistory)
      .where(eq(seatOperationHistory.actorUserId, userId));
    const [bookingOperationCount] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(bookingOperationAuditLogs)
      .where(eq(bookingOperationAuditLogs.operatorUserId, userId));

    const checks = [
      {
        key: 'reservations',
        label: '예매 이력',
        count: reservationCount?.count ?? 0,
      },
      {
        key: 'admin_audit_logs',
        label: '관리자 감사 로그',
        count: adminAuditCount?.count ?? 0,
      },
      {
        key: 'seat_operation_history',
        label: '좌석 운영 이력',
        count: seatOperationCount?.count ?? 0,
      },
      {
        key: 'booking_operation_audit_logs',
        label: '예매 운영 이력',
        count: bookingOperationCount?.count ?? 0,
      },
    ];

    return checks.filter((check) => check.count > 0);
  }
}

function userSelectFields() {
  return {
    id: users.id,
    email: users.email,
    name: users.name,
    phone: users.phone,
    gender: users.gender,
    country: users.country,
    birthDate: users.birthDate,
    preferredLocale: users.preferredLocale,
    isEmailVerified: users.isEmailVerified,
    isPhoneVerified: users.isPhoneVerified,
    marketingConsent: users.marketingConsent,
    role: users.role,
    adminCapabilityBundle: users.adminCapabilityBundle,
    adminCapabilities: users.adminCapabilities,
    accountStatus: users.accountStatus,
    withdrawnAt: users.withdrawnAt,
    withdrawalReason: users.withdrawalReason,
    withdrawnByUserId: users.withdrawnByUserId,
    withdrawalSource: users.withdrawalSource,
    createdAt: users.createdAt,
    updatedAt: users.updatedAt,
  };
}

function userExportSelectFields() {
  return {
    id: users.id,
    email: users.email,
    name: users.name,
    phone: users.phone,
    gender: users.gender,
    country: users.country,
    birthDate: users.birthDate,
    preferredLocale: users.preferredLocale,
    isPhoneVerified: users.isPhoneVerified,
    isEmailVerified: users.isEmailVerified,
    marketingConsent: users.marketingConsent,
    role: users.role,
    adminCapabilityBundle: users.adminCapabilityBundle,
    adminCapabilities: users.adminCapabilities,
    accountStatus: users.accountStatus,
    withdrawnAt: users.withdrawnAt,
    withdrawalReason: users.withdrawalReason,
    withdrawnByUserId: users.withdrawnByUserId,
    withdrawalSource: users.withdrawalSource,
    createdAt: users.createdAt,
    updatedAt: users.updatedAt,
  };
}

function userExportRowToCsvValues(row: UserExportRow): unknown[] {
  return [
    row.id,
    row.email,
    row.name,
    row.phone,
    row.gender,
    row.country,
    row.birthDate,
    row.preferredLocale ?? '',
    row.isPhoneVerified,
    row.isEmailVerified,
    row.marketingConsent,
    row.role,
    row.adminCapabilityBundle ?? '',
    JSON.stringify(row.adminCapabilities ?? []),
    row.accountStatus,
    row.withdrawnAt?.toISOString() ?? '',
    row.withdrawalReason ?? '',
    row.withdrawnByUserId ?? '',
    row.withdrawalSource ?? '',
    row.createdAt.toISOString(),
    row.updatedAt.toISOString(),
  ];
}

function toRatioItems(
  rows: UserStatsRatioRow[],
  total: number,
): AdminUserStatsRatio[] {
  return rows.map((row) => ({
    value: row.value,
    count: row.count,
    ratio: total > 0 ? row.count / total : 0,
  }));
}

function buildSignupTrend(
  rows: UserSignupTrendRow[],
): AdminUserSignupTrendBucket[] {
  const rowMap = new Map(rows.map((row) => [row.date, row.count]));
  return buildDailyBucketSkeleton(30).map((date) => ({
    date,
    count: rowMap.get(date) ?? 0,
  }));
}

function buildUserPredicates(query: AdminUserListQuery): SQL[] {
  const predicates: SQL[] = [];

  if (query.search) {
    const pattern = `%${query.search}%`;
    predicates.push(
      or(
        ilike(users.email, pattern),
        ilike(users.name, pattern),
        ilike(users.phone, pattern),
      )!,
    );
  }

  if (query.role) {
    predicates.push(eq(users.role, query.role));
  }

  if (query.verification === 'verified') {
    predicates.push(
      and(eq(users.isEmailVerified, true), eq(users.isPhoneVerified, true))!,
    );
  } else if (query.verification === 'email_verified') {
    predicates.push(eq(users.isEmailVerified, true));
  } else if (query.verification === 'phone_verified') {
    predicates.push(eq(users.isPhoneVerified, true));
  } else if (query.verification === 'email_unverified') {
    predicates.push(eq(users.isEmailVerified, false));
  } else if (query.verification === 'phone_unverified') {
    predicates.push(eq(users.isPhoneVerified, false));
  } else if (query.verification === 'unverified') {
    predicates.push(
      or(eq(users.isEmailVerified, false), eq(users.isPhoneVerified, false))!,
    );
  }

  return predicates;
}

function toListItem(
  user: UserRow,
  reservationSummary: AdminUserReservationSummary,
): AdminUserListItem {
  const lastActivityAt = latestIso([
    user.updatedAt,
    reservationSummary.lastReservationAt
      ? new Date(reservationSummary.lastReservationAt)
      : null,
  ]);

  return {
    id: user.id,
    maskedEmail: maskEmail(user.email),
    name: user.name,
    maskedPhone: maskPhone(user.phone),
    role: normalizeRole(user.role),
    country: user.country,
    preferredLocale: user.preferredLocale ?? 'ko',
    marketingConsent: user.marketingConsent,
    adminCapabilityBundle: normalizeBundle(user.adminCapabilityBundle),
    adminCapabilities: normalizeCapabilities(user.adminCapabilities),
    accountStatus: user.accountStatus === 'withdrawn' ? 'withdrawn' : 'active',
    withdrawnAt: user.withdrawnAt?.toISOString() ?? null,
    withdrawalReason: user.withdrawalReason ?? null,
    withdrawalSource: user.withdrawalSource === 'admin' ? 'admin' : user.withdrawalSource === 'self' ? 'self' : null,
    verificationState: {
      emailVerified: user.isEmailVerified,
      phoneVerified: user.isPhoneVerified,
    },
    reservationSummary,
    lastActivityAt,
    createdAt: user.createdAt.toISOString(),
  };
}

function toDetail(
  user: UserRow,
  reservationSummary: AdminUserReservationSummary,
  recentReservations: AdminUserRecentReservation[],
  supportThreadsSummary: AdminUserSupportThreadSummary,
  recentAuditEvents: MaskedAdminAuditEvent[],
): AdminUserDetail {
  return {
    ...toListItem(user, reservationSummary),
    account: {
      birthDate: user.birthDate,
      gender: user.gender,
      updatedAt: user.updatedAt?.toISOString() ?? null,
    },
    recentReservations,
    supportThreads: supportThreadsSummary,
    recentAuditEvents,
  };
}

function normalizePermissionUpdate(input: AdminUserPermissionUpdate) {
  if (input.role === 'user') {
    return {
      role: 'user' as const,
      adminCapabilityBundle: null,
      adminCapabilities: [] as AdminCapability[],
    };
  }

  return {
    role: 'admin' as const,
    adminCapabilityBundle: input.adminCapabilityBundle ?? 'admin',
    adminCapabilities: normalizeCapabilities(input.adminCapabilities),
  };
}

function permissionSnapshot(
  user: Pick<UserRow, 'role' | 'adminCapabilityBundle' | 'adminCapabilities'>,
) {
  return {
    role: normalizeRole(user.role),
    adminCapabilityBundle: normalizeBundle(user.adminCapabilityBundle),
    adminCapabilities: normalizeCapabilities(user.adminCapabilities),
  };
}

function changedPermissionFields(
  before: ReturnType<typeof permissionSnapshot>,
  after: ReturnType<typeof permissionSnapshot>,
): string[] {
  return (['role', 'adminCapabilityBundle', 'adminCapabilities'] as const)
    .filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
}

function hasSecurityManage(
  user: Pick<UserRow, 'id' | 'email' | 'role' | 'adminCapabilityBundle' | 'adminCapabilities'>,
): boolean {
  return resolveAdminCapabilitySnapshot({
    id: user.id,
    email: user.email,
    role: user.role,
    adminCapabilityBundle: normalizeBundle(user.adminCapabilityBundle),
    adminCapabilities: normalizeCapabilities(user.adminCapabilities),
  }).capabilities.includes('security.manage');
}

function normalizeRole(role: string): 'user' | 'admin' {
  return role === 'admin' ? 'admin' : 'user';
}

function normalizeBundle(
  bundle: string | null | undefined,
): AdminCapabilityBundle | null {
  if (
    bundle === 'operator' ||
    bundle === 'reviewer' ||
    bundle === 'approver' ||
    bundle === 'finance' ||
    bundle === 'admin'
  ) {
    return bundle;
  }
  return null;
}

function normalizeCapabilities(
  capabilities: readonly string[] | null | undefined,
): AdminCapability[] {
  if (!capabilities) return [];
  return ADMIN_CAPABILITIES.filter((capability) =>
    capabilities.includes(capability),
  );
}

function emptyReservationSummary(): AdminUserReservationSummary {
  return {
    total: 0,
    statuses: {
      pendingPayment: 0,
      confirmed: 0,
      cancelled: 0,
      failed: 0,
    },
    lastReservationAt: null,
  };
}

function incrementReservationStatus(
  summary: AdminUserReservationSummary,
  status: ReservationRow['status'],
): void {
  if (status === 'PENDING_PAYMENT') summary.statuses.pendingPayment += 1;
  if (status === 'CONFIRMED') summary.statuses.confirmed += 1;
  if (status === 'CANCELLED') summary.statuses.cancelled += 1;
  if (status === 'FAILED') summary.statuses.failed += 1;
}

function toRecentReservation(row: ReservationRow): AdminUserRecentReservation {
  return {
    id: row.id,
    reservationNumber: row.reservationNumber,
    status: row.status,
    totalAmount: row.totalAmount,
    createdAt: row.createdAt.toISOString(),
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
  };
}

function summarizeSupportThreads(
  rows: SupportThreadRow[],
): AdminUserSupportThreadSummary {
  return {
    total: rows.length,
    open: rows.filter((row) =>
      row.status !== 'resolved' && row.status !== 'closed',
    ).length,
    escalated: rows.filter((row) =>
      row.escalationState === 'manual_escalated' ||
      row.escalationState === 'auto_escalated',
    ).length,
    recentThreads: rows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      priority: row.priority,
      category: row.category,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt?.toISOString() ?? null,
    })),
  };
}

function latestIso(values: Array<Date | null>): string | null {
  const latest = values
    .filter((value): value is Date => value instanceof Date)
    .sort((left, right) => right.getTime() - left.getTime())[0];
  return latest ? latest.toISOString() : null;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***@${domain}`;
}

function maskPhone(phone: string): string {
  if (phone.length <= 4) return '****';
  return `${phone.slice(0, 3)}${'*'.repeat(Math.max(phone.length - 5, 2))}${phone.slice(-2)}`;
}
