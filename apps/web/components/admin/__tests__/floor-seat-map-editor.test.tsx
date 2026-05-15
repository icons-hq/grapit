import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PerformanceSeatMapInput } from '@grabit/shared';
import {
  FloorSeatMapEditor,
  findDuplicateFloorKeys,
} from '../floor-seat-map-editor';

function createSeatMap(
  overrides: Partial<PerformanceSeatMapInput>,
): PerformanceSeatMapInput {
  return {
    floorKey: '1F',
    floorLabel: '1층',
    sortOrder: 0,
    svgUrl: 'https://cdn.example.com/seatmaps/1f.svg',
    seatConfig: {
      tiers: [{ tierName: 'VIP', color: '#FFD700', seatIds: ['A-1'] }],
    },
    totalSeats: 1,
    ...overrides,
  };
}

describe('findDuplicateFloorKeys', () => {
  it('returns each duplicated floorKey once', () => {
    const duplicates = findDuplicateFloorKeys([
      createSeatMap({ floorKey: '1F' }),
      createSeatMap({ floorKey: '2F', floorLabel: '2층', sortOrder: 1 }),
      createSeatMap({ floorKey: '1F', floorLabel: '1층 복제', sortOrder: 2 }),
      createSeatMap({ floorKey: '2F', floorLabel: '2층 복제', sortOrder: 3 }),
    ]);

    expect(duplicates).toEqual(['1F', '2F']);
  });
});

describe('FloorSeatMapEditor', () => {
  it('shows an inline correction path when duplicated floorKey values exist', () => {
    render(
      <FloorSeatMapEditor
        value={[
          createSeatMap({ floorKey: '1F' }),
          createSeatMap({
            floorKey: '1F',
            floorLabel: '1층 복제',
            sortOrder: 1,
          }),
        ]}
        onChange={vi.fn()}
      />,
    );

    const alert = screen.getByRole('alert');

    expect(alert).toHaveTextContent('중복된 floorKey');
    expect(alert).toHaveTextContent('1F');
    expect(alert).toHaveTextContent('고유하게 수정');
  });

  it('renders the server duplicate correction message without dropping rows', () => {
    render(
      <FloorSeatMapEditor
        value={[createSeatMap({ floorKey: '1F' })]}
        onChange={vi.fn()}
        duplicateFloorError="서버에서 중복된 floorKey를 확인했습니다. 각 층 키를 고유하게 수정한 뒤 다시 저장해주세요."
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      '서버에서 중복된 floorKey를 확인했습니다.',
    );
    expect(screen.getByDisplayValue('1F')).toBeInTheDocument();
  });

  it('adds a shared seat tier to every floor at once', () => {
    const onChange = vi.fn();

    render(
      <FloorSeatMapEditor
        value={[
          createSeatMap({ floorKey: '1F', seatConfig: null }),
          createSeatMap({
            floorKey: '2F',
            floorLabel: '2층',
            sortOrder: 1,
            seatConfig: null,
          }),
        ]}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByText('좌석등급 추가'));

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        floorKey: '1F',
        seatConfig: {
          tiers: [{ tierName: '', color: '#6C3CE0', seatIds: [] }],
        },
      }),
      expect.objectContaining({
        floorKey: '2F',
        seatConfig: {
          tiers: [{ tierName: '', color: '#6C3CE0', seatIds: [] }],
        },
      }),
    ]);
  });

  it('updates shared tier name and color across floors while preserving per-floor seat assignments', () => {
    const onChange = vi.fn();

    render(
      <FloorSeatMapEditor
        value={[
          createSeatMap({
            floorKey: '1F',
            seatConfig: {
              tiers: [{ tierName: 'VIP', color: '#FFD700', seatIds: ['A-1'] }],
            },
          }),
          createSeatMap({
            floorKey: '2F',
            floorLabel: '2층',
            sortOrder: 1,
            seatConfig: {
              tiers: [{ tierName: 'VIP', color: '#FFD700', seatIds: ['B-1'] }],
            },
          }),
        ]}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByDisplayValue('VIP'), {
      target: { value: 'R석' },
    });

    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        floorKey: '1F',
        seatConfig: {
          tiers: [{ tierName: 'R석', color: '#FFD700', seatIds: ['A-1'] }],
        },
      }),
      expect.objectContaining({
        floorKey: '2F',
        seatConfig: {
          tiers: [{ tierName: 'R석', color: '#FFD700', seatIds: ['B-1'] }],
        },
      }),
    ]);
  });

  it('removes a shared seat tier from every floor at once', () => {
    const onChange = vi.fn();

    render(
      <FloorSeatMapEditor
        value={[
          createSeatMap({
            floorKey: '1F',
            seatConfig: {
              tiers: [
                { tierName: 'VIP', color: '#FFD700', seatIds: ['A-1'] },
                { tierName: 'R', color: '#2563EB', seatIds: ['A-2'] },
              ],
            },
          }),
          createSeatMap({
            floorKey: '2F',
            floorLabel: '2층',
            sortOrder: 1,
            seatConfig: {
              tiers: [
                { tierName: 'VIP', color: '#FFD700', seatIds: ['B-1'] },
                { tierName: 'R', color: '#2563EB', seatIds: ['B-2'] },
              ],
            },
          }),
        ]}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getAllByLabelText('통합 좌석등급 삭제')[0]!);

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        floorKey: '1F',
        seatConfig: {
          tiers: [{ tierName: 'R', color: '#2563EB', seatIds: ['A-2'] }],
        },
      }),
      expect.objectContaining({
        floorKey: '2F',
        seatConfig: {
          tiers: [{ tierName: 'R', color: '#2563EB', seatIds: ['B-2'] }],
        },
      }),
    ]);
  });
});
