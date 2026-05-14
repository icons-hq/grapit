import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import { StepIndicator } from '../step-indicator';

describe('StepIndicator', () => {
  it('renders supplied localized labels and navigation aria-label', () => {
    render(
      <StepIndicator
        currentStep={3}
        ariaLabel="Sign-up progress"
        labels={['Email/password', 'Terms', 'Additional info']}
      />,
    );

    expect(
      screen.getByRole('navigation', { name: 'Sign-up progress' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Email/password')).toBeInTheDocument();
    expect(screen.getByText('Terms')).toBeInTheDocument();
    expect(screen.getByText('Additional info')).toBeInTheDocument();
  });
});
