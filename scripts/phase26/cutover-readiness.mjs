#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';

const DEFAULT_LEDGER = '.planning/phases/26-m1-canary-cutover-gates/26-GATE-LEDGER.json';
const DEFAULT_LEDGER_MD = '.planning/phases/26-m1-canary-cutover-gates/26-GATE-LEDGER.md';
const DEFAULT_EVIDENCE_ROOT = '.planning/phases/26-m1-canary-cutover-gates/evidence';
const DEFAULT_LIVE_CUTOVER_EVIDENCE = `${DEFAULT_EVIDENCE_ROOT}/26-10-live-cutover.json`;
const VALIDATOR = 'scripts/phase26/validate-gate-ledger.mjs';

const REQUIRED_GATE_IDS = [
  'M1_DIRECT_DEPLOY_WATCH',
  'M1_LOCALE_SCOPE',
  'ADMIN_CUTOVER_UI',
  'QR_VISIBILITY',
  'TOSS_TEST_REHEARSAL',
  'TOSS_TEST_SECRET_ROTATION',
  'TOSS_LIVE_KEY_SMOKE',
  'BOOKING_ENABLED_GO_NO_GO',
  'LOAD_10K_BASELINE',
  'LOAD_20K_STRESS',
  'DR_CLOUD_RUN_ROLLBACK',
  'DR_CLOUD_SQL_PITR',
  'DR_VALKEY_RECONNECT',
  'INFRA_POOL_PGBOUNCER',
  'INFRA_HA_REPLICA',
  'WAF_ACTIVE_RULES',
  'ONCALL_PLAYBOOKS',
  'FIRST_24H_WATCH',
  'CLEANUP_ISOLATION',
];

const ALLOWED_STATES = new Set([
  'PASS',
  'FAIL',
  'ACCEPTED_RISK',
  'CONFIG_READY_NOT_DRILLED',
  'BLOCKED',
]);

const EVIDENCE = {
  qrContract: '26-02-qr-contract.json',
  qrVisibility: '26-03-qr-visibility.json',
  tossHardening: '26-04-toss-hardening.json',
  rehearsal: '26-05-rehearsal.json',
  load: '26-06-load.json',
  directDeploy: '26-07-direct-deploy-watch.json',
  drInfra: '26-08-dr-infra.json',
  ops: '26-09-ops-monitoring.json',
  adminApi: '26-11-admin-cutover-api.json',
  liveCutover: '26-10-live-cutover.json',
};

function usage() {
  return `
Usage:
  node scripts/phase26/cutover-readiness.mjs --help
  node scripts/phase26/cutover-readiness.mjs --aggregate-only
  node scripts/phase26/cutover-readiness.mjs --ledger ${DEFAULT_LEDGER} --booking-enabled-check

Options:
  --ledger <path>                 Gate Ledger JSON path. Default: ${DEFAULT_LEDGER}
  --ledger-md <path>              Gate Ledger Markdown path. Default: ${DEFAULT_LEDGER_MD}
  --evidence-root <path>          Evidence directory. Default: ${DEFAULT_EVIDENCE_ROOT}
  --live-cutover-evidence <path>  Evidence file written in booking-enabled mode. Default: ${DEFAULT_LIVE_CUTOVER_EVIDENCE}
  --aggregate-only                Aggregate existing evidence into Gate Ledger, run strict validation, and exit 0.
  --booking-enabled-check         Aggregate evidence, write live-cutover no-go evidence, then run the final BOOKING_ENABLED=true validator.

Cutover rules:
  - PASS requires direct evidence.
  - FAIL and BLOCKED remain no-go.
  - ACCEPTED_RISK and CONFIG_READY_NOT_DRILLED are never promoted to PASS.
  - TOSS_TEST_SECRET_ROTATION may proceed only as PASS or explicit D-24 owner-approved non-PASS.
  - Live booking is not enabled by this script. It only proves whether the runbook may proceed.

Security:
  Evidence and Gate Ledger output are metadata-only. Raw Toss keys, payment keys, QR tokens, cookies, auth headers, OTPs, and PII must never be written.
`;
}

function parseArgs(argv) {
  const args = {
    ledger: DEFAULT_LEDGER,
    ledgerMd: DEFAULT_LEDGER_MD,
    evidenceRoot: DEFAULT_EVIDENCE_ROOT,
    liveCutoverEvidence: DEFAULT_LIVE_CUTOVER_EVIDENCE,
    aggregateOnly: false,
    bookingEnabledCheck: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') {
      args.help = true;
    } else if (token === '--ledger') {
      args.ledger = readValue(argv, ++index, token);
    } else if (token === '--ledger-md') {
      args.ledgerMd = readValue(argv, ++index, token);
    } else if (token === '--evidence-root') {
      args.evidenceRoot = readValue(argv, ++index, token);
    } else if (token === '--live-cutover-evidence') {
      args.liveCutoverEvidence = readValue(argv, ++index, token);
    } else if (token === '--aggregate-only') {
      args.aggregateOnly = true;
    } else if (token === '--booking-enabled-check') {
      args.bookingEnabledCheck = true;
    } else {
      throw new Error(`Unsupported argument: ${token}`);
    }
  }

  if (!args.help && !args.aggregateOnly && !args.bookingEnabledCheck) {
    args.aggregateOnly = true;
  }

  return args;
}

function readValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage().trim());
    return;
  }

  const ledger = await readJson(args.ledger);
  const evidence = await readEvidenceSet(args.evidenceRoot);
  const aggregated = aggregateLedger(ledger, evidence, args);

  await writeJson(args.ledger, aggregated);
  await writeText(args.ledgerMd, renderLedgerMarkdown(aggregated));

  if (args.bookingEnabledCheck) {
    const blockers = readinessBlockers(aggregated);
    await writeJson(
      args.liveCutoverEvidence,
      buildLiveCutoverEvidence(aggregated, blockers),
    );
    const withLiveEvidence = aggregateLedger(
      await readJson(args.ledger),
      await readEvidenceSet(args.evidenceRoot),
      args,
    );
    await writeJson(args.ledger, withLiveEvidence);
    await writeText(args.ledgerMd, renderLedgerMarkdown(withLiveEvidence));
  }

  runValidator(args.ledger, '--strict');

  if (args.bookingEnabledCheck) {
    runValidator(args.ledger, '--booking-enabled-check');
  }

  console.log(`PASS cutover readiness aggregation: ${args.ledger}`);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function readJsonOptional(path) {
  try {
    return await readJson(path);
  } catch {
    return null;
  }
}

async function readEvidenceSet(root) {
  const entries = {};
  for (const [key, filename] of Object.entries(EVIDENCE)) {
    entries[key] = {
      path: `${root}/${filename}`,
      data: await readJsonOptional(`${root}/${filename}`),
    };
  }
  return entries;
}

function aggregateLedger(ledger, evidence) {
  const now = new Date().toISOString();
  const byGate = new Map((ledger.gates ?? []).map((gate) => [gate.gateId, { ...gate }]));

  for (const gateId of REQUIRED_GATE_IDS) {
    if (!byGate.has(gateId)) {
      byGate.set(gateId, missingGate(gateId));
    }
  }

  updateGate(byGate, 'M1_DIRECT_DEPLOY_WATCH', {
    state: evidence.directDeploy.data?.status === 'PASS' ? 'PASS' : 'BLOCKED',
    evidenceRefs: [evidence.directDeploy.path],
    failureReason:
      evidence.directDeploy.data?.status === 'PASS'
        ? 'Direct deploy strict-watch evidence recorded.'
        : 'Direct deploy strict-watch remains unavailable or not run.',
    compensatingMonitoring:
      'Run the 15-minute strict watch over health, auth/session, public detail, booking-disabled behavior, queue entry, payment-safe path, and Cloud Run logs.',
    rollbackOrCloseTrigger:
      'Rollback on health 5xx, login/refresh failure, public detail 5xx, unsafe booking side effects, queue entry 5xx, or unsafe payment confirm behavior.',
  });

  updateGate(byGate, 'M1_LOCALE_SCOPE', {
    state: 'BLOCKED',
    evidenceRefs: ['.planning/phases/26-m1-canary-cutover-gates/26-07-SUMMARY.md'],
    failureReason:
      'Active locale smoke exists, but older five-locale launch wording remains reconciled as non-PASS in Plan 26-07.',
    compensatingMonitoring:
      'Keep locale scope visible during M1 smoke and do not treat the older five-locale wording as PASS evidence.',
    rollbackOrCloseTrigger:
      'Do not mark M1 smoke PASS if an active locale route or switcher path regresses.',
  });

  updateGate(byGate, 'ADMIN_CUTOVER_UI', {
    state: 'BLOCKED',
    evidenceRefs: [
      evidence.adminApi.path,
      '.planning/phases/26-m1-canary-cutover-gates/26-11-SUMMARY.md',
      '.planning/phases/26-m1-canary-cutover-gates/26-12-SUMMARY.md',
    ],
    failureReason:
      'Admin cutover API/UI are implemented, but deployed authenticated admin API smoke and runtime CUTOVER_GATE_LEDGER_PATH evidence are still missing.',
    compensatingMonitoring:
      'Operator can inspect local/read-model semantics, but live enablement waits for deployed admin API smoke against the packaged Gate Ledger artifact.',
    rollbackOrCloseTrigger:
      'Do not proceed to live enablement if the operator cannot inspect current no-go state from the deployed admin surface.',
  });

  updateGate(byGate, 'QR_VISIBILITY', {
    state: evidence.qrVisibility.data?.status === 'PASS' ? 'PASS' : 'BLOCKED',
    evidenceRefs: [evidence.qrVisibility.path, evidence.qrContract.path],
    failureReason:
      evidence.qrVisibility.data?.status === 'PASS'
        ? 'Payment complete page and My Page QR visibility regression evidence recorded.'
        : 'QR visibility evidence is missing or non-PASS.',
    compensatingMonitoring:
      'Verify confirmed paid reservations expose active QR on payment complete and My Page/ticket detail before and after opening.',
    rollbackOrCloseTrigger:
      'Close booking if confirmed payment succeeds but QR issuance or visibility fails.',
  });

  updateGate(byGate, 'TOSS_TEST_REHEARSAL', {
    state: evidence.rehearsal.data?.status === 'PASS' ? 'PASS' : 'BLOCKED',
    evidenceRefs: [evidence.rehearsal.path],
    failureReason:
      evidence.rehearsal.data?.blockedReason ??
      'Toss test-key ticketing rehearsal has not produced PASS evidence.',
    compensatingMonitoring:
      'Keep live booking closed until dedicated test-event rehearsal covers queue, lock, prepare, payment-safe branch, QR, refund/cancel, and cleanup.',
    rollbackOrCloseTrigger:
      'Do not rely on live cutover readiness if test-key rehearsal fails or remains incomplete.',
  });

  preserveTossRotation(byGate, evidence.tossHardening.path, evidence.tossHardening.data);

  updateGate(byGate, 'TOSS_LIVE_KEY_SMOKE', liveKeyGate(evidence.liveCutover.path, evidence.liveCutover.data));
  updateGate(byGate, 'BOOKING_ENABLED_GO_NO_GO', bookingGoNoGoGate(evidence.liveCutover.path, evidence.liveCutover.data));

  for (const check of evidence.load.data?.checks ?? []) {
    if (check?.gateId === 'LOAD_10K_BASELINE' || check?.gateId === 'LOAD_20K_STRESS') {
      updateGate(byGate, check.gateId, {
        state: check.status === 'PASS' ? 'PASS' : 'BLOCKED',
        evidenceRefs: [evidence.load.path],
        failureReason: check.reason ?? 'Load gate did not produce PASS evidence.',
        compensatingMonitoring:
          'Record p95 latency under 2 seconds and error rate under 1 percent, or record explicit owner-approved accepted risk.',
        rollbackOrCloseTrigger:
          'Do not open live booking if load gate fails without owner-approved accepted risk.',
      });
    }
  }

  for (const classification of evidence.drInfra.data?.classifications ?? []) {
    if (!classification?.gateId || !ALLOWED_STATES.has(classification.state)) continue;
    updateGate(byGate, classification.gateId, {
      state: classification.state,
      evidenceRefs: [evidence.drInfra.path],
      failureReason: classification.reason ?? 'DR/infra classification did not produce PASS evidence.',
      compensatingMonitoring: drInfraMonitoring(classification.gateId),
      rollbackOrCloseTrigger: drInfraTrigger(classification.gateId),
    });
  }

  updateGate(byGate, 'WAF_ACTIVE_RULES', {
    state: 'BLOCKED',
    evidenceRefs: [evidence.ops.path],
    failureReason: 'Cloudflare WAF/rate-limit active-rule and smoke evidence remains pending provider evidence.',
    compensatingMonitoring:
      'Record normal-pass smoke and low-volume suspicious challenge/block/rate-limit evidence without impacting real users.',
    rollbackOrCloseTrigger:
      'Close booking or tighten controls on traffic-defense bypass, queue abuse, or booking mutation abuse.',
  });

  updateGate(byGate, 'ONCALL_PLAYBOOKS', {
    state: 'BLOCKED',
    evidenceRefs: [evidence.ops.path, 'docs/runbooks/phase26-cutover-ops.md'],
    failureReason: 'One-person on-call playbook exists, but dry-run/provider evidence remains pending.',
    compensatingMonitoring:
      'Dry-run PG/DB, Valkey, Cloud Run, Cloudflare, Toss/payment failure, queue stuck, oversell-risk, QR, and refund procedures.',
    rollbackOrCloseTrigger:
      'Close booking when financial or seat safety triage cannot be completed quickly.',
  });

  updateGate(byGate, 'FIRST_24H_WATCH', {
    state: 'BLOCKED',
    evidenceRefs: [
      evidence.ops.path,
      '.planning/phases/26-m1-canary-cutover-gates/26-FIRST-24H-WATCH.md',
    ],
    failureReason: 'First-24h watch runbook exists, but live post-open watch handoff has not started.',
    compensatingMonitoring:
      'After opening, run first-2h checks every 5-10 minutes and 24h checks every 30-60 minutes.',
    rollbackOrCloseTrigger:
      'Close booking on duplicate sale, reservation/QR mismatch, payment failure spike, seat mismatch, queue stuck, or refund/cancel buildup.',
  });

  updateGate(byGate, 'CLEANUP_ISOLATION', {
    state: 'BLOCKED',
    evidenceRefs: [evidence.rehearsal.path],
    failureReason:
      evidence.rehearsal.data?.blockedReason ??
      'Dedicated test-event cleanup isolation evidence has not produced PASS evidence.',
    compensatingMonitoring:
      'Cleanup must be constrained by dedicated test IDs, order markers, dry-run counts, and restore-point confirmation.',
    rollbackOrCloseTrigger:
      'Stop cleanup if dry-run returns unexpected rows or real production records.',
  });

  return {
    ...ledger,
    generatedAt: now,
    lastAggregatedAt: now,
    requiredGateIds: REQUIRED_GATE_IDS,
    gates: REQUIRED_GATE_IDS.map((gateId) => byGate.get(gateId)),
  };
}

function updateGate(byGate, gateId, patch) {
  const existing = byGate.get(gateId) ?? missingGate(gateId);
  const state = patch.state ?? existing.state;
  const { replaceEvidenceRefs = false, ...rowPatch } = patch;
  const { replaceEvidenceRefs: _unused, ...existingRow } = existing;
  if (!ALLOWED_STATES.has(state)) {
    throw new Error(`${gateId}: invalid state ${state}`);
  }

  const approval = state === 'PASS'
    ? { approvalState: 'not_requested', approver: null, approvalTimestamp: null }
    : {
        approvalState: existing.approvalState ?? 'not_requested',
        approver: existing.approver ?? null,
        approvalTimestamp: existing.approvalTimestamp ?? null,
      };

  byGate.set(gateId, {
    ...existingRow,
    ...rowPatch,
    ...approval,
    state,
    evidenceRefs: replaceEvidenceRefs
      ? (rowPatch.evidenceRefs ?? [])
      : mergeRefs(existing.evidenceRefs, rowPatch.evidenceRefs),
  });
}

function preserveTossRotation(byGate, evidenceRef, evidence) {
  const existing = byGate.get('TOSS_TEST_SECRET_ROTATION') ?? missingGate('TOSS_TEST_SECRET_ROTATION');
  const gate = evidence?.secretRotationGate;
  if (!gate) {
    updateGate(byGate, 'TOSS_TEST_SECRET_ROTATION', {
      state: existing.state,
      evidenceRefs: [evidenceRef],
      failureReason: existing.failureReason,
    });
    return;
  }

  byGate.set('TOSS_TEST_SECRET_ROTATION', {
    ...existing,
    state: gate.state,
    evidenceRefs: mergeRefs(existing.evidenceRefs, [evidenceRef]),
    failureReason:
      gate.riskRationale ??
      'TOSS_TEST_SECRET_ROTATION is preserved as owner-approved non-PASS D-24 risk.',
    approvalState: gate.ownerApproval?.approvalState ?? existing.approvalState,
    approver: gate.ownerApproval?.approver ?? existing.approver,
    approvalTimestamp: gate.ownerApproval?.approvalTimestamp ?? existing.approvalTimestamp,
    compensatingMonitoring: gate.compensatingMonitoring ?? existing.compensatingMonitoring,
    rollbackOrCloseTrigger: gate.rollbackOrCloseTrigger ?? existing.rollbackOrCloseTrigger,
    redactionNotes: gate.redactionNotes ?? existing.redactionNotes,
  });
}

function liveKeyGate(evidenceRef, evidence) {
  if (!evidence) {
    return {
      state: 'BLOCKED',
      replaceEvidenceRefs: true,
      evidenceRefs: [],
      failureReason: 'Toss live-key smoke has not run because live keys/review availability were not confirmed.',
      compensatingMonitoring:
        'Inject live keys with BOOKING_ENABLED=false, then verify prefix/class, server-only secret handling, widget init, confirm/query/cancel, webhook re-query, and leakage scan.',
      rollbackOrCloseTrigger:
        'Do not enable booking if live key smoke is unavailable or any live payment-safe check fails.',
    };
  }

  return {
    state: evidence.liveKeySmoke?.status === 'PASS' ? 'PASS' : 'BLOCKED',
    evidenceRefs: [evidenceRef],
    failureReason:
      evidence.liveKeySmoke?.reason ??
      'Toss live-key smoke did not produce PASS evidence.',
    compensatingMonitoring:
      'Keep BOOKING_ENABLED=false until live-key smoke passes and Gate Ledger approval is recorded.',
    rollbackOrCloseTrigger:
      'Do not enable booking if live key prefix, server-only handling, widget init, confirm/query/cancel, webhook re-query, or leakage scan fails.',
  };
}

function bookingGoNoGoGate(evidenceRef, evidence) {
  if (!evidence) {
    return {
      state: 'BLOCKED',
      replaceEvidenceRefs: true,
      evidenceRefs: [],
      failureReason: 'Final booking-enabled readiness check has not run.',
      compensatingMonitoring:
        'Run cutover-readiness and preserve every non-PASS gate before any BOOKING_ENABLED=true change.',
      rollbackOrCloseTrigger: 'Close booking immediately on financial or seat safety criteria.',
    };
  }

  return {
    state: evidence.status === 'PASS' ? 'PASS' : 'BLOCKED',
    evidenceRefs: [evidenceRef],
    failureReason:
      evidence.blockedReason ??
      'BOOKING_ENABLED=true was not applied because final readiness did not pass.',
    compensatingMonitoring:
      'Keep booking closed until readiness passes and the owner approves the runbook go decision.',
    rollbackOrCloseTrigger: 'Close booking immediately on financial or seat safety criteria.',
  };
}

function readinessBlockers(ledger) {
  const blockers = [];
  for (const gate of ledger.gates ?? []) {
    if (gate.state === 'PASS') {
      if (!Array.isArray(gate.evidenceRefs) || gate.evidenceRefs.length === 0) {
        blockers.push(`${gate.gateId}: PASS requires evidenceRefs`);
      }
      continue;
    }

    if (gate.state === 'FAIL' || gate.state === 'BLOCKED') {
      blockers.push(`${gate.gateId}: ${gate.state} is no-go`);
      continue;
    }

    if (gate.state === 'ACCEPTED_RISK' || gate.state === 'CONFIG_READY_NOT_DRILLED') {
      if (!Array.isArray(gate.evidenceRefs) || gate.evidenceRefs.length === 0) {
        blockers.push(`${gate.gateId}: ${gate.state} requires evidenceRefs`);
      }
      if (!isApprovedNonPass(gate)) {
        blockers.push(`${gate.gateId}: ${gate.state} requires owner approval, monitoring, and rollback/close trigger`);
      }
    }
  }

  const rotation = (ledger.gates ?? []).find((gate) => gate.gateId === 'TOSS_TEST_SECRET_ROTATION');
  if (!rotation) {
    blockers.push('TOSS_TEST_SECRET_ROTATION: missing required D-24 gate');
  } else if (rotation.state === 'BLOCKED' || rotation.state === 'FAIL') {
    blockers.push(`TOSS_TEST_SECRET_ROTATION: ${rotation.state} is not allowed for final readiness`);
  } else if (rotation.state !== 'PASS' && !isApprovedNonPass(rotation)) {
    blockers.push('TOSS_TEST_SECRET_ROTATION: non-PASS state lacks explicit D-24 owner approval');
  }

  return [...new Set(blockers)];
}

function isApprovedNonPass(gate) {
  return gate.approvalState === 'approved'
    && typeof gate.approver === 'string'
    && gate.approver.trim()
    && typeof gate.approvalTimestamp === 'string'
    && gate.approvalTimestamp.trim()
    && typeof gate.failureReason === 'string'
    && gate.failureReason.trim()
    && typeof gate.compensatingMonitoring === 'string'
    && gate.compensatingMonitoring.trim()
    && typeof gate.rollbackOrCloseTrigger === 'string'
    && gate.rollbackOrCloseTrigger.trim();
}

function buildLiveCutoverEvidence(ledger, blockers) {
  const now = new Date().toISOString();
  const rotation = ledger.gates.find((gate) => gate.gateId === 'TOSS_TEST_SECRET_ROTATION');
  const status = blockers.length === 0 ? 'PASS' : 'BLOCKED';

  return {
    schemaVersion: 'phase26.live-cutover.v1',
    phase: '26',
    plan: '26-10',
    generatedAt: now,
    status,
    bookingEnabledApplied: false,
    blockedReason:
      status === 'PASS'
        ? null
        : 'Live-key smoke and/or required Gate Ledger rows are not ready; BOOKING_ENABLED=true was not applied.',
    commands: [
      {
        command: `node scripts/phase26/cutover-readiness.mjs --ledger ${DEFAULT_LEDGER} --booking-enabled-check`,
        expectedUntilGo: 'non-zero no-go while required gates remain BLOCKED, FAIL, missing evidence, or unapproved non-PASS',
      },
    ],
    tossTestSecretRotation: rotation
      ? {
          state: rotation.state,
          approvalState: rotation.approvalState,
          approver: rotation.approver,
          approvalTimestamp: rotation.approvalTimestamp,
          preservedAsPass: false,
          note: 'D-24 accepted risk remains non-PASS unless the provider key is actually rotated/reissued and rebound.',
        }
      : {
          state: 'MISSING',
          approvalState: 'missing',
          preservedAsPass: false,
        },
    liveKeySmoke: {
      status: 'BLOCKED',
      reason:
        'Owner did not confirm Toss review completion or live-key availability in this executor context. No live key prefix/class, server confirm/query/cancel, webhook, or widget smoke was run.',
      bookingEnabledDuringSmoke: false,
      rawKeysRecorded: false,
    },
    bookingEnabledGoNoGo: {
      status,
      ownerApprovalRecorded: false,
      mutationApplied: false,
      reason:
        status === 'PASS'
          ? 'Readiness produced no blockers; operator approval is still required before mutation.'
          : 'Readiness blockers remain; live booking stays closed.',
    },
    blockers,
    nextOperatorActions: [
      'Complete Toss review and make live keys available through Secret Manager/GitHub/Cloud Run without writing raw key values into artifacts.',
      'Run live-key smoke with BOOKING_ENABLED=false: key prefix/class, server-only secret handling, widget init, confirm/query/cancel where safely allowed, webhook re-query, and leakage scan.',
      'Run cutover-readiness again and require zero blockers before any BOOKING_ENABLED=true mutation.',
      'After owner go approval, enable BOOKING_ENABLED=true through the approved Cloud Run/Secret Manager path and start direct-deploy plus first-2h/24h watch handoff.',
    ],
    redaction: {
      rawTossKeys: false,
      paymentKeys: false,
      qrTokens: false,
      cookies: false,
      authHeaders: false,
      pii: false,
      notes:
        'This evidence records only gate states, command shapes, and operator next actions. It contains no raw payment credentials or user data.',
    },
  };
}

function renderLedgerMarkdown(ledger) {
  const rows = ledger.gates ?? [];
  const accepted = rows.filter((gate) => gate.state === 'ACCEPTED_RISK');
  const config = rows.filter((gate) => gate.state === 'CONFIG_READY_NOT_DRILLED');
  const blockers = readinessBlockers(ledger);

  return `# Phase 26 Gate Ledger

This ledger is the cutover source of truth for Phase 26. \`BOOKING_ENABLED=true\`
is no-go until every required gate is \`PASS\` or explicitly owner-approved as
\`ACCEPTED_RISK\` or \`CONFIG_READY_NOT_DRILLED\`.

Empty, missing, failed, blocked, unreviewed, or malformed rows are no-go.
\`ACCEPTED_RISK\` and \`CONFIG_READY_NOT_DRILLED\` are never \`PASS\`.

Cloud Run traffic-split canary is not used as Phase 26 PASS evidence. Phase 26
uses CI/CD green, 100% direct deploy, and a 15-minute strict watch.

Evidence must be redacted. Do not store raw Toss keys, payment keys, QR tokens,
cookies, OTP values, raw customer rows, or unmasked PII in this ledger.

## Current Gate Rows

| Gate ID | Requirements | State | Approval | Evidence | No-Go / Caveat |
| --- | --- | --- | --- | --- | --- |
${rows.map((gate) => `| \`${gate.gateId}\` | ${(gate.requirementIds ?? []).join(', ') || '-'} | ${gate.state} | ${gate.approvalState}${gate.approver ? ` / ${gate.approver}` : ''} | ${(gate.evidenceRefs ?? []).length} | ${escapeMd(gate.failureReason ?? '')} |`).join('\n')}

## Final Readiness

${blockers.length === 0 ? '- No readiness blockers from the current Gate Ledger.' : blockers.map((blocker) => `- ${escapeMd(blocker)}`).join('\n')}

## Accepted-Risk Entries

${accepted.length === 0 ? 'None.' : accepted.map((gate) => `- \`${gate.gateId}\` remains \`ACCEPTED_RISK\` with approval \`${gate.approvalState}\` by \`${gate.approver ?? 'unknown'}\`. Evidence: ${(gate.evidenceRefs ?? []).join(', ') || 'missing'}.`).join('\n')}

## Config-Ready-Not-Drilled Entries

${config.length === 0 ? 'None.' : config.map((gate) => `- \`${gate.gateId}\` remains \`CONFIG_READY_NOT_DRILLED\`; this is non-PASS and requires owner approval before it can stop blocking. Evidence: ${(gate.evidenceRefs ?? []).join(', ') || 'missing'}.`).join('\n')}

## Operator Rules

- \`PASS\` requires direct evidence.
- \`FAIL\` and \`BLOCKED\` are no-go.
- Empty evidence is no-go.
- \`ACCEPTED_RISK\` requires owner approval, failed gate, compensating monitoring, and rollback or close-booking trigger.
- \`CONFIG_READY_NOT_DRILLED\` requires owner approval and remains non-PASS.
- Real Girl Rules event data, real users, real payments, real tickets, real sessions, and real seat state are protected from rehearsal cleanup.
`;
}

function runValidator(ledger, mode) {
  const result = spawnSync(process.execPath, [VALIDATOR, '--ledger', ledger, mode], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 10,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function missingGate(gateId) {
  return {
    gateId,
    requirementIds: [],
    state: 'BLOCKED',
    environment: 'unknown',
    evidenceRefs: [],
    failureReason: `Missing required gate row for ${gateId}.`,
    approvalState: 'not_requested',
    approver: null,
    approvalTimestamp: null,
    compensatingMonitoring: 'Missing gate rows are no-go.',
    rollbackOrCloseTrigger: 'Do not enable booking until every required gate row exists.',
    sourceDecisions: ['D-01', 'D-02', 'D-03', 'D-04'],
    redactionNotes: 'Synthesized by cutover-readiness; no raw evidence payload included.',
  };
}

function mergeRefs(existing = [], next = []) {
  return [...new Set([...(existing ?? []), ...(next ?? [])].filter(Boolean))];
}

function drInfraMonitoring(gateId) {
  if (gateId === 'DR_CLOUD_RUN_ROLLBACK') return 'Keep direct-deploy rollback command shape ready and execute strict watch before cutover.';
  if (gateId === 'DR_CLOUD_SQL_PITR') return 'Use owner-approved safe restore target or preserve accepted risk with clear rollback trigger.';
  if (gateId === 'DR_VALKEY_RECONNECT') return 'Run Valkey health/reconnect smoke and watch queue/seat-lock impact.';
  return 'Monitor DB capacity, pool saturation, and booking/payment/seat safety signals.';
}

function drInfraTrigger(gateId) {
  if (gateId === 'DR_CLOUD_SQL_PITR') return 'Do not execute destructive cleanup without backup/restore-point confirmation.';
  if (gateId === 'DR_VALKEY_RECONNECT') return 'Close booking if queue, lock, or seat safety signals fail after Valkey disruption.';
  return 'Close booking or rollback if the infra gate affects live booking safety.';
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value);
}

function escapeMd(value) {
  return String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

main().catch((error) => {
  console.error(`FAIL cutover readiness: ${error.message}`);
  process.exit(1);
});
