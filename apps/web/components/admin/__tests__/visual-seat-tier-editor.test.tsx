import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
