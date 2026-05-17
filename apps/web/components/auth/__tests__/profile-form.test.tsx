import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import type { UserProfile } from '@grabit/shared';

import { ProfileForm } from '../profile-form';

type ProfileSettingsUser = UserProfile & {
  marketingConsent?: boolean | null;
};

const mocks = vi.hoisted(() => ({
  routerPush: vi.fn(),
  setAuth: vi.fn(),
  clearAuth: vi.fn(),
  apiPatch: vi.fn(),
  apiPost: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mocks.routerPush,
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    patch: mocks.apiPatch,
    post: mocks.apiPost,
  },
}));

vi.mock('@/stores/use-auth-store', () => ({
  useAuthStore: () => ({
    setAuth: mocks.setAuth,
    clearAuth: mocks.clearAuth,
    accessToken: 'access-token',
  }),
}));

vi.mock('../phone-verification', () => ({
  PhoneVerification: (props: {
    phone: string;
    onPhoneChange: (value: string) => void;
    onVerified: (token: string) => void;
    isVerified: boolean;
  }) => (
    <div>
      <input
        aria-label="전화번호"
        value={props.phone}
        onChange={(event) => props.onPhoneChange(event.target.value)}
      />
      <button type="button" onClick={() => props.onVerified('phone-token')}>
        phone verify
      </button>
      <span>{props.isVerified ? 'verified' : 'unverified'}</span>
    </div>
  ),
}));

const baseUser: ProfileSettingsUser = {
  id: 'user-1',
  email: 'fan@example.com',
  name: 'Fan User',
  phone: '+821012345678',
  gender: 'unspecified',
  country: 'KR',
  birthDate: '1998-05-17',
  preferredLocale: 'en',
  isEmailVerified: true,
  isPhoneVerified: true,
  role: 'user',
  marketingConsent: false,
  createdAt: '2026-05-01T00:00:00.000Z',
};

describe('ProfileForm settings center', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders account status, preferred language, marketing consent, and session controls', () => {
    render(<ProfileForm user={baseUser} />);

    expect(screen.getByText('계정 상태')).toBeInTheDocument();
    expect(screen.getByText('이메일 인증 완료')).toBeInTheDocument();
    expect(screen.getByText('휴대폰 인증 완료')).toBeInTheDocument();
    expect(screen.getByLabelText('선호 언어')).toHaveValue('en');
    expect(
      screen.getByRole('switch', { name: '마케팅 수신 동의' }),
    ).not.toBeChecked();
    expect(screen.getByRole('button', { name: '로그아웃' })).toBeInTheDocument();
  });

  it('persists preferred language and marketing consent through PATCH /users/me', async () => {
    const updatedUser: ProfileSettingsUser = {
      ...baseUser,
      preferredLocale: 'th',
      marketingConsent: true,
    };
    mocks.apiPatch.mockResolvedValueOnce(updatedUser);
    const user = userEvent.setup();

    render(<ProfileForm user={baseUser} />);

    await user.selectOptions(screen.getByLabelText('선호 언어'), 'th');
    await user.click(screen.getByRole('switch', { name: '마케팅 수신 동의' }));
    await user.click(screen.getByRole('button', { name: '변경사항 저장' }));

    await waitFor(() => {
      expect(mocks.apiPatch).toHaveBeenCalledWith('/api/v1/users/me', {
        preferredLocale: 'th',
        marketingConsent: true,
      });
    });
    expect(mocks.setAuth).toHaveBeenCalledWith('access-token', updatedUser);
  });
});
