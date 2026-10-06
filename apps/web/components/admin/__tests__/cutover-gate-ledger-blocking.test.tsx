import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { CutoverGateLedger } from '../cutover-gate-ledger';
import type {
  AdminCutoverGateRow,
  AdminCutoverGateSummary,
} from '@/hooks/use-admin-cutover';

function row(overrides: Partial<AdminCutoverGateRow>): AdminCutoverGateRow {
  return {
    gateId: 'QR_VISIBILITY',
    requirementIds: ['PAY-01'],
    state: 'PASS',
    environment: 'production',
    evidenceRefs: ['evidence/pass.json'],
    evidenceMissing: false,
    failureReason: null,
    approvalState: 'not_requested',
    approver: null,
    approvalTimestamp: null,
    compensatingMonitoring: null,
    rollbackOrCloseTrigger: null,
    sourceDecisions: [],
    redactionNotes: null,
    blocking: false,
    blockingReason: null,
    ...overrides,
  };
}

const unapprovedConfigReady = (gateId: string) =>
  row({
    gateId,
    state: 'CONFIG_READY_NOT_DRILLED',
    blocking: true,
    blockingReason:
      'CONFIG_READY_NOT_DRILLED requires owner approval, monitoring, and rollback/close trigger.',
  });

function summaryOf(
  rows: AdminCutoverGateRow[],
  extra: Partial<AdminCutoverGateSummary> = {},
): AdminCutoverGateSummary {
  const count = (state: AdminCutoverGateRow['state']) =>
    rows.filter((entry) => entry.state === state).length;
  const firstBlockingGate = rows.find((entry) => entry.blocking) ?? null;
  return {
    generatedAt: '2026-10-02T00:00:00Z',
    ledgerGeneratedAt: '2026-09-30T00:00:00Z',
    freshness: { state: 'fresh', ageDays: 2, maxAgeDays: 30, reason: null },
    opening: {
      id: 'girl-rules-2026-10',
      label: 'Girl Rules 10월 오픈',
      performanceIds: ['performance-1'],
      opensAt: '2026-10-20T11:00:00.000Z',
    },
    source: { state: 'loaded', runtimeArtifactRequired: true, reason: null },
    rows,
    countsByState: {
      PASS: count('PASS'),
      FAIL: count('FAIL'),
      BLOCKED: count('BLOCKED'),
      ACCEPTED_RISK: count('ACCEPTED_RISK'),
      CONFIG_READY_NOT_DRILLED: count('CONFIG_READY_NOT_DRILLED'),
    },
    missingEvidenceCount: rows.filter((entry) => entry.evidenceMissing).length,
    firstBlockingGate,
    finalEnableAllowed: rows.length > 0 && !firstBlockingGate,
    redactionNotes: [],
    ...extra,
  };
}

function summaryCardValue(label: string) {
  const region = screen.getByRole('region', { name: '게이트 상태 요약' });
  const card = within(region).getByText(label).parentElement;
  return card?.querySelector('p:last-child')?.textContent;
}

describe('CutoverGateLedger blocking summary', () => {
  it('counts every server-blocking row, not only BLOCKED/FAIL states', () => {
    const rows = [
      row({ gateId: 'TOSS_LIVE_KEY_SMOKE', state: 'BLOCKED', blocking: true, blockingReason: 'blocked' }),
      unapprovedConfigReady('DR_CLOUD_RUN_ROLLBACK'),
      unapprovedConfigReady('INFRA_HA_REPLICA'),
      unapprovedConfigReady('INFRA_POOL_PGBOUNCER'),
      row({ gateId: 'QR_VISIBILITY' }),
    ];

    render(
      <CutoverGateLedger summary={summaryOf(rows)} isLoading={false} isError={false} onRefresh={vi.fn()} />,
    );

    // 1 BLOCKED + 3 unapproved CONFIG_READY_NOT_DRILLED rows block final enablement.
    expect(summaryCardValue('보완 필요')).toBe('4');
  });

  it('keeps showing blockers when no row is BLOCKED but unapproved rows remain', () => {
    const rows = [
      unapprovedConfigReady('DR_CLOUD_RUN_ROLLBACK'),
      unapprovedConfigReady('INFRA_HA_REPLICA'),
      unapprovedConfigReady('INFRA_POOL_PGBOUNCER'),
      row({ gateId: 'QR_VISIBILITY' }),
    ];

    render(
      <CutoverGateLedger summary={summaryOf(rows)} isLoading={false} isError={false} onRefresh={vi.fn()} />,
    );

    expect(summaryCardValue('보완 필요')).toBe('3');
    // Each blocking non-BLOCKED row carries an explicit marker next to its state badge
    // in the desktop table, the mobile cards and the selected detail panel.
    expect(screen.getAllByText('판매 차단').length).toBeGreaterThanOrEqual(6);
    expect(screen.getByText('판매 차단 사유')).toBeInTheDocument();
    expect(screen.getByText('기록상 미완료 점검이 있습니다')).toBeInTheDocument();
  });

  it('marks a stale or unscoped ledger as unusable for this opening', () => {
    const staleRow = row({
      gateId: 'CUTOVER_GATE_LEDGER_FRESHNESS',
      state: 'BLOCKED',
      evidenceRefs: [],
      evidenceMissing: true,
      blocking: true,
      blockingReason: 'Gate Ledger evidence is 134 days old (limit 30 days); regenerate it for this opening.',
    });
    const summary = summaryOf([staleRow, row({ gateId: 'QR_VISIBILITY' })], {
      ledgerGeneratedAt: '2026-05-21T03:27:30.198Z',
      freshness: {
        state: 'stale',
        ageDays: 134,
        maxAgeDays: 30,
        reason: 'Gate Ledger evidence is 134 days old (limit 30 days); regenerate it for this opening.',
      },
      opening: null,
    });

    render(<CutoverGateLedger summary={summary} isLoading={false} isError={false} onRefresh={vi.fn()} />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      '점검 기록이 134일 전 자료로 기준(30일)을 넘었습니다',
    );
    expect(screen.getByText(/대상 오픈이 지정되지 않은 점검 기록입니다/)).toBeInTheDocument();
    expect(screen.getByText('먼저 확인할 항목: 점검 기록 기준 시각')).toBeInTheDocument();
  });

  it('shows the opening the ledger was prepared for', () => {
    render(
      <CutoverGateLedger
        summary={summaryOf([row({ gateId: 'QR_VISIBILITY' })])}
        isLoading={false}
        isError={false}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByText(/대상 오픈: Girl Rules 10월 오픈 · 판매 시작/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('기록상 필수 점검이 검토되었습니다')).toBeInTheDocument();
  });
});
