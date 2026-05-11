import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  QueueService,
  readQueueAdmissionCookie,
  readRefreshCookie,
} from '../queue.service.js';

type AuthenticatedRequest = Request & {
  user?: {
    id?: string;
  };
  body?: Record<string, unknown>;
  queueAdmission?: {
    queueSessionId: string;
    admissionToken: string;
    refreshFamilyId: string;
    deviceSlotKey: string;
    admittedAt: string;
    activeUntilAt: string;
    reentryGraceUntilAt: string;
  };
};

@Injectable()
export class AdmissionGuard implements CanActivate {
  constructor(private readonly queueService: QueueService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = request.user?.id;
    if (!userId) {
      throw new ForbiddenException('대기열 입장 인증이 필요합니다');
    }

    const refreshToken = readRefreshCookie(
      request.cookies as Record<string, string | undefined>,
    );
    // Cookie transport is intentionally opaque and cookie-only: grabit_queue_admission.
    const admissionToken = readQueueAdmissionCookie(
      request.cookies as Record<string, string | undefined>,
    );

    if (!refreshToken || !admissionToken) {
      throw new ForbiddenException('대기열 입장 인증이 필요합니다');
    }

    const identity = await this.queueService.resolveBrowserIdentity(
      userId,
      refreshToken,
    );
    const validatedAdmission = await this.resolveAdmission(
      request,
      identity,
      admissionToken,
      userId,
    );

    request.queueAdmission = {
      queueSessionId: validatedAdmission.queueSessionId,
      admissionToken,
      refreshFamilyId: validatedAdmission.refreshTokenFamilyId,
      deviceSlotKey: validatedAdmission.deviceSlotId,
      admittedAt: validatedAdmission.admittedAt,
      activeUntilAt: validatedAdmission.activeUntilAt,
      reentryGraceUntilAt: validatedAdmission.reentryGraceUntilAt,
    };

    return true;
  }

  private async resolveAdmission(
    request: AuthenticatedRequest,
    identity: {
      userId: string;
      refreshTokenFamilyId: string;
      deviceSlotId: string;
    },
    admissionToken: string,
    userId: string,
  ) {
    const path = this.resolvePath(request);

    if (path.includes('/payments/confirm')) {
      const orderId = this.readString(request.body, 'orderId');
      if (!orderId) {
        throw new ForbiddenException('대기열 입장 정보가 필요합니다');
      }

      return this.queueService.assertAdmissionForOrder({
        orderId,
        userId,
        identity,
        admissionToken,
      });
    }

    const showtimeId = this.readString(request.body, 'showtimeId');
    if (!showtimeId) {
      throw new ForbiddenException('대기열 입장 정보가 필요합니다');
    }

    return this.queueService.assertAdmissionForShowtime({
      showtimeId,
      identity,
      admissionToken,
      action: path.includes('/reservations/prepare')
        ? 'prepare-reservation'
        : 'lock-seat',
    });
  }

  private readString(
    payload: Record<string, unknown> | undefined,
    key: string,
  ): string | null {
    const value = payload?.[key];
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private resolvePath(request: AuthenticatedRequest): string {
    const originalUrl = request.originalUrl ?? request.url ?? '';
    return originalUrl.split('?')[0] ?? originalUrl;
  }
}
