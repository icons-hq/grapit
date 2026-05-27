import { describe, expect, it } from 'vitest';
import { UnprocessableEntityException } from '@nestjs/common';

import { PerformanceIntakeService } from './performance-intake.service.js';

describe('PerformanceIntakeService', () => {
  const service = new PerformanceIntakeService();

  it('keeps floor-aware seat map normalization behind the intake interface', () => {
    expect(
      service.normalizeSeatMaps('performance-1', [
        {
          floorKey: '2F',
          floorLabel: '2층',
          sortOrder: 1,
          svgUrl: 'https://cdn.example.com/2f.svg',
          seatConfig: null,
          totalSeats: 0,
        },
      ]),
    ).toEqual([
      {
        id: 'performance-1:2F:0',
        performanceId: 'performance-1',
        floorKey: '2F',
        floorLabel: '2층',
        sortOrder: 1,
        svgUrl: 'https://cdn.example.com/2f.svg',
        seatConfig: null,
        totalSeats: 0,
      },
    ]);
  });

  it('rejects duplicate floor keys before persistence', () => {
    expect(() =>
      service.assertUniqueFloorKeys([
        {
          floorKey: '1F',
          floorLabel: '1층',
          sortOrder: 0,
          svgUrl: 'https://cdn.example.com/1f.svg',
          seatConfig: null,
          totalSeats: 0,
        },
        {
          floorKey: '1F',
          floorLabel: '1층 복제',
          sortOrder: 1,
          svgUrl: 'https://cdn.example.com/1f-copy.svg',
          seatConfig: null,
          totalSeats: 0,
        },
      ]),
    ).toThrow(UnprocessableEntityException);
  });

  it('rejects unknown tiers and duplicate seat assignments as one validation surface', () => {
    expect(() =>
      service.assertSeatMapConfigsValid(
        [
          {
            floorKey: '1F',
            floorLabel: '1층',
            sortOrder: 0,
            svgUrl: 'https://cdn.example.com/1f.svg',
            totalSeats: 2,
            seatConfig: {
              tiers: [
                {
                  tierName: 'VIP',
                  color: '#111111',
                  seatIds: ['A-1', 'A-1'],
                },
              ],
            },
          },
        ],
        new Set(['R']),
      ),
    ).toThrow(UnprocessableEntityException);
  });
});
