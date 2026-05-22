import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScannerCheckIn } from '../scanner-check-in';

const scannerUser = {
  id: 'scanner-user-1',
  name: '현장 스태프',
  role: 'admin',
  adminCapabilityBundle: 'scanner',
  adminCapabilities: ['field.scan.verify', 'field.scan.consume', 'field.scan.sync'],
} as const;

const regularUser = {
  id: 'regular-user-1',
  name: '일반 회원',
  role: 'user',
  adminCapabilityBundle: null,
  adminCapabilities: [],
} as const;

const baseVerification = {
  result: 'processable',
  resultLabel: '입장 가능 티켓입니다',
  reservationNumber: 'GRP-27-SCAN-0001',
  performanceTitle: 'Phase 27 Field Operations',
  showtimeAt: '2026-07-04T10:00:00.000Z',
  venueName: 'Phase 27 Hall',
  seats: ['VIP A열 1번'],
  ticketStatus: 'ACTIVE',
  offlineQueue: [],
} as const;

const onProcessEntry = vi.fn();
const onSyncOffline = vi.fn();

function renderScanner(
  overrides: Partial<React.ComponentProps<typeof ScannerCheckIn>> = {},
) {
  render(
    <ScannerCheckIn
      user={scannerUser}
      verification={baseVerification}
      onProcessEntry={onProcessEntry}
      onSyncOffline={onSyncOffline}
      {...overrides}
    />,
  );
}

describe('ScannerCheckIn', () => {
  beforeEach(() => {
    onProcessEntry.mockReset();
    onSyncOffline.mockReset();
  });

  it('shows verify-first UI and a sticky full-width mobile 입장 처리 action only for processable tickets', async () => {
    const user = userEvent.setup();
    renderScanner();

    expect(screen.getByText('입장 가능 티켓입니다')).toBeInTheDocument();
    expect(screen.queryByText('입장 처리가 완료되었습니다')).not.toBeInTheDocument();
    expect(screen.getByText('GRP-27-SCAN-0001')).toBeInTheDocument();
    expect(screen.getByText('Phase 27 Field Operations')).toBeInTheDocument();

    const actionArea = screen.getByTestId('scanner-sticky-action');
    const processButton = within(actionArea).getByRole('button', { name: '입장 처리' });

    expect(actionArea).toHaveClass('sticky', 'bottom-0');
    expect(processButton).toHaveClass('w-full');
    expect(processButton).not.toBeDisabled();

    await user.click(processButton);

    expect(onProcessEntry).toHaveBeenCalledTimes(1);
  });

  it('does not render raw token, JTI, or full check-in URL text', () => {
    const rawToken = 'raw-token-phase27-check-in-should-not-render';
    const rawJti = 'raw-JTI-phase27-check-in-should-not-render';
    const fullUrl = `https://heygrabit.com/field/check-in?ticket=${rawToken}`;

    renderScanner({
      verification: {
        ...baseVerification,
        rawToken,
        rawJti,
        qrUrl: fullUrl,
        redactedTokenRef: rawToken,
        maskedJti: rawJti,
      } as unknown as typeof baseVerification,
    });

    expect(document.body).not.toHaveTextContent(rawToken);
    expect(document.body).not.toHaveTextContent(rawJti);
    expect(document.body).not.toHaveTextContent(fullUrl);
  });

  it.each([
    ['duplicate', '이미 입장 처리된 티켓입니다'],
    ['refunded', '환불 또는 취소된 티켓입니다'],
    ['tampered', '확인할 수 없는 QR입니다'],
    ['wrong-showtime', '현재 회차의 티켓이 아닙니다'],
  ] as const)('disables 입장 처리 for %s scanner result', (result, resultLabel) => {
    renderScanner({
      verification: {
        ...baseVerification,
        result,
        resultLabel,
      },
    });

    expect(screen.getByText(resultLabel)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '입장 처리' })).not.toBeInTheDocument();
  });

  it('shows offline pending as non-final evidence until server sync succeeds', () => {
    renderScanner({
      verification: {
        ...baseVerification,
        result: 'offline-pending',
        resultLabel: '네트워크 문제로 보류 스캔에 저장했습니다. 연결이 복구되면 서버와 동기화하세요.',
        offlineQueue: [
          {
            deviceAttemptId: 'device-attempt-1',
            state: 'pending',
            attemptedAt: '2026-07-04T09:59:00.000Z',
          },
        ],
      },
    });

    expect(
      screen.getByText('네트워크 문제로 보류 스캔에 저장했습니다. 연결이 복구되면 서버와 동기화하세요.'),
    ).toBeInTheDocument();
    expect(screen.getByText('보류 상태는 최종 입장 증거가 아닙니다')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '보류 스캔 동기화' })).toBeEnabled();
  });

  it('denies regular members and keeps scanner-only users out of the full admin sidebar', () => {
    renderScanner({ user: regularUser });

    expect(screen.getByText('이 티켓을 검표할 권한이 없습니다')).toBeInTheDocument();
    expect(screen.queryByText('예매 관리')).not.toBeInTheDocument();
    expect(screen.queryByText('회원 관리')).not.toBeInTheDocument();
    expect(screen.queryByText('정산·내보내기')).not.toBeInTheDocument();
    expect(screen.queryByText('보안')).not.toBeInTheDocument();
  });
});
