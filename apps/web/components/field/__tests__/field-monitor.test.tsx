import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FieldMonitor } from '../field-monitor';
import {
  fieldMonitorRefetchInterval,
  useFieldMonitorSummary,
} from '@/hooks/use-field-monitor';

const { getMock, refetchMock, useQueryMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  refetchMock: vi.fn(),
  useQueryMock: vi.fn(() => ({
    data: undefined,
    isError: false,
    isFetching: false,
    isLoading: false,
    refetch: refetchMock,
  })),
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: getMock,
  },
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

const rawToken = 'raw-token-monitor-should-not-render';
const rawJti = 'raw-jti-monitor-should-not-render';
const rawBuyerEmail = 'buyer27@example.com';
const rawBuyerPhone = '010-9999-2727';

const monitorSummary = {
  eventId: 'phase27-event',
  showtimeId: '2d0f662d-7c72-42b9-9c83-c630903e2120',
  lastUpdatedAt: '2026-07-04T10:05:00.000Z',
  updatedAt: '2026-07-04T10:05:00.000Z',
  enteredCount: 120,
  notEnteredCount: 30,
  entryRate: 80,
  duplicateScanCount: 4,
  rejectedScanCount: 3,
  offlinePendingCount: 2,
  offlineSyncedCount: 12,
  latestAbnormalAlerts: [
    {
      type: 'duplicate_spike',
      message: '중복 스캔이 평소보다 많습니다',
      severity: 'warning',
      count: 4,
      detectedAt: '2026-07-04T10:01:00.000Z',
    },
    {
      type: 'rejected_tampered_scan',
      message: '위조 또는 거절된 스캔이 발생했습니다',
      severity: 'critical',
      count: 3,
      detectedAt: '2026-07-04T10:02:00.000Z',
    },
    {
      type: 'refunded_cancelled_attempt',
      message: '환불 또는 취소된 티켓 스캔이 있습니다',
      severity: 'critical',
      count: 1,
      detectedAt: '2026-07-04T10:03:00.000Z',
    },
    {
      type: 'offline_backlog',
      message: '동기화되지 않은 보류 스캔이 남아 있습니다',
      severity: 'warning',
      count: 2,
      detectedAt: '2026-07-04T10:04:00.000Z',
    },
    {
      type: 'sync_failure',
      message: '보류 스캔 동기화 실패가 발생했습니다',
      severity: 'critical',
      count: 1,
      detectedAt: '2026-07-04T10:04:30.000Z',
    },
  ],
};

const scanLogs = [
  {
    id: 'scan-log-1',
    eventId: 'phase27-event',
    showtimeId: '2d0f662d-7c72-42b9-9c83-c630903e2120',
    reservationNumber: 'GRP-27-MON-0001',
    outcome: 'duplicate',
    result: 'duplicate',
    syncState: 'pending',
    scannerUserId: 'scanner-1',
    deviceAttemptId: 'device-attempt-1',
    redactedTokenRef: 'jti_***_2727',
    maskedTicketRef: 'jti_***_2727',
    rawToken,
    rawJti,
    buyerEmail: rawBuyerEmail,
    buyerPhone: rawBuyerPhone,
    scannedAt: '2026-07-04T10:00:00.000Z',
  },
];

describe('FieldMonitor', () => {
  beforeEach(() => {
    getMock.mockReset();
    refetchMock.mockReset();
    useQueryMock.mockClear();
  });

  it('renders 4-8 KPI cards before any raw scan log table', () => {
    render(<FieldMonitor summary={monitorSummary} scanLogs={scanLogs} />);

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
    expect(within(kpiGrid).getByText('2')).toBeInTheDocument();
    expect(within(kpiGrid).getByText('offline synced')).toBeInTheDocument();
    expect(within(kpiGrid).getByText('12')).toBeInTheDocument();
    expect(within(kpiGrid).getByText('latest abnormal')).toBeInTheDocument();

    const logTable = screen.getByRole('table', { name: '스캔 로그' });
    expect(
      kpiGrid.compareDocumentPosition(logTable) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('surfaces all D-26 abnormal alerts before drill-down logs', () => {
    render(<FieldMonitor summary={monitorSummary} scanLogs={scanLogs} />);

    const alerts = screen.getByTestId('field-monitor-alerts');

    expect(within(alerts).getByText('이상 징후를 확인하세요')).toBeInTheDocument();
    expect(within(alerts).getByText('중복 스캔이 평소보다 많습니다')).toBeInTheDocument();
    expect(
      within(alerts).getByText('위조 또는 거절된 스캔이 발생했습니다'),
    ).toBeInTheDocument();
    expect(
      within(alerts).getByText('환불 또는 취소된 티켓 스캔이 있습니다'),
    ).toBeInTheDocument();
    expect(
      within(alerts).getByText('동기화되지 않은 보류 스캔이 남아 있습니다'),
    ).toBeInTheDocument();
    expect(
      within(alerts).getByText('보류 스캔 동기화 실패가 발생했습니다'),
    ).toBeInTheDocument();

    const logTable = screen.getByRole('table', { name: '스캔 로그' });
    expect(
      alerts.compareDocumentPosition(logTable) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('does not expose raw token, raw JTI, or raw PII rows in monitor UI', () => {
    render(<FieldMonitor summary={monitorSummary} scanLogs={scanLogs} />);

    expect(screen.queryByText(rawToken, { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(rawJti, { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(rawBuyerEmail, { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(rawBuyerPhone, { exact: true })).not.toBeInTheDocument();
  });

  it('configures the monitor summary hook for visible 10 second polling and manual refresh', async () => {
    const result = useFieldMonitorSummary({
      eventId: 'phase27-event',
      showtimeId: '2d0f662d-7c72-42b9-9c83-c630903e2120',
    });

    expect(result.manualRefresh).toBe(refetchMock);

    const options = useQueryMock.mock.calls[0]?.[0];
    expect(options.queryKey).toEqual([
      'field',
      'monitor',
      'summary',
      'phase27-event',
      '2d0f662d-7c72-42b9-9c83-c630903e2120',
    ]);
    expect(options.refetchInterval).toBe(fieldMonitorRefetchInterval);
    expect(fieldMonitorRefetchInterval()).toBe(10_000);

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValueOnce('hidden');
    expect(fieldMonitorRefetchInterval()).toBe(false);

    await options.queryFn();

    expect(getMock).toHaveBeenCalledWith(
      '/api/v1/field/monitor/summary?eventId=phase27-event&showtimeId=2d0f662d-7c72-42b9-9c83-c630903e2120',
      { showErrorToast: false },
    );
  });
});
