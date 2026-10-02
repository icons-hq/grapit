import { describe, expect, it } from 'vitest';
import {
  CONFIRM_PAYMENT_MAX_RETRIES,
  getConfirmPaymentRetryDelayMs,
  isRetryableConfirmPaymentError,
} from './payment-return';

function apiError(statusCode: number, message: string) {
  return Object.assign(new Error(message), { statusCode });
}

describe('confirm payment retry policy', () => {
  it.each([
    ['a lost request or response', new TypeError('Failed to fetch')],
    ['a non-JSON gateway body', new SyntaxError('Unexpected token <')],
    ['a gateway timeout', apiError(504, 'Gateway Timeout')],
    ['a gateway failure', apiError(502, 'Bad Gateway')],
    ['an unavailable confirm lease', apiError(503, '결제 확인을 다시 시도해주세요.')],
    ['an unexpected server error', apiError(500, '서버에 문제가 발생했습니다')],
    ['throttling', apiError(429, '요청이 너무 많습니다')],
    ['a confirm lease held by another request', apiError(409, '결제 확인이 이미 진행 중입니다.')],
  ])('repeats the confirm after %s', (_label, error) => {
    expect(isRetryableConfirmPaymentError(error)).toBe(true);
  });

  it.each([
    ['an expired seat hold', apiError(409, '좌석 점유 시간이 만료되었습니다. 좌석을 다시 선택해주세요.')],
    ['an expired admission', apiError(403, '대기열 입장 시간이 만료되었습니다')],
    ['an amount mismatch', apiError(400, '금액이 일치하지 않습니다')],
    ['an approved payment that was cancelled', apiError(500, '결제는 승인되었으나 처리 중 오류가 발생했습니다. 자동 취소를 시도했습니다. 고객센터에 문의해주세요.')],
    ['a missing order', apiError(404, '예매 정보를 찾을 수 없습니다. 다시 시도해주세요.')],
    ['a non-error value', 'boom'],
  ])('does not repeat a definite outcome: %s', (_label, error) => {
    expect(isRetryableConfirmPaymentError(error)).toBe(false);
  });

  it('backs off exponentially within the Toss authentication validity window', () => {
    const delays = Array.from({ length: CONFIRM_PAYMENT_MAX_RETRIES }, (_, failureCount) =>
      getConfirmPaymentRetryDelayMs(failureCount));
    expect(delays).toEqual([1_000, 2_000, 4_000]);
    expect(getConfirmPaymentRetryDelayMs(10)).toBe(8_000);
    expect(delays.reduce((sum, delay) => sum + delay, 0)).toBeLessThan(60_000);
  });
});
