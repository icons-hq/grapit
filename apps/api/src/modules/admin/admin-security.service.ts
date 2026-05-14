import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { isIP } from 'node:net';
import type { Request } from 'express';

import { resolveTrustedRequestIp } from '../../common/request-ip.js';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import { adminAccessAllowlist } from '../../database/schema/index.js';
import { AdminAuditService } from './admin-audit.service.js';

type AdminSecurityDb = Pick<DrizzleDB, 'select' | 'insert'>;
type AdminAllowlistSource = 'env_bootstrap' | 'db_managed' | 'temporary_exception';
type AdminAllowlistStatus = 'active' | 'disabled' | 'expired';

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

export interface AdminSecurityEvaluateContext {
  actorUserId: string;
  requestId?: string;
  userAgent?: string;
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
  status: AdminAllowlistStatus;
  reason: string;
  expiresAt: Date | null;
}

@Injectable()
export class AdminSecurityService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly audit: AdminAuditService,
    private readonly options: AdminSecurityServiceOptions = {},
  ) {}

  async evaluateRequest(
    request: Request,
    context: AdminSecurityEvaluateContext,
  ): Promise<AdminSecurityDecision> {
    const ipAddress = resolveTrustedRequestIp(request);

    if (!this.isProduction()) {
      return {
        allowed: true,
        source: 'non_production_bypass',
        ipAddress,
        reason: 'Admin IP allowlist bypass is explicit outside production.',
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

    const dbMatch = await this.findDbMatch(ipAddress, this.db);
    if (dbMatch) {
      await this.audit.write({
        actorUserId: context.actorUserId,
        action: 'security.allowlist.update',
        resourceType: 'admin_access_allowlist',
        resourceId: dbMatch.id,
        status: 'success',
        reason: `Admin access allowed by ${dbMatch.source} allowlist record.`,
        changedFields: ['cidr', 'source', 'label', 'reason', 'expiresAt'],
        after: {
          cidr: dbMatch.cidr,
          source: dbMatch.source,
          label: dbMatch.label,
          reason: dbMatch.reason,
          expiresAt: dbMatch.expiresAt?.toISOString() ?? null,
        },
        ipAddress,
        userAgent: context.userAgent ?? null,
        requestId: context.requestId ?? null,
      });

      return {
        allowed: true,
        source: dbMatch.source,
        ipAddress,
        matchedCidr: dbMatch.cidr,
        allowlistRecordId: dbMatch.id,
      };
    }

    await this.audit.write({
      actorUserId: context.actorUserId,
      action: 'security.allowlist.update',
      resourceType: 'admin_access_allowlist',
      resourceId: ipAddress,
      status: 'denied',
      reason: 'Admin request IP did not match env/bootstrap or DB allowlist.',
      changedFields: ['ipAddress'],
      after: { ipAddress },
      ipAddress,
      userAgent: context.userAgent ?? null,
      requestId: context.requestId ?? null,
    });

    return {
      allowed: false,
      source: 'denied',
      ipAddress,
      reason: 'Admin IP address is not allowlisted.',
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

  private findEnvMatch(ipAddress: string): string | undefined {
    return this.envCidrs().find((cidr) => ipMatchesCidr(ipAddress, cidr));
  }

  private async findDbMatch(
    ipAddress: string,
    db: Pick<DrizzleDB, 'select'>,
  ): Promise<AllowlistRow | undefined> {
    const rows = await db
      .select({
        id: adminAccessAllowlist.id,
        cidr: adminAccessAllowlist.cidr,
        label: adminAccessAllowlist.label,
        source: adminAccessAllowlist.source,
        status: adminAccessAllowlist.status,
        reason: adminAccessAllowlist.reason,
        expiresAt: adminAccessAllowlist.expiresAt,
      })
      .from(adminAccessAllowlist)
      .where(and(eq(adminAccessAllowlist.status, 'active')));

    const now = this.now();
    return (rows as AllowlistRow[]).find((row) =>
      row.status === 'active'
      && (!row.expiresAt || row.expiresAt > now)
      && ipMatchesCidr(ipAddress, row.cidr),
    );
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
