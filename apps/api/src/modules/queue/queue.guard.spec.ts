import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdmissionGuard } from './guards/admission.guard.js';

function createMockQueueService() {
  return {
    resolveBrowserIdentity: vi.fn().mockResolvedValue({
      userId: 'user-1',
      refreshTokenFamilyId: 'family-1',
      deviceSlotId: 'family-1',
    }),
    assertAdmissionForShowtime: vi.fn().mockResolvedValue({
      queueSessionId: 'queue-session-1',
      userId: 'user-1',
      refreshTokenFamilyId: 'family-1',
      deviceSlotId: 'family-1',
      admittedAt: '2026-05-08T00:00:00.000Z',
      activeUntilAt: '2026-05-08T00:10:00.000Z',
      reentryGraceUntilAt: '2026-05-08T00:13:00.000Z',
    }),
    assertAdmissionForOrder: vi.fn().mockResolvedValue({
      queueSessionId: 'queue-session-1',
      userId: 'user-1',
      refreshTokenFamilyId: 'family-1',
      deviceSlotId: 'family-1',
      admittedAt: '2026-05-08T00:00:00.000Z',
      activeUntilAt: '2026-05-08T00:10:00.000Z',
      reentryGraceUntilAt: '2026-05-08T00:13:00.000Z',
    }),
  };
}

function createExecutionContext(requestOverrides: Record<string, unknown> = {}) {
  const request = {
    user: { id: 'user-1' },
    cookies: {
      refreshToken: 'refresh-cookie',
      grabit_queue_admission: 'opaque-admission-token',
    },
    body: {
      showtimeId: '550e8400-e29b-41d4-a716-446655440000',
      orderId: 'ORDER-1',
    },
    originalUrl: '/api/v1/booking/seats/lock',
    ...requestOverrides,
  };

  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as ExecutionContext;
}

describe('AdmissionGuard', () => {
  let queueService: ReturnType<typeof createMockQueueService>;
  let guard: AdmissionGuard;

  beforeEach(() => {
    queueService = createMockQueueService();
    guard = new AdmissionGuard(queueService as never);
  });

  it('rejects booking mutation requests without the grabit_queue_admission cookie', async () => {
    const context = createExecutionContext({
      cookies: {
        refreshToken: 'refresh-cookie',
      },
    });

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(context)).rejects.toThrow(
      '대기열 입장 인증이 필요합니다',
    );
  });

  it('attaches queueAdmission context after validating the showtime binding', async () => {
    const context = createExecutionContext();

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(queueService.assertAdmissionForShowtime).toHaveBeenCalledWith({
      showtimeId: '550e8400-e29b-41d4-a716-446655440000',
      identity: {
        userId: 'user-1',
        refreshTokenFamilyId: 'family-1',
        deviceSlotId: 'family-1',
      },
      admissionToken: 'opaque-admission-token',
      action: 'lock-seat',
    });

    const request = context.switchToHttp().getRequest() as {
      queueAdmission?: Record<string, string>;
    };
    expect(request.queueAdmission).toMatchObject({
      queueSessionId: 'queue-session-1',
      admissionToken: 'opaque-admission-token',
      refreshFamilyId: 'family-1',
      deviceSlotKey: 'family-1',
    });
  });

  it('allows admin booking tests without queue cookies and attaches bypass admission context', async () => {
    const context = createExecutionContext({
      user: { id: 'admin-1', role: 'admin' },
      cookies: {},
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(queueService.resolveBrowserIdentity).not.toHaveBeenCalled();
    expect(queueService.assertAdmissionForShowtime).not.toHaveBeenCalled();

    const request = context.switchToHttp().getRequest() as {
      queueAdmission?: Record<string, string>;
    };
    expect(request.queueAdmission).toMatchObject({
      queueSessionId: 'admin-bypass-admin-1',
      admissionToken: 'admin-bypass',
      refreshFamilyId: 'admin-bypass-admin-1',
      deviceSlotKey: 'admin-bypass-admin-1',
    });
  });

  it('validates confirm-payment requests through orderId binding', async () => {
    const context = createExecutionContext({
      body: {
        orderId: 'ORDER-1',
      },
      originalUrl: '/api/v1/payments/confirm',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(queueService.assertAdmissionForOrder).toHaveBeenCalledWith({
      orderId: 'ORDER-1',
      userId: 'user-1',
      identity: {
        userId: 'user-1',
        refreshTokenFamilyId: 'family-1',
        deviceSlotId: 'family-1',
      },
      admissionToken: 'opaque-admission-token',
    });
  });

  it('locks the guard source and controller wiring to cookie-only admission enforcement', async () => {
    const guardSource = await readFile(
      resolve(__dirname, 'guards/admission.guard.ts'),
      'utf-8',
    );
    const bookingControllerSource = await readFile(
      resolve(__dirname, '../booking/booking.controller.ts'),
      'utf-8',
    );
    const reservationControllerSource = await readFile(
      resolve(__dirname, '../reservation/reservation.controller.ts'),
      'utf-8',
    );

    expect(guardSource).toContain('grabit_queue_admission');
    expect(guardSource).toContain('userId');
    expect(guardSource).toContain('refreshTokenFamilyId');
    expect(guardSource).toContain('deviceSlotId');
    expect(guardSource).toContain('queueSessionId');
    expect(bookingControllerSource).toContain('AdmissionGuard');
    expect(reservationControllerSource).toContain('AdmissionGuard');
  });
});
