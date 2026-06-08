import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { ReservationExportPanel } from '../reservation-export-panel';

const mocks = vi.hoisted(() => ({
  exportMutate: vi.fn(),
}));

vi.mock('@/hooks/use-reservations', () => ({
  useReservationExport: () => ({
    mutate: mocks.exportMutate,
    isPending: false,
  }),
}));

function renderPanel() {
  render(<ReservationExportPanel />);
}

describe('ReservationExportPanel', () => {
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
    mocks.exportMutate.mockReset();
  });

  it('shows all seven D-14 filters before export confirmation', () => {
    renderPanel();

    expect(screen.getByLabelText('이벤트')).toBeInTheDocument();
    expect(screen.getByLabelText('좌석 등급')).toBeInTheDocument();
    expect(screen.getByLabelText('구역/층')).toBeInTheDocument();
    expect(screen.getByLabelText('예매 상태')).toBeInTheDocument();
    expect(screen.getByLabelText('국내/해외')).toBeInTheDocument();
    expect(screen.getByLabelText('결제 수단')).toBeInTheDocument();
    expect(screen.getByLabelText('조회 시작일')).toBeInTheDocument();
    expect(screen.getByLabelText('조회 종료일')).toBeInTheDocument();
  });

  it('requires a reason in the raw PII confirmation dialog', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: '예약자 원본 CSV 내보내기' }));

    expect(
      screen.getByRole('heading', { name: '예약자 원본 CSV를 내보내시겠습니까?' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('개인정보가 포함됩니다. 필터와 사유를 확인한 뒤 내보내세요.'),
    ).toBeInTheDocument();

    const confirmButton = screen.getByRole('button', { name: 'CSV 내보내기' });
    expect(confirmButton).toBeDisabled();

    await user.type(screen.getByLabelText('내보내기 사유'), '정산 대조');

    expect(confirmButton).toBeEnabled();
  });

  it('does not start export before final confirmation', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: '예약자 원본 CSV 내보내기' }));
    await user.type(screen.getByLabelText('내보내기 사유'), '정산 대조');

    expect(mocks.exportMutate).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'CSV 내보내기' }));

    expect(mocks.exportMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        exportType: 'raw_pii',
        reason: '정산 대조',
      }),
    );
  });

  it('exports failed/cancelled contacts through the dedicated contact export button', async () => {
    const user = userEvent.setup();
    renderPanel();

    expect(
      screen.getByRole('button', { name: '실패/만료/취소 고객 CSV 내보내기' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '실패/만료/취소 고객 CSV 내보내기' }));

    expect(
      screen.getByRole('heading', { name: '실패/만료/취소 고객 CSV를 내보내시겠습니까?' }),
    ).toBeInTheDocument();

    const confirmButton = screen.getByRole('button', { name: 'CSV 내보내기' });
    expect(confirmButton).toBeDisabled();

    await user.type(screen.getByLabelText('내보내기 사유'), '실패 고객 안내');
    await user.click(confirmButton);

    expect(mocks.exportMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        exportType: 'failed_cancelled_contacts',
        reason: '실패 고객 안내',
      }),
    );
    expect(mocks.exportMutate.mock.calls[0]?.[0]).not.toHaveProperty('reservationStatus');
    expect(mocks.exportMutate.mock.calls[0]?.[0]).not.toHaveProperty('funnelStatus');
    expect(mocks.exportMutate.mock.calls[0]?.[0]).not.toHaveProperty('tierName');
    expect(mocks.exportMutate.mock.calls[0]?.[0]).not.toHaveProperty('zoneFloor');
  });

  it('exports payment failed and expired rows through the admin funnel status filter', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByLabelText('예매 상태'));
    await user.click(await screen.findByRole('option', { name: '결제 실패/만료' }));
    await user.click(screen.getByRole('button', { name: '예약자 원본 CSV 내보내기' }));
    await user.type(screen.getByLabelText('내보내기 사유'), '실패 고객 안내');
    await user.click(screen.getByRole('button', { name: 'CSV 내보내기' }));

    expect(mocks.exportMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        exportType: 'raw_pii',
        reason: '실패 고객 안내',
        funnelStatus: 'PAYMENT_FAILED',
      }),
    );
    expect(mocks.exportMutate.mock.calls[0]?.[0]).not.toHaveProperty('reservationStatus');
  });
});
