import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
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

    expect(screen.queryByText('입장 흐름이 정상입니다')).not.toBeInTheDocument();

    const kpiGrid = screen.getByTestId('field-monitor-kpi-grid');
    const kpiCards = within(kpiGrid).getAllByTestId(/^field-monitor-kpi-/);

    expect(kpiCards.length).toBeGreaterThanOrEqual(4);
    expect(kpiCards.length).toBeLessThanOrEqual(8);
    expect(within(kpiGrid).getByText('입장 완료')).toBeInTheDocument();
    expect(within(kpiGrid).getByText('미입장')).toBeInTheDocument();
    expect(within(kpiGrid).getByText('입장률')).toBeInTheDocument();
    expect(within(kpiGrid).getByText('중복 스캔')).toBeInTheDocument();
    expect(within(kpiGrid).getByText('거절 스캔')).toBeInTheDocument();
    expect(within(kpiGrid).getByText('동기화 완료')).toBeInTheDocument();
    expect(within(kpiGrid).getByText('12')).toBeInTheDocument();
    expect(within(kpiGrid).getByText('최근 이상 알림')).toBeInTheDocument();

    const logTable = screen.getByRole('table', { name: '스캔 로그' });
    expect(
      kpiGrid.compareDocumentPosition(logTable) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('does not present a server count as the device offline backlog (audit #119)', async () => {
    // Radix Select needs pointer capture APIs that jsdom does not implement.
    for (const method of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture']) {
      Object.defineProperty(HTMLElement.prototype, method, { value: () => false, configurable: true });
    }
    Element.prototype.scrollIntoView = function scrollIntoView() {};
    const user = userEvent.setup();
    render(<FieldMonitor summary={{ ...monitorSummary, offlinePendingCount: 0 }} scanLogs={scanLogs} />);

    const kpiGrid = screen.getByTestId('field-monitor-kpi-grid');
    expect(within(kpiGrid).queryByText('동기화 대기')).not.toBeInTheDocument();
    expect(screen.queryByTestId('field-monitor-kpi-offline-pending')).not.toBeInTheDocument();

    const notice = screen.getByTestId('field-monitor-device-backlog-notice');
    expect(notice).toHaveTextContent('동기화 대기는 이 화면에 집계되지 않습니다.');
    expect(notice).toHaveTextContent('각 현장 단말');
    expect(
      kpiGrid.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // The log filter cannot offer a server-side pending state that is never recorded.
    await user.click(screen.getByRole('combobox', { name: '오프라인 상태 필터' }));
    expect(screen.queryByRole('option', { name: '대기' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: '동기화 완료' })).toBeInTheDocument();
  });

  it('offers only recorded outcomes and filters duplicates the way the duplicate KPI counts them (audit #113, #114)', async () => {
    for (const method of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture']) {
      Object.defineProperty(HTMLElement.prototype, method, { value: () => false, configurable: true });
    }
    Element.prototype.scrollIntoView = function scrollIntoView() {};
    const user = userEvent.setup();
    const alreadyUsed = { ...scanLogs[0], id: 'scan-log-2', outcome: 'already_used', result: 'already_used' };
    const wrongShowtime = { ...scanLogs[0], id: 'scan-log-3', outcome: 'wrong_showtime', result: 'wrong_showtime' };
    render(<FieldMonitor summary={monitorSummary} scanLogs={[alreadyUsed, wrongShowtime]} initialFilters={{ eventId: 'phase27-event' }} />);

    // A rescan of a used seat is recorded as already_used; the table labels it as a duplicate.
    const rows = within(screen.getByRole('table', { name: '스캔 로그' })).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('중복');
    expect(rows[2]).toHaveTextContent('다른 회차');

    await user.click(screen.getByRole('combobox', { name: '스캔 결과 필터' }));
    expect(screen.queryByRole('option', { name: '오프라인 보류' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: '다른 회차' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '만료' })).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: '중복' }));

    // The server maps outcome=duplicate to duplicate + already_used rows.
    const logKeys = (useQueryMock.mock.calls as unknown as Array<[{ queryKey: unknown[] }]>)
      .map(([options]) => options.queryKey)
      .filter((key) => key[2] === 'logs');
    expect(logKeys.at(-1)?.[3]).toEqual(expect.objectContaining({ outcome: 'duplicate' }));
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

  it('keeps manual refresh disabled until required monitor filters are present', () => {
    render(<FieldMonitor />);

    expect(screen.getByRole('button', { name: '새로고침' })).toBeDisabled();
    expect(refetchMock).not.toHaveBeenCalled();
    expect(screen.queryAllByText('입장 흐름이 정상입니다')).toHaveLength(0);
    expect(screen.getByText('공연과 회차를 선택하면 현장 현황을 조회합니다.')).toBeInTheDocument();
  });

  it('configures the monitor summary hook for visible 10 second polling and manual refresh', async () => {
    const result = useFieldMonitorSummary({
      eventId: 'phase27-event',
      showtimeId: '2d0f662d-7c72-42b9-9c83-c630903e2120',
    });

    expect(result.manualRefresh).toBe(refetchMock);

    const calls = useQueryMock.mock.calls as unknown as Array<[
      {
        queryKey: readonly string[];
        refetchInterval: typeof fieldMonitorRefetchInterval;
        queryFn: () => Promise<unknown>;
      },
    ]>;
    const options = calls[0][0];
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

  // A scan of a ticket whose cancellation is not confirmed yet (audit #115) must
  // not read as a finished refund: staff refuse entry and escalate (field-ops-7).
  describe('cancellation pending scans', () => {
    const pendingReason = '취소 처리 중인 티켓입니다. 환불이 확정되지 않았으니 입장시키지 말고 현장 책임자에게 확인해주세요';
    const cancellationPending = {
      ...scanLogs[0], id: 'scan-log-pending', outcome: 'refunded_cancelled', result: 'refunded_cancelled',
      syncState: null, source: 'online' as const, seatLabel: '1층 · VIP · A-1', rejectionReason: pendingReason,
    };
    const refunded = {
      ...scanLogs[0], id: 'scan-log-refunded', outcome: 'refunded_cancelled', result: 'refunded_cancelled',
      syncState: null, source: 'online' as const, seatLabel: '1층 · VIP · A-2', rejectionReason: '환불 또는 취소된 티켓입니다',
    };
    function summaryWithRefundedAlert(count: number) {
      return {
        ...monitorSummary,
        latestAbnormalAlerts: [{
          type: 'refunded_cancelled_attempt', message: 'Refunded or cancelled ticket scan attempts detected',
          severity: 'warning', count, detectedAt: '2026-07-04T10:03:00.000Z',
        }],
      };
    }

    it('labels a pending cancellation apart from a completed refund and keeps the server reason', () => {
      render(<FieldMonitor summary={summaryWithRefundedAlert(2)} scanLogs={[cancellationPending, refunded]} />);

      const rows = within(screen.getByRole('table', { name: '스캔 로그' })).getAllByRole('row');
      expect(rows[1]).toHaveTextContent('취소 처리 중(환불 미확정)');
      expect(rows[1]).toHaveTextContent(pendingReason);
      expect(rows[2]).toHaveTextContent('환불/취소');
      expect(rows[2]).not.toHaveTextContent('취소 처리 중(환불 미확정)');
    });

    it('splits the refunded/cancelled alert count into pending and completed', () => {
      render(<FieldMonitor summary={summaryWithRefundedAlert(2)} scanLogs={[cancellationPending, refunded]} />);

      const alerts = screen.getByTestId('field-monitor-alerts');
      expect(within(alerts).getByText('환불 또는 취소된 티켓 스캔이 있습니다')).toBeInTheDocument();
      expect(within(alerts).getByTestId('field-monitor-refunded-breakdown')).toHaveTextContent('취소 처리 중 1건 · 환불/취소 1건');
      expect(within(alerts).getByTestId('field-monitor-refunded-breakdown')).not.toHaveTextContent('스캔 로그 밖');
    });

    it('reports showtime scans outside the loaded log as not split instead of guessing', () => {
      render(<FieldMonitor summary={summaryWithRefundedAlert(5)} scanLogs={[cancellationPending, refunded]} />);

      expect(screen.getByTestId('field-monitor-refunded-breakdown'))
        .toHaveTextContent('취소 처리 중 1건 · 환불/취소 1건 · 스캔 로그 밖 3건(구분 전)');
    });
  });

  // The log table was wider than its card and the Radix filters were shorter
  // and narrower than the native ones beside them (field-ops-8).
  describe('layout', () => {
    it('sizes the result and sync filters like the native filters', () => {
      render(<FieldMonitor summary={monitorSummary} scanLogs={scanLogs} />);

      for (const name of ['스캔 결과 필터', '오프라인 상태 필터']) {
        expect(screen.getByRole('combobox', { name })).toHaveClass('h-11', 'w-full', 'data-[size=default]:h-11');
        expect(screen.getByRole('combobox', { name })).not.toHaveClass('data-[size=default]:h-9');
      }
      expect(screen.getByRole('combobox', { name: '스캐너 계정 필터' })).toHaveClass('h-11', 'w-full');
    });

    it('puts the result next to the seat and shortens the time in the desktop table', () => {
      render(<FieldMonitor summary={monitorSummary} scanLogs={[{ ...scanLogs[0], seatLabel: '1층 · VIP · A-1' }]} />);

      const table = screen.getByRole('table', { name: '스캔 로그' });
      const headers = within(table).getAllByRole('columnheader').map((cell) => cell.textContent);
      expect(headers.slice(0, 3)).toEqual(['좌석', '결과', '예매번호']);
      expect(within(table).getAllByRole('row')[1]).toHaveTextContent('07.04 19:00');
      // Phones get the card list; the table and its scroll container are hidden there.
      expect(screen.getByTestId('field-monitor-log-table')).toHaveClass('hidden', 'sm:block');
      expect(screen.getByTestId('field-monitor-log-table')).toContainElement(table);
    });

    it('lists scans as cards on phones with time, seat, result and reason', () => {
      render(<FieldMonitor summary={monitorSummary} scanLogs={[{
        ...scanLogs[0], seatLabel: '1층 · VIP · A-1', rejectionReason: '이미 입장 처리된 티켓입니다',
      }]} />);

      const list = screen.getByRole('list', { name: '스캔 로그 목록' });
      expect(list).toHaveClass('sm:hidden');
      const [card] = within(list).getAllByRole('listitem');
      expect(card).toHaveTextContent('19:00');
      expect(card).toHaveTextContent('1층 · VIP · A-1');
      expect(card).toHaveTextContent('중복');
      expect(card).toHaveTextContent('이미 입장 처리된 티켓입니다');
      expect(card).not.toHaveTextContent(rawToken);
    });
  });
});
