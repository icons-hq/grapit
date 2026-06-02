import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SeatSelectionPanel } from '../seat-selection-panel';
import type { FloorAwareSeatSelection, SeatSelection, Showtime } from '@grabit/shared';

const mockShowtime: Showtime = {
  id: 'st-1',
  performanceId: 'p-1',
  dateTime: '2026-05-10T14:00:00Z',
};

const mockSeats: SeatSelection[] = [
  {
    seatId: 'A-1',
    tierName: 'VIP',
    tierColor: '#6C3CE0',
    row: 'A',
    number: '1',
    price: 170000,
  },
  {
    seatId: 'B-3',
    tierName: 'R',
    tierColor: '#3B82F6',
    row: 'B',
    number: '3',
    price: 130000,
  },
];

const floorAwareSeats: FloorAwareSeatSelection[] = [
  {
    ...mockSeats[0],
    floorKey: '1F',
    floorLabel: '1층',
    seatKey: '1F:A-1',
  },
];

describe('SeatSelectionPanel', () => {
  it('renders the heading "선택 좌석"', () => {
    render(
      <SeatSelectionPanel
        performanceTitle="테스트 공연"
        selectedDate={null}
        selectedShowtime={null}
        selectedSeats={[]}
        onRemove={() => {}}
        onProceed={() => {}}
        isLoading={false}
      />,
    );
    expect(screen.getByText('선택 좌석')).toBeDefined();
  });

  it('shows empty state message when no seats selected', () => {
    render(
      <SeatSelectionPanel
        performanceTitle="테스트 공연"
        selectedDate={null}
        selectedShowtime={null}
        selectedSeats={[]}
        onRemove={() => {}}
        onProceed={() => {}}
        isLoading={false}
      />,
    );
    expect(
      screen.getByText(
        '좌석을 선택해주세요. 좌석맵에서 원하는 좌석을 탭하면 이곳에 표시됩니다.',
      ),
    ).toBeDefined();
  });

  it('renders seat rows with tier name, label, and price', () => {
    render(
      <SeatSelectionPanel
        performanceTitle="테스트 공연"
        selectedDate={new Date(2026, 4, 10)}
        selectedShowtime={mockShowtime}
        selectedSeats={mockSeats}
        onRemove={() => {}}
        onProceed={() => {}}
        isLoading={false}
      />,
    );
    expect(screen.getByText('VIP')).toBeDefined();
    expect(screen.getByText('R')).toBeDefined();
    expect(screen.getByText('A열 1번')).toBeDefined();
    expect(screen.getByText('B열 3번')).toBeDefined();
    expect(screen.getByText('170,000원')).toBeDefined();
    expect(screen.getByText('130,000원')).toBeDefined();
  });

  it('calculates total price including per-ticket service fee', () => {
    render(
      <SeatSelectionPanel
        performanceTitle="테스트 공연"
        selectedDate={new Date(2026, 4, 10)}
        selectedShowtime={mockShowtime}
        selectedSeats={mockSeats}
        onRemove={() => {}}
        onProceed={() => {}}
        isLoading={false}
      />,
    );
    // Total: 170,000 + 130,000 + (2 * 2,000) = 304,000
    expect(screen.getByText('예매 수수료')).toBeDefined();
    expect(screen.getByText('4,000원')).toBeDefined();
    expect(screen.getByText('304,000원')).toBeDefined();
    expect(screen.getByText('2석')).toBeDefined();
  });

  it('"다음" button is disabled when no seats selected', () => {
    render(
      <SeatSelectionPanel
        performanceTitle="테스트 공연"
        selectedDate={null}
        selectedShowtime={null}
        selectedSeats={[]}
        onRemove={() => {}}
        onProceed={() => {}}
        isLoading={false}
      />,
    );
    const btn = screen.getByRole('button', { name: '좌석을 선택해주세요' });
    expect(btn).toBeDefined();
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('calls onRemove when remove button is clicked', async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(
      <SeatSelectionPanel
        performanceTitle="테스트 공연"
        selectedDate={new Date(2026, 4, 10)}
        selectedShowtime={mockShowtime}
        selectedSeats={mockSeats}
        onRemove={onRemove}
        onProceed={() => {}}
        isLoading={false}
      />,
    );
    const removeButtons = screen.getAllByRole('button', {
      name: '좌석 선택 해제',
    });
    await user.click(removeButtons[0]);
    expect(onRemove).toHaveBeenCalledWith('A-1');
  });

  it('calls onRemove with the floor-aware seat key when present', async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(
      <SeatSelectionPanel
        performanceTitle="테스트 공연"
        selectedDate={new Date(2026, 4, 10)}
        selectedShowtime={mockShowtime}
        selectedSeats={floorAwareSeats}
        onRemove={onRemove}
        onProceed={() => {}}
        isLoading={false}
      />,
    );
    await user.click(screen.getByRole('button', {
      name: '좌석 선택 해제',
    }));
    expect(onRemove).toHaveBeenCalledWith('1F:A-1');
  });
});
