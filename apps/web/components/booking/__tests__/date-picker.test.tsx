import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DatePicker } from '../date-picker';

function makeDate(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day);
}

describe('DatePicker', () => {
  beforeEach(() => window.history.replaceState({}, '', '/'));
  const availableDates = [
    makeDate(2026, 5, 10),
    makeDate(2026, 5, 15),
    makeDate(2026, 5, 20),
  ];

  it('uses the selected English calendar language without changing the available date', async () => {
    window.history.replaceState({}, '', '/en/booking/test');
    const onSelect = vi.fn();
    render(<DatePicker availableDates={availableDates} selected={null} onSelect={onSelect} />);
    await userEvent.setup().click(screen.getByRole('button', { name: /Sunday, May 10th, 2026/ }));
    expect(onSelect.mock.calls[0]?.[0]).toEqual(makeDate(2026, 5, 10));
  });

  it('renders the calendar component', () => {
    render(
      <DatePicker
        availableDates={availableDates}
        selected={null}
        onSelect={() => {}}
      />,
    );
    // Calendar should render month/year header (May 2026 in Korean)
    expect(screen.getByText(/2026년/)).toBeDefined();
  });

  it('disables unavailable dates', () => {
    render(
      <DatePicker
        availableDates={availableDates}
        selected={null}
        onSelect={() => {}}
      />,
    );
    // Day 11 is not in available dates, should be disabled
    const day11Button = screen.getByRole('gridcell', { name: /11/ });
    expect(day11Button).toBeDefined();
    // Disabled days have the disabled class applied by react-day-picker
    const button = day11Button.querySelector('button');
    if (button) {
      expect(button.disabled).toBe(true);
    }
  });

  it('calls onSelect when an available date is clicked', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <DatePicker
        availableDates={availableDates}
        selected={null}
        onSelect={onSelect}
      />,
    );
    // Day 10 is available
    const day10Cell = screen.getByRole('gridcell', { name: /10/ });
    const day10Button = day10Cell.querySelector('button');
    if (day10Button) {
      await user.click(day10Button);
    }
    expect(onSelect).toHaveBeenCalledTimes(1);
    const calledWith = onSelect.mock.calls[0][0] as Date;
    expect(calledWith.getDate()).toBe(10);
  });

  it('renders with all dates disabled when availableDates is empty', () => {
    render(
      <DatePicker
        availableDates={[]}
        selected={null}
        onSelect={() => {}}
      />,
    );
    // All grid cells' buttons should be disabled
    const buttons = screen.getAllByRole('gridcell').flatMap((cell) =>
      Array.from(cell.querySelectorAll('button')),
    );
    const allDisabled = buttons.every((btn) => btn.disabled);
    expect(allDisabled).toBe(true);
  });
});
