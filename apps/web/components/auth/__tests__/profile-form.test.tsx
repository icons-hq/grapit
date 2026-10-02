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
  nextPhoneToken: vi.fn(() => 'phone-token'),
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

vi.mock('../phone-verification', async () => {
  const { useState } = await import('react');
  return {
    PhoneVerification: (props: {
      phone: string;
      onPhoneChange: (value: string) => void;
      onVerified: (token: string) => void;
      isVerified: boolean;
    }) => {
      // Stands for the widget's own SMS step state (code sent, timers).
      const [codeSent, setCodeSent] = useState(false);
      return (
        <div>
          <input
            aria-label="전화번호"
            value={props.phone}
            onChange={(event) => props.onPhoneChange(event.target.value)}
          />
          <button type="button" onClick={() => setCodeSent(true)}>
            send code
          </button>
          {codeSent ? <span>code sent</span> : null}
          <button type="button" onClick={() => props.onVerified(mocks.nextPhoneToken())}>
            phone verify
          </button>
          <span>{props.isVerified ? 'verified' : 'unverified'}</span>
        </div>
      );
    },
  };
});

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
    // Drop queued once-values a failed test may leave behind.
    mocks.apiPatch.mockReset();
    mocks.nextPhoneToken.mockReset();
    mocks.nextPhoneToken.mockReturnValue('phone-token');
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

  it('verifies the existing phone then returns to the selected booking', async () => {
    const viewer = userEvent.setup();
    mocks.apiPatch.mockResolvedValueOnce(baseUser);
    render(<ProfileForm user={{ ...baseUser, isPhoneVerified: false }} returnTo="/en/booking/show" />);
    expect(screen.getByText('unverified')).toBeInTheDocument();
    await viewer.click(screen.getByRole('button', { name: 'phone verify' }));
    await viewer.click(screen.getByRole('button', { name: '변경사항 저장' }));
    await waitFor(() => expect(mocks.apiPatch).toHaveBeenCalledWith('/api/v1/users/me', { phone: baseUser.phone, phoneVerificationToken: 'phone-token' }));
    expect(mocks.routerPush).toHaveBeenCalledWith('/en/booking/show');
  });

  it('asks for phone verification again when the API reports the token as already used', async () => {
    const tokenUsedMessage = '이미 사용된 전화번호 인증입니다. 휴대폰 인증을 다시 진행해주세요.';
    mocks.nextPhoneToken
      .mockReturnValueOnce('phone-token-1')
      .mockReturnValueOnce('phone-token-2');
    mocks.apiPatch
      .mockRejectedValueOnce(Object.assign(new Error(tokenUsedMessage), {
        statusCode: 400,
        data: {
          statusCode: 400,
          message: tokenUsedMessage,
          errorCode: 'PHONE_VERIFICATION_TOKEN_USED',
        },
      }))
      .mockResolvedValueOnce({ ...baseUser, phone: '+821099998888' });
    const viewer = userEvent.setup();
    render(<ProfileForm user={baseUser} />);

    await viewer.click(screen.getByRole('button', { name: '전화번호 변경' }));
    await viewer.clear(screen.getByLabelText('전화번호'));
    await viewer.type(screen.getByLabelText('전화번호'), '+821099998888');
    await viewer.click(screen.getByRole('button', { name: 'send code' }));
    await viewer.click(screen.getByRole('button', { name: 'phone verify' }));
    expect(screen.getByText('verified')).toBeInTheDocument();
    await viewer.click(screen.getByRole('button', { name: '변경사항 저장' }));

    await waitFor(() => expect(screen.getByText('unverified')).toBeInTheDocument());
    expect(mocks.toastError).toHaveBeenCalledWith(tokenUsedMessage);
    // A fresh widget: the SMS step starts over for the same new number.
    expect(screen.queryByText('code sent')).not.toBeInTheDocument();
    expect(screen.getByLabelText('전화번호')).toHaveValue('+821099998888');
    expect(screen.getByRole('button', { name: '변경사항 저장' })).toBeDisabled();

    await viewer.click(screen.getByRole('button', { name: 'phone verify' }));
    await viewer.click(screen.getByRole('button', { name: '변경사항 저장' }));
    await waitFor(() => expect(mocks.apiPatch).toHaveBeenLastCalledWith('/api/v1/users/me', {
      phone: '+821099998888',
      phoneVerificationToken: 'phone-token-2',
    }));
  });

  it('keeps the phone verification for other save errors', async () => {
    mocks.apiPatch.mockRejectedValueOnce(Object.assign(new Error('저장하지 못했습니다'), {
      statusCode: 500,
      data: { statusCode: 500, message: '저장하지 못했습니다' },
    }));
    const viewer = userEvent.setup();
    render(<ProfileForm user={{ ...baseUser, isPhoneVerified: false }} />);

    await viewer.click(screen.getByRole('button', { name: 'phone verify' }));
    await viewer.click(screen.getByRole('button', { name: '변경사항 저장' }));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('저장하지 못했습니다'));
    expect(screen.getByText('verified')).toBeInTheDocument();
  });

  it('lets a verified customer start and cancel a phone change without saving it', async () => {
    const viewer = userEvent.setup();
    render(<ProfileForm user={baseUser} />);
    await viewer.click(screen.getByRole('button', { name: '전화번호 변경' }));
    expect(screen.getByText('unverified')).toBeInTheDocument();
    await viewer.click(screen.getByRole('button', { name: '전화번호 변경 취소' }));
    expect(screen.getByText('verified')).toBeInTheDocument();
    expect(mocks.apiPatch).not.toHaveBeenCalled();
  });

  it('withdraws the account only after explicit confirmation', async () => {
    mocks.apiPost.mockResolvedValueOnce({
      ...baseUser,
      accountStatus: 'withdrawn',
    });
    const user = userEvent.setup();

    render(<ProfileForm user={baseUser} />);

    const withdrawButton = screen.getByRole('button', { name: '회원 탈퇴' });
    expect(withdrawButton).toBeDisabled();

    await user.type(screen.getByLabelText('탈퇴 사유'), '서비스 이용 종료');
    await user.click(screen.getByRole('checkbox', { name: '회원 탈퇴 확인' }));
    expect(withdrawButton).toBeEnabled();

    await user.click(withdrawButton);
    await user.click(await screen.findByRole('button', { name: '탈퇴 확정' }));

    await waitFor(() => {
      expect(mocks.apiPost).toHaveBeenCalledWith('/api/v1/users/me/withdrawal', {
        reason: '서비스 이용 종료',
        confirmed: true,
      });
    });
    expect(mocks.clearAuth).toHaveBeenCalled();
    expect(mocks.routerPush).toHaveBeenCalledWith('/auth?withdrawn=1');
  });
});
