import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { canUseAdminBookingBypass } from '../../common/admin-booking-bypass.js';
import {
  QUEUE_ACTIVE_WINDOW_SECONDS,
  QUEUE_ADMISSION_COOKIE_MAX_AGE_MS,
  QUEUE_ADMISSION_COOKIE_NAME,
  QUEUE_WAITING_COOKIE_MAX_AGE_MS,
  QueueService,
  WAITING,
  readQueueAdmissionCookie,
  readRefreshCookie,
  type QueueSessionState,
} from './queue.service.js';

type AuthenticatedRequest = Request & {
  user: {
    id: string;
    role?: string;
    adminCapabilityBundle?: string | null;
    adminCapabilities?: string[];
  };
};

@Controller('queue')
export class QueueController {
  constructor(private readonly queueService: QueueService) {}

  // POST /api/v1/queue/performances/:performanceId/enter
  @Post('performances/:performanceId/enter')
  async enterQueue(
    // Validate before any DB query or queue key: malformed ids are a 400, not a Postgres 500.
    @Param(
      'performanceId',
      new ParseUUIDPipe({
        exceptionFactory: () => new BadRequestException('올바른 공연 ID가 아닙니다'),
      }),
    )
    performanceId: string,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const identity = await this.queueService.resolveBrowserIdentity(
      req.user.id,
      readRefreshCookie(req.cookies as Record<string, string | undefined>),
    );
    // QueueService treats actorRole 'admin' as Admin Booking Bypass, so only a
    // full admin may pass it; restricted bundles queue like Buyers.
    const adminBookingBypass = canUseAdminBookingBypass(req.user);
    const result = await this.queueService.enterPerformanceQueue({
      performanceId,
      identity,
      bypassQueue: adminBookingBypass,
      actorRole: adminBookingBypass ? 'admin' : undefined,
      presentedAdmissionToken: readQueueAdmissionCookie(
        req.cookies as Record<string, string | undefined>,
      ),
    });

    this.setAdmissionCookie(res, result.admissionToken, result.state);

    return {
      queueSessionId: result.queueSessionId,
      state: result.state,
      position: result.position,
      waitingCount: result.waitingCount,
      etaSeconds: result.etaSeconds,
      etaMinSeconds: result.etaMinSeconds,
      etaUnavailable: result.etaUnavailable,
      remainingSeats: result.remainingSeats,
      autoEnter: result.autoEnter,
      admittedAt: result.admittedAt,
      activeUntilAt: result.activeUntilAt,
      reentryGraceUntilAt: result.reentryGraceUntilAt,
      ...(result.recoveryOrderId ? { recoveryOrderId: result.recoveryOrderId } : {}),
      queueActiveWindowSeconds: QUEUE_ACTIVE_WINDOW_SECONDS,
    };
  }

  // GET /api/v1/queue/sessions/:queueSessionId
  @Get('sessions/:queueSessionId')
  async getQueueSession(
    @Param('queueSessionId') queueSessionId: string,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const identity = await this.queueService.resolveBrowserIdentity(
      req.user.id,
      readRefreshCookie(req.cookies as Record<string, string | undefined>),
    );
    const admissionToken = readQueueAdmissionCookie(
      req.cookies as Record<string, string | undefined>,
    );

    if (!admissionToken) {
      res.clearCookie(QUEUE_ADMISSION_COOKIE_NAME, this.cookieOptions());
      return {
        queueSessionId,
        state: 'EXPIRED',
        position: 0,
        waitingCount: 0,
        etaSeconds: 0,
        etaMinSeconds: 0,
        etaUnavailable: false,
        remainingSeats: 0,
        autoEnter: false,
        admittedAt: null,
        activeUntilAt: null,
        reentryGraceUntilAt: null,
      };
    }

    const result = await this.queueService.getQueueSessionStatus({
      queueSessionId,
      identity,
      admissionToken,
    });

    if (result.state === 'EXPIRED') {
      res.clearCookie(QUEUE_ADMISSION_COOKIE_NAME, this.cookieOptions());
    } else {
      this.setAdmissionCookie(res, admissionToken, result.state);
    }

    return result;
  }

  private setAdmissionCookie(
    res: Response,
    admissionToken: string,
    state: QueueSessionState,
  ): void {
    res.cookie(
      QUEUE_ADMISSION_COOKIE_NAME,
      admissionToken,
      this.cookieOptions(this.resolveCookieMaxAge(state)),
    );
  }

  /**
   * A WAITING session lives for its idle window (30 minutes since the last
   * heartbeat), so its cookie must too: a buyer back from a backgrounded tab
   * after 13+ minutes would otherwise lose a still-live position. An admission
   * keeps the 13-minute cookie (active window + re-entry grace).
   */
  private resolveCookieMaxAge(state: QueueSessionState): number {
    return state === WAITING ? QUEUE_WAITING_COOKIE_MAX_AGE_MS : QUEUE_ADMISSION_COOKIE_MAX_AGE_MS;
  }

  private cookieOptions(maxAge: number = QUEUE_ADMISSION_COOKIE_MAX_AGE_MS) {
    return {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'lax' as const,
      path: '/api/v1',
      maxAge,
    };
  }
}
