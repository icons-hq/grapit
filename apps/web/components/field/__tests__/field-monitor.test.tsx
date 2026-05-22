import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { FieldMonitor } from '../field-monitor';

const rawToken = 'raw-token-monitor-should-not-render';
const rawJti = 'raw-jti-monitor-should-not-render';
const rawBuyerEmail = 'buyer27@example.com';
const rawBuyerPhone = '010-9999-2727';

const monitorSummary = {
  eventId: 'phase27-event',
  showtimeId: 'phase27-showtime',
  lastUpdatedAt: '2026-07-04T10:05:00.000Z',
  entered: 120,
  notEntered: 30,
  entryRate: 80,
  duplicateScans: 4,
  rejectedScans: 3,
  offlinePending: 2,
  offlineSynced: 12,
  latestAbnormalAlerts: [
    {
      id: 'alert-duplicate-spike',
      title: '중복 스캔이 평소보다 많습니다',
      severity: 'warning',
      count: 4,
      detectedAt: '2026-07-04T10:01:00.000Z',
    },
  ],
  scanLogs: [
    {
      id: 'scan-log-1',
      reservationNumber: 'GRP-27-MON-0001',
      result: 'duplicate',
      maskedTicketRef: 'jti_***_2727',
      rawToken,
      rawJti,
      buyerEmail: rawBuyerEmail,
      buyerPhone: rawBuyerPhone,
      scannedAt: '2026-07-04T10:00:00.000Z',
    },
  ],
};

describe('FieldMonitor', () => {
  it('renders 4-8 KPI cards before any raw scan log table', () => {
    render(<FieldMonitor summary={monitorSummary} />);

    expect(screen.getByText('입장 흐름이 정상입니다')).toBeInTheDocument();

    const kpiGrid = screen.getByTestId('field-monitor-kpi-grid');
    const kpiCards = within(kpiGrid).getAllByTestId(/^field-monitor-kpi-/);

    expect(kpiCards.length).toBeGreaterThanOrEqual(4);
    expect(kpiCards.length).toBeLessThanOrEqual(8);
    expect(within(kpiGrid).getByText('entered')).toBeInTheDocument();
    expect(within(kpiGrid).getByText('not-entered')).toBeInTheDocument();
    expect(within(kpiGrid).getByText('entry rate')).toBeInTheDocument();
    expect(within(kpiGrid).getByText('duplicate scans')).toBeInTheDocument();
    expect(within(kpiGrid).getByText('rejected scans')).toBeInTheDocument();
    expect(within(kpiGrid).getByText('offline pending')).toBeInTheDocument();
    expect(within(kpiGrid).getByText('offline synced')).toBeInTheDocument();
    expect(within(kpiGrid).getByText('latest abnormal')).toBeInTheDocument();

    const logTable = screen.getByRole('table', { name: '스캔 로그' });
    expect(
      kpiGrid.compareDocumentPosition(logTable) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('surfaces latest abnormal alerts before drill-down logs', () => {
    render(<FieldMonitor summary={monitorSummary} />);

    const alerts = screen.getByTestId('field-monitor-alerts');

    expect(within(alerts).getByText('이상 징후를 확인하세요')).toBeInTheDocument();
    expect(within(alerts).getByText('중복 스캔이 평소보다 많습니다')).toBeInTheDocument();
  });

  it('does not expose raw token, raw JTI, or raw PII rows in monitor UI', () => {
    render(<FieldMonitor summary={monitorSummary} />);

    expect(screen.queryByText(rawToken, { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(rawJti, { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(rawBuyerEmail, { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(rawBuyerPhone, { exact: true })).not.toBeInTheDocument();
  });
});
