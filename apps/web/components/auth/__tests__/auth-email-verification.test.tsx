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
import jaMessages from '@/messages/ja.json';
import { EmailVerificationStatus } from '../email-verification-status';

const mocks = vi.hoisted(() => ({
  activeLocale: 'ko',
}));

vi.mock('next-intl', () => ({
  useLocale: () => mocks.activeLocale,
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    post: vi.fn(),
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

const messageFiles = {
  ko: koMessages,
  en: enMessages,
  th: thMessages,
  'zh-CN': zhCNMessages,
  'ja': jaMessages,
} as const;

const expectedNamespaces = [
  'auth.emailVerification',
  'auth.otp',
  'auth.errors',
] as const;

const expectedKeys = {
  'auth.emailVerification': [
    'sent',
    'resendCta',
    'resendLoading',
    'resendSuccess',
    'expired',
    'verified',
    'throttled',
    'systemError',
  ],
  'auth.otp': [
    'sent',
    'resendCta',
    'resendLoading',
    'resendSuccess',
    'expired',
    'invalidCode',
    'throttled',
    'systemError',
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
  it('defines exactly the five launch locale message files', () => {
    expect(Object.keys(messageFiles)).toEqual(LAUNCH_COPY_LOCALES);
  });

  it('mirrors every required auth namespace and key in all five launch locales', () => {
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

    expect(copy.resendCta).toBe('인증 메일 다시 보내기');
    expect(copy.resendLoading).toBe('다시 보내는 중...');
    expect(copy.expired).toBe(
      '인증 링크가 만료되었습니다. 새 인증 메일을 요청해주세요.',
    );
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

  it('shows sent state with resend action', () => {
    render(<EmailVerificationStatus {...defaultProps} initialState="sent" />);

    expect(screen.getByText('인증 메일을 발송했습니다')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '인증 메일 다시 보내기' }),
    ).toBeInTheDocument();
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

    await user.click(screen.getByRole('button', { name: '인증 메일 다시 보내기' }));
    expect(screen.getByRole('status')).toHaveTextContent('다시 보내는 중...');

    resolveResend();

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        '인증 메일을 다시 보냈습니다',
      );
    });
  });

  it('shows expired and verified states distinctly', () => {
    const { unmount } = render(
      <EmailVerificationStatus {...defaultProps} initialState="expired" />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      '인증 링크가 만료되었습니다. 새 인증 메일을 요청해주세요.',
    );

    unmount();
    render(<EmailVerificationStatus {...defaultProps} initialState="verified" />);
    expect(screen.getByRole('status')).toHaveTextContent(
      '이메일 인증이 완료되었습니다.',
    );
  });

  it('maps throttled and system resend failures without exposing raw server text', async () => {
    const { apiClient, ApiClientError } = await import('@/lib/api-client');
    (apiClient.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ApiClientError('raw provider quota text', 429),
    );

    render(<EmailVerificationStatus {...defaultProps} initialState="sent" />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: '인증 메일 다시 보내기' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        '잠시 후 다시 시도해주세요.',
      );
      expect(screen.queryByText('raw provider quota text')).not.toBeInTheDocument();
    });

    (apiClient.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ApiClientError('raw smtp failure text', 500),
    );

    await user.click(screen.getByRole('button', { name: '인증 메일 다시 보내기' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        '일시적인 오류가 발생했습니다. 다시 시도해주세요.',
      );
      expect(screen.queryByText('raw smtp failure text')).not.toBeInTheDocument();
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
        '인증 링크가 만료되었습니다. 새 인증 메일을 요청해주세요.',
      );
      expect(screen.queryByText('raw expired token')).not.toBeInTheDocument();
    });
  });
});
