import { z } from 'zod';

export const lockSeatSchema = z.object({
  showtimeId: z.string().uuid('올바른 회차 ID가 아닙니다'),
  seatId: z.string().min(1, '좌석 ID를 입력해주세요').max(120, '좌석 ID는 120자 이내여야 합니다'),
});

export type LockSeatBody = z.infer<typeof lockSeatSchema>;
