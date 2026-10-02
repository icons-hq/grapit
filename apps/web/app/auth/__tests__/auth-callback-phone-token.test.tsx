import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import type { AuthConsentCaptureItem } from '@grabit/shared';

import AuthCallbackPage from '../callback/page';

const TOKEN_USED_MESSAGE = '이미 사용된 전화번호 인증입니다. 휴대폰 인증을 다시 진행해주세요.';

const mocks = vi.hoisted(() => ({
  apiPost: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  searchParams: new URLSearchParams(),
  setAuth: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  issuedTokens: 0,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
  useSearchParams: () => mocks.searchParams,
}));

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
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
      user: null;
      isInitialized: boolean;
    }) => unknown,
  ) => selector({ setAuth: mocks.setAuth, user: null, isInitialized: false }),
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
] as const).map((key) => ({
  key,
  version: '2026-04-28',
  language: 'en',
  accepted: true,
  required: true,
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
          marketingConsent: false,
          consentItems: socialConsentItems,
        })
      }
    >
      complete social consent
    </button>
  ),
}));

// The real step 3 form is rendered; only the SMS widget is replaced.
vi.mock('@/components/auth/phone-verification', () => ({
  PhoneVerification: (props: {
    phone: string;
    onPhoneChange: (value: string) => void;
    onVerified: (token: string) => void;
    isVerified: boolean;
  }) => (
    <div>
      <span data-testid="phone-verification-state">
        {props.isVerified ? 'verified' : 'unverified'}
      </span>
      <button
        type="button"
        disabled={props.isVerified}
        onClick={() => {
          props.onPhoneChange('+821012345678');
          mocks.issuedTokens += 1;
          props.onVerified(`social-phone-token-${mocks.issuedTokens}`);
        }}
      >
        verify phone
      </button>
    </div>
  ),
}));

function apiError(message: string, data: Record<string, unknown>): Error {
  return Object.assign(new Error(message), { statusCode: 400, data });
}

async function completeUntilPhoneVerified(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'complete social consent' }));
  await user.type(screen.getByPlaceholderText('Enter your name'), 'Social User');
  await user.click(screen.getByRole('button', { name: 'Female' }));
  await user.type(screen.getByLabelText('Birth year'), '1995');
  await user.type(screen.getByLabelText('Birth month'), '01');
  await user.type(screen.getByLabelText('Birth day'), '02');
  await user.click(screen.getByRole('button', { name: 'verify phone' }));
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Complete sign-up' })).toBeEnabled();
  });
}

describe('AuthCallbackPage social completion with a used phone verification token', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Drop queued once-responses a failed test may leave behind.
    mocks.apiPost.mockReset();
    mocks.issuedTokens = 0;
    mocks.searchParams = new URLSearchParams(
      'status=needs_registration&registrationToken=registration-token',
    );
  });

  it('shows phone verification again with the entered details kept', async () => {
    mocks.apiPost
      .mockRejectedValueOnce(apiError(TOKEN_USED_MESSAGE, {
        statusCode: 400,
        message: TOKEN_USED_MESSAGE,
        errorCode: 'PHONE_VERIFICATION_TOKEN_USED',
      }))
      .mockResolvedValueOnce({
        emailVerificationRequired: true,
        email: 'social@test.com',
        verificationExpiresAt: '2026-10-02T05:50:00.000Z',
        user: { id: 'user-1', email: 'social@test.com' },
      });
    const user = userEvent.setup();
    render(<AuthCallbackPage />);

    await completeUntilPhoneVerified(user);
    await user.click(screen.getByRole('button', { name: 'Complete sign-up' }));

    await waitFor(() => {
      expect(screen.getByTestId('phone-verification-state')).toHaveTextContent('unverified');
    });
    expect(mocks.toastError).toHaveBeenCalledWith(TOKEN_USED_MESSAGE);
    expect(screen.getByRole('button', { name: 'Complete sign-up' })).toBeDisabled();
    expect(screen.getByPlaceholderText('Enter your name')).toHaveValue('Social User');

    await user.click(screen.getByRole('button', { name: 'verify phone' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Complete sign-up' })).toBeEnabled();
    });
    await user.click(screen.getByRole('button', { name: 'Complete sign-up' }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('verify social@test.com');
    });
    expect(mocks.apiPost).toHaveBeenNthCalledWith(
      2,
      '/api/v1/auth/social/complete-registration',
      expect.objectContaining({
        registrationToken: 'registration-token',
        name: 'Social User',
        phoneVerificationToken: 'social-phone-token-2',
      }),
    );
  });

  it('keeps the phone verification for other completion errors', async () => {
    mocks.apiPost.mockRejectedValueOnce(apiError('잠시 후 다시 시도해주세요', {
      statusCode: 400,
      message: '잠시 후 다시 시도해주세요',
    }));
    const user = userEvent.setup();
    render(<AuthCallbackPage />);

    await completeUntilPhoneVerified(user);
    await user.click(screen.getByRole('button', { name: 'Complete sign-up' }));

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('잠시 후 다시 시도해주세요');
    });
    expect(screen.getByTestId('phone-verification-state')).toHaveTextContent('verified');
  });
});
