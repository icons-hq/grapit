import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FieldBenefitEntitlement } from '@grabit/shared';
import {
  addPendingScanAttempt,
  clearPendingScanAttempts,
  listPendingScanAttempts,
  removePendingScanAttempt,
  updatePendingScanAttempt,
  type PendingScanAttemptRecord,
} from '@/lib/field/offline-scan-store';
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

const includedBenefitId = '00000000-0000-4000-8000-000000000801';
const limitedBenefitId = '00000000-0000-4000-8000-000000000802';
const inactiveBenefitId = '00000000-0000-4000-8000-000000000803';
const benefitRunId = '00000000-0000-4000-8000-000000000701';

function benefitDisplayCopy(name: string) {
  return {
    ko: { name, description: `${name} 설명` },
    en: { name, description: `${name} description` },
    'zh-CN': { name, description: `${name} 说明` },
    th: { name, description: `${name} description` },
  };
}

function includedBenefit(
  overrides: Partial<FieldBenefitEntitlement> = {},
): FieldBenefitEntitlement {
  return {
    id: includedBenefitId,
    runId: null,
    source: 'configuration',
    benefitIdentity: 'benefit_official_poster',
    kind: 'included',
    displayCopy: benefitDisplayCopy('공식 포스터'),
    state: 'active',
    redeemedAt: null,
    attachedToTicket: true,
    ...overrides,
  } as FieldBenefitEntitlement;
}

function limitedBenefit(
  overrides: Partial<FieldBenefitEntitlement> = {},
): FieldBenefitEntitlement {
  return {
    id: limitedBenefitId,
    runId: benefitRunId,
    source: 'live_run',
    runMode: 'live',
    benefitIdentity: 'benefit_6_to_1',
    kind: 'limited',
    displayCopy: benefitDisplayCopy('6:1 이벤트 참여권'),
    state: 'redeemed',
    redeemedAt: '2026-07-04T08:30:00.000Z',
    attachedToTicket: true,
    ...overrides,
  } as FieldBenefitEntitlement;
}

const baseVerification = {
  result: 'processable',
  resultLabel: '입장 가능 티켓입니다',
  processable: true,
  reservationNumber: 'GRP-27-SCAN-0001',
  performanceTitle: 'Phase 27 Field Operations',
  showtimeAt: '2026-07-04T10:00:00.000Z',
  venueName: 'Phase 27 Hall',
  seats: ['VIP A열 1번'],
  ticketStatus: 'ACTIVE',
  offlineQueue: [],
  benefitEntitlements: [],
} as const;

const onProcessEntry = vi.fn();
const onSyncOffline = vi.fn();
const onRedeemBenefit = vi.fn();

function renderScanner(
  overrides: Partial<React.ComponentProps<typeof ScannerCheckIn>> = {},
) {
  render(
    <ScannerCheckIn
      user={scannerUser}
      verification={baseVerification}
      onProcessEntry={onProcessEntry}
      onRedeemBenefit={onRedeemBenefit}
      onSyncOffline={onSyncOffline}
      {...overrides}
    />,
  );
}

describe('ScannerCheckIn', () => {
  beforeEach(() => {
    onProcessEntry.mockReset();
    onSyncOffline.mockReset();
    onRedeemBenefit.mockReset();
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
        processable: false,
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
        processable: false,
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

  it('shows offline sync status before ticket details with pending, synced, and rejected rows', () => {
    renderScanner({
      verification: {
        ...baseVerification,
        offlineQueue: [
          {
            deviceAttemptId: 'device-attempt-pending',
            state: 'pending',
            attemptedAt: '2026-07-04T09:59:00.000Z',
          },
          {
            deviceAttemptId: 'device-attempt-synced',
            state: 'synced',
            attemptedAt: '2026-07-04T10:00:00.000Z',
            reason: '보류 스캔 동기화 완료',
          },
          {
            deviceAttemptId: 'device-attempt-rejected',
            state: 'rejected',
            attemptedAt: '2026-07-04T10:01:00.000Z',
            reason: '이미 입장 처리된 티켓입니다',
          },
        ],
      },
    });

    const syncStatus = screen.getByTestId('offline-sync-status');
    const ticketInfo = screen.getByText('티켓 정보');
    const position = syncStatus.compareDocumentPosition(ticketInfo);

    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('보류 1')).toBeInTheDocument();
    expect(screen.getByText('동기화 1')).toBeInTheDocument();
    expect(screen.getByText('거절 1')).toBeInTheDocument();
    expect(screen.getByText('보류 스캔 동기화 완료')).toBeInTheDocument();
    expect(screen.getByText('이미 입장 처리된 티켓입니다')).toBeInTheDocument();
  });

  it('shows ALL and limited benefits to scanners and redeems only active benefits', async () => {
    const user = userEvent.setup();
    renderScanner({
      verification: {
        ...baseVerification,
        benefitEntitlements: [
          includedBenefit(),
          limitedBenefit(),
          includedBenefit({
            id: inactiveBenefitId,
            displayCopy: benefitDisplayCopy('취소 좌석 혜택'),
            state: 'inactive',
          }),
        ],
      },
    });

    const panel = screen.getByTestId('scanner-benefit-panel');
    expect(within(panel).getByText('티켓 혜택')).toBeInTheDocument();
    expect(within(panel).getAllByText('ALL')).toHaveLength(2);
    expect(within(panel).getByText('한정')).toBeInTheDocument();
    expect(within(panel).getByText('공식 포스터')).toBeInTheDocument();
    expect(within(panel).getByText('공식 포스터 설명')).toBeInTheDocument();
    expect(within(panel).getByText('6:1 이벤트 참여권')).toBeInTheDocument();
    expect(within(panel).getByText('사용됨')).toBeInTheDocument();
    expect(within(panel).getByText(/^사용 일시:/)).toBeInTheDocument();
    expect(within(panel).getByText('취소 좌석 혜택')).toBeInTheDocument();
    expect(within(panel).getByText('비활성')).toBeInTheDocument();

    const activeBenefit = within(panel).getByTestId(`scanner-benefit-${includedBenefitId}`);
    const redeemButton = within(activeBenefit).getByRole('button', { name: '사용 처리' });
    await user.click(redeemButton);

    expect(onRedeemBenefit).toHaveBeenCalledWith(includedBenefitId);
    expect(within(panel).getAllByRole('button', { name: '사용 처리' })).toHaveLength(1);
  });

  it('shows redemption results immediately and disables repeated benefit use', () => {
    renderScanner({
      verification: {
        ...baseVerification,
        benefitEntitlements: [includedBenefit()],
      },
      benefitRedemptionResults: {
        [includedBenefitId]: {
          outcome: 'redeemed',
          outcomeLabel: '혜택 사용 처리 완료',
          redeemedAt: '2026-07-04T08:45:00.000Z',
        },
      },
    });

    const benefit = screen.getByTestId(`scanner-benefit-${includedBenefitId}`);
    expect(within(benefit).getByText('혜택 사용 처리 완료')).toBeInTheDocument();
    expect(within(benefit).getByText(/^사용 일시:/)).toBeInTheDocument();
    expect(within(benefit).queryByRole('button', { name: '사용 처리' })).not.toBeInTheDocument();
  });

  it('shows benefits without redemption actions when consume permission is not wired', () => {
    renderScanner({
      verification: {
        ...baseVerification,
        benefitEntitlements: [includedBenefit()],
      },
      onRedeemBenefit: undefined,
    });

    const panel = screen.getByTestId('scanner-benefit-panel');
    expect(within(panel).getByText('공식 포스터')).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: '사용 처리' })).not.toBeInTheDocument();
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

describe('offline pending scan store', () => {
  beforeEach(async () => {
    await clearPendingScanAttempts();
  });

  it('adds, lists, updates, and removes safe pending scan attempt metadata', async () => {
    const pending: PendingScanAttemptRecord = {
      deviceAttemptId: 'device-attempt-store-1',
      scannerUserId: 'scanner-user-1',
      eventId: 'event-phase27',
      showtimeId: '00000000-0000-4000-8000-000000000027',
      token: 'opaque-ticket-token',
      redactedTokenRef: 'tok_abc...7890',
      attemptedAt: '2026-07-04T09:59:00.000Z',
      syncState: 'pending',
    };

    await addPendingScanAttempt(pending);
    await expect(listPendingScanAttempts()).resolves.toEqual([pending]);

    await updatePendingScanAttempt(pending.deviceAttemptId, {
      syncState: 'synced',
      lastSyncAttemptAt: '2026-07-04T10:03:00.000Z',
    });

    await expect(listPendingScanAttempts()).resolves.toEqual([
      {
        ...pending,
        syncState: 'synced',
        lastSyncAttemptAt: '2026-07-04T10:03:00.000Z',
      },
    ]);

    await removePendingScanAttempt(pending.deviceAttemptId);
    await expect(listPendingScanAttempts()).resolves.toEqual([]);
  });

  it('persists the verifiable QR token for server sync without raw JTI, URLs, payment keys, cookies, IP, or buyer PII', async () => {
    await addPendingScanAttempt({
      deviceAttemptId: 'device-attempt-safe-1',
      scannerUserId: 'scanner-user-1',
      eventId: 'event-phase27',
      showtimeId: '00000000-0000-4000-8000-000000000027',
      token: 'opaque-ticket-token',
      redactedTokenRef: 'tok_abc...7890',
      attemptedAt: '2026-07-04T09:59:00.000Z',
      syncState: 'pending',
    });

    const [stored] = await listPendingScanAttempts();

    expect(stored).toEqual({
      deviceAttemptId: 'device-attempt-safe-1',
      scannerUserId: 'scanner-user-1',
      eventId: 'event-phase27',
      showtimeId: '00000000-0000-4000-8000-000000000027',
      token: 'opaque-ticket-token',
      redactedTokenRef: 'tok_abc...7890',
      attemptedAt: '2026-07-04T09:59:00.000Z',
      syncState: 'pending',
    });
    expect(stored?.token).toBe('opaque-ticket-token');
    expect(stored).not.toHaveProperty('rawToken');
    expect(stored).not.toHaveProperty('rawJti');
    expect(stored).not.toHaveProperty('qrUrl');
    expect(stored).not.toHaveProperty('buyerEmail');
    expect(stored).not.toHaveProperty('buyerPhone');
    expect(stored).not.toHaveProperty('paymentKey');
    expect(stored).not.toHaveProperty('cookie');
    expect(stored).not.toHaveProperty('ipAddress');
  });
});
