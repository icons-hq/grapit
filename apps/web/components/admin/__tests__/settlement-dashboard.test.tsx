import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettlementDashboard } from '../settlement-dashboard';

const exportMutate = vi.fn();

const financeUser = {
  id: 'finance-admin-1',
  role: 'admin',
  adminCapabilityBundle: 'finance',
  adminCapabilities: ['settlement.export', 'reservations.export_raw', 'audit.read'],
} as const;

const scannerOnlyUser = {
  id: 'scanner-only-1',
  role: 'admin',
  adminCapabilityBundle: 'scanner',
  adminCapabilities: ['field.scan.verify', 'field.scan.consume', 'field.scan.sync'],
} as const;

const dashboardData = {
  summary: {
    salesAmount: 12800000,
    paidReservations: 180,
    refundedAmount: 320000,
    entered: 142,
    noShow: 38,
    exportReady: true,
  },
  maskedSamples: [
    {
      reservationNumber: 'GRP-27-SET-0001',
      buyerName: '김**',
      buyerEmail: 'masked@example.invalid',
      entryStatus: 'entered',
    },
  ],
  rawRows: [
    {
      buyerEmail: 'raw-buyer@example.com',
      buyerPhone: '010-7777-2727',
      paymentKey: 'raw-payment-key-phase27',
    },
  ],
} as const;

function renderDashboard(
  overrides: Partial<React.ComponentProps<typeof SettlementDashboard>> = {},
) {
  render(
    <SettlementDashboard
      user={financeUser}
      data={dashboardData}
      requiredFilters={{
        eventId: 'phase27-event',
        showtimeId: 'phase27-showtime',
        dateFrom: '2026-07-04',
        dateTo: '2026-07-04',
      }}
      onExport={exportMutate}
      {...overrides}
    />,
  );
}

describe('SettlementDashboard', () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      value: () => false,
      configurable: true,
    });
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      value: () => {},
      configurable: true,
    });
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      value: () => {},
      configurable: true,
    });
    Element.prototype.scrollIntoView = function scrollIntoView() {};
  });

  beforeEach(() => {
    exportMutate.mockReset();
  });

  it('renders dashboard summary, all settlement tabs, and all required dataset export actions', () => {
    renderDashboard();

    expect(screen.getByRole('heading', { name: '정산·내보내기' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '요약' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '입장/노쇼' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '결제/환불' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '내보내기' })).toBeInTheDocument();
    expect(screen.getByText('정산 입력 자료')).toBeInTheDocument();

    const summary = screen.getByTestId('settlement-summary');
    const exportPanel = screen.getByTestId('settlement-export-panel');
    expect(
      summary.compareDocumentPosition(exportPanel) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: '입장 상태 CSV 내보내기' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '노쇼 예약 CSV 내보내기' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '예매/결제/환불 CSV 내보내기' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '정산 CSV 내보내기' })).toBeInTheDocument();
  });

  it('requires confirmation and reason before settlement CSV export', async () => {
    const user = userEvent.setup();
    renderDashboard();

    await user.click(screen.getByRole('button', { name: '정산 CSV 내보내기' }));

    expect(
      screen.getByRole('heading', { name: '정산 데이터를 내보내시겠습니까?' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('개인정보와 결제/환불 정보가 포함될 수 있습니다. 필터, 권한, 사유를 확인한 뒤 내보내세요.'),
    ).toBeInTheDocument();

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('필터 요약')).toBeInTheDocument();
    expect(within(dialog).getByText('phase27-event')).toBeInTheDocument();
    expect(within(dialog).getByText('phase27-showtime')).toBeInTheDocument();
    expect(within(dialog).getByText('2026-07-04 ~ 2026-07-04')).toBeInTheDocument();
    expect(within(dialog).getByText('작업자')).toBeInTheDocument();
    expect(within(dialog).getByText('finance-admin-1')).toBeInTheDocument();
    expect(within(dialog).getByText('감사 로그에 내보내기 사유와 필터가 기록됩니다.')).toBeInTheDocument();

    const confirm = within(dialog).getByRole('button', { name: 'CSV 내보내기' });
    expect(confirm).toBeDisabled();

    await user.type(within(dialog).getByLabelText('내보내기 사유'), '행사 종료 정산 대조');
    expect(confirm).toBeEnabled();

    await user.click(confirm);

    expect(exportMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: '행사 종료 정산 대조',
        dataset: 'settlement_accounting_input',
      }),
    );
  });

  it('does not preview raw PII or payment rows in the browser before export', () => {
    renderDashboard();

    expect(screen.queryByText('raw-buyer@example.com')).not.toBeInTheDocument();
    expect(screen.queryByText('010-7777-2727')).not.toBeInTheDocument();
    expect(screen.queryByText('raw-payment-key-phase27')).not.toBeInTheDocument();
  });

  it('denies scanner-only users from settlement and export surfaces', () => {
    renderDashboard({ user: scannerOnlyUser });

    expect(screen.getByText('정산 데이터를 내보낼 권한이 없습니다')).toBeInTheDocument();
    expect(screen.getByText('scanner-only accounts cannot access settlement export')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '정산 CSV 내보내기' })).not.toBeInTheDocument();
  });
});
