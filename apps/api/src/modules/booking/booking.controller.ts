import {
  Controller,
  Post,
  Delete,
  Get,
  Body,
  Param,
  Req,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AdmissionGuard } from '../queue/guards/admission.guard.js';
import { BookingService } from './booking.service.js';
import { lockSeatSchema, type LockSeatBody } from './dto/lock-seat.dto.js';

type AuthenticatedBookingUser = {
  id: string;
  role?: string;
  isEmailVerified?: boolean;
  isPhoneVerified?: boolean;
};

@Controller('booking')
export class BookingController {
  constructor(private readonly bookingService: BookingService) {}

  /**
   * POST /api/v1/booking/seats/lock
   * Auth required. Locks a seat for the authenticated user.
   */
  @UseGuards(AdmissionGuard)
  @Post('seats/lock')
  @HttpCode(HttpStatus.CREATED)
  async lockSeat(
    @Body(new ZodValidationPipe(lockSeatSchema)) body: LockSeatBody,
    @Req() req: Request,
  ) {
    const user = req.user as AuthenticatedBookingUser;
    return this.bookingService.lockSeat(
      {
        id: user.id,
        role: user.role,
        isEmailVerified: user.isEmailVerified,
        isPhoneVerified: user.isPhoneVerified,
      },
      body.showtimeId,
      body.seatId,
    );
  }

  /**
   * DELETE /api/v1/booking/seats/lock/:showtimeId/:seatId
   * Auth required. Releases a seat lock (only if caller owns it).
   */
  @Delete('seats/lock/:showtimeId/:seatId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unlockSeat(
    @Param('showtimeId') showtimeId: string,
    @Param('seatId') seatId: string,
    @Req() req: Request,
  ) {
    const user = req.user as { id: string };
    await this.bookingService.unlockSeat(user.id, showtimeId, seatId);
  }

  /**
   * GET /api/v1/booking/my-locks/:showtimeId
   * Auth required. Returns current user's locked seats for session restore.
   */
  @Get('my-locks/:showtimeId')
  async getMyLocks(
    @Param('showtimeId') showtimeId: string,
    @Req() req: Request,
  ) {
    const user = req.user as { id: string };
    return this.bookingService.getMyLocks(user.id, showtimeId);
  }

  /**
   * DELETE /api/v1/booking/seats/lock-all/:showtimeId
   * Auth required. Releases ALL seat locks for the authenticated user in a showtime.
   * Used by timer reset to clean up all locks at once.
   */
  @Delete('seats/lock-all/:showtimeId')
  @HttpCode(HttpStatus.OK)
  async unlockAllSeats(
    @Param('showtimeId') showtimeId: string,
    @Req() req: Request,
  ) {
    const user = req.user as { id: string };
    return this.bookingService.unlockAllSeats(user.id, showtimeId);
  }

  /**
   * GET /api/v1/booking/schedules/:showtimeId/seats
   * Public endpoint. Returns all seat states for a showtime.
   */
  @Public()
  @SkipThrottle()
  @Get('schedules/:showtimeId/seats')
  async getSeatStatus(@Param('showtimeId') showtimeId: string) {
    return this.bookingService.getSeatStatus(showtimeId);
  }
}
