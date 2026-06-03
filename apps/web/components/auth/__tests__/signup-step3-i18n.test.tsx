import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { COUNTRY_OPTIONS } from '@grabit/shared';

import { SignupStep3 } from '../signup-step3';

const mocks = vi.hoisted(() => ({
  activeLocale: 'en',
}));

vi.mock('next-intl', () => ({
  useLocale: () => mocks.activeLocale,
}));

vi.mock('../phone-verification', () => ({
  PhoneVerification: (props: {
    phone: string;
    onPhoneChange: (value: string) => void;
    onVerified: (token: string) => void;
    isVerified: boolean;
    error?: string;
  }) => (
    <div>
      <span data-testid="phone-verification-state">
        {props.isVerified ? 'verified' : 'unverified'}
      </span>
      <button
        type="button"
        onClick={() => {
          props.onPhoneChange('+821012345678');
          props.onVerified('signed-phone-token');
        }}
      >
        verify phone
      </button>
      <button
        type="button"
        onClick={() => props.onPhoneChange('+821099999999')}
      >
        change phone
      </button>
      {props.error ? <p role="alert">{props.error}</p> : null}
    </div>
  ),
}));

describe('SignupStep3 i18n visible copy', () => {
  beforeEach(() => {
    mocks.activeLocale = 'en';
  });

  it('renders step 3 fields and actions from the active locale', () => {
    render(
      <SignupStep3
        onComplete={vi.fn()}
        onBack={vi.fn()}
        isSubmitting={false}
      />,
    );

    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter your name')).toBeInTheDocument();
    expect(screen.getByText('Gender')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Prefer not to say' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Japan' })).toHaveValue('JP');
    expect(screen.getByRole('option', { name: 'South Korea' })).toHaveValue('KR');
    expect(screen.getAllByRole('option').length).toBeGreaterThan(200);
    expect(screen.getByText('Phone number')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Complete sign-up' })).toBeInTheDocument();
  });

  it('uses localized validation copy for additional info fields', async () => {
    const user = userEvent.setup();

    render(
      <SignupStep3
        onComplete={vi.fn()}
        onBack={vi.fn()}
        isSubmitting={false}
      />,
    );

    await user.click(screen.getByLabelText('Birth year'));
    await user.type(screen.getByLabelText('Birth year'), '12');
    await user.tab();

    await waitFor(() => {
      expect(screen.getByText('Enter a valid birth year')).toBeInTheDocument();
    });
  });

  it('renders English country names in every locale while keeping canonical country values', () => {
    mocks.activeLocale = 'zh-CN';

    render(
      <SignupStep3
        onComplete={vi.fn()}
        onBack={vi.fn()}
        isSubmitting={false}
      />,
    );

    for (const [label, value] of [
      ['Afghanistan', 'AF'],
      ['Brazil', 'BR'],
      ['Japan', 'JP'],
      ['South Korea', 'KR'],
      ['United States', 'US'],
      ['Zimbabwe', 'ZW'],
    ] as const) {
      expect(screen.getByRole('option', { name: label })).toHaveValue(value);
    }

    expect(screen.getAllByRole('option')).toHaveLength(COUNTRY_OPTIONS.length);
    expect(screen.queryByRole('option', { name: '韩国' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '其他' })).not.toBeInTheDocument();
  });

  it('requires phone verification again after the verified phone number changes', async () => {
    const onComplete = vi.fn();
    const user = userEvent.setup();

    render(
      <SignupStep3
        onComplete={onComplete}
        onBack={vi.fn()}
        isSubmitting={false}
      />,
    );

    await user.type(screen.getByPlaceholderText('Enter your name'), 'Social User');
    await user.click(screen.getByRole('button', { name: 'Female' }));
    await user.type(screen.getByLabelText('Birth year'), '1995');
    await user.type(screen.getByLabelText('Birth month'), '01');
    await user.type(screen.getByLabelText('Birth day'), '02');
    await user.click(screen.getByRole('button', { name: 'verify phone' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Complete sign-up' })).toBeEnabled();
      expect(screen.getByTestId('phone-verification-state')).toHaveTextContent('verified');
    });

    await user.click(screen.getByRole('button', { name: 'change phone' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Complete sign-up' })).toBeDisabled();
      expect(screen.getByTestId('phone-verification-state')).toHaveTextContent('unverified');
    });

    await user.click(screen.getByRole('button', { name: 'Complete sign-up' }));
    expect(onComplete).not.toHaveBeenCalled();
  });
});
