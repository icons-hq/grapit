import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';

const LEDGER_ENV = 'CUTOVER_GATE_LEDGER_PATH';
const LEDGER_MAX_AGE_DAYS_ENV = 'CUTOVER_GATE_LEDGER_MAX_AGE_DAYS';
const DEFAULT_LEDGER_MAX_AGE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
// Tolerates small clock skew between the ledger author and the API.
const FUTURE_SKEW_MS = 60 * 60 * 1000;
export const LEDGER_FRESHNESS_GATE_ID = 'CUTOVER_GATE_LEDGER_FRESHNESS';
export const LEDGER_OPENING_SCOPE_GATE_ID = 'CUTOVER_GATE_LEDGER_OPENING_SCOPE';
const LOCAL_LEDGER_RELATIVE_PATH =
  '.planning/phases/26-m1-canary-cutover-gates/26-GATE-LEDGER.json';
const SENSITIVE_TEXT_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\b(?:test|live)_sk_[A-Za-z0-9_-]+/gi, '<toss-secret:redacted>'],
  [/\b(?:test|live)_ck_[A-Za-z0-9_-]+/gi, '<toss-client:redacted>'],
  [/\b(?:pay|tgen)_[A-Za-z0-9_-]{8,}\b/gi, '<toss-payment-key:redacted>'],
  [
    /\bpaymentKey\s*[:=]\s*["']?[A-Za-z0-9_-]{8,}/gi,
    'paymentKey=<redacted>',
  ],
  [
    /\bqr(?:Token|_token)?\s*[:=]\s*["']?[A-Za-z0-9_-]{16,}/gi,
    'qrToken=<redacted>',
  ],
  [
    /\bAuthorization:\s*Bearer\s+[A-Za-z0-9._-]{16,}/gi,
    'Authorization: Bearer <redacted>',
  ],
  [/\bCookie:\s*[^\n\r]+/gi, 'Cookie: <redacted>'],
  [
    /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g,
    '<jwt:redacted>',
  ],
];

export const CUTOVER_GATE_STATES = [
  'PASS',
  'FAIL',
  'ACCEPTED_RISK',
  'CONFIG_READY_NOT_DRILLED',
  'BLOCKED',
] as const;

export type CutoverGateState = (typeof CUTOVER_GATE_STATES)[number];

type ApprovalState =
  | 'not_requested'
  | 'requested'
  | 'approved'
  | 'rejected'
  | string;

export interface AdminCutoverGateRow {
  gateId: string;
  requirementIds: string[];
  state: CutoverGateState;
  environment: string | null;
  evidenceRefs: string[];
  evidenceMissing: boolean;
  failureReason: string | null;
  approvalState: ApprovalState;
  approver: string | null;
  approvalTimestamp: string | null;
  compensatingMonitoring: string | null;
  rollbackOrCloseTrigger: string | null;
  sourceDecisions: string[];
  redactionNotes: string | null;
  blocking: boolean;
  blockingReason: string | null;
}

export interface AdminCutoverLedgerFreshness {
  state: 'fresh' | 'stale' | 'unknown';
  ageDays: number | null;
  maxAgeDays: number;
  reason: string | null;
}

/** The ticket opening a ledger was prepared for. */
export interface AdminCutoverOpeningScope {
  id: string;
  label: string | null;
  performanceIds: string[];
  opensAt: string | null;
}

export interface AdminCutoverGateSummary {
  generatedAt: string;
  ledgerGeneratedAt: string | null;
  freshness: AdminCutoverLedgerFreshness;
  opening: AdminCutoverOpeningScope | null;
  source: {
    state: 'loaded' | 'blocked';
    runtimeArtifactRequired: boolean;
    reason: string | null;
  };
  rows: AdminCutoverGateRow[];
  countsByState: Record<CutoverGateState, number>;
  missingEvidenceCount: number;
  firstBlockingGate: AdminCutoverGateRow | null;
  finalEnableAllowed: boolean;
  redactionNotes: string[];
}

type GateLedgerDocument = {
  generatedAt?: unknown;
  opening?: unknown;
  cutoverPolicy?: {
    secretPolicy?: unknown;
  };
  requiredGateIds?: unknown;
  gates?: unknown;
};

@Injectable()
export class AdminCutoverService {
  async getGateSummary(): Promise<AdminCutoverGateSummary> {
    const ledgerPath = await this.resolveLedgerPath();
    if (!ledgerPath) {
      return noGoSummary('runtime_artifact_missing');
    }

    try {
      const raw = await readFile(ledgerPath, 'utf8');
      const parsed = JSON.parse(raw) as GateLedgerDocument;
      return normalizeLedger(parsed);
    } catch {
      return noGoSummary('runtime_artifact_unreadable');
    }
  }

  private async resolveLedgerPath(): Promise<string | null> {
    const configured = process.env[LEDGER_ENV]?.trim();
    if (configured) {
      return configured;
    }

    if (process.env.NODE_ENV === 'production') {
      return null;
    }

    for (const candidate of localLedgerCandidates()) {
      try {
        await access(candidate, constants.R_OK);
        return candidate;
      } catch {
        // Try the next local development cwd shape.
      }
    }

    return null;
  }
}

function normalizeLedger(ledger: GateLedgerDocument): AdminCutoverGateSummary {
  if (!Array.isArray(ledger.gates)) {
    return noGoSummary('runtime_artifact_invalid');
  }

  const rawRows = ledger.gates
    .map((gate) => normalizeGate(gate))
    .filter((row): row is AdminCutoverGateRow => Boolean(row));
  const requiredGateIds = safeStringArray(ledger.requiredGateIds);
  const knownGateIds = new Set(rawRows.map((row) => row.gateId));
  const missingRows = requiredGateIds
    .filter((gateId) => !knownGateIds.has(gateId))
    .map((gateId) => missingRequiredGate(gateId));

  const ledgerGeneratedAt =
    typeof ledger.generatedAt === 'string' ? ledger.generatedAt : null;
  const freshness = evaluateFreshness(ledgerGeneratedAt);
  const opening = normalizeOpening(ledger.opening);
  // A ledger only authorises the opening it names, and only while its evidence
  // is recent. Old or unscoped records stay visible but can never be green.
  const ledgerRows = [
    freshness.state === 'fresh' ? null : ledgerFreshnessGate(freshness),
    opening ? null : ledgerOpeningScopeGate(),
  ].filter((row): row is AdminCutoverGateRow => Boolean(row));

  const rows = [...rawRows, ...missingRows, ...ledgerRows].sort(compareGateRows);
  const firstBlockingGate = rows.find((row) => row.blocking) ?? null;

  return {
    generatedAt: new Date().toISOString(),
    ledgerGeneratedAt,
    freshness,
    opening,
    source: {
      state: 'loaded',
      runtimeArtifactRequired: process.env.NODE_ENV === 'production',
      reason: null,
    },
    rows,
    countsByState: countStates(rows),
    missingEvidenceCount: rows.filter((row) => row.evidenceMissing).length,
    firstBlockingGate,
    finalEnableAllowed: rawRows.length + missingRows.length > 0 && !firstBlockingGate,
    redactionNotes: [
      'Only Gate Ledger metadata and evidenceRefs are exposed by this API.',
      safeStringOrNull(ledger.cutoverPolicy?.secretPolicy) ??
        'Evidence must be redacted before it is linked from the Gate Ledger.',
    ],
  };
}

function ledgerMaxAgeDays(): number {
  const raw = process.env[LEDGER_MAX_AGE_DAYS_ENV]?.trim();
  if (!raw || !/^\d+$/.test(raw) || Number(raw) <= 0) {
    return DEFAULT_LEDGER_MAX_AGE_DAYS;
  }
  return Number(raw);
}

function evaluateFreshness(ledgerGeneratedAt: string | null): AdminCutoverLedgerFreshness {
  const maxAgeDays = ledgerMaxAgeDays();
  const generatedAtMs = ledgerGeneratedAt ? Date.parse(ledgerGeneratedAt) : Number.NaN;
  if (!Number.isFinite(generatedAtMs)) {
    return {
      state: 'unknown',
      ageDays: null,
      maxAgeDays,
      reason: 'Gate Ledger generatedAt is missing or invalid; evidence age cannot be verified.',
    };
  }

  const ageMs = Date.now() - generatedAtMs;
  if (ageMs < -FUTURE_SKEW_MS) {
    return {
      state: 'unknown',
      ageDays: null,
      maxAgeDays,
      reason: 'Gate Ledger generatedAt is in the future; evidence age cannot be verified.',
    };
  }

  const ageDays = Math.max(0, Math.floor(ageMs / DAY_MS));
  if (ageMs > maxAgeDays * DAY_MS) {
    return {
      state: 'stale',
      ageDays,
      maxAgeDays,
      reason: `Gate Ledger evidence is ${ageDays} days old (limit ${maxAgeDays} days); regenerate it for this opening.`,
    };
  }

  return { state: 'fresh', ageDays, maxAgeDays, reason: null };
}

function normalizeOpening(value: unknown): AdminCutoverOpeningScope | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = safeStringOrNull(value.id);
  if (!id) {
    return null;
  }
  const opensAt = safeStringOrNull(value.opensAt);
  return {
    id,
    label: safeStringOrNull(value.label),
    performanceIds: safeStringArray(value.performanceIds),
    opensAt: opensAt && Number.isFinite(Date.parse(opensAt)) ? opensAt : null,
  };
}

function ledgerFreshnessGate(freshness: AdminCutoverLedgerFreshness): AdminCutoverGateRow {
  const reason = freshness.reason ?? 'Gate Ledger evidence age cannot be verified.';
  return synthesizedLedgerGate(LEDGER_FRESHNESS_GATE_ID, reason, {
    compensatingMonitoring:
      'Regenerate the Gate Ledger from evidence collected for this opening and redeploy or remount it.',
    rollbackOrCloseTrigger:
      'Keep BOOKING_ENABLED=false or record an explicit owner approval outside this ledger.',
  });
}

function ledgerOpeningScopeGate(): AdminCutoverGateRow {
  return synthesizedLedgerGate(
    LEDGER_OPENING_SCOPE_GATE_ID,
    'Gate Ledger does not name the opening (opening.id) it was prepared for.',
    {
      compensatingMonitoring:
        'Add opening.id, label, performanceIds and opensAt to the Gate Ledger for this opening.',
      rollbackOrCloseTrigger:
        'Do not treat an unscoped ledger as go/no-go evidence for a new opening.',
    },
  );
}

function synthesizedLedgerGate(
  gateId: string,
  reason: string,
  {
    compensatingMonitoring,
    rollbackOrCloseTrigger,
  }: { compensatingMonitoring: string; rollbackOrCloseTrigger: string },
): AdminCutoverGateRow {
  return {
    gateId,
    requirementIds: ['M1-01', 'OPS-01'],
    state: 'BLOCKED',
    environment: process.env.NODE_ENV === 'production' ? 'production' : 'local',
    evidenceRefs: [],
    evidenceMissing: true,
    failureReason: reason,
    approvalState: 'not_requested',
    approver: null,
    approvalTimestamp: null,
    compensatingMonitoring,
    rollbackOrCloseTrigger,
    sourceDecisions: [],
    redactionNotes: 'Synthesized by AdminCutoverService; no raw artifact data exposed.',
    blocking: true,
    blockingReason: reason,
  };
}

function normalizeGate(gate: unknown): AdminCutoverGateRow | null {
  if (!isRecord(gate)) {
    return null;
  }

  const gateId = stringOrNull(gate.gateId);
  const state = toGateState(gate.state);
  if (!gateId || !state) {
    return null;
  }

  const evidenceRefs = safeStringArray(gate.evidenceRefs);
  const approvalState = safeStringOrNull(gate.approvalState) ?? 'not_requested';
  const row: Omit<AdminCutoverGateRow, 'blocking' | 'blockingReason'> = {
    gateId: redactSensitiveText(gateId),
    requirementIds: safeStringArray(gate.requirementIds),
    state,
    environment: safeStringOrNull(gate.environment),
    evidenceRefs,
    evidenceMissing: evidenceRefs.length === 0,
    failureReason: safeStringOrNull(gate.failureReason),
    approvalState,
    approver: safeStringOrNull(gate.approver),
    approvalTimestamp: safeStringOrNull(gate.approvalTimestamp),
    compensatingMonitoring: safeStringOrNull(gate.compensatingMonitoring),
    rollbackOrCloseTrigger: safeStringOrNull(gate.rollbackOrCloseTrigger),
    sourceDecisions: safeStringArray(gate.sourceDecisions),
    redactionNotes: safeStringOrNull(gate.redactionNotes),
  };
  const blockingReason = getBlockingReason(row);

  return {
    ...row,
    blocking: blockingReason !== null,
    blockingReason,
  };
}

function getBlockingReason(
  row: Omit<AdminCutoverGateRow, 'blocking' | 'blockingReason'>,
): string | null {
  if (row.state === 'BLOCKED') {
    return row.failureReason ?? 'Gate Ledger row is BLOCKED.';
  }

  if (row.state === 'FAIL') {
    return row.failureReason ?? 'Gate Ledger row is FAIL.';
  }

  if (row.evidenceMissing) {
    return '증거가 비어 있어 no-go입니다';
  }

  if (row.state === 'PASS') {
    return null;
  }

  if (!hasApprovedNonPass(row)) {
    return `${row.state} requires owner approval, monitoring, and rollback/close trigger.`;
  }

  return null;
}

function hasApprovedNonPass(
  row: Omit<AdminCutoverGateRow, 'blocking' | 'blockingReason'>,
): boolean {
  return Boolean(
    row.approvalState === 'approved' &&
      row.approver &&
      row.approvalTimestamp &&
      row.compensatingMonitoring &&
      row.rollbackOrCloseTrigger,
  );
}

function missingRequiredGate(gateId: string): AdminCutoverGateRow {
  return {
    gateId,
    requirementIds: [],
    state: 'BLOCKED',
    environment: null,
    evidenceRefs: [],
    evidenceMissing: true,
    failureReason: `Missing required gate row for required gate ${gateId}.`,
    approvalState: 'not_requested',
    approver: null,
    approvalTimestamp: null,
    compensatingMonitoring: null,
    rollbackOrCloseTrigger: null,
    sourceDecisions: [],
    redactionNotes: 'Synthesized by AdminCutoverService; no raw artifact data exposed.',
    blocking: true,
    blockingReason: `Missing required gate row for required gate ${gateId}.`,
  };
}

function noGoSummary(reason: string): AdminCutoverGateSummary {
  const row: AdminCutoverGateRow = {
    gateId: 'CUTOVER_GATE_LEDGER_RUNTIME_ARTIFACT',
    requirementIds: ['M1-01', 'OPS-01', 'OPS-02'],
    state: 'BLOCKED',
    environment: process.env.NODE_ENV === 'production' ? 'production' : 'local',
    evidenceRefs: [],
    evidenceMissing: true,
    failureReason: 'Gate Ledger runtime artifact is unavailable or invalid.',
    approvalState: 'not_requested',
    approver: null,
    approvalTimestamp: null,
    compensatingMonitoring:
      'Confirm CUTOVER_GATE_LEDGER_PATH points at the packaged read-only Gate Ledger artifact.',
    rollbackOrCloseTrigger:
      'Do not enable BOOKING_ENABLED=true until the Gate Ledger artifact can be read.',
    sourceDecisions: ['D-01', 'D-02', 'D-03', 'D-04'],
    redactionNotes: 'No runtime path or raw parse error is exposed to clients.',
    blocking: true,
    blockingReason: 'Gate Ledger artifact is unavailable; live ticketing is no-go.',
  };

  return {
    generatedAt: new Date().toISOString(),
    ledgerGeneratedAt: null,
    freshness: {
      state: 'unknown',
      ageDays: null,
      maxAgeDays: ledgerMaxAgeDays(),
      reason: 'Gate Ledger runtime artifact is unavailable.',
    },
    opening: null,
    source: {
      state: 'blocked',
      runtimeArtifactRequired: process.env.NODE_ENV === 'production',
      reason,
    },
    rows: [row],
    countsByState: countStates([row]),
    missingEvidenceCount: 1,
    firstBlockingGate: row,
    finalEnableAllowed: false,
    redactionNotes: [
      'Runtime artifact errors are intentionally sanitized.',
      'No filesystem path, secret value, payment key, cookie, QR token, OTP, or PII is exposed.',
    ],
  };
}

function countStates(rows: AdminCutoverGateRow[]): Record<CutoverGateState, number> {
  return CUTOVER_GATE_STATES.reduce(
    (counts, state) => {
      counts[state] = rows.filter((row) => row.state === state).length;
      return counts;
    },
    {} as Record<CutoverGateState, number>,
  );
}

function compareGateRows(a: AdminCutoverGateRow, b: AdminCutoverGateRow): number {
  const rankDelta = blockerRank(a) - blockerRank(b);
  if (rankDelta !== 0) return rankDelta;
  return a.gateId.localeCompare(b.gateId);
}

function blockerRank(row: AdminCutoverGateRow): number {
  // Ledger-level problems invalidate every row, so they are reviewed first.
  if (row.gateId === LEDGER_FRESHNESS_GATE_ID) return -2;
  if (row.gateId === LEDGER_OPENING_SCOPE_GATE_ID) return -1;
  if (row.state === 'BLOCKED') return 0;
  if (row.state === 'FAIL') return 1;
  if (row.evidenceMissing) return 2;
  if (row.blocking) return 3;
  if (row.state === 'ACCEPTED_RISK') return 4;
  if (row.state === 'CONFIG_READY_NOT_DRILLED') return 5;
  return 6;
}

function toGateState(value: unknown): CutoverGateState | null {
  return typeof value === 'string' &&
    (CUTOVER_GATE_STATES as readonly string[]).includes(value)
    ? (value as CutoverGateState)
    : null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
}

function safeStringArray(value: unknown): string[] {
  return toStringArray(value).map(redactSensitiveText);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeStringOrNull(value: unknown): string | null {
  const text = stringOrNull(value);
  return text ? redactSensitiveText(text) : null;
}

function redactSensitiveText(value: string): string {
  return SENSITIVE_TEXT_REPLACEMENTS.reduce(
    (redacted, [pattern, replacement]) => redacted.replace(pattern, replacement),
    value,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function localLedgerCandidates(): string[] {
  return [
    resolve(process.cwd(), LOCAL_LEDGER_RELATIVE_PATH),
    resolve(process.cwd(), '..', LOCAL_LEDGER_RELATIVE_PATH),
    resolve(process.cwd(), '..', '..', LOCAL_LEDGER_RELATIVE_PATH),
    join('/app', 'phase26', '26-GATE-LEDGER.json'),
  ];
}
