import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import { PhoneVerification } from '../phone-verification';

const mocks = vi.hoisted(() => ({
  activeLocale: 'ko',
  phoneInputLocales: [] as unknown[],
}));

vi.mock('next-intl', () => ({
  useLocale: () => mocks.activeLocale,
}));

vi.mock('@/components/ui/phone-input', () => ({
  PhoneInput: (props: {
    locale?: string;
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
  }) => {
    mocks.phoneInputLocales.push(props.locale);
    return (
      <input
        data-testid="mock-phone-input"
        disabled={props.disabled}
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      />
    );
  },
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

describe('PhoneVerification PhoneInput locale wiring', () => {
  const defaultProps = {
    phone: '+821012345678',
    onPhoneChange: vi.fn(),
    onVerified: vi.fn(),
    isVerified: false,
  };

  beforeEach(() => {
    mocks.activeLocale = 'ko';
    mocks.phoneInputLocales = [];
    vi.clearAllMocks();
  });

  it.each(['ko', 'en', 'th', 'zh-CN', 'ja'] as const)(
    'passes active %s locale into PhoneInput during the auth/SMS OTP flow',
    (locale) => {
      mocks.activeLocale = locale;

      render(<PhoneVerification {...defaultProps} />);

      expect(screen.getByTestId('mock-phone-input')).toBeInTheDocument();
      expect(mocks.phoneInputLocales).toEqual([locale]);
    },
  );

  it('falls back to ko when next-intl returns an unsupported locale', () => {
    mocks.activeLocale = 'fr';

    render(<PhoneVerification {...defaultProps} />);

    expect(mocks.phoneInputLocales).toEqual(['ko']);
  });

  it('allows an explicit locale prop override for caller tests', () => {
    mocks.activeLocale = 'en';

    render(<PhoneVerification {...defaultProps} locale="th" />);

    expect(mocks.phoneInputLocales).toEqual(['th']);
  });
});
