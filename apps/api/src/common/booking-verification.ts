import { ForbiddenException } from '@nestjs/common';

export const BOOKING_VERIFICATION_REQUIRED_MESSAGE =
  '이메일 인증과 휴대폰 인증을 완료해야 예매할 수 있습니다.';

export function assertBookingVerificationComplete(actor: { isEmailVerified?: boolean; isPhoneVerified?: boolean }): void {
  if (actor.isEmailVerified !== true || actor.isPhoneVerified !== true) {
    throw new ForbiddenException(BOOKING_VERIFICATION_REQUIRED_MESSAGE);
  }
}
