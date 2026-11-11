import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SignupMonitoringResponse } from '@grabit/shared';
import { SignupMonitoringPanel } from '../signup-monitoring-panel';

const hook = vi.hoisted(() => ({ useSignupMonitoring: vi.fn() }));
vi.mock('@/hooks/use-signup-monitoring', () => hook);
vi.mock('next/dynamic', () => ({ default: () => () => <div>시간대별 차트</div> }));
const data: SignupMonitoringResponse = {
  since: '2026-11-10T15:00:00.000Z', until: '2026-11-11T06:00:00.000Z', previousSince: '2026-11-10T00:00:00.000Z', generatedAt: '2026-11-11T06:00:00.000Z',
  summary: { signups: 4, previousSignups: 0, change: 4, changeRate: null, emailVerified: 3, phoneVerified: 2, marketingConsented: 1, firstPaidMembers: 1, firstPaidRate: 25 },
  hourly: [{ hour: '2026-11-11 00:00', signups: 4 }], providers: [{ value: 'email', count: 4, rate: 100 }], countries: [{ value: 'KR', count: 4, rate: 100 }], locales: [{ value: 'ko', count: 4, rate: 100 }],
};
describe('SignupMonitoringPanel', () => {
  beforeEach(() => {
    const saved = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) });
    hook.useSignupMonitoring.mockReturnValue({ data, isPending: false, isError: false, isFetching: false, refetch: vi.fn() });
  });
  afterEach(() => vi.unstubAllGlobals());
  it('shows last refresh, exact comparison range, denominator and account inclusion rules', () => {
    render(<SignupMonitoringPanel />);
    expect(screen.getByText(/마지막 갱신: 2026-11-11 15:00:00/)).toBeInTheDocument();
    expect(screen.getByText(/이전 0명으로 증감률 미산출/)).toBeInTheDocument();
    expect(screen.getByText(/탈퇴 계정은 포함하고 병합 계정/)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '가입 → 첫 결제 전환율' })).toHaveTextContent('25.0%');
    expect(screen.getByText(/60초마다 자동 갱신/)).toBeInTheDocument();
  });
  it('applies a KST announcement timestamp and saves it only in this browser', async () => {
    const chosen = new Date(Date.now() - 3_600_000).toISOString();
    const local = new Date(Date.parse(chosen) + 9 * 3_600_000).toISOString().slice(0, 16);
    render(<SignupMonitoringPanel />);
    fireEvent.change(screen.getByLabelText('공지 시각 (KST)'), { target: { value: local } });
    fireEvent.click(screen.getByText('기준 시각 적용'));
    await waitFor(() => expect(hook.useSignupMonitoring).toHaveBeenLastCalledWith({ period: 'announcement', since: new Date(local + ':00+09:00').toISOString() }));
    expect(localStorage.getItem('grabit-signup-announcement-v1')).toBe(new Date(local + ':00+09:00').toISOString());
    fireEvent.click(screen.getByRole('radio', { name: '최근 7일' }));
    expect(hook.useSignupMonitoring).toHaveBeenLastCalledWith({ period: '7d' });
  });
  it('renders a loading state and a retryable error without presenting stale data as current', () => {
    hook.useSignupMonitoring.mockReturnValue({ isPending: true });
    const { rerender } = render(<SignupMonitoringPanel />);
    expect(screen.getByRole('status', { name: '가입 통계 불러오는 중' })).toBeInTheDocument();
    const refetch = vi.fn(); hook.useSignupMonitoring.mockReturnValue({ data, isError: true, refetch }); rerender(<SignupMonitoringPanel />);
    expect(screen.getByRole('alert')).toHaveTextContent('가입 통계를 불러오지 못했습니다');
    expect(screen.queryByText('신규 가입')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('다시 시도')); expect(refetch).toHaveBeenCalled();
  });
  it('distinguishes a real zero from loading and errors', () => {
    hook.useSignupMonitoring.mockReturnValue({ data: { ...data, summary: { ...data.summary, signups: 0 } }, isPending: false });
    render(<SignupMonitoringPanel />); expect(screen.getByText('선택한 기간에 신규 가입이 없습니다.')).toBeInTheDocument();
  });
});
