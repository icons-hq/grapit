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
  function enableDragPaint() {
    fireEvent.click(screen.getByLabelText('드래그 배정'));
  }

  function dragPaintSeats(
    container: HTMLElement,
    seatIds: [string, ...string[]],
  ) {
    const firstSeat = container.querySelector(
      `[data-seat-id="${seatIds[0]}"]`,
    )!;
    const grid = screen.getByRole('grid', { name: '등급 배정 좌석맵' });
    const previousElementFromPoint = document.elementFromPoint;
    const elementFromPoint = vi.fn(() => firstSeat);
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: elementFromPoint,
    });

    fireEvent.pointerDown(firstSeat, {
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    });

    for (const seatId of seatIds.slice(1)) {
      elementFromPoint.mockImplementation(
        () => container.querySelector(`[data-seat-id="${seatId}"]`)!,
      );
      fireEvent.pointerMove(grid, {
        pointerId: 1,
        clientX: 20,
        clientY: 20,
      });
    }

    fireEvent.pointerUp(grid, {
      pointerId: 1,
      clientX: 20,
      clientY: 20,
    });

    if (previousElementFromPoint) {
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: previousElementFromPoint,
      });
    } else {
      Reflect.deleteProperty(document, 'elementFromPoint');
    }
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

  it('drag paint assigns multiple seats to the active tier with one batched change', () => {
    const onChange = vi.fn();
    const { container } = render(
      <VisualSeatTierEditor
        svgMarkup={SVG_MARKUP}
        tiers={createTiers()}
        onChange={onChange}
      />,
    );

    enableDragPaint();
    dragPaintSeats(container, ['A-1', 'A-2', 'A-3']);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith([
      { tierName: 'VIP', color: '#6C3CE0', seatIds: ['A-1', 'A-2', 'A-3'] },
      { tierName: 'R', color: '#2563EB', seatIds: [] },
    ]);
  });

  it('drag paint moves seats from another tier without creating duplicates', () => {
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
    enableDragPaint();
    dragPaintSeats(container, ['A-1']);

    expect(onChange).toHaveBeenCalledWith([
      { tierName: 'VIP', color: '#6C3CE0', seatIds: [] },
      { tierName: 'R', color: '#2563EB', seatIds: ['A-2', 'A-1'] },
    ]);
  });

  it('drag paint does not toggle off seats already assigned to the active tier', () => {
    const onChange = vi.fn();
    const { container } = render(
      <VisualSeatTierEditor
        svgMarkup={SVG_MARKUP}
        tiers={createTiers([{ seatIds: ['A-1'] }, { seatIds: [] }])}
        onChange={onChange}
      />,
    );

    enableDragPaint();
    dragPaintSeats(container, ['A-1']);

    expect(onChange).toHaveBeenCalledWith([
      { tierName: 'VIP', color: '#6C3CE0', seatIds: ['A-1'] },
      { tierName: 'R', color: '#2563EB', seatIds: [] },
    ]);
  });

  it('pointer cancel commits the current drag paint and clears drag state', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <VisualSeatTierEditor
        svgMarkup={SVG_MARKUP}
        tiers={createTiers()}
        onChange={onChange}
      />,
    );
    enableDragPaint();
    const firstSeat = container.querySelector('[data-seat-id="A-1"]')!;
    fireEvent.pointerDown(firstSeat, {
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    });
    await waitFor(() => {
      window.dispatchEvent(new Event('pointercancel'));
      expect(onChange).toHaveBeenCalledTimes(1);
    });
    expect(onChange).toHaveBeenCalledWith([
      { tierName: 'VIP', color: '#6C3CE0', seatIds: ['A-1'] },
      { tierName: 'R', color: '#2563EB', seatIds: [] },
    ]);
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
