import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AdminCutoverService } from './admin-cutover.service.js';

const ORIGINAL_ENV = { ...process.env };

describe('AdminCutoverService', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'grabit-cutover-ledger-'));
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'test' };
    delete process.env.CUTOVER_GATE_LEDGER_PATH;
  });

  afterEach(async () => {
    process.env = { ...ORIGINAL_ENV };
    await rm(tmpRoot, { force: true, recursive: true });
  });

  it('returns blocker-first rows, state counts, firstBlockingGate, and finalEnableAllowed=false for no-go rows', async () => {
    const ledgerPath = await writeLedger({
      requiredGateIds: [
        'PASS_GATE',
        'PASS_WITHOUT_EVIDENCE',
        'UNAPPROVED_ACCEPTED_RISK',
        'UNAPPROVED_CONFIG_READY',
        'FAIL_GATE',
        'BLOCKED_GATE',
      ],
      gates: [
        gate({ gateId: 'PASS_GATE', state: 'PASS', evidenceRefs: ['evidence/pass.json'] }),
        gate({ gateId: 'PASS_WITHOUT_EVIDENCE', state: 'PASS', evidenceRefs: [] }),
        gate({
          gateId: 'UNAPPROVED_ACCEPTED_RISK',
          state: 'ACCEPTED_RISK',
          evidenceRefs: ['evidence/risk.json'],
          approvalState: 'not_requested',
        }),
        gate({
          gateId: 'UNAPPROVED_CONFIG_READY',
          state: 'CONFIG_READY_NOT_DRILLED',
          evidenceRefs: ['evidence/config.json'],
          approvalState: 'not_requested',
        }),
        gate({ gateId: 'FAIL_GATE', state: 'FAIL', evidenceRefs: ['evidence/fail.json'] }),
        gate({ gateId: 'BLOCKED_GATE', state: 'BLOCKED', evidenceRefs: ['evidence/blocked.json'] }),
      ],
    });
    process.env.CUTOVER_GATE_LEDGER_PATH = ledgerPath;

    const summary = await new AdminCutoverService().getGateSummary();

    expect(summary.finalEnableAllowed).toBe(false);
    expect(summary.firstBlockingGate?.gateId).toBe('BLOCKED_GATE');
    expect(summary.rows.map((row) => row.gateId).slice(0, 4)).toEqual([
      'BLOCKED_GATE',
      'FAIL_GATE',
      'PASS_WITHOUT_EVIDENCE',
      'UNAPPROVED_ACCEPTED_RISK',
    ]);
    expect(summary.countsByState).toMatchObject({
      PASS: 2,
      FAIL: 1,
      ACCEPTED_RISK: 1,
      CONFIG_READY_NOT_DRILLED: 1,
      BLOCKED: 1,
    });
    expect(summary.missingEvidenceCount).toBe(1);
  });

  it('allows final enablement only when PASS rows have evidence and non-PASS rows have explicit owner approval metadata', async () => {
    const ledgerPath = await writeLedger({
      requiredGateIds: ['PASS_GATE', 'APPROVED_ACCEPTED_RISK', 'APPROVED_CONFIG_READY'],
      gates: [
        gate({ gateId: 'PASS_GATE', state: 'PASS', evidenceRefs: ['evidence/pass.json'] }),
        gate({
          gateId: 'APPROVED_ACCEPTED_RISK',
          state: 'ACCEPTED_RISK',
          evidenceRefs: ['evidence/risk.json'],
          approvalState: 'approved',
          approver: 'owner-operator',
          approvalTimestamp: '2026-05-20T05:00:00.000Z',
          compensatingMonitoring: 'Cloud Run and payment watch every five minutes',
          rollbackOrCloseTrigger: 'Close booking on payment/QR mismatch',
        }),
        gate({
          gateId: 'APPROVED_CONFIG_READY',
          state: 'CONFIG_READY_NOT_DRILLED',
          evidenceRefs: ['evidence/config.json'],
          approvalState: 'approved',
          approver: 'owner-operator',
          approvalTimestamp: '2026-05-20T05:05:00.000Z',
          compensatingMonitoring: 'DB pool saturation watch',
          rollbackOrCloseTrigger: 'Rollback on DB pool saturation',
        }),
      ],
    });
    process.env.CUTOVER_GATE_LEDGER_PATH = ledgerPath;

    const summary = await new AdminCutoverService().getGateSummary();

    expect(summary.finalEnableAllowed).toBe(true);
    expect(summary.firstBlockingGate).toBeNull();
    expect(summary.rows.map((row) => row.state)).toEqual([
      'ACCEPTED_RISK',
      'CONFIG_READY_NOT_DRILLED',
      'PASS',
    ]);
  });

  it('synthesizes missing required gates as BLOCKED rows', async () => {
    const ledgerPath = await writeLedger({
      requiredGateIds: ['PRESENT_GATE', 'MISSING_REQUIRED_GATE'],
      gates: [
        gate({ gateId: 'PRESENT_GATE', state: 'PASS', evidenceRefs: ['evidence/pass.json'] }),
      ],
    });
    process.env.CUTOVER_GATE_LEDGER_PATH = ledgerPath;

    const summary = await new AdminCutoverService().getGateSummary();

    expect(summary.finalEnableAllowed).toBe(false);
    expect(summary.firstBlockingGate?.gateId).toBe('MISSING_REQUIRED_GATE');
    expect(summary.rows[0]).toMatchObject({
      gateId: 'MISSING_REQUIRED_GATE',
      state: 'BLOCKED',
      failureReason: expect.stringContaining('required gate'),
    });
  });

  it('returns no-go BLOCKED data for missing or invalid runtime artifacts without leaking paths or secret-like evidence', async () => {
    process.env.CUTOVER_GATE_LEDGER_PATH = join(
      tmpRoot,
      'missing-sk_test_do_not_leak-paymentKey-cookie.json',
    );

    const missing = await new AdminCutoverService().getGateSummary();

    expect(missing.finalEnableAllowed).toBe(false);
    expect(missing.firstBlockingGate).toMatchObject({
      state: 'BLOCKED',
      gateId: 'CUTOVER_GATE_LEDGER_RUNTIME_ARTIFACT',
    });
    expect(JSON.stringify(missing)).not.toContain(tmpRoot);
    expect(JSON.stringify(missing)).not.toContain('sk_test_do_not_leak');
    expect(JSON.stringify(missing)).not.toContain('paymentKey');

    const invalidPath = join(tmpRoot, 'invalid-ledger.json');
    await writeFile(invalidPath, '{"evidence":{"paymentKey":"pay_secret"}', 'utf8');
    process.env.CUTOVER_GATE_LEDGER_PATH = invalidPath;

    const invalid = await new AdminCutoverService().getGateSummary();

    expect(invalid.finalEnableAllowed).toBe(false);
    expect(invalid.firstBlockingGate?.state).toBe('BLOCKED');
    expect(JSON.stringify(invalid)).not.toContain('pay_secret');
    expect(JSON.stringify(invalid)).not.toContain(invalidPath);
  });

  it('returns only redacted metadata and evidence refs, never raw evidence payloads', async () => {
    const ledgerPath = await writeLedger({
      requiredGateIds: ['PASS_GATE'],
      gates: [
        {
          ...gate({
            gateId: 'PASS_GATE',
            state: 'PASS',
            evidenceRefs: ['evidence/redacted-summary.json'],
          }),
          evidence: {
            paymentKey: 'pay_should_not_leave_service',
            cookie: 'refresh_token=secret',
          },
        },
      ],
    });
    process.env.CUTOVER_GATE_LEDGER_PATH = ledgerPath;

    const summary = await new AdminCutoverService().getGateSummary();
    const serialized = JSON.stringify(summary);

    expect(summary.rows[0]?.evidenceRefs).toEqual(['evidence/redacted-summary.json']);
    expect(serialized).not.toContain('pay_should_not_leave_service');
    expect(serialized).not.toContain('refresh_token=secret');
    expect(serialized).not.toContain('"evidence":');
  });

  it('redacts secret-like strings from exposed Gate Ledger metadata', async () => {
    const ledgerPath = await writeLedger({
      requiredGateIds: ['PASS_GATE'],
      gates: [
        gate({
          gateId: 'PASS_GATE',
          state: 'PASS',
          evidenceRefs: ['evidence/pay_standalone_secret_key_123456.json'],
          failureReason: 'paymentKey=pay_failure_secret_key_123456',
          approver: 'test_ck_client_key_should_not_leave',
          compensatingMonitoring:
            'Authorization: Bearer header_payload_signature_should_not_leave',
          rollbackOrCloseTrigger: 'QR token qrToken=secret_qr_token_should_not_leave',
          redactionNotes: 'Cookie: refresh_token=secret_cookie_value',
        }),
      ],
    });
    process.env.CUTOVER_GATE_LEDGER_PATH = ledgerPath;

    const summary = await new AdminCutoverService().getGateSummary();
    const serialized = JSON.stringify(summary);

    expect(serialized).not.toContain('pay_standalone_secret_key_123456');
    expect(serialized).not.toContain('pay_failure_secret_key_123456');
    expect(serialized).not.toContain('test_ck_client_key_should_not_leave');
    expect(serialized).not.toContain('header_payload_signature_should_not_leave');
    expect(serialized).not.toContain('secret_qr_token_should_not_leave');
    expect(serialized).not.toContain('secret_cookie_value');
    expect(serialized).toContain('<toss-payment-key:redacted>');
  });

  async function writeLedger(ledger: Record<string, unknown>): Promise<string> {
    const path = join(tmpRoot, `ledger-${Math.random().toString(36).slice(2)}.json`);
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: 'phase26.gate-ledger.v1',
        phase: '26',
        generatedAt: '2026-05-20T00:00:00.000Z',
        cutoverPolicy: {
          secretPolicy: 'Evidence must be redacted.',
        },
        ...ledger,
      }),
      'utf8',
    );
    return path;
  }
});

function gate(overrides: Record<string, unknown>) {
  return {
    gateId: 'PASS_GATE',
    requirementIds: ['M1-01'],
    state: 'PASS',
    environment: 'production',
    evidenceRefs: [],
    failureReason: null,
    approvalState: 'not_requested',
    approver: null,
    approvalTimestamp: null,
    compensatingMonitoring: 'Monitor health, payment, QR, and queue signals',
    rollbackOrCloseTrigger: 'Close booking on user-path critical failure',
    sourceDecisions: ['D-01'],
    redactionNotes: 'Store redacted evidence only.',
    ...overrides,
  };
}
