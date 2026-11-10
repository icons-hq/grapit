import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import { StepIndicator } from '../step-indicator';

describe('StepIndicator', () => {
  it('moves focus to the progress indicator only when the step changes', () => {
    const { rerender } = render(<StepIndicator currentStep={1} />);
    const progress = screen.getByRole('navigation', { name: '회원가입 진행 상태' });
    expect(progress).not.toHaveFocus();

    rerender(<StepIndicator currentStep={2} />);
    expect(progress).toHaveFocus();
    expect(progress.querySelector('[aria-current="step"]')).toHaveTextContent('2');
  });

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
