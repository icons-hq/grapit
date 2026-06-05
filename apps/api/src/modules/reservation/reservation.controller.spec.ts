import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ReservationController } from './reservation.controller.js';
import type { ReservationService } from './reservation.service.js';

describe('ReservationController', () => {
  it('rejects customer ticket-item cancellation without calling the service', async () => {
    const reservationService = {
      cancelTicketItem: vi.fn(),
    } as unknown as ReservationService;
    const controller = new ReservationController(reservationService);

    await expect(
      controller.cancelTicketItem(
        'reservation-1',
        'ticket-item-1',
        { reason: '일정 변경' },
        { user: { id: 'user-1' } },
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      controller.cancelTicketItem(
        'reservation-1',
        'ticket-item-1',
        { reason: '일정 변경' },
        { user: { id: 'user-1' } },
      ),
    ).rejects.toThrow('티켓 단위 취소는 지원하지 않습니다. 예매 전체를 취소해주세요.');
    expect(reservationService.cancelTicketItem).not.toHaveBeenCalled();
  });
});
