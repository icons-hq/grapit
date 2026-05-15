import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, lte, type SQL } from 'drizzle-orm';

import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import { adminAuditLogs } from '../../database/schema/index.js';

export const ADMIN_AUDIT_ACTIONS = [
  'event.publish',
  'event.update',
  'refund.admin_refund',
  'support.escalate',
  'seat.disable',
  'seat.reactivate',
  'seat.manual_open',
  'banner.manage',
  'reservations.export_raw',
  'security.allowlist.update',
  'security.permission.update',
] as const;

export const ADMIN_AUDIT_STATUSES = ['success', 'denied', 'failed'] as const;

export type AdminAuditAction = (typeof ADMIN_AUDIT_ACTIONS)[number];
export type AdminAuditStatus = (typeof ADMIN_AUDIT_STATUSES)[number];

type AdminAuditDb = Pick<DrizzleDB, 'insert' | 'select'>;
type AuditSnapshot = Record<string, unknown>;

export interface AdminAuditWriteInput {
  actorUserId: string;
  action: AdminAuditAction;
  resourceType: string;
  resourceId: string;
  status: AdminAuditStatus;
  reason?: string | null;
  changedFields?: string[];
  before?: AuditSnapshot | null;
  after?: AuditSnapshot | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface AdminAuditQueryFilters {
  actorUserId?: string;
  action?: AdminAuditAction;
  status?: AdminAuditStatus;
  resourceType?: string;
  resourceId?: string;
  requestId?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export interface MaskedAdminAuditEvent {
  id: string;
  actorUserId: string;
  action: AdminAuditAction;
  resourceType: string;
  resourceId: string;
  status: AdminAuditStatus;
  reason: string | null;
  changedFields: string[];
  diff: {
    before: AuditSnapshot;
    after: AuditSnapshot;
  };
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: string;
}

@Injectable()
export class AdminAuditService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async write(
    input: AdminAuditWriteInput,
    db: AdminAuditDb = this.db,
  ): Promise<{ id: string }> {
    const changedFields = resolveChangedFields(input);

    const [row] = await db
      .insert(adminAuditLogs)
      .values({
        actorUserId: input.actorUserId,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        status: input.status,
        reason: input.reason ?? null,
        changedFields,
        maskedBeforeSnapshot: maskSnapshot(input.before, changedFields),
        maskedAfterSnapshot: maskSnapshot(input.after, changedFields),
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        requestId: input.requestId ?? null,
      })
      .returning({ id: adminAuditLogs.id });

    return { id: row?.id ?? '' };
  }

  async query(filters: AdminAuditQueryFilters = {}): Promise<MaskedAdminAuditEvent[]> {
    const predicates: SQL[] = [];

    if (filters.actorUserId) {
      predicates.push(eq(adminAuditLogs.actorUserId, filters.actorUserId));
    }
    if (filters.action) {
      predicates.push(eq(adminAuditLogs.action, filters.action));
    }
    if (filters.status) {
      predicates.push(eq(adminAuditLogs.status, filters.status));
    }
    if (filters.resourceType) {
      predicates.push(eq(adminAuditLogs.resourceType, filters.resourceType));
    }
    if (filters.resourceId) {
      predicates.push(eq(adminAuditLogs.resourceId, filters.resourceId));
    }
    if (filters.requestId) {
      predicates.push(eq(adminAuditLogs.requestId, filters.requestId));
    }
    if (filters.from) {
      predicates.push(gte(adminAuditLogs.createdAt, new Date(filters.from)));
    }
    if (filters.to) {
      predicates.push(lte(adminAuditLogs.createdAt, new Date(filters.to)));
    }

    const rows = await this.db
      .select({
        id: adminAuditLogs.id,
        actorUserId: adminAuditLogs.actorUserId,
        action: adminAuditLogs.action,
        resourceType: adminAuditLogs.resourceType,
        resourceId: adminAuditLogs.resourceId,
        status: adminAuditLogs.status,
        reason: adminAuditLogs.reason,
        changedFields: adminAuditLogs.changedFields,
        maskedBeforeSnapshot: adminAuditLogs.maskedBeforeSnapshot,
        maskedAfterSnapshot: adminAuditLogs.maskedAfterSnapshot,
        ipAddress: adminAuditLogs.ipAddress,
        userAgent: adminAuditLogs.userAgent,
        requestId: adminAuditLogs.requestId,
        createdAt: adminAuditLogs.createdAt,
      })
      .from(adminAuditLogs)
      .where(predicates.length > 0 ? and(...predicates) : undefined)
      .orderBy(desc(adminAuditLogs.createdAt))
      .limit(Math.min(Math.max(filters.limit ?? 50, 1), 200));

    return rows.map((row) => ({
      id: row.id,
      actorUserId: row.actorUserId,
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      status: row.status,
      reason: row.reason,
      changedFields: row.changedFields,
      diff: {
        before: row.maskedBeforeSnapshot,
        after: row.maskedAfterSnapshot,
      },
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      requestId: row.requestId,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}

function resolveChangedFields(input: AdminAuditWriteInput): string[] {
  if (input.changedFields) {
    return [...new Set(input.changedFields)].filter((field) => field.length > 0);
  }

  const before = input.before ?? {};
  const after = input.after ?? {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

  return [...keys].filter((key) =>
    !areAuditValuesEqual(before[key], after[key]),
  );
}

function areAuditValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function maskSnapshot(
  snapshot: AuditSnapshot | null | undefined,
  changedFields: readonly string[],
): AuditSnapshot {
  if (!snapshot) {
    return {};
  }

  return changedFields.reduce<AuditSnapshot>((masked, field) => {
    if (Object.hasOwn(snapshot, field)) {
      masked[field] = maskAuditValue(field, snapshot[field]);
    }
    return masked;
  }, {});
}

function maskAuditValue(key: string, value: unknown): unknown {
  if (isCsvRowsKey(key)) {
    return `[redacted:csv_rows:${Array.isArray(value) ? value.length : 0}]`;
  }

  if (Array.isArray(value)) {
    return value.map((item) => maskAuditValue(key, item));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        maskAuditValue(childKey, childValue),
      ]),
    );
  }

  if (isEmailKey(key) && typeof value === 'string') {
    return maskEmail(value);
  }

  if (isPhoneKey(key) && typeof value === 'string') {
    return maskPhone(value);
  }

  if (isIpKey(key) && typeof value === 'string') {
    return maskIp(value);
  }

  if (isSensitiveScalarKey(key)) {
    return '[redacted]';
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCsvRowsKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized === 'rows'
    || normalized.includes('rawexportrows')
    || normalized.includes('exportrows')
    || normalized.includes('csvrows');
}

function isEmailKey(key: string): boolean {
  return key.toLowerCase().includes('email');
}

function isPhoneKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized.includes('phone') || normalized.includes('mobile');
}

function isIpKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized === 'ip'
    || normalized === 'ipaddress'
    || normalized.endsWith('ipaddress');
}

function isSensitiveScalarKey(key: string): boolean {
  return /(password|token|secret|otp|credential|authorization|cookie|session)/i
    .test(key);
}

function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  if (!domain) {
    return '***';
  }

  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***@${domain}`;
}

function maskPhone(phone: string): string {
  if (phone.length <= 5) {
    return '***';
  }

  return `${phone.slice(0, 3)}${'*'.repeat(Math.max(3, phone.length - 5))}${phone.slice(-2)}`;
}

function maskIp(ipAddress: string): string {
  if (ipAddress.includes(':')) {
    return `${ipAddress.split(':').slice(0, 4).join(':')}::`;
  }

  const octets = ipAddress.split('.');
  if (octets.length === 4) {
    return `${octets[0]}.${octets[1]}.${octets[2]}.0`;
  }

  return '0.0.0.0';
}
