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
import { OfflineSyncStatus } from '../offline-sync-status';

const scannerUser = {
  id: 'scanner-user-1',
  name: '현장 스태프',
  role: 'admin',
  adminCapabilityBundle: 'scanner',
  adminCapabilities: ['field.scan.verify', 'field.scan.consume', 'field.scan.sync', 'field.benefits.redeem'],
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
    const processButton = within(actionArea).getByRole('button', { name: '이 좌석 입장 처리' });

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
    expect(screen.queryByRole('button', { name: '이 좌석 입장 처리' })).not.toBeInTheDocument();
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

  it('does not render benefit redemption actions for wrong-showtime scans', () => {
    renderScanner({
      verification: {
        ...baseVerification,
        result: 'wrong-showtime',
        resultLabel: '현재 회차의 티켓이 아닙니다',
        processable: false,
        benefitEntitlements: [includedBenefit()],
      },
    });

    const panel = screen.getByTestId('scanner-benefit-panel');
    expect(within(panel).getByText('공식 포스터')).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: '사용 처리' })).not.toBeInTheDocument();
  });

  it('keeps entry disabled but allows active benefit redemption for already-used tickets', async () => {
    const user = userEvent.setup();
    renderScanner({
      verification: {
        ...baseVerification,
        result: 'duplicate',
        resultLabel: '이미 입장 처리된 티켓입니다',
        processable: false,
        ticketStatus: 'USED',
        benefitEntitlements: [includedBenefit()],
      },
    });

    expect(screen.queryByRole('button', { name: '이 좌석 입장 처리' })).not.toBeInTheDocument();
    expect(screen.getByText('이 검표 결과에서는 입장 처리를 진행할 수 없습니다.'))
      .toBeInTheDocument();

    const benefit = screen.getByTestId(`scanner-benefit-${includedBenefitId}`);
    const redeemButton = within(benefit).getByRole('button', { name: '사용 처리' });
    await user.click(redeemButton);

    expect(onRedeemBenefit).toHaveBeenCalledWith(includedBenefitId);
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

describe('ScannerCheckIn unverifiable QR identity (field-ops-5)', () => {
  it.each(['tampered', 'rejected'] as const)('leaves out the ticket card for a %s QR that identifies no ticket', (result) => {
    renderScanner({
      verification: {
        result,
        resultLabel: '확인할 수 없는 QR입니다',
        processable: false,
        seats: [],
        offlineQueue: [],
        benefitEntitlements: [],
      },
    });

    expect(screen.getByRole('status', { name: '확인할 수 없는 QR입니다' })).toBeInTheDocument();
    expect(screen.queryByText('티켓 정보')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('확인 중');
    expect(screen.queryByText('검표 확인')).not.toBeInTheDocument();
  });

  it('shows settled wording, never "확인 중", for fields a verified result does not carry', () => {
    renderScanner({
      verification: {
        result: 'tampered',
        resultLabel: '확인할 수 없는 QR입니다',
        processable: false,
        reservationNumber: 'GRP-27-SCAN-0009',
        seats: [],
        offlineQueue: [],
        benefitEntitlements: [],
      },
    });

    expect(screen.getByText('티켓 정보')).toBeInTheDocument();
    expect(screen.getByText('좌석 확인 불가')).toBeInTheDocument();
    expect(screen.getAllByText('확인 불가').length).toBeGreaterThan(0);
    expect(screen.getByText('검증 실패')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('확인 중');
  });

  it('keeps in-progress wording for the loading state only', () => {
    renderScanner({ verification: null });

    expect(screen.getByText('QR 티켓을 확인하고 있습니다')).toBeInTheDocument();
  });
});

describe('ScannerCheckIn access denied (field-ops-4)', () => {
  it('lets the person switch accounts or go home instead of a dead end', async () => {
    const user = userEvent.setup();
    const onSwitchAccount = vi.fn();
    renderScanner({ user: regularUser, hasTicket: false, onSwitchAccount, verification: null });

    expect(screen.getByRole('heading', { name: '검표 권한이 없습니다' })).toBeInTheDocument();
    expect(screen.queryByText('이 티켓을 검표할 권한이 없습니다')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '홈으로' })).toHaveAttribute('href', '/');

    await user.click(screen.getByRole('button', { name: '다른 계정으로 로그인' }));
    expect(onSwitchAccount).toHaveBeenCalledTimes(1);
  });

  it('names the ticket only when one was scanned and offers no login button without a handler', () => {
    renderScanner({ user: regularUser });

    expect(screen.getByRole('heading', { name: '이 티켓을 검표할 권한이 없습니다' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '다른 계정으로 로그인' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '홈으로' })).toBeInTheDocument();
  });
});

describe('OfflineSyncStatus receipts (field-ops-2, field-ops-9)', () => {
  const pendingItem = { deviceAttemptId: 'held-1', state: 'pending' as const, attemptedAt: '2026-07-04T09:59:00.000Z', seatLabel: '1층 · VIP · A-1' };
  const syncedItem = { deviceAttemptId: 'synced-1', state: 'synced' as const, attemptedAt: '2026-07-04T10:00:00.000Z', reason: '보류 스캔 동기화 완료' };
  const rejectedItem = { deviceAttemptId: 'rejected-1', state: 'rejected' as const, attemptedAt: '2026-07-04T10:01:00.000Z', reason: '이미 입장 처리된 티켓입니다' };

  it('folds settled receipts into one summary line when nothing is held', () => {
    render(<OfflineSyncStatus queue={[syncedItem, rejectedItem]} isSyncing={false} onSyncOffline={vi.fn()} />);

    const receipts = screen.getByTestId('offline-sync-receipts');
    expect(receipts.tagName).toBe('DETAILS');
    expect(receipts).not.toHaveAttribute('open');
    expect(within(receipts).getByText('보류 스캔 0건 · 동기화 완료 1건 · 거절 1건 보기')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '보류 스캔 동기화' })).not.toBeInTheDocument();
  });

  it('keeps held entries open and settled receipts folded below them', () => {
    render(<OfflineSyncStatus queue={[pendingItem, syncedItem]} isSyncing={false} onSyncOffline={vi.fn()} />);

    const receipts = screen.getByTestId('offline-sync-receipts');
    expect(receipts).not.toHaveAttribute('open');
    expect(within(receipts).getByText('동기화 완료 1건 · 거절 0건 보기')).toBeInTheDocument();
    expect(within(receipts).getByText('보류 스캔 동기화 완료')).toBeInTheDocument();
    const heldRow = screen.getAllByTestId('offline-sync-row').find((row) => !receipts.contains(row))!;
    expect(within(heldRow).getByText('1층 · VIP · A-1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '보류 스캔 동기화' })).toBeEnabled();
  });

  it('labels a row state once, in a badge that does not wrap', () => {
    render(<OfflineSyncStatus queue={[pendingItem]} isSyncing={false} onSyncOffline={vi.fn()} />);

    const row = screen.getByTestId('offline-sync-row');
    const badges = within(row).getAllByText('동기화 대기');
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveClass('whitespace-nowrap', 'break-keep');
    expect(row.textContent).not.toContain('· 동기화 대기');
  });

  it('omits the seat line for records saved before seats were recorded', () => {
    render(<OfflineSyncStatus queue={[{ ...pendingItem, seatLabel: undefined }]} isSyncing={false} onSyncOffline={vi.fn()} />);

    expect(screen.getByTestId('offline-sync-row')).not.toHaveTextContent('VIP');
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
        token: '',
        syncState: 'synced',
        lastSyncAttemptAt: '2026-07-04T10:03:00.000Z',
      },
    ]);

    await removePendingScanAttempt(pending.deviceAttemptId);
    await expect(listPendingScanAttempts()).resolves.toEqual([]);
  });

  it('keeps the seat label of a held entry through sync and accepts records without one', async () => {
    const base = { scannerUserId: 'scanner-user-1', eventId: 'event-phase27', showtimeId: '00000000-0000-4000-8000-000000000027',
      token: 'opaque-ticket-token', redactedTokenRef: 'tok_abc...7890', attemptedAt: '2026-07-04T09:59:00.000Z', syncState: 'pending' as const };
    await addPendingScanAttempt({ ...base, deviceAttemptId: 'with-seat', seatLabel: '1층 · VIP · A-1' });
    await addPendingScanAttempt({ ...base, deviceAttemptId: 'legacy', token: 'other-token' });
    await updatePendingScanAttempt('with-seat', { syncState: 'synced' });

    const records = await listPendingScanAttempts();
    expect(records.find((record) => record.deviceAttemptId === 'with-seat')).toMatchObject({ seatLabel: '1층 · VIP · A-1', token: '' });
    expect(records.find((record) => record.deviceAttemptId === 'legacy')).not.toHaveProperty('seatLabel');
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
  it('never turns a terminal sync receipt back into pending when another tab responds late', async () => {
    await addPendingScanAttempt({ deviceAttemptId: 'late-tab-attempt', scannerUserId: 'scanner-1', eventId: 'event-1', showtimeId: 'showtime-1',
      token: 'pending-token', redactedTokenRef: 'redacted', attemptedAt: new Date().toISOString(), syncState: 'pending' });
    await updatePendingScanAttempt('late-tab-attempt', { syncState: 'synced', result: 'processed', scanEventId: 'server-receipt' });
    await updatePendingScanAttempt('late-tab-attempt', { syncState: 'pending', result: 'offline-pending', scanEventId: null });
    expect(await listPendingScanAttempts({ scannerUserId: 'scanner-1' })).toEqual([expect.objectContaining({
      syncState: 'synced', token: '', result: 'processed', scanEventId: 'server-receipt',
    })]);
  });

});
