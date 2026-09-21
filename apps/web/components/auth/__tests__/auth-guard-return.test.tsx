import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthGuard } from '../auth-guard';
import { useAuthStore } from '@/stores/use-auth-store';

const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

describe('Protected checkout login return', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    window.history.replaceState(null, '', '/en/booking/performance-1/confirm?resumeOrderId=GRP-return');
    useAuthStore.setState({ isInitialized: true, accessToken: null, user: null });
  });

  it('preserves the same order and language when login is needed after a document return', async () => {
    render(<AuthGuard><p>Checkout</p></AuthGuard>);
    await waitFor(() => expect(push).toHaveBeenCalledWith(
      '/en/auth?returnTo=%2Fen%2Fbooking%2Fperformance-1%2Fconfirm%3FresumeOrderId%3DGRP-return',
    ));
    expect(screen.queryByText('Checkout')).not.toBeInTheDocument();
  });

  it('keeps withdrawal navigation separate from checkout restoration', async () => {
    sessionStorage.setItem('grabit:withdrawalRedirect', '1');
    render(<AuthGuard><p>Checkout</p></AuthGuard>);
    await waitFor(() => expect(push).toHaveBeenCalledWith('/en/auth?withdrawn=1'));
    expect(sessionStorage.getItem('grabit:withdrawalRedirect')).toBeNull();
  });

  it('waits for session refresh before deciding whether login is needed', () => {
    useAuthStore.setState({ isInitialized: false });
    render(<AuthGuard><p>Checkout</p></AuthGuard>);
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByText('Checkout')).not.toBeInTheDocument();
  });
});
