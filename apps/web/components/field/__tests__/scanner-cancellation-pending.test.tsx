import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import type { FieldCheckInConsumeResponse, FieldCheckInVerifyResponse } from '@grabit/shared';
import { normalizeConsumeResponse, normalizeVerifyResponse } from '@/hooks/use-field-operations';
import { ScannerCheckIn } from '../scanner-check-in';

// Audit #115: a seat whose cancellation is requested but not confirmed by the PG
// keeps outcome refunded_cancelled. The API adds a headline (resultLabel) and a
// machine-readable flag so staff do not see "refunded" next to "not yet refunded".

const scannerUser = {
  id: 'scanner-user-1',
  name: '현장 스태프',
  role: 'admin',
  adminCapabilityBundle: 'scanner',
  adminCapabilities: ['field.scan.verify', 'field.scan.consume', 'field.scan.sync'],
} as const;

const PENDING_LABEL = '취소 처리 중 · 입장 불가';
const PENDING_REASON =
  '취소 처리 중인 티켓입니다. 환불이 확정되지 않았으니 입장시키지 말고 현장 책임자에게 확인해주세요';
const REFUNDED_LABEL = '환불 또는 취소된 티켓입니다';

function ticketContext(cancellationPending: boolean) {
  return {
    reservationNumber: 'GRP-115-PENDING',
    performanceTitle: 'Pending Cancellation Hall',
    showtimeId: '00000000-0000-4000-8000-000000000301',
    showtimeLabel: '2026-07-04T10:00:00.000Z',
    seatLabels: ['1층 · VIP A열 1번'],
    ticketStatus: 'REVOKED' as const,
    redactedTokenRef: 'tok_redacted',
    benefitEntitlements: [],
    cancellationPending,
  };
}

function renderScanner(props: Partial<React.ComponentProps<typeof ScannerCheckIn>>) {
  render(
    <ScannerCheckIn
      user={scannerUser}
      onProcessEntry={vi.fn()}
      onSyncOffline={vi.fn()}
      {...props}
    />,
  );
}

describe('scanner result for a pending cancellation', () => {
  it('shows the server headline instead of the refunded label on verify', () => {
    const response: FieldCheckInVerifyResponse = {
      outcome: 'refunded_cancelled',
      processable: false,
      ticket: ticketContext(true),
      resultLabel: PENDING_LABEL,
      rejectionReason: PENDING_REASON,
      verifiedAt: '2026-07-04T09:59:00.000Z',
    };

    renderScanner({ verification: normalizeVerifyResponse(response) });

    expect(screen.getByRole('status', { name: PENDING_LABEL })).toHaveTextContent(PENDING_REASON);
    expect(screen.queryByText(REFUNDED_LABEL)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '이 좌석 입장 처리' })).not.toBeInTheDocument();
  });

  it('keeps the pending headline on a consume result', () => {
    const verify: FieldCheckInVerifyResponse = {
      outcome: 'processable',
      processable: true,
      ticket: { ...ticketContext(false), ticketStatus: 'ACTIVE' },
      rejectionReason: null,
      verifiedAt: '2026-07-04T09:59:00.000Z',
    };
    const consume: FieldCheckInConsumeResponse = {
      outcome: 'refunded_cancelled',
      ticket: ticketContext(true),
      scanEventId: 'scan-event-1',
      consumedAt: null,
      resultLabel: PENDING_LABEL,
      rejectionReason: PENDING_REASON,
    };

    renderScanner({
      verification: normalizeVerifyResponse(verify),
      consumeResult: normalizeConsumeResponse(consume),
    });

    expect(screen.getByRole('status', { name: PENDING_LABEL })).toHaveTextContent(PENDING_REASON);
    expect(screen.queryByText(REFUNDED_LABEL)).not.toBeInTheDocument();
  });

  it('still reports a completed refund with the refunded label', () => {
    const response: FieldCheckInVerifyResponse = {
      outcome: 'refunded_cancelled',
      processable: false,
      ticket: ticketContext(false),
      rejectionReason: '취소 또는 환불된 티켓입니다',
      verifiedAt: '2026-07-04T09:59:00.000Z',
    };

    renderScanner({ verification: normalizeVerifyResponse(response) });

    expect(screen.getByRole('status', { name: REFUNDED_LABEL })).toBeInTheDocument();
    expect(screen.queryByText(PENDING_LABEL)).not.toBeInTheDocument();
  });
});
