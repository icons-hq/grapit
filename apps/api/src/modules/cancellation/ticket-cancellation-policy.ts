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

  const daysAfterBooking = Math.max(0, today - bookingDay);
  const policyCode: TicketItemCancellationPolicyCode = today === bookingDay ? 'SAME_DAY_BEFORE_MIDNIGHT'
    : daysBeforeShow <= 2 ? 'SHOW_DAY_2_TO_1'
    : daysBeforeShow <= 6 ? 'SHOW_DAY_6_TO_3'
    : daysBeforeShow <= 9 ? 'SHOW_DAY_9_TO_7'
    : daysAfterBooking <= 7 ? 'WITHIN_7_DAYS_AFTER_BOOKING'
    : 'BOOKING_DAY_8_TO_SHOW_DAY_10';
  const cancellationFee = ticketCancellationFeeForSubtotal(policyCode, input.price, input.fixedCancellationFee);
  const serviceFeeRefund = today === bookingDay ? input.serviceFee : 0;
  return { policyCode, cancellationFee, serviceFeeRefund, refundableAmount: input.price - cancellationFee + serviceFeeRefund };
}

/** Applied once to the cumulative seat and add-on value, even across separate payments. */
export function ticketCancellationFeeForSubtotal(policy: TicketItemCancellationPolicyCode, subtotal: number, fixedFee: boolean) {
  switch (policy) {
    case 'SHOW_DAY_2_TO_1': return Math.floor(subtotal * 0.3);
    case 'SHOW_DAY_6_TO_3': return Math.floor(subtotal * 0.2);
    case 'SHOW_DAY_9_TO_7': return Math.floor(subtotal * 0.1);
    case 'BOOKING_DAY_8_TO_SHOW_DAY_10':
      return Math.min(FIXED_TICKET_CANCELLATION_FEE_KRW, fixedFee ? subtotal : Math.floor(subtotal * 0.1));
    default: return 0;
  }
}

function getSeoulDayOrdinal(date: Date): number {
  const parts = seoulDateFormatter.formatToParts(date);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);

  return Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}
