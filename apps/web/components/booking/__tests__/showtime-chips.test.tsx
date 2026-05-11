import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShowtimeChips } from '../showtime-chips';
import type { Showtime } from '@grabit/shared';

const mockShowtimes: Showtime[] = [
  { id: 'st-1', performanceId: 'p-1', dateTime: '2026-05-10T14:00:00Z' },
  { id: 'st-2', performanceId: 'p-1', dateTime: '2026-05-10T18:00:00Z' },
  { id: 'st-3', performanceId: 'p-1', dateTime: '2026-05-10T20:00:00Z' },
];

describe('ShowtimeChips', () => {
  it('renders showtime buttons with formatted times', () => {
    render(
      <ShowtimeChips
        showtimes={mockShowtimes}
        selected={null}
        onSelect={() => {}}
      />,
    );
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(3);
    // Each button should contain a time string (HH:MM format)
    buttons.forEach((btn) => {
      expect(btn.textContent).toMatch(/\d{2}:\d{2}/);
    });
  });

  it('renders Korean event time in KST regardless of runner timezone', () => {
    render(
      <ShowtimeChips
        showtimes={[
          {
            id: 'kst-showtime',
            performanceId: 'p-1',
            dateTime: '2026-07-18T19:00:00.000+09:00',
          },
        ]}
        selected={null}
        onSelect={() => {}}
      />,
    );

    expect(screen.getByRole('button', { name: '19:00' })).toBeDefined();
    expect(screen.queryByRole('button', { name: '10:00' })).toBeNull();
  });

  it('calls onSelect with the showtime id when clicked', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <ShowtimeChips
        showtimes={mockShowtimes}
        selected={null}
        onSelect={onSelect}
      />,
    );
    const buttons = screen.getAllByRole('button');
    await user.click(buttons[1]);
    expect(onSelect).toHaveBeenCalledWith('st-2');
  });

  it('applies active styling to the selected chip', () => {
    render(
      <ShowtimeChips
        showtimes={mockShowtimes}
        selected="st-2"
        onSelect={() => {}}
      />,
    );
    const buttons = screen.getAllByRole('button');
    // Second chip should have the primary active class
    expect(buttons[1].className).toContain('bg-primary');
    expect(buttons[1].className).toContain('text-white');
    // First chip should not have active styles
    expect(buttons[0].className).toContain('bg-gray-100');
  });

  it('shows empty state message when showtimes is empty', () => {
    render(
      <ShowtimeChips
        showtimes={[]}
        selected={null}
        onSelect={() => {}}
      />,
    );
    expect(
      screen.getByText('선택한 날짜에 예정된 회차가 없습니다'),
    ).toBeDefined();
  });

  it('shows loading skeletons when isLoading is true', () => {
    const { container } = render(
      <ShowtimeChips
        showtimes={[]}
        selected={null}
        onSelect={() => {}}
        isLoading
      />,
    );
    const skeletons = container.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons).toHaveLength(3);
  });
});
