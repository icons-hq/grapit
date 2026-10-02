import { describe, expect, it, vi } from 'vitest';
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

  describe('replaceSeatMaps with legacy untrimmed tier names', () => {
    const stored = { floorKey: '1F', floorLabel: '1층', sortOrder: 0, svgUrl: 'https://cdn.example.com/1f.svg', totalSeats: 1,
      seatConfig: { tiers: [{ tierName: 'VIP ', color: '#111111', seatIds: ['A-1'] }] } };
    const submitted = { ...stored, seatConfig: { tiers: [{ tierName: 'VIP', color: '#111111', seatIds: ['A-1'] }] } };

    function createTx() {
      const where = vi.fn().mockResolvedValue([stored]);
      return {
        select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where }) }),
        delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) }),
      };
    }

    it('does not treat the newly trimmed names as a structure change on an open sale', async () => {
      const tx = createTx();

      await expect(service.replaceSeatMaps(tx as never, 'performance-1', null, [submitted], new Set(['VIP']), [], true)).resolves.toBeUndefined();
      expect(tx.delete).not.toHaveBeenCalled();
    });

    it('still blocks a real seat change on an open sale', async () => {
      const tx = createTx();

      await expect(service.replaceSeatMaps(tx as never, 'performance-1', null,
        [{ ...submitted, seatConfig: { tiers: [{ tierName: 'VIP', color: '#111111', seatIds: ['A-2'] }] } }], new Set(['VIP']), [], true))
        .rejects.toThrow(UnprocessableEntityException);
      expect(tx.delete).not.toHaveBeenCalled();
    });

    it('rewrites the stored names before sales open so seat assignments are rebuilt', async () => {
      const tx = createTx();

      await service.replaceSeatMaps(tx as never, 'performance-1', null, [submitted], new Set(['VIP']), [], false);

      expect(tx.delete).toHaveBeenCalled();
      expect(tx.insert).toHaveBeenCalled();
    });
  });
});
