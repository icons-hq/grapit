import type { ComponentProps } from 'react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import type { AuthConsentCaptureItem } from '@grabit/shared';

import { SignupForm } from '../signup-form';

const mocks = vi.hoisted(() => ({
  apiPost: vi.fn(),
  setAuth: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  step3BirthYear: '1995',
}));

vi.mock('sonner', () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}));

vi.mock('next-intl', () => ({
  useLocale: () => 'ko',
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
  'marketing',
] as const).map((key) => ({
  key,
  version: '2026-04-28',
  language: 'ko',
  accepted: key !== 'marketing',
  required: key !== 'marketing',
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

vi.mock('@/components/auth/signup-step3', () => ({
  SignupStep3: ({ onComplete }: ComponentProps<typeof import('../signup-step3').SignupStep3>) => (
    <button
      type="button"
      onClick={() =>
        onComplete({
          name: 'Fan User',
          gender: 'female',
          country: 'KR',
          birthYear: mocks.step3BirthYear,
          birthMonth: '01',
          birthDay: '02',
          phone: '+821012345678',
          phoneVerificationToken: 'signed-phone-token',
        })
      }
    >
      complete step 3
    </button>
  ),
}));

describe('SignupForm consent submit payload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.step3BirthYear = '1995';
    mocks.apiPost.mockResolvedValue({
      emailVerificationRequired: true,
      email: 'fan@example.com',
      verificationExpiresAt: '2026-05-06T05:50:00.000Z',
      user: { id: 'user-1', email: 'fan@example.com' },
    });
  });

  it('submits itemized consent rows with item key, version, language, accepted/refused, and source flow', async () => {
    render(<SignupForm />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'complete step 1' }));
    await user.click(screen.getByRole('button', { name: 'complete step 2' }));
    await user.click(screen.getByRole('button', { name: 'complete step 3' }));

    await waitFor(() => {
      expect(mocks.apiPost).toHaveBeenCalledWith(
        '/api/v1/auth/register',
        expect.objectContaining({
          birthDate: '1995-01-02',
          locale: 'ko',
          frontendOrigin: 'http://localhost:3001',
          consentItems: expect.arrayContaining([
            expect.objectContaining({
              key: 'pipa_required',
              version: '2026-04-28',
              language: 'ko',
              accepted: true,
              required: true,
              sourceFlow: 'signup',
            }),
            expect.objectContaining({
              key: 'marketing',
              version: '2026-04-28',
              language: 'ko',
              accepted: false,
              required: false,
              sourceFlow: 'signup',
            }),
          ]),
        }),
      );
    });
  });

  it('blocks under-14 signup locally without submitting or showing a guardian flow', async () => {
    mocks.step3BirthYear = '2015';
    render(<SignupForm />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'complete step 1' }));
    await user.click(screen.getByRole('button', { name: 'complete step 2' }));
    await user.click(screen.getByRole('button', { name: 'complete step 3' }));

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('만 14세 미만은 가입할 수 없습니다');
    });
    expect(mocks.apiPost).not.toHaveBeenCalled();
    expect(screen.queryByText(/보호자|법정대리인|guardian/i)).not.toBeInTheDocument();
  });
});
