import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { expect, it, vi } from 'vitest';
import { CutoverGateLedger } from '../cutover-gate-ledger';
import type { AdminCutoverGateSummary } from '@/hooks/use-admin-cutover';
it('shows historical evidence without pretending to switch live booking on', () => {
  const summary: AdminCutoverGateSummary = {
    generatedAt: '2026-09-22T00:00:00Z', ledgerGeneratedAt: '2026-09-01T00:00:00Z', source: { state: 'loaded', runtimeArtifactRequired: true, reason: null },
    rows: [{ gateId: 'QR_VISIBILITY', requirementIds: ['PAY-01'], state: 'PASS', environment: 'test', evidenceRefs: ['qr-test'], evidenceMissing: false, failureReason: null, approvalState: 'approved', approver: '운영자', approvalTimestamp: null, compensatingMonitoring: null, rollbackOrCloseTrigger: null, sourceDecisions: [], redactionNotes: null, blocking: false, blockingReason: null }],
    countsByState: { PASS: 1, FAIL: 0, BLOCKED: 0, ACCEPTED_RISK: 0, CONFIG_READY_NOT_DRILLED: 0 }, missingEvidenceCount: 0, firstBlockingGate: null, finalEnableAllowed: true, redactionNotes: [],
  };
  render(<CutoverGateLedger summary={summary} isLoading={false} isError={false} onRefresh={vi.fn()} />);
  expect(screen.getByRole('heading', { name: '판매 시작은 별도로 진행합니다' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /활성화|판매 시작/ })).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '구매자 QR 티켓 표시' })).toBeInTheDocument();
  expect(screen.getByText(/현재 판매 상태와 자동으로 일치하지 않을 수 있습니다/)).toBeInTheDocument();
});
