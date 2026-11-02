import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueueService } from './queue.service.js';

type AdmissionInput = Parameters<QueueService['assertAdmissionForShowtime']>[0];
type PerformanceInput = Omit<AdmissionInput, 'showtimeId'> & { performanceId: string };

function fixture() {
  const where = vi.fn().mockResolvedValue([{ performanceId: 'performance-a' }]);
  const select = vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where }) });
  const service = new QueueService({} as never, { select } as never, {} as never);
  const authorize = vi.spyOn(service as unknown as {
    assertAdmissionForPerformance(input: PerformanceInput): Promise<unknown>;
  }, 'assertAdmissionForPerformance').mockImplementation(async input => input);
  const read = (buyer: string, showtimeId = 'showtime-a') => service.assertAdmissionForShowtime({
    showtimeId, identity: { userId: buyer, refreshTokenFamilyId: buyer + '-family', deviceSlotId: buyer + '-device' },
    admissionToken: buyer + '-admission', action: 'lock-seat',
  });
  return { where, select, authorize, read };
}

afterEach(() => vi.restoreAllMocks());

describe('showtime lookup before per-buyer admission authorization', () => {
  it('coalesces a simultaneous lookup while authorizing every buyer separately', async () => {
    const { read, select, authorize } = fixture();
    await Promise.all([read('buyer-a'), read('buyer-b')]);
    expect(select).toHaveBeenCalledTimes(1);
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(authorize).toHaveBeenNthCalledWith(1, expect.objectContaining({
      performanceId: 'performance-a', identity: expect.objectContaining({ userId: 'buyer-a' }), admissionToken: 'buyer-a-admission',
    }));
    expect(authorize).toHaveBeenNthCalledWith(2, expect.objectContaining({
      performanceId: 'performance-a', identity: expect.objectContaining({ userId: 'buyer-b' }), admissionToken: 'buyer-b-admission',
    }));
  });

  it('uses a later snapshot for a request arriving after the query has started', async () => {
    const { read, where, authorize } = fixture();
    let release!: (rows: Array<{ performanceId: string }>) => void;
    where.mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValueOnce([]);
    const first = read('buyer-a');
    await new Promise(resolve => setImmediate(resolve));
    const later = read('buyer-b').then(() => null, error => error as Error);
    try {
      expect(where).toHaveBeenCalledTimes(1);
    } finally {
      release([{ performanceId: 'performance-a' }]);
    }
    await first;
    expect(await later).toMatchObject({ message: '회차를 찾을 수 없습니다' });
    expect(where).toHaveBeenCalledTimes(2);
    expect(authorize).toHaveBeenCalledTimes(1);
  });

  it('does not retain a completed or failed read and keeps showtimes independent', async () => {
    const { read, where, select } = fixture();
    await Promise.all([read('buyer-a', 'showtime-a'), read('buyer-b', 'showtime-b')]);
    expect(select).toHaveBeenCalledTimes(2);
    where.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(read('buyer-a')).rejects.toThrow('database unavailable');
    where.mockResolvedValueOnce([]);
    await expect(read('buyer-a')).rejects.toThrow('회차를 찾을 수 없습니다');
    where.mockResolvedValueOnce([{ performanceId: 'performance-b' }]);
    await expect(read('buyer-a')).resolves.toMatchObject({ performanceId: 'performance-b' });
  });
});
