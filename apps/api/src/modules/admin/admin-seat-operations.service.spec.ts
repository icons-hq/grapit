import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it, vi, type Mock } from 'vitest';

import {
  seatMaps,
  seatInventories,
  seatOperationHistory,
  showtimes,
} from '../../database/schema/index.js';
import type { BookingService } from '../booking/booking.service.js';
import type { AdminAuditService } from './admin-audit.service.js';
import { AdminSeatOperationsService } from './admin-seat-operations.service.js';

function createMockAdminAuditService() {
  return {
    write: vi.fn().mockResolvedValue({ id: 'audit-seat-1' }),
  } as unknown as AdminAuditService & {
    write: Mock;
  };
}

function createMockBookingGateway() {
  return {
    broadcastSeatUpdate: vi.fn(),
  };
}

function createMockBookingService() {
  return {
    forceReleaseSeatLock: vi.fn().mockResolvedValue(undefined),
  } as unknown as Pick<BookingService, 'forceReleaseSeatLock'> & {
    forceReleaseSeatLock: Mock;
  };
}

function createSelectChain(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });

  return { select, from, where, limit };
}

function createHistorySelectChain(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ orderBy });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });

  return { select, from, where, orderBy, limit };
}

function createTransactionMock(seatRows: unknown[]) {
  const selectChain = createSelectChain(seatRows);
  const updateReturning = vi.fn().mockResolvedValue([{ id: 'seat-inventory-1' }]);
  const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set: updateSet });
  const insertReturning = vi.fn().mockResolvedValue([{ id: 'history-1' }]);
  const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
  const insert = vi.fn().mockReturnValue({ values: insertValues });

  const tx = {
    select: selectChain.select,
    update,
    insert,
  };

  return {
    tx,
    selectChain,
    update,
    updateSet,
    updateWhere,
    updateReturning,
    insert,
    insertValues,
    insertReturning,
  };
}

function availableSeat() {
  return {
    id: 'seat-inventory-1',
    showtimeId: '00000000-0000-4000-8000-000000000001',
    seatId: 'A-1',
    floorKey: '2F',
    seatKey: '2F:A-1',
    status: 'available',
  };
}

describe('AdminSeatOperationsService', () => {
  it('disables an available seat with transaction-bound audit, history, inventory update, and post-transaction broadcast', async () => {
    const tx = createTransactionMock([availableSeat()]);
    const gateway = createMockBookingGateway();
    const db = {
      transaction: vi.fn().mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
        const result = await callback(tx.tx);
        expect(gateway.broadcastSeatUpdate).not.toHaveBeenCalled();
        return result;
      }),
      select: vi.fn(),
    };
    const auditService = createMockAdminAuditService();
    const bookingService = createMockBookingService();
    const service = new AdminSeatOperationsService(
      db as never,
      auditService,
      gateway as never,
      bookingService as never,
    );

    const result = await service.performOperation(
      'admin-1',
      {
        operation: 'seat.disable',
        showtimeId: '00000000-0000-4000-8000-000000000001',
        seatKey: '2F:A-1',
        reason: '시야 제한 좌석 판매 중지',
        confirmed: true,
      },
      {
        ipAddress: '203.0.113.20',
        userAgent: 'Vitest Admin Console',
        now: new Date('2026-05-14T03:10:00.000Z'),
      },
    );

    expect(result).toMatchObject({
      historyId: 'history-1',
      auditEventId: 'audit-seat-1',
      operation: 'seat.disable',
      showtimeId: '00000000-0000-4000-8000-000000000001',
      seatKey: '2F:A-1',
      previousStatus: 'available',
      nextStatus: 'disabled',
    });
    expect(auditService.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'admin-1',
        action: 'seat.disable',
        resourceType: 'seat_inventory',
        resourceId: '00000000-0000-4000-8000-000000000001:2F:A-1',
        status: 'success',
        reason: '시야 제한 좌석 판매 중지',
        changedFields: ['seatStatus'],
        before: { seatStatus: 'available' },
        after: { seatStatus: 'disabled' },
        ipAddress: '203.0.113.20',
        userAgent: 'Vitest Admin Console',
      }),
      tx.tx,
    );
    expect(tx.update).toHaveBeenCalledWith(seatInventories);
    expect(tx.updateSet).toHaveBeenCalledWith(expect.objectContaining({
      status: 'disabled',
      lockedBy: null,
      lockedUntil: null,
      soldAt: null,
      heldCancelledAt: null,
      reopenHoldUntil: null,
      reopenJobId: null,
    }));
    expect(tx.insert).toHaveBeenCalledWith(seatOperationHistory);
    expect(tx.insertValues).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'admin-1',
      action: 'seat.disable',
      showtimeId: '00000000-0000-4000-8000-000000000001',
      seatInventoryId: 'seat-inventory-1',
      seatId: 'A-1',
      floorKey: '2F',
      seatKey: '2F:A-1',
      previousStatus: 'available',
      nextStatus: 'disabled',
      reason: '시야 제한 좌석 판매 중지',
      auditLogId: 'audit-seat-1',
    }));
    expect(bookingService.forceReleaseSeatLock).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
      '2F:A-1',
    );
    expect(bookingService.forceReleaseSeatLock.mock.invocationCallOrder[0])
      .toBeLessThan(gateway.broadcastSeatUpdate.mock.invocationCallOrder[0]!);
    expect(gateway.broadcastSeatUpdate).toHaveBeenCalledTimes(1);
    expect(gateway.broadcastSeatUpdate).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
      '2F:A-1',
      'disabled',
    );
  });

  it('broadcasts the committed disabled state when active lock cleanup fails', async () => {
    const tx = createTransactionMock([availableSeat()]);
    const gateway = createMockBookingGateway();
    const db = {
      transaction: vi.fn().mockImplementation((callback: (tx: unknown) => Promise<unknown>) =>
        callback(tx.tx),
      ),
      select: vi.fn(),
    };
    const bookingService = createMockBookingService();
    bookingService.forceReleaseSeatLock.mockRejectedValueOnce(new Error('redis cleanup failed'));
    const service = new AdminSeatOperationsService(
      db as never,
      createMockAdminAuditService(),
      gateway as never,
      bookingService as never,
    );

    await expect(service.performOperation('admin-1', {
      operation: 'seat.disable',
      showtimeId: '00000000-0000-4000-8000-000000000001',
      seatKey: '2F:A-1',
      reason: '시야 제한 좌석 판매 중지',
      confirmed: true,
    })).resolves.toMatchObject({
      showtimeId: '00000000-0000-4000-8000-000000000001',
      seatKey: '2F:A-1',
      nextStatus: 'disabled',
    });

    expect(bookingService.forceReleaseSeatLock).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
      '2F:A-1',
    );
    expect(gateway.broadcastSeatUpdate).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
      '2F:A-1',
      'disabled',
    );
  });

  it('disables an untouched available seat by creating a disabled inventory row from the seat map', async () => {
    const inventorySelect = createSelectChain([]);
    const showtimeSelect = createSelectChain([{ performanceId: 'performance-1' }]);
    const seatMapSelect = createSelectChain([{
      seatConfig: {
        tiers: [
          { tierName: 'VIP', color: '#111111', seatIds: ['A-1', 'A-2'] },
        ],
      },
    }]);
    const insertInventoryReturning = vi.fn().mockResolvedValue([{
      id: 'seat-inventory-1',
      showtimeId: '00000000-0000-4000-8000-000000000001',
      seatId: 'A-1',
      floorKey: '2F',
      seatKey: '2F:A-1',
      status: 'disabled',
    }]);
    const insertInventoryOnConflict = vi.fn().mockReturnValue({
      returning: insertInventoryReturning,
    });
    const insertInventoryValues = vi.fn().mockReturnValue({
      onConflictDoNothing: insertInventoryOnConflict,
    });
    const insertHistoryReturning = vi.fn().mockResolvedValue([{ id: 'history-1' }]);
    const insertHistoryValues = vi.fn().mockReturnValue({
      returning: insertHistoryReturning,
    });
    const tx = {
      select: vi.fn()
        .mockReturnValueOnce(inventorySelect.select())
        .mockReturnValueOnce(showtimeSelect.select())
        .mockReturnValueOnce(seatMapSelect.select()),
      insert: vi.fn()
        .mockReturnValueOnce({ values: insertInventoryValues })
        .mockReturnValueOnce({ values: insertHistoryValues }),
      update: vi.fn(),
    };
    const db = {
      transaction: vi.fn().mockImplementation((callback: (tx: unknown) => Promise<unknown>) =>
        callback(tx),
      ),
      select: vi.fn(),
    };
    const auditService = createMockAdminAuditService();
    const gateway = createMockBookingGateway();
    const bookingService = createMockBookingService();
    const service = new AdminSeatOperationsService(
      db as never,
      auditService,
      gateway as never,
      bookingService as never,
    );

    const result = await service.performOperation('admin-1', {
      operation: 'seat.disable',
      showtimeId: '00000000-0000-4000-8000-000000000001',
      seatKey: '2F:A-1',
      reason: '시야 제한 좌석 판매 중지',
      confirmed: true,
    });

    expect(result).toMatchObject({
      previousStatus: 'available',
      nextStatus: 'disabled',
      seatInventoryId: 'seat-inventory-1',
      seatKey: '2F:A-1',
    });
    expect(tx.insert).toHaveBeenCalledWith(seatInventories);
    expect(insertInventoryValues).toHaveBeenCalledWith(expect.objectContaining({
      showtimeId: '00000000-0000-4000-8000-000000000001',
      seatId: 'A-1',
      floorKey: '2F',
      seatKey: '2F:A-1',
      status: 'disabled',
    }));
    expect(tx.insert).toHaveBeenCalledWith(seatOperationHistory);
    expect(auditService.write).toHaveBeenCalledWith(
      expect.objectContaining({
        before: { seatStatus: 'available' },
        after: { seatStatus: 'disabled' },
      }),
      tx,
    );
    expect(bookingService.forceReleaseSeatLock).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
      '2F:A-1',
    );
    expect(gateway.broadcastSeatUpdate).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
      '2F:A-1',
      'disabled',
    );
    expect(tx.select).toHaveBeenCalledWith(expect.objectContaining({
      performanceId: showtimes.performanceId,
    }));
    expect(tx.select).toHaveBeenCalledWith(expect.objectContaining({
      seatConfig: seatMaps.seatConfig,
    }));
  });

  it('reactivates a disabled seat and rejects invalid state transitions', async () => {
    const disabledTx = createTransactionMock([{
      ...availableSeat(),
      status: 'disabled',
    }]);
    const db = {
      transaction: vi.fn().mockImplementation((callback: (tx: unknown) => Promise<unknown>) =>
        callback(disabledTx.tx),
      ),
      select: vi.fn(),
    };
    const auditService = createMockAdminAuditService();
    const gateway = createMockBookingGateway();
    const service = new AdminSeatOperationsService(
      db as never,
      auditService,
      gateway as never,
    );

    await service.performOperation('admin-1', {
      operation: 'seat.reactivate',
      showtimeId: '00000000-0000-4000-8000-000000000001',
      seatKey: '2F:A-1',
      reason: '좌석 상태 확인 완료',
      confirmed: true,
    });

    expect(disabledTx.updateSet).toHaveBeenCalledWith(expect.objectContaining({
      status: 'available',
    }));
    expect(disabledTx.insertValues).toHaveBeenCalledWith(expect.objectContaining({
      action: 'seat.reactivate',
      previousStatus: 'disabled',
      nextStatus: 'available',
    }));
    expect(gateway.broadcastSeatUpdate).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
      '2F:A-1',
      'available',
    );

    const availableTx = createTransactionMock([availableSeat()]);
    db.transaction.mockImplementationOnce((callback: (tx: unknown) => Promise<unknown>) =>
      callback(availableTx.tx),
    );

    await expect(
      service.performOperation('admin-1', {
        operation: 'seat.reactivate',
        showtimeId: '00000000-0000-4000-8000-000000000001',
        seatKey: '2F:A-1',
        reason: '이미 판매 가능 좌석 확인',
        confirmed: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires a reason and confirmation before opening a transaction', async () => {
    const db = {
      transaction: vi.fn(),
      select: vi.fn(),
    };
    const auditService = createMockAdminAuditService();
    const gateway = createMockBookingGateway();
    const service = new AdminSeatOperationsService(
      db as never,
      auditService,
      gateway as never,
    );

    await expect(
      service.performOperation('admin-1', {
        operation: 'seat.disable',
        showtimeId: '00000000-0000-4000-8000-000000000001',
        seatKey: '2F:A-1',
        reason: '   ',
        confirmed: true,
      }),
    ).rejects.toThrow('좌석 운영 사유를 입력해주세요');
    await expect(
      service.performOperation('admin-1', {
        operation: 'seat.disable',
        showtimeId: '00000000-0000-4000-8000-000000000001',
        seatKey: '2F:A-1',
        reason: '시야 제한',
        confirmed: false as true,
      }),
    ).rejects.toThrow('좌석 운영 확인이 필요합니다');

    expect(db.transaction).not.toHaveBeenCalled();
    expect(auditService.write).not.toHaveBeenCalled();
    expect(gateway.broadcastSeatUpdate).not.toHaveBeenCalled();
  });

  it('rejects malformed showtime IDs before database access', async () => {
    const db = {
      transaction: vi.fn(),
      select: vi.fn(),
    };
    const auditService = createMockAdminAuditService();
    const gateway = createMockBookingGateway();
    const service = new AdminSeatOperationsService(
      db as never,
      auditService,
      gateway as never,
    );

    await expect(
      service.performOperation('admin-1', {
        operation: 'seat.disable',
        showtimeId: 'malformed-showtime-id',
        seatKey: '2F:A-1',
        reason: '시야 제한',
        confirmed: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.listHistory({
        showtimeId: 'malformed-showtime-id',
        seatKey: '2F:A-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
    expect(auditService.write).not.toHaveBeenCalled();
    expect(gateway.broadcastSeatUpdate).not.toHaveBeenCalled();
  });

  it('does not broadcast when the transaction fails or the seat is missing', async () => {
    const failingDb = {
      transaction: vi.fn().mockRejectedValue(new Error('tx failed')),
      select: vi.fn(),
    };
    const auditService = createMockAdminAuditService();
    const gateway = createMockBookingGateway();
    const service = new AdminSeatOperationsService(
      failingDb as never,
      auditService,
      gateway as never,
    );

    await expect(
      service.performOperation('admin-1', {
        operation: 'seat.disable',
        showtimeId: '00000000-0000-4000-8000-000000000001',
        seatKey: '2F:A-1',
        reason: '시설 문제',
        confirmed: true,
      }),
    ).rejects.toThrow('tx failed');
    expect(gateway.broadcastSeatUpdate).not.toHaveBeenCalled();

    const missingTx = createTransactionMock([]);
    failingDb.transaction.mockImplementationOnce((callback: (tx: unknown) => Promise<unknown>) =>
      callback(missingTx.tx),
    );

    await expect(
      service.performOperation('admin-1', {
        operation: 'seat.disable',
        showtimeId: '00000000-0000-4000-8000-000000000001',
        seatKey: '2F:A-404',
        reason: '없는 좌석 확인',
        confirmed: true,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(gateway.broadcastSeatUpdate).not.toHaveBeenCalled();
  });

  it('returns seat operation history ordered for a specific showtime and seat key', async () => {
    const historyRows = [
      {
        id: 'history-1',
        action: 'seat.disable',
        showtimeId: '00000000-0000-4000-8000-000000000001',
        seatKey: '2F:A-1',
        previousStatus: 'available',
        nextStatus: 'disabled',
        reason: '시야 제한',
        actorUserId: 'admin-1',
        auditLogId: 'audit-seat-1',
        createdAt: new Date('2026-05-14T03:10:00.000Z'),
      },
    ];
    const historySelect = createHistorySelectChain(historyRows);
    const db = {
      transaction: vi.fn(),
      select: historySelect.select,
    };
    const service = new AdminSeatOperationsService(
      db as never,
      createMockAdminAuditService(),
      createMockBookingGateway() as never,
    );

    const history = await service.listHistory({
      showtimeId: '00000000-0000-4000-8000-000000000001',
      seatKey: '2F:A-1',
    });

    expect(history.rows).toEqual([
      {
        id: 'history-1',
        operation: 'seat.disable',
        showtimeId: '00000000-0000-4000-8000-000000000001',
        seatKey: '2F:A-1',
        previousStatus: 'available',
        nextStatus: 'disabled',
        reason: '시야 제한',
        actorUserId: 'admin-1',
        auditEventId: 'audit-seat-1',
        createdAt: '2026-05-14T03:10:00.000Z',
      },
    ]);
    expect(historySelect.select).toHaveBeenCalledTimes(1);
  });
});
