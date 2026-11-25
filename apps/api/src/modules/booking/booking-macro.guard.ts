import { Body, CanActivate, Controller, ExecutionContext, HttpCode, Injectable, Post, Req, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { canUseAdminBookingBypass } from '../../common/admin-booking-bypass.js';
import { AdmissionGuard } from '../queue/guards/admission.guard.js';
import { BookingMacroService } from '../traffic/booking-macro.service.js';
import { lockSeatSchema } from './dto/lock-seat.dto.js';

@Injectable()
export class BookingMacroGuard implements CanActivate {
  constructor(private readonly macro: BookingMacroService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const data = lockSeatSchema.safeParse(req.body);
    if (data.success && !canUseAdminBookingBypass(req.user ?? {})) {
      await this.macro.beforeNewSeat(req, http.getResponse<Response>(), data.data.showtimeId, data.data.seatId);
    }
    return true;
  }
}

const verification = z.object({ showtimeId: z.string().uuid(), token: z.string().min(1).max(2048) });

@Controller('booking/seats')
export class BookingMacroController {
  constructor(private readonly macro: BookingMacroService) {}

  @UseGuards(AdmissionGuard)
  @Post('verify')
  @HttpCode(204)
  async verify(@Req() req: Request, @Body(new ZodValidationPipe(verification)) body: z.infer<typeof verification>) {
    await this.macro.verify(req, body.showtimeId, body.token);
  }
}
