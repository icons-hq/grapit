import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SeatLegend } from '../seat-legend';

describe('SeatLegend', () => {
  it('explains unavailable gray seats alongside tier and excluded colors', () => {
    render(
      <SeatLegend
        tiers={[{ name: 'VIP', color: '#6C3CE0', price: 240000 }]}
        showExcluded
      />,
    );

    expect(screen.getByText('VIP')).toBeInTheDocument();
    expect(screen.getByText('판매완료 / 선택중')).toBeInTheDocument();
    expect(screen.getByText('선택 불가')).toBeInTheDocument();
  });
});
