import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SeatMapConfig } from '@grabit/shared';
import { VisualSeatTierEditor } from '../visual-seat-tier-editor';

const SVG_MARKUP = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 80">
    <text>STAGE</text>
    <rect data-seat-id="A-1" x="10" y="20" width="24" height="24" />
    <rect data-seat-id="A-2" x="44" y="20" width="24" height="24" />
    <rect data-seat-id="A-3" x="78" y="20" width="24" height="24" />
  </svg>
`;

function createTiers(
  overrides?: Partial<SeatMapConfig['tiers'][number]>[],
): SeatMapConfig['tiers'] {
  return [
    { tierName: 'VIP', color: '#6C3CE0', seatIds: [], ...overrides?.[0] },
    { tierName: 'R', color: '#2563EB', seatIds: [], ...overrides?.[1] },
  ];
}

function expectMetric(label: string, value: string) {
  const metric = screen.getByText(label).parentElement;
  if (!metric) {
    throw new Error(`Metric not found: ${label}`);
  }
  expect(metric).toHaveTextContent(value);
}

describe('VisualSeatTierEditor', () => {
  async function enableRangeSelect() {
    fireEvent.click(screen.getByLabelText('범위 배정'));
    await waitFor(() => {
      expect(screen.getByRole('grid', { name: '등급 배정 좌석맵' })).toHaveClass(
        'cursor-crosshair',
      );
    });
  }

  function stubElementRect(
    element: Element,
    rect: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom' | 'width' | 'height'>,
  ) {
    Object.defineProperty(element, 'getBoundingClientRect', {
      configurable: true,
      value: vi.fn(() => ({
        x: rect.left,
        y: rect.top,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        toJSON: () => ({}),
      })),
    });
  }

  function stubSeatRects(container: HTMLElement) {
    stubElementRect(screen.getByRole('grid', { name: '등급 배정 좌석맵' }), {
      left: 0,
      right: 200,
      top: 0,
      bottom: 100,
      width: 200,
      height: 100,
    });
    stubElementRect(container.querySelector('[data-seat-id="A-1"]')!, {
      left: 10,
      right: 34,
      top: 20,
      bottom: 44,
      width: 24,
      height: 24,
    });
    stubElementRect(container.querySelector('[data-seat-id="A-2"]')!, {
      left: 44,
      right: 68,
      top: 20,
      bottom: 44,
      width: 24,
      height: 24,
    });
    stubElementRect(container.querySelector('[data-seat-id="A-3"]')!, {
      left: 78,
      right: 102,
      top: 20,
      bottom: 44,
      width: 24,
      height: 24,
    });
  }

  function fireMouse(
    element: Element,
    type: string,
    point: { x: number; y: number },
  ) {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: point.x,
      clientY: point.y,
    });
    fireEvent(element, event);
  }

  function dragSelectRange(
    container: HTMLElement,
    endPoint: { x: number; y: number },
  ) {
    const grid = screen.getByRole('grid', { name: '등급 배정 좌석맵' });
    stubSeatRects(container);
    fireMouse(grid, 'mousedown', { x: 5, y: 15 });
    fireMouse(grid, 'mousemove', endPoint);
    stubSeatRects(container);
    fireMouse(grid, 'mouseup', endPoint);
  }

  it('clicking an SVG seat assigns it to the active tier through the existing tiers shape', () => {
    const onChange = vi.fn();
    const { container } = render(
      <VisualSeatTierEditor
        svgMarkup={SVG_MARKUP}
        tiers={createTiers()}
        onChange={onChange}
      />,
    );

    fireEvent.click(container.querySelector('[data-seat-id="A-1"]')!);

    expect(onChange).toHaveBeenCalledWith([
      { tierName: 'VIP', color: '#6C3CE0', seatIds: ['A-1'] },
      { tierName: 'R', color: '#2563EB', seatIds: [] },
    ]);
  });

  it('moving a seat to another tier removes the previous assignment to prevent visual duplicates', () => {
    const onChange = vi.fn();
    const { container } = render(
      <VisualSeatTierEditor
        svgMarkup={SVG_MARKUP}
        tiers={createTiers([{ seatIds: ['A-1'] }, { seatIds: [] }])}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('클릭 배정 등급'), {
      target: { value: '1' },
    });
    fireEvent.click(container.querySelector('[data-seat-id="A-1"]')!);

    expect(onChange).toHaveBeenCalledWith([
      { tierName: 'VIP', color: '#6C3CE0', seatIds: [] },
      { tierName: 'R', color: '#2563EB', seatIds: ['A-1'] },
    ]);
  });

  it('range selection assigns intersecting seats to the active tier with one batched change', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <VisualSeatTierEditor
        svgMarkup={SVG_MARKUP}
        tiers={createTiers()}
        onChange={onChange}
      />,
    );

    await enableRangeSelect();
    dragSelectRange(container, { x: 70, y: 50 });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith([
      { tierName: 'VIP', color: '#6C3CE0', seatIds: ['A-1', 'A-2'] },
      { tierName: 'R', color: '#2563EB', seatIds: [] },
    ]);
  });

  it('range selection moves seats from another tier without creating duplicates', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <VisualSeatTierEditor
        svgMarkup={SVG_MARKUP}
        tiers={createTiers([{ seatIds: ['A-1'] }, { seatIds: ['A-2'] }])}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('클릭 배정 등급'), {
      target: { value: '1' },
    });
    await enableRangeSelect();
    dragSelectRange(container, { x: 40, y: 50 });

    expect(onChange).toHaveBeenCalledWith([
      { tierName: 'VIP', color: '#6C3CE0', seatIds: [] },
      { tierName: 'R', color: '#2563EB', seatIds: ['A-2', 'A-1'] },
    ]);
  });

  it('range selection does not toggle off seats already assigned to the active tier', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <VisualSeatTierEditor
        svgMarkup={SVG_MARKUP}
        tiers={createTiers([{ seatIds: ['A-1'] }, { seatIds: [] }])}
        onChange={onChange}
      />,
    );

    await enableRangeSelect();
    dragSelectRange(container, { x: 40, y: 50 });

    expect(onChange).toHaveBeenCalledWith([
      { tierName: 'VIP', color: '#6C3CE0', seatIds: ['A-1'] },
      { tierName: 'R', color: '#2563EB', seatIds: [] },
    ]);
  });

  it('pointer cancel clears range selection without committing a change', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <VisualSeatTierEditor
        svgMarkup={SVG_MARKUP}
        tiers={createTiers()}
        onChange={onChange}
      />,
    );
    const grid = screen.getByRole('grid', { name: '등급 배정 좌석맵' });
    stubSeatRects(container);

    await enableRangeSelect();
    fireMouse(grid, 'mousedown', { x: 5, y: 15 });
    fireMouse(grid, 'mousemove', { x: 70, y: 50 });
    fireEvent(window, new Event('pointercancel'));

    await waitFor(() => {
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  it('shows duplicate, unknown, and unassigned counts from component-level validation', () => {
    render(
      <VisualSeatTierEditor
        svgMarkup={SVG_MARKUP}
        tiers={createTiers([
          { seatIds: ['A-1', 'MISSING-1'] },
          { seatIds: ['A-1'] },
        ])}
        onChange={vi.fn()}
      />,
    );

    expectMetric('미배정', '2개');
    expectMetric('중복 배정', '1개');
    expectMetric('SVG에 없음', '1개');
    expect(screen.getByRole('alert')).toHaveTextContent('중복: A-1');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'SVG에 없는 좌석: MISSING-1',
    );
  });
});
