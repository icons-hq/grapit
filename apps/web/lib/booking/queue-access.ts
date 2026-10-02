/**
 * Queue access window helpers.
 *
 * After admission the server grants a fixed access window (`activeUntilAt`).
 * Seat locks and prepare are rejected once it closes, even while a seat lock
 * is still alive, so the booking screens count down to whichever ends first.
 */

/** Parses a server ISO instant; anything unusable is treated as absent. */
export function parseServerDeadline(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The earliest of the known deadlines (epoch ms), or null when none is set. */
export function earliestDeadline(
  ...deadlines: Array<number | null | undefined>
): number | null {
  let earliest: number | null = null;
  for (const deadline of deadlines) {
    if (typeof deadline !== 'number' || !Number.isFinite(deadline)) {
      continue;
    }
    if (earliest === null || deadline < earliest) {
      earliest = deadline;
    }
  }
  return earliest;
}

/**
 * Whether the checkout deadline being counted down is the queue access window
 * rather than the seat lock or the server payment deadline.
 */
export function isQueueAccessDeadline(
  deadlineAt: number | null,
  queueAccessExpiresAt: number | null,
): boolean {
  return (
    deadlineAt !== null &&
    queueAccessExpiresAt !== null &&
    deadlineAt === queueAccessExpiresAt
  );
}

type QueueAccessLocale = 'ko' | 'en' | 'th' | 'zh-CN';

/**
 * Server messages (403) of a seat lock, prepare or payment handoff refused for
 * the queue admission itself: the window ended, the admission was used up by a
 * purchase in another tab, the admission cookie is missing, for another
 * performance or still WAITING (this browser re-entered the queue elsewhere), or
 * (handoff) the order is bound to another browser session.
 * Other 403s (sales closed, booking disabled) are not about the queue.
 * Matched by message prefix (the error code field is not delivered yet), so every
 * admission 403 message of the API (queue.service admission checks, admission.guard)
 * must start with one of these.
 */
const QUEUE_ACCESS_REJECTION_PREFIXES = [
  '대기열 입장 시간이 만료되었습니다',
  '대기열 입장 인증이 필요합니다',
  '대기열 입장 정보가',
  '대기열 입장이 아직',
] as const;

export function isQueueAccessRejection(statusCode: number, message: string): boolean {
  const normalized = message.trim();
  return (
    statusCode === 403 &&
    QUEUE_ACCESS_REJECTION_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  );
}

function resolveQueueAccessLocale(locale: string | undefined): QueueAccessLocale {
  return locale && Object.hasOwn(QUEUE_ACCESS_CLOSED_COPY, locale)
    ? (locale as QueueAccessLocale)
    : 'ko';
}

export interface QueueAccessClosedCopy {
  /** Heading of the checkout notice and label of the blocked pay button. */
  title: string;
  body: string;
  /** Leaves checkout (releasing the seats) for the queue. */
  rejoin: string;
  /**
   * Shown when the checkout countdown reaches the queue access deadline, and
   * when a seat lock is refused because the queue access is gone.
   */
  toast: string;
}

const QUEUE_ACCESS_CLOSED_COPY: Record<QueueAccessLocale, QueueAccessClosedCopy> = {
  ko: {
    title: '대기열 입장 시간이 끝났습니다',
    body: '결제 요청은 대기열 입장 시간 안에만 할 수 있습니다. 다시 입장하면 선택한 좌석이 해제되고 새 순번을 받습니다.',
    rejoin: '대기열 다시 입장하기',
    toast: '대기열 입장 시간이 끝나 예매를 계속할 수 없습니다. 대기열에 다시 입장해 주세요.',
  },
  en: {
    title: 'Your queue access has ended',
    body: 'Payment can only be requested while your queue access is active. Rejoining releases the selected seats and gives you a new place in the queue.',
    rejoin: 'Rejoin the queue',
    toast: 'Your queue access ended, so booking cannot continue. Please rejoin the queue.',
  },
  th: {
    title: 'สิทธิ์เข้าคิวของคุณสิ้นสุดแล้ว',
    body: 'ขอชำระเงินได้เฉพาะช่วงที่สิทธิ์เข้าคิวยังมีผลอยู่ เมื่อเข้าคิวใหม่ ที่นั่งที่เลือกจะถูกปล่อยและคุณจะได้รับลำดับคิวใหม่',
    rejoin: 'เข้าคิวใหม่',
    toast: 'สิทธิ์เข้าคิวสิ้นสุดแล้ว จึงไม่สามารถจองต่อได้ กรุณาเข้าคิวใหม่',
  },
  'zh-CN': {
    title: '排队入场时间已结束',
    body: '只有在排队入场有效期内才能发起付款。重新排队会释放已选座位，并分配新的排队序号。',
    rejoin: '重新排队',
    toast: '排队入场时间已结束，无法继续预订。请重新排队。',
  },
};

export function getQueueAccessClosedCopy(
  locale: string | undefined,
): QueueAccessClosedCopy {
  return QUEUE_ACCESS_CLOSED_COPY[resolveQueueAccessLocale(locale)];
}

export interface QueueResumeRefusedCopy {
  /** Heading of the checkout notice and label of the blocked pay button. */
  title: string;
  body: string;
  toast: string;
}

/**
 * Checkout resuming a Prepared Checkout whose provider handoff was refused with
 * a queue 403: the order is bound to the browser session that prepared it (or
 * needs a live queue admission), as for payment confirm. Typical cases are
 * "continue payment" opened on another device or browser, or a session that
 * was signed out and in again. The order itself is still payable from the
 * bound browser until its deadline.
 */
const QUEUE_RESUME_REFUSED_COPY: Record<QueueAccessLocale, QueueResumeRefusedCopy> = {
  ko: {
    title: '이 화면에서는 결제를 이어갈 수 없습니다',
    body: '이 예매는 결제를 시작한 기기·브라우저의 로그인 세션에서만 이어서 결제할 수 있습니다. 그곳에서 결제 기한 안에 완료하거나, 대기열에 다시 입장해 새로 예매해 주세요. 다시 입장하면 이 예매가 취소되고 좌석이 해제됩니다.',
    toast: '결제를 시작한 기기·브라우저에서 결제를 이어 주세요.',
  },
  en: {
    title: 'Payment can’t continue here',
    body: 'This booking can only be paid in the signed-in session of the device and browser where you started paying. Finish it there before the payment deadline, or rejoin the queue to book again. Rejoining cancels this booking and releases its seats.',
    toast: 'Continue the payment on the device and browser where you started it.',
  },
  th: {
    title: 'ไม่สามารถชำระเงินต่อในหน้านี้ได้',
    body: 'การจองนี้ชำระเงินต่อได้เฉพาะในเซสชันที่เข้าสู่ระบบบนอุปกรณ์และเบราว์เซอร์ที่คุณเริ่มชำระเงินเท่านั้น กรุณาชำระให้เสร็จที่นั่นก่อนหมดเวลาชำระ หรือเข้าคิวใหม่เพื่อจองอีกครั้ง เมื่อเข้าคิวใหม่ การจองนี้จะถูกยกเลิกและที่นั่งจะถูกปล่อย',
    toast: 'กรุณาชำระเงินต่อบนอุปกรณ์และเบราว์เซอร์ที่คุณเริ่มชำระเงิน',
  },
  'zh-CN': {
    title: '无法在此页面继续付款',
    body: '此预订只能在开始付款的设备和浏览器的登录会话中继续付款。请在付款期限内在该处完成付款，或重新排队再次预订。重新排队会取消此预订并释放座位。',
    toast: '请在开始付款的设备和浏览器上继续付款。',
  },
};

export function getQueueResumeRefusedCopy(
  locale: string | undefined,
): QueueResumeRefusedCopy {
  return QUEUE_RESUME_REFUSED_COPY[resolveQueueAccessLocale(locale)];
}

export interface QueuePaymentRecoveryCopy {
  badge: string;
  title: string;
  body: string;
  /** Opens checkout for the order awaiting payment. */
  resume: string;
  /** Opens the buyer's reservation list. */
  reservations: string;
}

/**
 * The booking route for an admission whose seat window closed while an order
 * still awaits payment: only that payment may continue.
 */
const QUEUE_PAYMENT_RECOVERY_COPY: Record<QueueAccessLocale, QueuePaymentRecoveryCopy> = {
  ko: {
    badge: '결제 대기',
    title: '결제 대기 중인 예매가 있습니다',
    body: '좌석 선택 시간은 끝났지만 결제를 시작한 예매가 남아 있습니다. 결제 기한 안에 결제를 이어서 완료할 수 있습니다.',
    resume: '결제 이어하기',
    reservations: '내 예매 보기',
  },
  en: {
    badge: 'Payment pending',
    title: 'You have a booking awaiting payment',
    body: 'Your seat selection time has ended, but a booking you started paying for is still open. You can finish the payment before its deadline.',
    resume: 'Continue payment',
    reservations: 'View my bookings',
  },
  th: {
    badge: 'รอชำระเงิน',
    title: 'คุณมีการจองที่รอชำระเงิน',
    body: 'เวลาเลือกที่นั่งสิ้นสุดแล้ว แต่ยังมีการจองที่คุณเริ่มชำระเงินไว้ คุณสามารถชำระเงินต่อให้เสร็จได้ก่อนหมดเวลาชำระ',
    resume: 'ชำระเงินต่อ',
    reservations: 'ดูการจองของฉัน',
  },
  'zh-CN': {
    badge: '待付款',
    title: '您有一笔待付款的预订',
    body: '选座时间已结束，但您已开始付款的预订仍然有效。请在付款期限内完成付款。',
    resume: '继续付款',
    reservations: '查看我的预订',
  },
};

export function getQueuePaymentRecoveryCopy(
  locale: string | undefined,
): QueuePaymentRecoveryCopy {
  return QUEUE_PAYMENT_RECOVERY_COPY[resolveQueueAccessLocale(locale)];
}
