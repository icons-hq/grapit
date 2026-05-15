import {
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  QUEUE_ACTIVE_WINDOW_SECONDS,
  QUEUE_ADMISSION_COOKIE_NAME,
  QueueService,
  readQueueAdmissionCookie,
  readRefreshCookie,
} from './queue.service.js';

type AuthenticatedRequest = Request & {
  user: {
    id: string;
    role?: string;
  };
};

@Controller('queue')
export class QueueController {
  constructor(private readonly queueService: QueueService) {}

  // POST /api/v1/queue/performances/:performanceId/enter
  @Post('performances/:performanceId/enter')
  async enterQueue(
    @Param('performanceId') performanceId: string,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const identity = await this.queueService.resolveBrowserIdentity(
      req.user.id,
      readRefreshCookie(req.cookies as Record<string, string | undefined>),
    );
    const result = await this.queueService.enterPerformanceQueue({
      performanceId,
      identity,
      bypassQueue: req.user.role === 'admin',
    });

    this.setAdmissionCookie(res, result.admissionToken);

    return {
      queueSessionId: result.queueSessionId,
      state: result.state,
      position: result.position,
      waitingCount: result.waitingCount,
      etaSeconds: result.etaSeconds,
      remainingSeats: result.remainingSeats,
      autoEnter: result.autoEnter,
      admittedAt: result.admittedAt,
      activeUntilAt: result.activeUntilAt,
      reentryGraceUntilAt: result.reentryGraceUntilAt,
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
      this.setAdmissionCookie(res, admissionToken);
    }

    return result;
  }

  private setAdmissionCookie(res: Response, admissionToken: string): void {
    res.cookie(QUEUE_ADMISSION_COOKIE_NAME, admissionToken, this.cookieOptions());
  }

  private cookieOptions() {
    return {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'lax' as const,
      path: '/api/v1',
      maxAge: 780000,
    };
  }
}
