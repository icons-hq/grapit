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

export interface QueueAccessClosedCopy {
  /** Heading of the checkout notice and label of the blocked pay button. */
  title: string;
  body: string;
  /** Leaves checkout (releasing the seats) for the queue. */
  rejoin: string;
  /** Shown when the checkout countdown reaches the queue access deadline. */
  toast: string;
}

const QUEUE_ACCESS_CLOSED_COPY: Record<QueueAccessLocale, QueueAccessClosedCopy> = {
  ko: {
    title: '대기열 입장 시간이 끝났습니다',
    body: '결제 요청은 대기열 입장 시간 안에만 할 수 있습니다. 다시 입장하면 선택한 좌석이 해제되고 새 순번을 받습니다.',
    rejoin: '대기열 다시 입장하기',
    toast: '대기열 입장 시간이 끝나 결제를 진행할 수 없습니다. 대기열에 다시 입장해 주세요.',
  },
  en: {
    title: 'Your queue access has ended',
    body: 'Payment can only be requested while your queue access is active. Rejoining releases the selected seats and gives you a new place in the queue.',
    rejoin: 'Rejoin the queue',
    toast: 'Your queue access ended, so payment cannot continue. Please rejoin the queue.',
  },
  th: {
    title: 'สิทธิ์เข้าคิวของคุณสิ้นสุดแล้ว',
    body: 'ขอชำระเงินได้เฉพาะช่วงที่สิทธิ์เข้าคิวยังมีผลอยู่ เมื่อเข้าคิวใหม่ ที่นั่งที่เลือกจะถูกปล่อยและคุณจะได้รับลำดับคิวใหม่',
    rejoin: 'เข้าคิวใหม่',
    toast: 'สิทธิ์เข้าคิวสิ้นสุดแล้ว จึงไม่สามารถชำระเงินต่อได้ กรุณาเข้าคิวใหม่',
  },
  'zh-CN': {
    title: '排队入场时间已结束',
    body: '只有在排队入场有效期内才能发起付款。重新排队会释放已选座位，并分配新的排队序号。',
    rejoin: '重新排队',
    toast: '排队入场时间已结束，无法继续付款。请重新排队。',
  },
};

export function getQueueAccessClosedCopy(
  locale: string | undefined,
): QueueAccessClosedCopy {
  return locale && Object.hasOwn(QUEUE_ACCESS_CLOSED_COPY, locale)
    ? QUEUE_ACCESS_CLOSED_COPY[locale as QueueAccessLocale]
    : QUEUE_ACCESS_CLOSED_COPY.ko;
}
