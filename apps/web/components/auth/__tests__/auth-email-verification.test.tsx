import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import {
  LAUNCH_COPY_KEYS,
  LAUNCH_COPY_LOCALES,
} from '@grabit/shared';

import koMessages from '@/messages/ko.json';
import enMessages from '@/messages/en.json';
import thMessages from '@/messages/th.json';
import zhCNMessages from '@/messages/zh-CN.json';
import { EmailVerificationStatus } from '../email-verification-status';
import { getAuthLaunchCopy } from '../auth-launch-copy';

const mocks = vi.hoisted(() => ({
  activeLocale: 'ko',
  routerReplace: vi.fn(),
}));

vi.mock('next-intl', () => ({
  useLocale: () => mocks.activeLocale,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: mocks.routerReplace,
  }),
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    post: vi.fn(),
    get: vi.fn(),
  },
  ApiClientError: class ApiClientError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.name = 'ApiClientError';
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/frontend-origin', () => ({
  getFrontendOrigin: () => 'http://localhost:3001',
}));

const messageFiles = {
  ko: koMessages,
  en: enMessages,
  th: thMessages,
  'zh-CN': zhCNMessages,
} as const;

const expectedNamespaces = [
  'auth.signup',
  'auth.emailVerification',
  'auth.otp',
  'auth.errors',
] as const;

const expectedKeys = {
  'auth.signup': [
    'progressAriaLabel',
    'stepCredentials',
    'stepConsent',
    'stepAdditional',
    'socialStep',
    'socialTitle',
    'nameLabel',
    'namePlaceholder',
    'genderLabel',
    'genderMale',
    'genderFemale',
    'genderUnspecified',
    'countryLabel',
    'countryKR',
    'countryUS',
    'countryJP',
    'countryCN',
    'countryGB',
    'countryCA',
    'countryAU',
    'countryOTHER',
    'birthDateLabel',
    'birthYearAriaLabel',
    'birthMonthAriaLabel',
    'birthDayAriaLabel',
    'phoneLabel',
    'previousButton',
    'submitButton',
    'submittingButton',
    'nameRequired',
    'nameMax',
    'genderRequired',
    'countryRequired',
    'birthYearInvalid',
    'birthMonthInvalid',
    'birthDayInvalid',
    'phoneInvalid',
    'phoneVerificationRequired',
  ],
  'auth.emailVerification': [
    'sent',
    'codeAriaLabel',
    'codePlaceholder',
    'verifyCta',
    'resendCta',
    'resendLoading',
    'resendSuccess',
    'expired',
    'invalidCode',
    'verified',
    'throttled',
    'systemError',
  ],
  'auth.otp': [
    'sent',
    'sendCta',
    'sendLoading',
    'resendCta',
    'resendLoading',
    'resendSuccess',
    'destinationPreview',
    'sentTo',
    'resendSuccessTo',
    'cooldownLabel',
    'cooldownAriaLabel',
    'codeAriaLabel',
    'codePlaceholder',
    'verifyCta',
    'expired',
    'invalidCode',
    'throttled',
    'systemError',
    'verified',
  ],
  'auth.errors': [
    'invalidCredentials',
    'emailUnverified',
    'verificationRequired',
    'providerUnavailable',
    'deviceLimitNotice',
  ],
} as const;

function readNamespace(
  messages: unknown,
  namespace: (typeof expectedNamespaces)[number],
): Record<string, string> {
  const [root, child] = namespace.split('.') as ['auth', string];
  const rootMessages = (messages as Record<string, unknown>)[root] as
    | Record<string, unknown>
    | undefined;
  return rootMessages?.[child] as Record<string, string>;
}

describe('auth launch copy messages', () => {
  it('defines exactly the active launch locale message files', () => {
    expect(Object.keys(messageFiles)).toEqual(LAUNCH_COPY_LOCALES);
  });

  it('mirrors every required auth namespace and key in all active launch locales', () => {
    for (const locale of LAUNCH_COPY_LOCALES) {
      for (const namespace of expectedNamespaces) {
        const copy = readNamespace(messageFiles[locale], namespace);

        expect(Object.keys(copy)).toEqual(expectedKeys[namespace]);
        expect(LAUNCH_COPY_KEYS[namespace][locale]).toEqual(expectedKeys[namespace]);

        for (const key of expectedKeys[namespace]) {
          expect(copy[key]).toEqual(expect.any(String));
          expect(copy[key].trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('locks critical Korean email verification copy', () => {
    const copy = readNamespace(koMessages, 'auth.emailVerification');

    expect(copy.resendCta).toBe('인증번호 다시 보내기');
    expect(copy.resendLoading).toBe('다시 보내는 중...');
    expect(copy.expired).toBe(
      '인증번호가 만료되었습니다. 새 인증 메일을 요청해주세요.',
    );
  });

  it('falls back to Korean auth copy for stale unsupported locale keys', () => {
    const staleLocale = ['zh', 'TW'].join('-');
    const copy = getAuthLaunchCopy(staleLocale);

    expect(copy.locale).toBe('ko');
    expect(copy.emailVerification.resendCta).toEqual(expect.any(String));
    expect(copy.emailVerification.resendCta.trim().length).toBeGreaterThan(0);
  });
});

describe('EmailVerificationStatus', () => {
  const defaultProps = {
    email: 'fan@test.com',
  };

  beforeEach(() => {
    mocks.activeLocale = 'ko';
    vi.clearAllMocks();
  });

  it('shows sent state with code input and resend action without auto-requesting email', async () => {
    const { apiClient } = await import('@/lib/api-client');
    render(<EmailVerificationStatus {...defaultProps} initialState="sent" />);

    expect(
      screen.getByText('이메일로 받은 6자리 인증번호를 입력해주세요'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('이메일 인증번호 6자리')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '확인' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: '인증번호 다시 보내기' }),
    ).toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('verifies a 6-digit email code', async () => {
    const { apiClient } = await import('@/lib/api-client');
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      verified: true,
    });

    render(<EmailVerificationStatus {...defaultProps} initialState="sent" />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('이메일 인증번호 6자리'), '12a3456');
    await user.click(screen.getByRole('button', { name: '확인' }));

    expect(apiClient.post).toHaveBeenCalledWith(
      '/api/v1/auth/email-verification/verify',
      { email: 'fan@test.com', code: '123456' },
      { showErrorToast: false },
    );

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        '이메일 인증이 완료되었습니다.',
      );
      expect(mocks.routerReplace).toHaveBeenCalledWith('/');
    });
  });

  it('redirects token-backed successful verification to home', async () => {
    const { apiClient } = await import('@/lib/api-client');
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      verified: true,
    });

    render(<EmailVerificationStatus email="" token="opaque-token-1234567890" />);

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/v1/auth/email-verification/verify',
        { token: 'opaque-token-1234567890' },
        { showErrorToast: false },
      );
      expect(mocks.routerReplace).toHaveBeenCalledWith('/');
    });
  });

  it('announces resend loading and success states with aria-live', async () => {
    const { apiClient } = await import('@/lib/api-client');
    let resolveResend!: () => void;
    (apiClient.post as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveResend = () => resolve({ expiresAt: '2026-05-06T07:30:00Z' });
      }),
    );

    render(<EmailVerificationStatus {...defaultProps} initialState="sent" />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: '인증번호 다시 보내기' }));
    expect(screen.getByRole('status')).toHaveTextContent('다시 보내는 중...');
    expect(apiClient.post).toHaveBeenCalledWith(
      '/api/v1/auth/email-verification/resend',
      {
        email: 'fan@test.com',
        locale: 'ko',
        frontendOrigin: 'http://localhost:3001',
      },
      { showErrorToast: false },
    );

    resolveResend();

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        '인증번호를 다시 보냈습니다',
      );
    });
  });

  it('shows expired and verified states distinctly', () => {
    const { unmount } = render(
      <EmailVerificationStatus {...defaultProps} initialState="expired" />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      '인증번호가 만료되었습니다. 새 인증 메일을 요청해주세요.',
    );

    unmount();
    render(<EmailVerificationStatus {...defaultProps} initialState="verified" />);
    expect(screen.getByRole('status')).toHaveTextContent(
      '이메일 인증이 완료되었습니다.',
    );
  });

  it('maps invalid, throttled, and system failures without exposing raw server text', async () => {
    const { apiClient, ApiClientError } = await import('@/lib/api-client');
    (apiClient.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ApiClientError('raw mismatch text', 400),
    );

    render(<EmailVerificationStatus {...defaultProps} initialState="sent" />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('이메일 인증번호 6자리'), '999999');
    await user.click(screen.getByRole('button', { name: '확인' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        '인증번호가 일치하지 않습니다',
      );
      expect(screen.queryByText('raw mismatch text')).not.toBeInTheDocument();
    });

    (apiClient.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ApiClientError('raw provider quota text', 429),
    );

    await user.click(screen.getByRole('button', { name: '인증번호 다시 보내기' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        '잠시 후 다시 시도해주세요.',
      );
      expect(screen.queryByText('raw provider quota text')).not.toBeInTheDocument();
    });

    (apiClient.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ApiClientError('raw smtp failure text', 500),
    );

    await user.click(screen.getByRole('button', { name: '인증번호 다시 보내기' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        '일시적인 오류가 발생했습니다. 다시 시도해주세요.',
      );
      expect(screen.queryByText('raw smtp failure text')).not.toBeInTheDocument();
    });
  });

  it('requests a fresh email on mount only when explicitly asked', async () => {
    const { apiClient } = await import('@/lib/api-client');
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      expiresAt: '2026-05-06T07:30:00Z',
    });

    render(<EmailVerificationStatus {...defaultProps} requestOnMount />);

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/v1/auth/email-verification/request',
        {
          email: 'fan@test.com',
          locale: 'ko',
          frontendOrigin: 'http://localhost:3001',
        },
        { showErrorToast: false },
      );
    });
  });

  it('verifies token-backed links and maps expired token errors', async () => {
    const { apiClient, ApiClientError } = await import('@/lib/api-client');
    (apiClient.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ApiClientError('raw expired token', 410),
    );

    render(<EmailVerificationStatus email="" token="opaque-token-1234567890" />);

    expect(screen.getByText('다시 보내는 중...')).toBeInTheDocument();

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/v1/auth/email-verification/verify',
        { token: 'opaque-token-1234567890' },
        { showErrorToast: false },
      );
      expect(screen.getByRole('alert')).toHaveTextContent(
        '인증번호가 만료되었습니다. 새 인증 메일을 요청해주세요.',
      );
      expect(screen.queryByText('raw expired token')).not.toBeInTheDocument();
    });
  });
});
