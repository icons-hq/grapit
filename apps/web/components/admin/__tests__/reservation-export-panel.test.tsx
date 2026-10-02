import type { ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { ReservationExportPanel } from '../reservation-export-panel';

const mocks = vi.hoisted(() => ({
  apiRaw: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

// The real export hook runs; only the network edge is mocked.
vi.mock('@/lib/api-client', () => ({
  apiClient: { raw: mocks.apiRaw },
}));

vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

type ActiveManifestContext = {
  performanceLabel: string;
  showtimeId: string;
  showtimeLabel: string;
};

function renderPanel(activeManifestContext?: ActiveManifestContext) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  render(<ReservationExportPanel activeManifestContext={activeManifestContext} />, { wrapper: Wrapper });
}

function csvResponse() {
  return new Response('"reservationNumber"\n"GRP-1"', {
    status: 200,
    headers: { 'content-disposition': 'attachment; filename="reservation-export-raw.csv"' },
  });
}

/** The export payload the panel sent, as the API receives it. */
function sentPayload(callIndex = 0) {
  const call = mocks.apiRaw.mock.calls[callIndex];
  expect(call?.[0]).toBe('POST');
  expect(call?.[1]).toBe('/api/v1/admin/bookings/export');
  expect(call?.[3]).toEqual({ showErrorToast: false });
  return call?.[2] as Record<string, unknown>;
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
    Object.defineProperty(URL, 'createObjectURL', {
      value: vi.fn(() => 'blob:http://localhost/reservation-export'),
      configurable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
    // jsdom does not navigate for the download anchor.
    HTMLAnchorElement.prototype.click = function click() {};
  });

  beforeEach(() => {
    mocks.apiRaw.mockReset().mockImplementation(async () => csvResponse());
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();
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

    expect(mocks.apiRaw).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'CSV 내보내기' }));

    await waitFor(() => expect(mocks.apiRaw).toHaveBeenCalledTimes(1));
    expect(sentPayload()).toEqual(expect.objectContaining({
      exportType: 'raw_pii',
      reason: '정산 대조',
    }));
  });

  it('closes the dialog and confirms the download once the CSV arrives', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: '예약자 원본 CSV 내보내기' }));
    await user.type(screen.getByLabelText('내보내기 사유'), '정산 대조');
    await user.click(screen.getByRole('button', { name: 'CSV 내보내기' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith('CSV 파일을 내려받았습니다.');
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('shows the server message and keeps the dialog open when the export fails (503)', async () => {
    const user = userEvent.setup();
    mocks.apiRaw.mockResolvedValueOnce(new Response(
      JSON.stringify({ statusCode: 503, message: '예매 내보내기 조회가 시간 초과로 중단되었습니다.' }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    ));
    renderPanel();

    await user.click(screen.getByRole('button', { name: '예약자 원본 CSV 내보내기' }));
    await user.type(screen.getByLabelText('내보내기 사유'), '정산 대조');
    await user.click(screen.getByRole('button', { name: 'CSV 내보내기' }));

    expect(await screen.findByText('예매 내보내기 조회가 시간 초과로 중단되었습니다.', { selector: '[role="alert"]' }))
      .toBeInTheDocument();
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).toHaveBeenCalledWith('예매 내보내기 조회가 시간 초과로 중단되었습니다.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('내보내기 사유')).toHaveValue('정산 대조');
    expect(mocks.toastSuccess).not.toHaveBeenCalled();

    // A retry that succeeds clears the error and closes the dialog.
    await user.click(screen.getByRole('button', { name: 'CSV 내보내기' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mocks.toastSuccess).toHaveBeenCalledWith('CSV 파일을 내려받았습니다.');
  });

  it('reports a network failure with the fallback message', async () => {
    const user = userEvent.setup();
    mocks.apiRaw.mockRejectedValueOnce(new Error(''));
    renderPanel();

    await user.click(screen.getByRole('button', { name: '실패/만료/취소 고객 CSV 내보내기' }));
    await user.type(screen.getByLabelText('내보내기 사유'), '실패 고객 안내');
    await user.click(screen.getByRole('button', { name: 'CSV 내보내기' }));

    const fallback = 'CSV 내보내기에 실패했습니다. 잠시 후 다시 시도해주세요.';
    expect(await screen.findByText(fallback, { selector: '[role="alert"]' })).toBeInTheDocument();
    expect(mocks.toastError).toHaveBeenCalledWith(fallback);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
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
    expect(
      screen.getByText(
        '고객 CSV에는 이름, 이메일, 전화번호, 마케팅 동의 여부, 실패/취소 사유와 취소 매출 정보가 포함됩니다.',
      ),
    ).toBeInTheDocument();

    const confirmButton = screen.getByRole('button', { name: 'CSV 내보내기' });
    expect(confirmButton).toBeDisabled();

    await user.type(screen.getByLabelText('내보내기 사유'), '실패 고객 안내');
    await user.click(confirmButton);

    await waitFor(() => expect(mocks.apiRaw).toHaveBeenCalledTimes(1));
    const payload = sentPayload();
    expect(payload).toEqual(expect.objectContaining({
      exportType: 'failed_cancelled_contacts',
      reason: '실패 고객 안내',
    }));
    expect(payload).not.toHaveProperty('reservationStatus');
    expect(payload).not.toHaveProperty('funnelStatus');
    expect(payload).not.toHaveProperty('tierName');
    expect(payload).not.toHaveProperty('zoneFloor');
  });

  it('exports payment failed and expired rows through the admin funnel status filter', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByLabelText('예매 상태'));
    await user.click(await screen.findByRole('option', { name: '결제 실패/만료' }));
    await user.click(screen.getByRole('button', { name: '예약자 원본 CSV 내보내기' }));
    await user.type(screen.getByLabelText('내보내기 사유'), '실패 고객 안내');
    await user.click(screen.getByRole('button', { name: 'CSV 내보내기' }));

    await waitFor(() => expect(mocks.apiRaw).toHaveBeenCalledTimes(1));
    const payload = sentPayload();
    expect(payload).toEqual(expect.objectContaining({
      exportType: 'raw_pii',
      reason: '실패 고객 안내',
      funnelStatus: 'PAYMENT_FAILED',
    }));
    expect(payload).not.toHaveProperty('reservationStatus');
  });

  it('keeps active ticket manifest export disabled until a showtime is selected', () => {
    renderPanel();

    const button = screen.getByRole('button', { name: '회차 구매자 명단 CSV' });

    expect(button).toBeDisabled();
    expect(
      screen.getByText('상단 공연과 회차 필터를 선택하면 활성화됩니다.'),
    ).toBeInTheDocument();
  });

  it('exports active ticket manifest with the selected showtime context after confirmation', async () => {
    const user = userEvent.setup();
    renderPanel({
      performanceLabel: 'Girl Rules Fanmeet',
      showtimeId: '11111111-1111-4111-8111-000000000302',
      showtimeLabel: '2026.07.18 19:00',
    });

    await user.click(screen.getByRole('button', { name: '회차 구매자 명단 CSV' }));

    expect(
      screen.getByRole('heading', { name: '회차 구매자 명단 CSV를 내보내시겠습니까?' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Girl Rules Fanmeet')).toBeInTheDocument();
    expect(screen.getByText('2026.07.18 19:00')).toBeInTheDocument();
    expect(screen.getByText('유효 티켓만 포함')).toBeInTheDocument();

    await user.type(screen.getByLabelText('내보내기 사유'), '현장 운영 명단');
    await user.click(screen.getByRole('button', { name: 'CSV 내보내기' }));

    await waitFor(() => expect(mocks.apiRaw).toHaveBeenCalledTimes(1));
    expect(sentPayload()).toEqual(expect.objectContaining({
      exportType: 'active_ticket_manifest',
      showtimeId: '11111111-1111-4111-8111-000000000302',
      reason: '현장 운영 명단',
    }));
  });
});
