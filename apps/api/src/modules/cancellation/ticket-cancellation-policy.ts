import { ForbiddenException } from '@nestjs/common';
import { FIXED_TICKET_CANCELLATION_FEE_KRW, type TicketItemCancellationPolicyCode } from '@grabit/shared';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const seoulDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * `bookedAt` is the booking confirmation time: the provider approval (`payments.paid_at`), falling back to
 * the reservation creation time only for legacy rows without it. A seat selected before midnight but paid
 * after midnight is booked on the payment day.
 */
export function calculateTicketItemCancellationQuote(input: {
  price: number;
  serviceFee: number;
  bookedAt: Date;
  showtimeAt: Date;
  fixedCancellationFee: boolean;
  now?: Date;
}): {
  cancellationFee: number;
  serviceFeeRefund: number;
  refundableAmount: number;
  policyCode: TicketItemCancellationPolicyCode;
} {
  const now = input.now ?? new Date();
  const today = getSeoulDayOrdinal(now);
  const bookingDay = getSeoulDayOrdinal(input.bookedAt);
  const showDay = getSeoulDayOrdinal(input.showtimeAt);
  const daysBeforeShow = showDay - today;

  if (daysBeforeShow <= 0) {
    throw new ForbiddenException('관람일 당일에는 취소할 수 없습니다');
  }

  if (today === bookingDay) {
    return {
      cancellationFee: 0,
      serviceFeeRefund: input.serviceFee,
      refundableAmount: input.price + input.serviceFee,
      policyCode: 'SAME_DAY_BEFORE_MIDNIGHT',
    };
  }

  if (daysBeforeShow <= 2) {
    const cancellationFee = Math.floor(input.price * 0.3);
    return {
      cancellationFee,
      serviceFeeRefund: 0,
      refundableAmount: Math.max(0, input.price - cancellationFee),
      policyCode: 'SHOW_DAY_2_TO_1',
    };
  }

  if (daysBeforeShow <= 6) {
    const cancellationFee = Math.floor(input.price * 0.2);
    return {
      cancellationFee,
      serviceFeeRefund: 0,
      refundableAmount: Math.max(0, input.price - cancellationFee),
      policyCode: 'SHOW_DAY_6_TO_3',
    };
  }

  if (daysBeforeShow <= 9) {
    const cancellationFee = Math.floor(input.price * 0.1);
    return {
      cancellationFee,
      serviceFeeRefund: 0,
      refundableAmount: Math.max(0, input.price - cancellationFee),
      policyCode: 'SHOW_DAY_9_TO_7',
    };
  }

  const daysAfterBooking = Math.max(0, today - bookingDay);
  const cancellationFee =
    daysAfterBooking <= 7
      ? 0
      : input.fixedCancellationFee
      ? Math.min(FIXED_TICKET_CANCELLATION_FEE_KRW, input.price)
      : Math.min(FIXED_TICKET_CANCELLATION_FEE_KRW, Math.floor(input.price * 0.1));

  return {
    cancellationFee,
    serviceFeeRefund: 0,
    refundableAmount: Math.max(0, input.price - cancellationFee),
    policyCode:
      daysAfterBooking <= 7
        ? 'WITHIN_7_DAYS_AFTER_BOOKING'
        : 'BOOKING_DAY_8_TO_SHOW_DAY_10',
  };
}

function getSeoulDayOrdinal(date: Date): number {
  const parts = seoulDateFormatter.formatToParts(date);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);

  return Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}
