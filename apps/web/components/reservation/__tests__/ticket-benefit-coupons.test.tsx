import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BenefitEntitlement, BenefitRedemptionResponse } from '@grabit/shared';
import { TicketBenefitCoupons, BENEFIT_USE_WARNINGS, BENEFIT_UNCERTAIN_WARNINGS } from '../ticket-benefit-coupons';
import { apiClient } from '@/lib/api-client';
import { useReservationDetail } from '@/hooks/use-reservations';
import { useAuthStore } from '@/stores/use-auth-store';

vi.mock('@/lib/api-client', () => ({ apiClient: { post: vi.fn(), get: vi.fn() } }));
const post = vi.mocked(apiClient.post);
const get = vi.mocked(apiClient.get);
const firstId = '00000000-0000-4000-8000-000000000811';
const secondId = '00000000-0000-4000-8000-000000000812';
const ticketItemId = '00000000-0000-4000-8000-000000000101';

function benefit(id = firstId, kind: 'paid' | 'included' = 'paid'): BenefitEntitlement {
  return { id, ticketItemId, showtimeId: '00000000-0000-4000-8000-000000000301', runId: null,
    source: kind === 'paid' ? 'purchase' : 'configuration', kind, benefitIdentity: kind === 'paid' ? 'hi-touch' : 'poster',
    displayCopy: { ko: { name: '하이터치', description: 'One benefit' }, en: { name: 'Hi-touch', description: 'One benefit' },
      'zh-CN': { name: '击掌', description: 'One benefit' }, th: { name: 'ไฮทัช', description: 'One benefit' } },
    state: 'active', assignedAt: '2026-11-09T00:00:00.000Z', redeemedAt: null, attachedToTicket: true } as BenefitEntitlement;
}
function redeemed(id = firstId): BenefitRedemptionResponse {
  return { outcome: 'redeemed', benefitEntitlement: { ...benefit(id), state: 'redeemed', redeemedAt: '2026-11-09T07:00:00.000Z' },
    redemptionEventId: '00000000-0000-4000-8000-000000000901', redeemedAt: '2026-11-09T07:00:00.000Z' };
}
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>{children}</QueryClientProvider>;
}
function show(props: Partial<React.ComponentProps<typeof TicketBenefitCoupons>> = {}) {
  return render(<TicketBenefitCoupons reservationId="reservation-a" ticketItemId={ticketItemId} benefits={[benefit(), benefit(secondId)]}
    ticketStatus="ACTIVE" token="private-test-token" seatLabel="1층 A-1" locale="ko" {...props} />, { wrapper });
}

beforeEach(() => {
  post.mockReset(); get.mockReset(); window.history.replaceState({}, '', '/');
  useAuthStore.setState({ user: { id: 'buyer-a' } as never, accessToken: 'test-buyer-a' });
});

describe('Buyer benefit coupons', () => {
  it.each(['ko', 'en', 'zh-CN', 'th'] as const)('shows all four warnings every time in %s and defaults focus to cancel', async (locale) => {
    show({ locale });
    fireEvent.click(within(screen.getByTestId(`benefit-coupon-${firstId}`)).getByRole('button'));
    const dialog = screen.getByRole('alertdialog');
    for (const warning of BENEFIT_USE_WARNINGS) expect(within(dialog).getByText(warning.text)).toHaveAttribute('lang', warning.lang);
    const cancel = within(dialog).getByRole('button', { name: /^(취소|Cancel|取消|ยกเลิก)$/ });
    expect(cancel).toHaveFocus();
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(cancel);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId(`benefit-coupon-${secondId}`)).getByRole('button'));
    for (const warning of BENEFIT_USE_WARNINGS) expect(screen.getByText(warning.text)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('confirms exactly one unit, blocks double clicks, and leaves the second purchased unit available', async () => {
    let resolve!: (value: BenefitRedemptionResponse) => void;
    post.mockImplementation(() => new Promise((done) => { resolve = done; }));
    show();
    fireEvent.click(within(screen.getByTestId(`benefit-coupon-${firstId}`)).getByRole('button'));
    const confirm = screen.getByRole('button', { name: '직원이 확인하고 1개 사용 처리' });
    fireEvent.click(confirm); fireEvent.click(confirm);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(confirm).toBeDisabled();
    expect(post).toHaveBeenCalledWith('/api/v1/tickets/benefits/redeem', expect.objectContaining({
      benefitEntitlementId: firstId, token: 'private-test-token', confirmed: true, deviceAttemptId: expect.any(String),
    }), { showErrorToast: false });
    await act(async () => resolve(redeemed()));
    await waitFor(() => expect(screen.getByText('사용 완료 · Used · 已使用 · ใช้แล้ว')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(within(screen.getByTestId(`benefit-coupon-${firstId}`)).queryByRole('button')).not.toBeInTheDocument();
    expect(within(screen.getByTestId(`benefit-coupon-${firstId}`)).getByText(/^사용 일시:/)).toBeInTheDocument();
    expect(within(screen.getByTestId(`benefit-coupon-${secondId}`)).getByRole('button')).toBeEnabled();
    expect(screen.queryByText('private-test-token')).not.toBeInTheDocument();
  });

  it('reuses a lost response attempt after closing and reopening instead of consuming again', async () => {
    post.mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce(redeemed());
    show();
    fireEvent.click(within(screen.getByTestId(`benefit-coupon-${firstId}`)).getByRole('button'));
    fireEvent.click(screen.getByRole('button', { name: '직원이 확인하고 1개 사용 처리' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '같은 시도의 결과 다시 확인' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    fireEvent.click(within(screen.getByTestId(`benefit-coupon-${firstId}`)).getByRole('button'));
    fireEvent.click(screen.getByRole('button', { name: '같은 시도의 결과 다시 확인' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1]?.[1]).toEqual(post.mock.calls[0]?.[1]);
    await screen.findByText('사용 완료 · Used · 已使用 · ใช้แล้ว');
  });

  it.each(['redeemed', 'duplicate'] as const)('recovers the same uncertain receipt after automatic refetch shows used (%s)', async (outcome) => {
    let serverUsed = false;
    get.mockImplementation(async () => ({ id: 'reservation-a', ticketItems: [{ id: ticketItemId, status: 'ACTIVE',
      qrCredential: { status: 'ACTIVE', token: serverUsed ? 'rotated-ticket-token' : 'private-test-token' },
      benefitEntitlements: [serverUsed ? redeemed().benefitEntitlement : benefit(), benefit(secondId)],
    }] }));
    post.mockImplementationOnce(async () => { serverUsed = true; throw new TypeError('Response lost after server commit'); });
    post.mockResolvedValueOnce(outcome === 'redeemed' ? redeemed() : { outcome: 'duplicate',
      benefitEntitlement: redeemed().benefitEntitlement, redemptionEventId: null,
      redeemedAt: '2026-11-09T07:00:00.000Z', priorRedemption: { redeemedAt: '2026-11-09T07:00:00.000Z' } });
    function LiveTicket() {
      const detail = useReservationDetail('reservation-a');
      const ticket = detail.data?.ticketItems[0];
      return ticket ? <TicketBenefitCoupons reservationId="reservation-a" ticketItemId={ticketItemId}
        benefits={ticket.benefitEntitlements} ticketStatus={ticket.status} token={ticket.qrCredential?.token ?? null}
        seatLabel="1층 A-1" locale="ko" /> : <p>Loading ticket</p>;
    }
    render(<LiveTicket />, { wrapper });
    const coupon = await screen.findByTestId(`benefit-coupon-${firstId}`);
    fireEvent.click(within(coupon).getByRole('button'));
    fireEvent.click(screen.getByRole('button', { name: '직원이 확인하고 1개 사용 처리' }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(within(coupon).getByText('사용됨')).toBeInTheDocument());
    const retry = screen.getByRole('button', { name: '같은 시도의 결과 다시 확인' });
    expect(retry).toBeEnabled();
    const holdWarning = screen.getByTestId('benefit-uncertain-warning');
    for (const warning of BENEFIT_UNCERTAIN_WARNINGS) expect(within(holdWarning).getByText(warning.text)).toHaveAttribute('lang', warning.lang);
    expect(screen.queryByText('사용 완료 · Used · 已使用 · ใช้แล้ว')).not.toBeInTheDocument();
    expect(screen.queryByTestId('benefit-duplicate-warning')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    fireEvent.click(within(coupon).getByRole('button', { name: /같은 시도의 결과 다시 확인/ }));
    fireEvent.click(screen.getByRole('button', { name: '같은 시도의 결과 다시 확인' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1]?.[1]).toEqual(post.mock.calls[0]?.[1]);
    expect(post.mock.calls[1]?.[1]).toMatchObject({ token: 'private-test-token' });
    if (outcome === 'redeemed') await screen.findByText('사용 완료 · Used · 已使用 · ใช้แล้ว');
    else await screen.findByText('이미 사용된 베네핏입니다. 다시 제공하지 마세요.');
    expect(screen.queryByRole('button', { name: '같은 시도의 결과 다시 확인' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(within(coupon).queryByRole('button')).not.toBeInTheDocument();
    expect(within(screen.getByTestId(`benefit-coupon-${secondId}`)).getByRole('button')).toBeEnabled();
  });

  it.each(['account', 'reservation', 'ticket'] as const)('does not transfer an uncertain receipt across a changed %s', async (scope) => {
    post.mockRejectedValueOnce(new TypeError('network'));
    const { rerender } = show({ benefits: [benefit()] });
    fireEvent.click(within(screen.getByTestId(`benefit-coupon-${firstId}`)).getByRole('button'));
    fireEvent.click(screen.getByRole('button', { name: '직원이 확인하고 1개 사용 처리' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '같은 시도의 결과 다시 확인' })).toBeEnabled());
    if (scope === 'account') act(() => useAuthStore.setState({ user: { id: 'buyer-b' } as never, accessToken: 'test-buyer-b' }));
    rerender(<TicketBenefitCoupons reservationId={scope === 'reservation' ? 'reservation-b' : 'reservation-a'}
      ticketItemId={scope === 'ticket' ? 'another-ticket' : ticketItemId}
      benefits={[{ ...benefit(), state: 'redeemed', redeemedAt: '2026-11-09T07:00:00.000Z' }]}
      ticketStatus="ACTIVE" token="another-token" seatLabel="1층 A-1" locale="ko" />);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('warns against another handover when a stale coupon was already used on another device', async () => {
    const previousUse = '2026-11-09T06:30:00.000Z';
    post.mockResolvedValueOnce({ outcome: 'duplicate', benefitEntitlement: {
      ...benefit(), state: 'redeemed', redeemedAt: previousUse,
    }, redemptionEventId: null, redeemedAt: previousUse, priorRedemption: { redeemedAt: previousUse } });
    show();
    fireEvent.click(within(screen.getByTestId(`benefit-coupon-${firstId}`)).getByRole('button'));
    fireEvent.click(screen.getByRole('button', { name: '직원이 확인하고 1개 사용 처리' }));
    const warning = await screen.findByRole('alert');
    expect(within(warning).getByText('이미 사용된 베네핏입니다. 다시 제공하지 마세요.')).toBeInTheDocument();
    expect(within(warning).getByText('This benefit has already been used. Do not provide it again.')).toBeInTheDocument();
    expect(within(warning).getByText('此权益已使用，请勿重复提供。')).toBeInTheDocument();
    expect(within(warning).getByText('สิทธิ์นี้ถูกใช้แล้ว ห้ามมอบสิทธิ์ซ้ำ')).toBeInTheDocument();
    expect(within(warning).getByText(/^이전 사용 시각:/)).toHaveTextContent('03:30');
    expect(screen.queryByText('사용 완료 · Used · 已使用 · ใช้แล้ว')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '직원이 확인하고 1개 사용 처리' })).not.toBeInTheDocument();
    expect(post).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(within(screen.getByTestId(`benefit-coupon-${firstId}`)).queryByRole('button')).not.toBeInTheDocument();
    expect(within(screen.getByTestId(`benefit-coupon-${secondId}`)).getByRole('button')).toBeEnabled();
  });

  it('shows an already-used warning when a refresh discovers redemption while the confirmation is open', () => {
    const { rerender } = show({ benefits: [benefit()] });
    fireEvent.click(within(screen.getByTestId(`benefit-coupon-${firstId}`)).getByRole('button'));
    rerender(<TicketBenefitCoupons reservationId="reservation-a" ticketItemId={ticketItemId}
      benefits={[{ ...benefit(), state: 'redeemed', redeemedAt: '2026-11-09T06:30:00.000Z' }]}
      ticketStatus="ACTIVE" token="private-test-token" seatLabel="1층 A-1" locale="ko" />);
    const warning = screen.getByRole('alert');
    expect(within(warning).getByText('이미 사용된 베네핏입니다. 다시 제공하지 마세요.')).toBeInTheDocument();
    expect(within(warning).getByText('This benefit has already been used. Do not provide it again.')).toBeInTheDocument();
    expect(within(warning).getByText('此权益已使用，请勿重复提供。')).toBeInTheDocument();
    expect(within(warning).getByText('สิทธิ์นี้ถูกใช้แล้ว ห้ามมอบสิทธิ์ซ้ำ')).toBeInTheDocument();
    expect(within(warning).getByText(/^이전 사용 시각:/)).toHaveTextContent('03:30');
    expect(screen.queryByText('사용 완료 · Used · 已使用 · ใช้แล้ว')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '직원이 확인하고 1개 사용 처리' })).not.toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it.each(['CANCELLED', 'CANCELLATION_PENDING', 'EXPIRED'] as const)('prevents use for a %s ticket while keeping the benefit history', (ticketStatus) => {
    show({ ticketStatus });
    expect(screen.getAllByText('하이터치', { exact: false })).toHaveLength(2);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('supports the same flow for included benefits and disables a missing active credential', () => {
    show({ benefits: [benefit(firstId, 'included')], token: null });
    expect(screen.getByText('포함')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '하이터치 현장 사용' })).toBeDisabled();
  });
});
