import { StrictMode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailVerificationStatus } from '../email-verification-status';
import { useAuthStore } from '@/stores/use-auth-store';

const boundary = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn(), replace: vi.fn() }));
vi.mock('@/lib/api-client', () => ({
  apiClient: { post: boundary.post, get: boundary.get },
  ApiClientError: class extends Error { statusCode = 500; },
}));
vi.mock('next-intl', () => ({ useLocale: () => 'en' }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: boundary.replace }) }));

const returnTo = '/en/booking/event/confirm?resumeOrderId=GRP-return';
function mountVerification(props = {}) {
  return render(<QueryClientProvider client={new QueryClient()}><EmailVerificationStatus email="new@example.test" {...props} /></QueryClientProvider>);
}

describe('Verification continuation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', `/en/auth/verify-email?returnTo=${encodeURIComponent(returnTo)}`);
    useAuthStore.setState({ user: null, accessToken: null, isInitialized: true });
    boundary.post.mockResolvedValue({ verified: true });
  });

  it('takes a newly verified unauthenticated buyer to login with the original booking', async () => {
    const user = userEvent.setup();
    mountVerification();
    await user.type(screen.getByRole('textbox', { name: '6-digit email verification code' }), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(boundary.replace).toHaveBeenCalledWith(
      `/en/auth?verified=1&returnTo=${encodeURIComponent(returnTo)}`,
    ));
  });

  it('returns an authenticated buyer only after refreshing the verified account', async () => {
    useAuthStore.setState({ accessToken: 'synthetic-session', user: { id: 'buyer', isEmailVerified: false } as never });
    boundary.get.mockResolvedValue({ id: 'buyer', isEmailVerified: true });
    mountVerification({ token: 'synthetic-verification' });
    await waitFor(() => expect(boundary.replace).toHaveBeenCalledWith(returnTo));
    expect(useAuthStore.getState().user?.isEmailVerified).toBe(true);
  });

  it('finishes one mount request even under StrictMode effect replay', async () => {
    render(<StrictMode><EmailVerificationStatus email="new@example.test" requestOnMount /></StrictMode>);
    await waitFor(() => expect(boundary.post).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Enter the 6-digit verification code sent to your email')).toBeInTheDocument();
  });

  it('keeps delivery failures retryable without saying that a code was sent', async () => {
    boundary.post.mockResolvedValue({ emailDeliveryFailed: true });
    const user = userEvent.setup();
    mountVerification();
    await user.click(screen.getByRole('button', { name: 'Resend verification code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not send the verification email');
    expect(screen.getByRole('button', { name: 'Resend verification code' })).toBeEnabled();
    expect(boundary.replace).not.toHaveBeenCalled();
  });

  it('can request a new code from an unusable email link without losing the booking', async () => {
    boundary.post.mockRejectedValueOnce(new Error('Expired link')).mockResolvedValue({});
    const user = userEvent.setup();
    mountVerification({ email: '', token: 'expired-test-token' });
    await user.type(await screen.findByRole('textbox', { name: 'Email' }), 'new@example.test');
    await user.click(screen.getByRole('button', { name: 'Resend verification code' }));
    await waitFor(() => expect(boundary.post).toHaveBeenCalledWith(
      '/api/v1/auth/email-verification/resend', expect.objectContaining({ email: 'new@example.test', locale: 'en' }), { showErrorToast: false },
    ));
    await waitFor(() => expect(new URL(window.location.href).searchParams.get('email')).toBe('new@example.test'));
    expect(new URL(window.location.href).searchParams.get('returnTo')).toBe(returnTo);
  });
});
