import { Controller, Get, Param, Request } from '@nestjs/common';
import { QrTicketService } from './qr-ticket.service.js';

@Controller('tickets')
export class TicketController {
  constructor(private readonly qrTicketService: QrTicketService) {}

  @Get('reservations/:id')
  async getReservationTicket(
    @Param('id') reservationId: string,
    @Request() req: { user: { id: string } },
  ) {
    return this.qrTicketService.getOwnedTicketForReservation(reservationId, req.user.id);
  }
}
