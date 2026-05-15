import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  aliasedTable,
  and,
  asc,
  desc,
  eq,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';

import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import {
  refunds,
  supportMessages,
  supportThreads,
  users,
} from '../../database/schema/index.js';
import { AdminAuditService } from './admin-audit.service.js';

type SupportThread = typeof supportThreads.$inferSelect;
type SupportMessage = typeof supportMessages.$inferSelect;
type SupportThreadSource = SupportThread['source'];
type SupportThreadStatus = SupportThread['status'];
type SupportThreadCategory = SupportThread['category'];
type SupportThreadPriority = SupportThread['priority'];
type SupportThreadEscalationState = SupportThread['escalationState'];
type UserSummary = Pick<typeof users.$inferSelect, 'id' | 'email' | 'phone' | 'name'> | null;
type RefundSummary = Pick<
  typeof refunds.$inferSelect,
  'id' | 'status' | 'requestedAt' | 'expectedDepositAt'
> | null;

const assigneeUsers = aliasedTable(users, 'support_assignee_users');

const HIGH_RISK_CATEGORIES = new Set<SupportThreadCategory>([
  'payment_error',
  'refund_unprocessed',
  'refund_dispute',
  'abuse_fraud',
  'signup_failure',
]);

const DUE_SOON_MINUTES = 120;

const CATEGORY_LABELS: Record<SupportThreadCategory, string> = {
  general: '일반 문의',
  event_info: '공연 정보',
  booking: '예매',
  payment_error: '결제 오류',
  refund_unprocessed: '환불 미처리',
  refund_dispute: '환불 분쟁',
  signup_failure: '가입 실패',
  account: '계정',
  ticket_delivery: '티켓 전달',
  seat_accessibility: '좌석 접근성',
  abuse_fraud: '부정 이용 의심',
  other: '기타',
};

const SOURCE_LABELS: Record<SupportThreadSource, string> = {
  qna: 'Q&A',
  cs: 'CS',
  refund_dispute: '환불',
  signup_failure: '가입',
  notice_followup: '공지',
};

const SLA_SORT_RANK: Record<AdminOperationsSlaState, number> = {
  overdue: 3,
  due_soon: 2,
  within_sla: 1,
  responded: 0,
};

export interface AdminOperationsThreadRow {
  thread: SupportThread;
  requester: UserSummary;
  assignee: UserSummary;
  refund: RefundSummary;
}

export interface AdminOperationsInboxFilters {
  source?: SupportThreadSource;
  category?: SupportThreadCategory;
  status?: SupportThreadStatus;
  priority?: AdminOperationsPriority;
  includeResolved?: boolean;
  signupFailureEmailHash?: string;
  signupFailurePhoneHash?: string;
  limit?: number;
}

export interface AdminOperationsExecutionContext {
  now?: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export type AdminOperationsSource =
  | 'qna'
  | 'cs_ticket'
  | 'refund_dispute'
  | 'signup_failure'
  | 'notice_followup';

export type AdminOperationsPriority =
  | 'normal'
  | 'due_soon'
  | 'overdue'
  | 'escalated';

export type AdminOperationsSlaState =
  | 'within_sla'
  | 'due_soon'
  | 'overdue'
  | 'responded';

export type AdminOperationsStatus =
  | 'open'
  | 'in_progress'
  | 'resolved'
  | 'archived';

export interface AdminOperationsInboxRow {
  id: string;
  source: AdminOperationsSource;
  sourceLabel: string;
  category: SupportThreadCategory;
  categoryLabel: string;
  subject: string;
  summary: string | null;
  locale: string;
  status: AdminOperationsStatus;
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
  priority: AdminOperationsPriority;
  escalation: {
    state: SupportThreadEscalationState;
    escalated: boolean;
    label: string;
  };
  sla: {
    dueAt: string;
    remainingMinutes: number;
    state: AdminOperationsSlaState;
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

export interface AdminOperationsInboxResponse {
  generatedAt: string;
  rows: AdminOperationsInboxRow[];
  totals: {
    all: number;
    escalated: number;
    overdue: number;
    dueSoon: number;
  };
}

export interface AdminOperationsMessageRow {
  id: string;
  authorType: SupportMessage['authorType'];
  locale: string;
  body: string;
  visibility: SupportMessage['visibility'];
  isInternalNote: boolean;
  createdAt: string;
}

export interface AdminOperationsThreadDetail extends AdminOperationsInboxRow {
  messages: AdminOperationsMessageRow[];
}

export interface AdminOperationsAnswerInput {
  body: string;
  visibility?: SupportMessage['visibility'];
  internalNote?: boolean;
  markResolved?: boolean;
}

export interface AdminOperationsEscalateInput {
  reason: string;
}

export interface AdminOperationsStatusInput {
  status: SupportThreadStatus;
  reason: string;
}

export interface AdminOperationsReassignInput {
  assigneeUserId: string | null;
  reason: string;
}

export interface AdminOperationsSignupLookup {
  emailHash?: string;
  phoneHash?: string;
}

@Injectable()
export class AdminOperationsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly adminAuditService: AdminAuditService,
  ) {}

  async listInbox(
    filters: AdminOperationsInboxFilters = {},
    context: AdminOperationsExecutionContext = {},
  ): Promise<AdminOperationsInboxResponse> {
    const now = context.now ?? new Date();
    const rows = await this.fetchThreadRows(filters);
    const inboxRows = rows
      .map((row) => toInboxRow(row, now))
      .filter((row) => matchesRuntimeFilters(row, filters))
      .sort(compareInboxRows);

    return {
      generatedAt: now.toISOString(),
      rows: inboxRows,
      totals: {
        all: inboxRows.length,
        escalated: inboxRows.filter((row) => row.escalation.escalated).length,
        overdue: inboxRows.filter((row) => row.sla.state === 'overdue').length,
        dueSoon: inboxRows.filter((row) => row.sla.state === 'due_soon').length,
      },
    };
  }

  async getThreadDetail(
    threadId: string,
    context: AdminOperationsExecutionContext = {},
  ): Promise<AdminOperationsThreadDetail> {
    const inbox = await this.listInbox(
      { includeResolved: true, limit: 200 },
      context,
    );
    const row = inbox.rows.find((item) => item.id === threadId);
    if (!row) {
      throw new NotFoundException('운영 항목을 찾을 수 없습니다');
    }

    const messages = await this.db
      .select({
        id: supportMessages.id,
        authorType: supportMessages.authorType,
        locale: supportMessages.locale,
        body: supportMessages.body,
        visibility: supportMessages.visibility,
        isInternalNote: supportMessages.isInternalNote,
        createdAt: supportMessages.createdAt,
      })
      .from(supportMessages)
      .where(eq(supportMessages.threadId, threadId))
      .orderBy(asc(supportMessages.createdAt));

    return {
      ...row,
      messages: messages.map((message) => ({
        ...message,
        createdAt: message.createdAt.toISOString(),
      })),
    };
  }

  async answerThread(
    threadId: string,
    actorUserId: string,
    input: AdminOperationsAnswerInput,
    context: AdminOperationsExecutionContext = {},
  ): Promise<{ id: string; status: SupportThreadStatus }> {
    const now = context.now ?? new Date();
    const body = input.body.trim();
    if (!body) {
      throw new BadRequestException('답변 내용을 입력해주세요');
    }

    const nextStatus: SupportThreadStatus = input.markResolved
      ? 'resolved'
      : 'waiting_customer';

    await this.db.insert(supportMessages).values({
      threadId,
      authorType: 'admin',
      authorUserId: actorUserId,
      body,
      visibility: input.visibility ?? 'public',
      isInternalNote: input.internalNote ?? false,
      locale: 'ko',
      reviewState: 'approved',
      translationUse: 'manual',
      createdAt: now,
    });

    await this.db
      .update(supportThreads)
      .set({
        status: nextStatus,
        firstResponseAt: now,
        lastMessageAt: now,
        resolvedAt: input.markResolved ? now : null,
        messageCount: sql`${supportThreads.messageCount} + 1`,
        updatedAt: now,
      })
      .where(eq(supportThreads.id, threadId));

    return { id: threadId, status: nextStatus };
  }

  async updateThreadStatus(
    threadId: string,
    actorUserId: string,
    input: AdminOperationsStatusInput,
    context: AdminOperationsExecutionContext = {},
  ): Promise<{ id: string; status: SupportThreadStatus }> {
    const now = context.now ?? new Date();
    const reason = input.reason.trim();
    if (!reason) {
      throw new BadRequestException('상태 변경 사유를 입력해주세요');
    }

    await this.db
      .update(supportThreads)
      .set({
        status: input.status,
        resolvedAt: input.status === 'resolved' ? now : null,
        updatedAt: now,
      })
      .where(eq(supportThreads.id, threadId));

    await this.adminAuditService.write({
      actorUserId,
      action: 'support.escalate',
      resourceType: 'support_thread',
      resourceId: threadId,
      status: 'success',
      reason,
      changedFields: ['status'],
      before: null,
      after: { status: input.status },
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
    });

    return { id: threadId, status: input.status };
  }

  async escalateThread(
    threadId: string,
    actorUserId: string,
    input: AdminOperationsEscalateInput,
    context: AdminOperationsExecutionContext = {},
  ): Promise<{ id: string; escalationState: SupportThreadEscalationState }> {
    const now = context.now ?? new Date();
    const reason = input.reason.trim();
    if (!reason) {
      throw new BadRequestException('에스컬레이션 사유를 입력해주세요');
    }

    await this.db
      .update(supportThreads)
      .set({
        priority: 'urgent',
        escalationState: 'manual_escalated',
        escalatedAt: now,
        updatedAt: now,
      })
      .where(eq(supportThreads.id, threadId))
      .returning({ id: supportThreads.id });

    await this.adminAuditService.write({
      actorUserId,
      action: 'support.escalate',
      resourceType: 'support_thread',
      resourceId: threadId,
      status: 'success',
      reason,
      changedFields: ['priority', 'escalationState', 'escalatedAt'],
      before: null,
      after: {
        priority: 'urgent',
        escalationState: 'manual_escalated',
        escalatedAt: now.toISOString(),
      },
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
    });

    return { id: threadId, escalationState: 'manual_escalated' };
  }

  async reassignThread(
    threadId: string,
    actorUserId: string,
    input: AdminOperationsReassignInput,
    context: AdminOperationsExecutionContext = {},
  ): Promise<{ id: string; assigneeUserId: string | null }> {
    const now = context.now ?? new Date();
    const reason = input.reason.trim();
    if (!reason) {
      throw new BadRequestException('담당자 변경 사유를 입력해주세요');
    }

    await this.db
      .update(supportThreads)
      .set({
        assigneeUserId: input.assigneeUserId,
        updatedAt: now,
      })
      .where(eq(supportThreads.id, threadId));

    await this.adminAuditService.write({
      actorUserId,
      action: 'support.escalate',
      resourceType: 'support_thread',
      resourceId: threadId,
      status: 'success',
      reason,
      changedFields: ['assigneeUserId'],
      before: null,
      after: { assigneeUserId: input.assigneeUserId },
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
    });

    return { id: threadId, assigneeUserId: input.assigneeUserId };
  }

  async lookupSignupFailures(
    lookup: AdminOperationsSignupLookup,
    context: AdminOperationsExecutionContext = {},
  ): Promise<AdminOperationsInboxResponse> {
    const emailHash = lookup.emailHash?.trim();
    const phoneHash = lookup.phoneHash?.trim();
    if (!emailHash && !phoneHash) {
      throw new BadRequestException('가입 실패 조회 키가 필요합니다');
    }

    return this.listInbox(
      {
        includeResolved: true,
        source: 'signup_failure',
        signupFailureEmailHash: emailHash,
        signupFailurePhoneHash: phoneHash,
      },
      context,
    );
  }

  private async fetchThreadRows(
    filters: AdminOperationsInboxFilters,
  ): Promise<AdminOperationsThreadRow[]> {
    const predicates: SQL[] = [];
    const limit = Math.min(Math.max(filters.limit ?? 100, 1), 200);

    if (!filters.includeResolved) {
      predicates.push(notInArray(supportThreads.status, ['resolved', 'closed']));
    }
    if (filters.source) {
      predicates.push(eq(supportThreads.source, filters.source));
    }
    if (filters.category) {
      predicates.push(eq(supportThreads.category, filters.category));
    }
    if (filters.status) {
      predicates.push(eq(supportThreads.status, filters.status));
    }
    if (filters.signupFailureEmailHash || filters.signupFailurePhoneHash) {
      const signupPredicates: SQL[] = [];
      if (filters.signupFailureEmailHash) {
        signupPredicates.push(
          eq(
            supportThreads.signupFailureEmailHash,
            filters.signupFailureEmailHash,
          ),
        );
      }
      if (filters.signupFailurePhoneHash) {
        signupPredicates.push(
          eq(
            supportThreads.signupFailurePhoneHash,
            filters.signupFailurePhoneHash,
          ),
        );
      }
      predicates.push(or(...signupPredicates)!);
    }

    const rows = await this.db
      .select({
        thread: supportThreads,
        requester: {
          id: users.id,
          email: users.email,
          phone: users.phone,
          name: users.name,
        },
        assignee: {
          id: assigneeUsers.id,
          email: assigneeUsers.email,
          phone: assigneeUsers.phone,
          name: assigneeUsers.name,
        },
        refund: {
          id: refunds.id,
          status: refunds.status,
          requestedAt: refunds.requestedAt,
          expectedDepositAt: refunds.expectedDepositAt,
        },
      })
      .from(supportThreads)
      .leftJoin(users, eq(supportThreads.userId, users.id))
      .leftJoin(assigneeUsers, eq(supportThreads.assigneeUserId, assigneeUsers.id))
      .leftJoin(refunds, eq(supportThreads.refundId, refunds.id))
      .where(predicates.length > 0 ? and(...predicates) : undefined)
      .orderBy(desc(supportThreads.createdAt))
      .limit(limit);

    return rows as AdminOperationsThreadRow[];
  }
}

function toInboxRow(
  row: AdminOperationsThreadRow,
  now: Date,
): AdminOperationsInboxRow {
  const highRisk = isHighRisk(row.thread);
  const sla = resolveSla(row.thread, now);
  const escalation = resolveEscalation(row.thread, highRisk);

  return {
    id: row.thread.id,
    source: mapSource(row.thread.source),
    sourceLabel: SOURCE_LABELS[row.thread.source],
    category: row.thread.category,
    categoryLabel: CATEGORY_LABELS[row.thread.category],
    subject: row.thread.title,
    summary: row.thread.summary,
    locale: row.thread.locale,
    status: mapStatus(row.thread.status),
    queue: SOURCE_LABELS[row.thread.source],
    assignee: {
      id: row.assignee?.id ?? null,
      name: row.assignee?.name ?? '미배정',
      email: row.assignee?.email ? maskEmail(row.assignee.email) : null,
    },
    requester: {
      id: row.requester?.id ?? row.thread.userId,
      email: row.requester?.email ? maskEmail(row.requester.email) : '***',
      phone: row.requester?.phone ? maskPhone(row.requester.phone) : '***',
      name: row.requester?.name ? maskName(row.requester.name) : '비회원',
    },
    priority: escalation.escalated ? 'escalated' : mapSlaPriority(sla.state),
    escalation,
    sla,
    createdAt: row.thread.createdAt.toISOString(),
    updatedAt: row.thread.updatedAt.toISOString(),
    lastMessageAt: row.thread.lastMessageAt?.toISOString() ?? null,
    reservationId: row.thread.reservationId,
    refundDispute: resolveRefundDispute(row),
    signupFailure: resolveSignupFailure(row.thread),
  };
}

function matchesRuntimeFilters(
  row: AdminOperationsInboxRow,
  filters: AdminOperationsInboxFilters,
): boolean {
  if (filters.priority && row.priority !== filters.priority) {
    return false;
  }
  if (
    filters.signupFailureEmailHash
    && row.signupFailure?.emailHash !== filters.signupFailureEmailHash
  ) {
    return false;
  }
  if (
    filters.signupFailurePhoneHash
    && row.signupFailure?.phoneHash !== filters.signupFailurePhoneHash
  ) {
    return false;
  }
  return true;
}

function compareInboxRows(
  left: AdminOperationsInboxRow,
  right: AdminOperationsInboxRow,
): number {
  const escalationRank = Number(right.escalation.escalated) - Number(left.escalation.escalated);
  if (escalationRank !== 0) return escalationRank;

  const slaRank = SLA_SORT_RANK[right.sla.state] - SLA_SORT_RANK[left.sla.state];
  if (slaRank !== 0) return slaRank;

  return Date.parse(right.createdAt) - Date.parse(left.createdAt);
}

function isHighRisk(thread: SupportThread): boolean {
  return HIGH_RISK_CATEGORIES.has(thread.category)
    || thread.source === 'refund_dispute'
    || thread.source === 'signup_failure';
}

function resolveEscalation(
  thread: SupportThread,
  highRisk: boolean,
): AdminOperationsInboxRow['escalation'] {
  const escalated = highRisk
    || thread.priority === 'urgent'
    || thread.priority === 'high'
    || thread.escalationState === 'auto_escalated'
    || thread.escalationState === 'manual_escalated';

  return {
    state: thread.escalationState,
    escalated,
    label: escalated ? '즉시 확인' : '일반',
  };
}

function resolveSla(
  thread: SupportThread,
  now: Date,
): AdminOperationsInboxRow['sla'] {
  const remainingMinutes = Math.round(
    (thread.slaDueAt.getTime() - now.getTime()) / 60_000,
  );
  let state: AdminOperationsSlaState = 'within_sla';
  let label = `${Math.max(remainingMinutes, 0)}분 남음`;

  if (thread.firstResponseAt || thread.status === 'resolved' || thread.status === 'closed') {
    state = 'responded';
    label = '응답 완료';
  } else if (remainingMinutes < 0) {
    state = 'overdue';
    label = '24시간 SLA를 초과했습니다. 즉시 확인해주세요';
  } else if (remainingMinutes <= DUE_SOON_MINUTES) {
    state = 'due_soon';
    label = '24시간 SLA 마감이 가까워지고 있습니다';
  }

  return {
    dueAt: thread.slaDueAt.toISOString(),
    remainingMinutes,
    state,
    label,
  };
}

function mapSlaPriority(state: AdminOperationsSlaState): AdminOperationsPriority {
  if (state === 'overdue') return 'overdue';
  if (state === 'due_soon') return 'due_soon';
  return 'normal';
}

function mapSource(source: SupportThreadSource): AdminOperationsSource {
  if (source === 'cs') return 'cs_ticket';
  return source;
}

function mapStatus(status: SupportThreadStatus): AdminOperationsStatus {
  if (status === 'resolved' || status === 'closed') return 'resolved';
  if (status === 'waiting_customer' || status === 'waiting_operator') {
    return 'in_progress';
  }
  return 'open';
}

function resolveRefundDispute(
  row: AdminOperationsThreadRow,
): AdminOperationsInboxRow['refundDispute'] {
  const isRefundRelated = row.thread.source === 'refund_dispute'
    || row.thread.category === 'refund_dispute'
    || row.thread.category === 'refund_unprocessed'
    || Boolean(row.thread.refundId);

  if (!isRefundRelated || !row.thread.refundId) {
    return null;
  }

  return {
    refundId: row.thread.refundId,
    status: row.refund?.status ?? null,
    retainedForAudit: true,
    requestedAt: row.refund?.requestedAt?.toISOString() ?? null,
    expectedDepositAt: row.refund?.expectedDepositAt?.toISOString() ?? null,
  };
}

function resolveSignupFailure(
  thread: SupportThread,
): AdminOperationsInboxRow['signupFailure'] {
  if (
    thread.source !== 'signup_failure'
    && thread.category !== 'signup_failure'
  ) {
    return null;
  }

  return {
    emailHash: thread.signupFailureEmailHash,
    phoneHash: thread.signupFailurePhoneHash,
  };
}

function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  if (!domain) return '***';
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***@${domain}`;
}

function maskPhone(phone: string): string {
  if (phone.length <= 5) return '***';
  return `${phone.slice(0, 3)}${'*'.repeat(Math.max(3, phone.length - 5))}${phone.slice(-2)}`;
}

function maskName(name: string): string {
  if (name.length <= 1) return '*';
  return `${name.slice(0, 1)}${'*'.repeat(Math.max(1, name.length - 1))}`;
}
