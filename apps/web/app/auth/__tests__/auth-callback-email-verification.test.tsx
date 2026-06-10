import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import type { AuthConsentCaptureItem } from '@grabit/shared';

import AuthCallbackPage from '../callback/page';

const mocks = vi.hoisted(() => ({
  apiPost: vi.fn(),
  push: vi.fn(),
  searchParams: new URLSearchParams(),
  setAuth: vi.fn(),
  user: null as null | { id: string; email: string },
  isInitialized: false,
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => mocks.searchParams,
}));

vi.mock('next-intl', () => ({
  useLocale: () => 'ko',
}));

vi.mock('sonner', () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    post: mocks.apiPost,
  },
}));

vi.mock('@/lib/frontend-origin', () => ({
  getFrontendOrigin: () => 'http://localhost:3001',
}));

vi.mock('@/stores/use-auth-store', () => ({
  useAuthStore: (
    selector: (state: {
      setAuth: typeof mocks.setAuth;
      user: typeof mocks.user;
      isInitialized: boolean;
    }) => unknown,
  ) =>
    selector({
      setAuth: mocks.setAuth,
      user: mocks.user,
      isInitialized: mocks.isInitialized,
    }),
}));

vi.mock('@/components/auth/email-verification-status', () => ({
  EmailVerificationStatus: ({ email }: { email: string }) => (
    <div role="status">verify {email}</div>
  ),
}));

const socialConsentItems: AuthConsentCaptureItem[] = ([
  'terms',
  'privacy',
  'pipa_required',
  'marketing',
] as const).map((key) => ({
  key,
  version: '2026-04-28',
  language: 'ko',
  accepted: true,
  required: key !== 'marketing',
  sourceFlow: 'social_completion',
}));

vi.mock('@/components/auth/signup-step2', () => ({
  SignupStep2: ({
    onComplete,
  }: ComponentProps<typeof import('@/components/auth/signup-step2').SignupStep2>) => (
    <button
      type="button"
      onClick={() =>
        onComplete({
          termsOfService: true,
          privacyPolicy: true,
          marketingConsent: true,
          consentItems: socialConsentItems,
        })
      }
    >
      complete social consent
    </button>
  ),
}));

vi.mock('@/components/auth/signup-step3', () => ({
  SignupStep3: ({
    onComplete,
  }: ComponentProps<typeof import('@/components/auth/signup-step3').SignupStep3>) => (
    <button
      type="button"
      onClick={() =>
        onComplete({
          name: 'Social User',
          gender: 'female',
          country: 'KR',
          birthYear: '1995',
          birthMonth: '01',
          birthDay: '02',
          phone: '+821012345678',
          phoneVerificationToken: 'signed-social-phone-token',
        })
      }
    >
      complete social details
    </button>
  ),
}));

describe('AuthCallbackPage email verification pending states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchParams = new URLSearchParams();
    mocks.user = null;
    mocks.isInitialized = false;
    mocks.apiPost.mockResolvedValue({
      emailVerificationRequired: true,
      email: 'social@test.com',
      verificationExpiresAt: '2026-05-06T05:50:00.000Z',
      user: { id: 'user-1', email: 'social@test.com' },
    });
  });

  it('renders EmailVerificationStatus after social completion pending response without setting auth or routing home', async () => {
    mocks.searchParams = new URLSearchParams(
      'status=needs_registration&registrationToken=registration-token',
    );
    render(<AuthCallbackPage />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'complete social consent' }));
    await user.click(screen.getByRole('button', { name: 'complete social details' }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('verify social@test.com');
    });
    expect(mocks.apiPost).toHaveBeenCalledWith(
      '/api/v1/auth/social/complete-registration',
      expect.objectContaining({
        registrationToken: 'registration-token',
        phoneVerificationToken: 'signed-social-phone-token',
        frontendOrigin: 'http://localhost:3001',
      }),
    );
    expect(mocks.setAuth).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalledWith('/');
  });

  it('renders EmailVerificationStatus for status=email_verification_required callback query without setting auth or routing home', async () => {
    mocks.searchParams = new URLSearchParams(
      `status=email_verification_required&email=${encodeURIComponent('existing@test.com')}`,
    );

    render(<AuthCallbackPage />);

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('verify existing@test.com');
    });
    expect(mocks.setAuth).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalledWith('/');
  });

  it('routes authenticated social callbacks back to a safe booking return path', async () => {
    mocks.searchParams = new URLSearchParams(
      `status=authenticated&returnTo=${encodeURIComponent('/booking/performance-auth')}`,
    );
    mocks.user = { id: 'user-1', email: 'social@test.com' };
    mocks.isInitialized = true;

    render(<AuthCallbackPage />);

    await waitFor(() => {
      expect(mocks.push).toHaveBeenCalledWith('/booking/performance-auth');
    });
  });

  it('routes completed social registrations back to a safe booking return path', async () => {
    mocks.searchParams = new URLSearchParams(
      `status=needs_registration&registrationToken=registration-token&returnTo=${encodeURIComponent('/booking/performance-auth')}`,
    );
    mocks.apiPost.mockResolvedValue({
      accessToken: 'social-access-token',
      user: { id: 'user-1', email: 'social@test.com' },
    });
    render(<AuthCallbackPage />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'complete social consent' }));
    await user.click(screen.getByRole('button', { name: 'complete social details' }));

    await waitFor(() => {
      expect(mocks.push).toHaveBeenCalledWith('/booking/performance-auth');
    });
  });
});
