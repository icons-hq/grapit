import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { OrderSummary } from '../order-summary';

vi.mock('next-intl', () => ({ useLocale: () => 'ko' }));

describe('Checkout event summary', () => {
  it('shows the venue time with its KST anchor instead of a raw UTC timestamp', () => {
    render(<OrderSummary performanceTitle="Example event" posterUrl={null}
      showDateTime="2026-11-20T02:58:07.592Z" venue="Example hall"
      seats={[{ seatId: 'A-1', row: 'A', number: '1', tierName: 'VIP', price: 50000 }]} />);
    expect(screen.getByText('2026.11.20 11:58 KST')).toBeInTheDocument();
    expect(screen.queryByText('2026-11-20T02:58:07.592Z')).not.toBeInTheDocument();
  });
});
