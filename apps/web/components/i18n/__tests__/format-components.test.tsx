import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KstTime } from '../kst-time';
import { CurrencyDisplay } from '../currency-display';

describe('KstTime', () => {
  it('renders event-critical time with a KST anchor and local secondary time', () => {
    render(
      <KstTime
        value="2026-07-04T09:00:00.000Z"
        locale="en"
        localTimeZone="America/Los_Angeles"
      />,
    );

    expect(screen.getByText('2026.07.04 18:00 KST')).toBeDefined();
    expect(screen.getByText(/local time/i)).toBeDefined();
  });
});

describe('CurrencyDisplay', () => {
  it('renders only the KRW source price', () => {
    render(
      <CurrencyDisplay
        krwAmount={110000}
      />,
    );

    expect(screen.getByText('KRW 110,000')).toBeDefined();
    expect(screen.queryByText(/THB|USD|approx/i)).toBeNull();
    expect(screen.queryByText(/exchange rate may change|환율/)).toBeNull();
  });
});
