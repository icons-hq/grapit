import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import type { AuthConsentCaptureItem } from '@grabit/shared';

import { SignupForm } from '../signup-form';

const TOKEN_USED_MESSAGE = '이미 사용된 전화번호 인증입니다. 휴대폰 인증을 다시 진행해주세요.';

const mocks = vi.hoisted(() => ({
  apiPost: vi.fn(),
  setAuth: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  issuedTokens: 0,
}));

vi.mock('sonner', () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
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
  useAuthStore: (selector: (state: { setAuth: typeof mocks.setAuth }) => unknown) =>
    selector({ setAuth: mocks.setAuth }),
}));

vi.mock('@/components/auth/email-verification-status', () => ({
  EmailVerificationStatus: ({ email }: { email: string }) => (
    <div role="status">verify {email}</div>
  ),
}));

vi.mock('@/components/auth/signup-step1', () => ({
  SignupStep1: ({ onComplete }: ComponentProps<typeof import('../signup-step1').SignupStep1>) => (
    <button
      type="button"
      onClick={() =>
        onComplete({
          email: 'fan@example.com',
          password: 'Test1234!',
          passwordConfirm: 'Test1234!',
        })
      }
    >
      complete step 1
    </button>
  ),
}));

const signupConsentItems: AuthConsentCaptureItem[] = ([
  'terms',
  'privacy',
  'pipa_required',
] as const).map((key) => ({
  key,
  version: '2026-04-28',
  language: 'en',
  accepted: true,
  required: true,
  sourceFlow: 'signup',
}));

vi.mock('@/components/auth/signup-step2', () => ({
  SignupStep2: ({ onComplete }: ComponentProps<typeof import('../signup-step2').SignupStep2>) => (
    <button
      type="button"
      onClick={() =>
        onComplete({
          termsOfService: true,
          privacyPolicy: true,
          marketingConsent: false,
          consentItems: signupConsentItems,
        })
      }
    >
      complete step 2
    </button>
  ),
}));

// The real step 3 form is rendered; only the SMS widget is replaced.
vi.mock('../phone-verification', () => ({
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
      <span data-testid="phone-value">{props.phone}</span>
      <button
        type="button"
        disabled={props.isVerified}
        onClick={() => {
          props.onPhoneChange('+821012345678');
          mocks.issuedTokens += 1;
          props.onVerified(`phone-token-${mocks.issuedTokens}`);
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

async function fillSignupUntilPhoneVerified(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'complete step 1' }));
  await user.click(screen.getByRole('button', { name: 'complete step 2' }));
  await user.type(screen.getByPlaceholderText('Enter your name'), 'Fan User');
  await user.click(screen.getByRole('button', { name: 'Female' }));
  await user.type(screen.getByLabelText('Birth year'), '1995');
  await user.type(screen.getByLabelText('Birth month'), '01');
  await user.type(screen.getByLabelText('Birth day'), '02');
  await user.click(screen.getByRole('button', { name: 'verify phone' }));
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Complete sign-up' })).toBeEnabled();
  });
}

describe('SignupForm phone verification token reuse (PHONE_VERIFICATION_TOKEN_USED)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Drop queued once-responses a failed test may leave behind.
    mocks.apiPost.mockReset();
    mocks.issuedTokens = 0;
  });

  it('clears the used token and asks for phone verification again, keeping the other fields', async () => {
    mocks.apiPost
      .mockRejectedValueOnce(apiError(TOKEN_USED_MESSAGE, {
        statusCode: 400,
        message: TOKEN_USED_MESSAGE,
        errorCode: 'PHONE_VERIFICATION_TOKEN_USED',
      }))
      .mockResolvedValueOnce({
        emailVerificationRequired: true,
        email: 'fan@example.com',
        verificationExpiresAt: '2026-10-02T05:50:00.000Z',
        user: { id: 'user-1', email: 'fan@example.com' },
      });
    const user = userEvent.setup();
    render(<SignupForm />);

    await fillSignupUntilPhoneVerified(user);
    await user.click(screen.getByRole('button', { name: 'Complete sign-up' }));

    await waitFor(() => {
      expect(screen.getByTestId('phone-verification-state')).toHaveTextContent('unverified');
    });
    expect(mocks.toastError).toHaveBeenCalledWith(TOKEN_USED_MESSAGE);
    expect(screen.getByRole('button', { name: 'Complete sign-up' })).toBeDisabled();
    expect(screen.getByPlaceholderText('Enter your name')).toHaveValue('Fan User');
    expect(screen.getByLabelText('Birth year')).toHaveValue('1995');
    expect(screen.getByTestId('phone-value')).toHaveTextContent('+821012345678');

    await user.click(screen.getByRole('button', { name: 'verify phone' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Complete sign-up' })).toBeEnabled();
    });
    await user.click(screen.getByRole('button', { name: 'Complete sign-up' }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('verify fan@example.com');
    });
    expect(mocks.apiPost).toHaveBeenNthCalledWith(1, '/api/v1/auth/register', expect.objectContaining({
      phoneVerificationToken: 'phone-token-1',
    }));
    expect(mocks.apiPost).toHaveBeenNthCalledWith(2, '/api/v1/auth/register', expect.objectContaining({
      name: 'Fan User',
      birthDate: '1995-01-02',
      phone: '+821012345678',
      phoneVerificationToken: 'phone-token-2',
    }));
  });

  it('keeps the phone verification for other sign-up errors', async () => {
    mocks.apiPost.mockRejectedValueOnce(apiError('이미 가입된 이메일입니다', {
      statusCode: 409,
      message: '이미 가입된 이메일입니다',
    }));
    const user = userEvent.setup();
    render(<SignupForm />);

    await fillSignupUntilPhoneVerified(user);
    await user.click(screen.getByRole('button', { name: 'Complete sign-up' }));

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('이미 가입된 이메일입니다');
    });
    expect(screen.getByTestId('phone-verification-state')).toHaveTextContent('verified');
    expect(screen.getByRole('button', { name: 'Complete sign-up' })).toBeEnabled();
  });
});
