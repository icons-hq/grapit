import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import { SignupStep1 } from '../signup-step1';

const mocks = vi.hoisted(() => ({
  activeLocale: 'en',
}));

vi.mock('next-intl', () => ({
  useLocale: () => mocks.activeLocale,
}));

describe('SignupStep1 i18n visible copy', () => {
  it('renders password confirmation copy from the active locale', () => {
    mocks.activeLocale = 'en';

    render(<SignupStep1 onComplete={vi.fn()} defaultValues={null} />);

    expect(
      screen.getByText('At least 8 characters with letters, numbers, and symbols'),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter your password again')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
  });
});
