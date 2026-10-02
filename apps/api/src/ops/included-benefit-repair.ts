import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { resolveAdminCapabilitySnapshot, type AdminCapabilityUser } from '@grabit/shared';
import type { DrizzleDB } from '../database/drizzle.provider.js';
import { ticketBenefitEntitlements, users } from '../database/schema/index.js';
import { AdminAuditService } from '../modules/admin/admin-audit.service.js';
type BenefitDisplayCopy = typeof ticketBenefitEntitlements.$inferInsert.displayCopySnapshot;

type MissingBenefit = { ticket_item_id: string; tier_name: string; benefit_identity: string;
  configuration_id: string; display_copy: BenefitDisplayCopy };

/**
 * Apply holds the showtime row (blocking ticket issuance, configuration changes and
 * field redemption of that showtime) and the candidate tickets. Fail instead of
 * queueing behind busy sales or admission traffic; rerun when the showtime is quiet.
 */
export const BENEFIT_REPAIR_LOCK_TIMEOUT = '2s';
const REPAIR_CHUNK_SIZE = 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const INCLUDED_UNIQUE_INDEX = 'idx_tbe_active_config_included_item_identity';

export interface IncludedBenefitRepairApply {
  expectedHash: string;
  /** Admin user with benefits.manage. Recorded in admin_audit_logs. */
  operatorUserId: string;
  reason: string;
}

export type IncludedBenefitRepairArgs =
  | { mode: 'dry-run'; showtimeId: string }
  | ({ mode: 'apply'; showtimeId: string } & IncludedBenefitRepairApply);

export const INCLUDED_BENEFIT_REPAIR_USAGE = 'Usage: included-benefit-repair dry-run <showtime UUID> | '
  + 'apply <showtime UUID> <reviewed hash> --operator-user-id <admin UUID> --reason "<10-500 chars>"';

export function parseIncludedBenefitRepairArgs(argv: string[]): IncludedBenefitRepairArgs {
  const [mode, showtimeId, ...rest] = argv;
  if (!showtimeId || !UUID_PATTERN.test(showtimeId)) throw new Error(INCLUDED_BENEFIT_REPAIR_USAGE);
  if (mode === 'dry-run' && rest.length === 0) return { mode, showtimeId };
  if (mode !== 'apply') throw new Error(INCLUDED_BENEFIT_REPAIR_USAGE);

  const [expectedHash, ...flags] = rest;
  const options = new Map<string, string>();
  for (let index = 0; index < flags.length; index += 2) {
    const key = flags[index];
    const value = flags[index + 1];
    if ((key !== '--operator-user-id' && key !== '--reason') || value === undefined || options.has(key)) {
      throw new Error(INCLUDED_BENEFIT_REPAIR_USAGE);
    }
    options.set(key, value);
  }
  const apply = {
    expectedHash: expectedHash ?? '',
    operatorUserId: options.get('--operator-user-id') ?? '',
    reason: options.get('--reason') ?? '',
  };
  assertApplyInput(apply);
  return { mode, showtimeId, ...apply, reason: apply.reason.trim() };
}

function assertApplyInput(apply: IncludedBenefitRepairApply): void {
  if (!HASH_PATTERN.test(apply.expectedHash)) throw new Error(INCLUDED_BENEFIT_REPAIR_USAGE);
  if (!UUID_PATTERN.test(apply.operatorUserId)) throw new Error('BENEFIT_REPAIR_OPERATOR_REQUIRED');
  const reason = apply.reason.trim();
  if (reason.length < 10 || reason.length > 500) throw new Error('BENEFIT_REPAIR_REASON_REQUIRED');
}

/**
 * Dry-run is read-only. Apply requires the exact hash of the reviewed candidate set
 * and an admin operator; it writes one admin audit row and links every inserted
 * entitlement to it through repair_audit_log_id.
 */
export async function repairIncludedBenefits(db: DrizzleDB, showtimeId: string,
  apply?: IncludedBenefitRepairApply) {
  if (apply) assertApplyInput(apply);
  try {
    return await db.transaction(async (tx) => {
      if (apply) {
        await tx.execute(sql`SELECT set_config('lock_timeout', ${BENEFIT_REPAIR_LOCK_TIMEOUT}, true)`);
        await assertRepairOperator(tx as unknown as DrizzleDB, apply.operatorUserId);
      }
      // Apply serializes with ticket issuance (FOR SHARE) and benefit mutations; dry-run stays read-only.
      const showtime = await tx.execute(sql`SELECT id FROM showtimes WHERE id = ${showtimeId}
        ${apply ? sql`FOR NO KEY UPDATE` : sql``}`);
      if (showtime.rows.length === 0) throw new Error('BENEFIT_REPAIR_SHOWTIME_NOT_FOUND');
      const missing = await tx.execute<MissingBenefit>(sql`
        WITH latest AS (
          SELECT id FROM ticket_benefit_configurations WHERE showtime_id = ${showtimeId}
          ORDER BY version DESC LIMIT 1
        )
        SELECT ti.id AS ticket_item_id, ti.tier_name, b.identity AS benefit_identity,
          b.configuration_id, b.display_copy
        FROM ticket_items ti
        JOIN reservations r ON r.id = ti.reservation_id AND r.status = 'CONFIRMED'
        JOIN payments p ON p.id = ti.payment_id AND p.status = 'DONE'
        JOIN ticket_benefits b ON b.configuration_id = (SELECT id FROM latest)
          AND b.kind = 'included' AND b.eligible_tier_names ? ti.tier_name
        WHERE ti.showtime_id = ${showtimeId} AND ti.status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM ticket_benefit_entitlements e
            WHERE e.ticket_item_id = ti.id AND e.benefit_identity = b.identity
              AND e.source = 'configuration' AND e.benefit_kind = 'included'
              AND e.state IN ('active', 'redeemed')
          )
        ORDER BY ti.id, b.identity
      `);
      const candidates = missing.rows;
      const hash = createHash('sha256').update(JSON.stringify({ showtimeId, candidates })).digest('hex');
      const items = [...new Map(candidates.map((c) => [c.ticket_item_id,
        { id: c.ticket_item_id, tierName: c.tier_name }])).values()];
      if (apply && apply.expectedHash !== hash) throw new Error('BENEFIT_REPAIR_CANDIDATES_CHANGED');
      let appliedEntitlements = 0;
      let auditLogId: string | null = null;
      if (apply) {
        // Only the candidate tickets are held, so check-in and cancellation of the
        // rest of the showtime keep running while the repair commits.
        await lockCandidateTickets(tx as unknown as DrizzleDB, showtimeId, items.map((item) => item.id));
        const audit = await new AdminAuditService(tx as unknown as DrizzleDB).write({
          actorUserId: apply.operatorUserId,
          action: 'benefits.included_repair.apply',
          resourceType: 'showtime',
          resourceId: showtimeId,
          status: 'success',
          reason: apply.reason.trim(),
          changedFields: ['showtimeId', 'reviewedHash', 'configurationIds', 'benefitIdentities',
            'missingTickets', 'missingEntitlements'],
          before: {},
          after: {
            showtimeId,
            reviewedHash: hash,
            configurationIds: [...new Set(candidates.map((c) => c.configuration_id))],
            benefitIdentities: [...new Set(candidates.map((c) => c.benefit_identity))],
            missingTickets: items.length,
            missingEntitlements: candidates.length,
          },
        }, tx);
        if (!audit.id) throw new Error('BENEFIT_REPAIR_AUDIT_FAILED');
        auditLogId = audit.id;
        for (let offset = 0; offset < candidates.length; offset += REPAIR_CHUNK_SIZE) {
          const inserted = await tx.insert(ticketBenefitEntitlements).values(
            candidates.slice(offset, offset + REPAIR_CHUNK_SIZE).map((c) => ({
              showtimeId, ticketItemId: c.ticket_item_id, benefitIdentity: c.benefit_identity,
              benefitKind: 'included' as const, displayCopySnapshot: c.display_copy,
              source: 'configuration' as const, state: 'active' as const, repairAuditLogId: audit.id,
            })),
          ).returning({ id: ticketBenefitEntitlements.id });
          appliedEntitlements += inserted.length;
        }
        if (appliedEntitlements !== candidates.length) throw new Error('BENEFIT_REPAIR_COUNT_MISMATCH');
      }
      return { mode: apply ? 'apply' : 'dry-run', showtimeId, hash,
        missingTickets: items.length, missingEntitlements: candidates.length,
        appliedEntitlements, auditLogId };
    }, apply ? undefined : { isolationLevel: 'repeatable read', accessMode: 'read only' });
  } catch (error) {
    if (postgresError(error)?.code === '55P03') throw new Error('BENEFIT_REPAIR_LOCK_TIMEOUT');
    const unique = postgresError(error);
    if (unique?.code === '23505' && unique.constraint === INCLUDED_UNIQUE_INDEX) {
      throw new Error('BENEFIT_REPAIR_CANDIDATES_CHANGED');
    }
    throw error;
  }
}

async function assertRepairOperator(db: DrizzleDB, operatorUserId: string): Promise<void> {
  const [operator] = await db.select({
    id: users.id, role: users.role, accountStatus: users.accountStatus,
    adminCapabilityBundle: users.adminCapabilityBundle, adminCapabilities: users.adminCapabilities,
  }).from(users).where(eq(users.id, operatorUserId)).limit(1);
  if (!operator || operator.role !== 'admin' || operator.accountStatus !== 'active') {
    throw new Error('BENEFIT_REPAIR_OPERATOR_NOT_ALLOWED');
  }
  const snapshot = resolveAdminCapabilitySnapshot(operator as AdminCapabilityUser);
  if (!snapshot.superuser && !snapshot.capabilities.includes('benefits.manage')) {
    throw new Error('BENEFIT_REPAIR_OPERATOR_NOT_ALLOWED');
  }
}

/** Re-checks the candidate tickets under FOR SHARE so they cannot be cancelled before commit. */
async function lockCandidateTickets(db: DrizzleDB, showtimeId: string, ticketItemIds: string[]) {
  let locked = 0;
  for (let offset = 0; offset < ticketItemIds.length; offset += REPAIR_CHUNK_SIZE) {
    const chunk = ticketItemIds.slice(offset, offset + REPAIR_CHUNK_SIZE);
    const result = await db.execute(sql`
      SELECT ti.id
      FROM ticket_items ti
      JOIN reservations r ON r.id = ti.reservation_id
      JOIN payments p ON p.id = ti.payment_id
      WHERE ti.showtime_id = ${showtimeId}
        AND ti.id IN ${chunk}
        AND ti.status = 'active' AND r.status = 'CONFIRMED' AND p.status = 'DONE'
      ORDER BY ti.id
      FOR SHARE OF ti, r, p
    `);
    locked += result.rows.length;
  }
  if (locked !== ticketItemIds.length) throw new Error('BENEFIT_REPAIR_CANDIDATES_CHANGED');
}

function postgresError(error: unknown): { code?: unknown; constraint?: unknown } | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof candidate.code === 'string') return candidate;
    current = candidate.cause;
  }
  return undefined;
}
