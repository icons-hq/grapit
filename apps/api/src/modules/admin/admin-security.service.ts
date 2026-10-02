import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { isIP } from 'node:net';
import type { Request } from 'express';

import { resolveTrustedRequestIp } from '../../common/request-ip.js';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import { adminAccessAllowlist } from '../../database/schema/index.js';
import { AdminAuditService } from './admin-audit.service.js';

type AdminSecurityDb = Pick<DrizzleDB, 'select' | 'insert'>;
type AdminAllowlistSource = 'env_bootstrap' | 'db_managed' | 'temporary_exception';
type AdminAllowlistRecordStatus = 'active' | 'disabled' | 'expired';

export type AdminSecurityDecisionSource =
  | AdminAllowlistSource
  | 'non_production_bypass'
  | 'denied';

export interface AdminSecurityDecision {
  allowed: boolean;
  source: AdminSecurityDecisionSource;
  ipAddress: string;
  matchedCidr?: string;
  allowlistRecordId?: string;
  reason?: string;
}

/**
 * Admin IP allowlist enforcement state. No guard, middleware or edge rule
 * blocks admin requests by IP today, so the allowlist is evaluated for the
 * security screen only ("monitoring"). Flip this only together with a real
 * enforcing guard and a field-scanner exemption policy (audit #43).
 */
export const ADMIN_IP_ALLOWLIST_ENFORCED = false;

export type AdminAllowlistMode = 'disabled' | 'monitoring' | 'enforced';

export interface AdminAllowlistStatus {
  mode: AdminAllowlistMode;
  enforced: boolean;
  activeRecords: number;
  lastChangedAt: string | null;
  decision: AdminSecurityDecision;
}

export interface AdminAllowlistChangeInput {
  actorUserId: string;
  hasSecurityManage: boolean;
  cidr: string;
  label: string;
  source: Exclude<AdminAllowlistSource, 'env_bootstrap'>;
  reason: string;
  expiresAt?: Date | string | null;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface AdminSecurityServiceOptions {
  env?: Record<string, string | undefined>;
  now?: () => Date;
}

interface AllowlistRow {
  id: string;
  cidr: string;
  label: string;
  source: AdminAllowlistSource;
  status: AdminAllowlistRecordStatus;
  reason: string;
  expiresAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

@Injectable()
export class AdminSecurityService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly audit: AdminAuditService,
    private readonly options: AdminSecurityServiceOptions = {},
  ) {}

  /**
   * Read-only evaluation of whether the request IP matches the allowlist.
   * It never blocks and never writes audit rows: status reads are not
   * allowlist changes (audit #43).
   */
  async evaluateRequest(request: Request): Promise<AdminSecurityDecision> {
    return this.evaluate(resolveTrustedRequestIp(request), await this.loadAllowlistRows());
  }

  async getAllowlistStatus(request: Request): Promise<AdminAllowlistStatus> {
    const rows = await this.loadAllowlistRows();
    const decision = this.evaluate(resolveTrustedRequestIp(request), rows);
    const now = this.now();
    const activeDbRecords = rows.filter((row) => isActiveRow(row, now)).length;
    const lastChangedAt = rows.reduce<Date | null>((latest, row) => {
      const changedAt = row.updatedAt ?? row.createdAt;
      return changedAt && (!latest || changedAt > latest) ? changedAt : latest;
    }, null);

    return {
      mode: this.mode(),
      enforced: ADMIN_IP_ALLOWLIST_ENFORCED,
      activeRecords: this.envCidrs().length + activeDbRecords,
      lastChangedAt: lastChangedAt?.toISOString() ?? null,
      decision,
    };
  }

  private evaluate(ipAddress: string, rows: AllowlistRow[]): AdminSecurityDecision {
    if (!this.isProduction()) {
      return {
        allowed: true,
        source: 'non_production_bypass',
        ipAddress,
        reason: 'Admin IP allowlist is not evaluated outside production.',
      };
    }

    const envMatch = this.findEnvMatch(ipAddress);
    if (envMatch) {
      return {
        allowed: true,
        source: 'env_bootstrap',
        ipAddress,
        matchedCidr: envMatch,
      };
    }

    const now = this.now();
    const dbMatch = rows.find((row) => isActiveRow(row, now) && ipMatchesCidr(ipAddress, row.cidr));
    if (dbMatch) {
      return {
        allowed: true,
        source: dbMatch.source,
        ipAddress,
        matchedCidr: dbMatch.cidr,
        allowlistRecordId: dbMatch.id,
      };
    }

    return {
      allowed: false,
      source: 'denied',
      ipAddress,
      reason: ADMIN_IP_ALLOWLIST_ENFORCED
        ? 'Admin IP address is not allowlisted.'
        : 'Admin IP address is outside the allowlist. The allowlist is monitoring-only and does not block requests.',
    };
  }

  async createAllowlistRecord(
    input: AdminAllowlistChangeInput,
    db: AdminSecurityDb = this.db,
  ): Promise<{ id: string }> {
    if (!input.hasSecurityManage) {
      await this.audit.write({
        actorUserId: input.actorUserId,
        action: 'security.allowlist.update',
        resourceType: 'admin_access_allowlist',
        resourceId: input.cidr,
        status: 'denied',
        reason: 'security.manage capability is required for allowlist changes.',
        changedFields: ['cidr', 'source', 'label', 'reason', 'expiresAt'],
        after: allowlistAuditSnapshot(input),
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        requestId: input.requestId ?? null,
      }, db);
      throw new ForbiddenException('security.manage capability is required');
    }

    const audit = await this.audit.write({
      actorUserId: input.actorUserId,
      action: 'security.allowlist.update',
      resourceType: 'admin_access_allowlist',
      resourceId: input.cidr,
      status: 'success',
      reason: input.reason,
      changedFields: ['cidr', 'source', 'label', 'reason', 'expiresAt'],
      after: allowlistAuditSnapshot(input),
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      requestId: input.requestId ?? null,
    }, db);

    const [record] = await db
      .insert(adminAccessAllowlist)
      .values({
        cidr: input.cidr,
        label: input.label,
        source: input.source,
        status: 'active',
        reason: input.reason,
        createdByUserId: input.actorUserId,
        auditLogId: audit.id,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      })
      .returning({ id: adminAccessAllowlist.id });

    return { id: record?.id ?? '' };
  }

  private isProduction(): boolean {
    const env = this.env();
    return env.NODE_ENV === 'production' || env.GRABIT_ENV === 'production';
  }

  private mode(): AdminAllowlistMode {
    if (!this.isProduction()) {
      return 'disabled';
    }
    return ADMIN_IP_ALLOWLIST_ENFORCED ? 'enforced' : 'monitoring';
  }

  private findEnvMatch(ipAddress: string): string | undefined {
    return this.envCidrs().find((cidr) => ipMatchesCidr(ipAddress, cidr));
  }

  private async loadAllowlistRows(): Promise<AllowlistRow[]> {
    // The allowlist is a small operator-managed table; load it whole so the
    // status screen can report counts and the latest change.
    const rows = await this.db
      .select({
        id: adminAccessAllowlist.id,
        cidr: adminAccessAllowlist.cidr,
        label: adminAccessAllowlist.label,
        source: adminAccessAllowlist.source,
        status: adminAccessAllowlist.status,
        reason: adminAccessAllowlist.reason,
        expiresAt: adminAccessAllowlist.expiresAt,
        createdAt: adminAccessAllowlist.createdAt,
        updatedAt: adminAccessAllowlist.updatedAt,
      })
      .from(adminAccessAllowlist);

    return rows as AllowlistRow[];
  }

  private envCidrs(): string[] {
    const env = this.env();
    return [
      env.ADMIN_IP_ALLOWLIST_CIDRS,
      env.ADMIN_ACCESS_ALLOWLIST_CIDRS,
    ]
      .filter((value): value is string => Boolean(value?.trim()))
      .flatMap((value) => value.split(','))
      .map((value) => value.trim())
      .filter(Boolean);
  }

  private env(): Record<string, string | undefined> {
    return this.options.env ?? process.env;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
}

function isActiveRow(row: AllowlistRow, now: Date): boolean {
  return row.status === 'active' && (!row.expiresAt || row.expiresAt > now);
}

function allowlistAuditSnapshot(input: AdminAllowlistChangeInput): Record<string, unknown> {
  return {
    cidr: input.cidr,
    label: input.label,
    source: input.source,
    reason: input.reason,
    expiresAt: input.expiresAt ? new Date(input.expiresAt).toISOString() : null,
  };
}

function ipMatchesCidr(ipAddress: string, cidrOrIp: string): boolean {
  const normalizedCidr = cidrOrIp.trim();
  if (!normalizedCidr) {
    return false;
  }

  if (!normalizedCidr.includes('/')) {
    return ipAddress === normalizedCidr;
  }

  const [baseIp, prefixText] = normalizedCidr.split('/');
  const prefix = Number(prefixText);
  const version = isIP(ipAddress);

  if (!baseIp || !Number.isInteger(prefix) || version === 0 || isIP(baseIp) !== version) {
    return false;
  }

  if (version === 4) {
    return ipv4MatchesCidr(ipAddress, baseIp, prefix);
  }

  return prefix === 128 && ipAddress === baseIp;
}

function ipv4MatchesCidr(ipAddress: string, baseIp: string, prefix: number): boolean {
  if (prefix < 0 || prefix > 32) {
    return false;
  }

  const ip = ipv4ToInt(ipAddress);
  const base = ipv4ToInt(baseIp);
  if (ip === null || base === null) {
    return false;
  }

  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ip & mask) === (base & mask);
}

function ipv4ToInt(ipAddress: string): number | null {
  const parts = ipAddress.split('.');
  if (parts.length !== 4) {
    return null;
  }

  return parts.reduce<number | null>((acc, part) => {
    if (acc === null || !/^\d+$/.test(part)) {
      return null;
    }

    const octet = Number(part);
    if (octet < 0 || octet > 255) {
      return null;
    }

    return ((acc << 8) + octet) >>> 0;
  }, 0);
}
