import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { CountdownTimer } from '../countdown-timer';

describe('CountdownTimer', () => {
  it('does not render a placeholder timer before a seat hold starts', () => {
    render(<CountdownTimer expiresAt={null} onExpire={vi.fn()} />);

    expect(screen.queryByText('남은시간')).not.toBeInTheDocument();
    expect(screen.queryByText('--:--')).not.toBeInTheDocument();
  });
});
