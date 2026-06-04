import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';

const mockZoomIn = vi.fn();
const mockZoomOut = vi.fn();
const mockResetTransform = vi.fn();

vi.mock('react-zoom-pan-pinch', () => ({
  useControls: () => ({
    zoomIn: mockZoomIn,
    zoomOut: mockZoomOut,
    resetTransform: mockResetTransform,
  }),
}));

// Import after mock setup
import { SeatMapControls } from '../seat-map-controls';

describe('SeatMapControls', () => {
  it('renders three zoom control buttons', () => {
    render(<SeatMapControls />);
    expect(screen.getByLabelText('확대')).toBeDefined();
    expect(screen.getByLabelText('축소')).toBeDefined();
    expect(screen.getByLabelText('전체 보기')).toBeDefined();
  });

  it('calls zoomIn when zoom in button is clicked', async () => {
    const user = userEvent.setup();
    render(<SeatMapControls />);
    await user.click(screen.getByLabelText('확대'));
    expect(mockZoomIn).toHaveBeenCalled();
  });

  it('calls zoomOut when zoom out button is clicked', async () => {
    const user = userEvent.setup();
    render(<SeatMapControls />);
    await user.click(screen.getByLabelText('축소'));
    expect(mockZoomOut).toHaveBeenCalled();
  });

  it('calls resetTransform when reset button is clicked', async () => {
    const user = userEvent.setup();
    render(<SeatMapControls />);
    await user.click(screen.getByLabelText('전체 보기'));
    expect(mockResetTransform).toHaveBeenCalled();
  });

  it('all buttons have correct aria-labels', () => {
    render(<SeatMapControls />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(3);
    expect(buttons[0].getAttribute('aria-label')).toBe('확대');
    expect(buttons[1].getAttribute('aria-label')).toBe('축소');
    expect(buttons[2].getAttribute('aria-label')).toBe('전체 보기');
  });

  it('uses an inline mobile toolbar and keeps overlay positioning for desktop only', () => {
    render(<SeatMapControls />);

    const group = screen.getByLabelText('좌석맵 보기 조절');
    expect(group).toHaveClass('justify-end');
    expect(group).toHaveClass('lg:absolute');
    expect(group).not.toHaveClass('absolute');
  });
});
