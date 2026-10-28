import { z } from 'zod';
import { performanceSeatMapSchema } from './performance.schema';

/** A saved version is immutable. Saving the same venue/name creates a new version. */
export const createVenueLayoutSchema = z.object({
  venueName: z.string().trim().min(1, '공연장을 입력해주세요').max(255),
  layoutName: z.string().trim().min(1, '템플릿 이름을 입력해주세요').max(100),
  seatMaps: z.array(performanceSeatMapSchema).min(1).max(7),
}).superRefine((value, ctx) => {
  const floors = new Set<string>();
  for (const [index, floor] of value.seatMaps.entries()) {
    if (floors.has(floor.floorKey)) ctx.addIssue({ code: z.ZodIssueCode.custom,
      path: ['seatMaps', index, 'floorKey'], message: '층 키는 고유해야 합니다' });
    floors.add(floor.floorKey);
    const seats = floor.seatConfig?.tiers.flatMap((tier) => tier.seatIds) ?? [];
    const localIds = seats.map((id) => id.includes(':') ? id.slice(id.indexOf(':') + 1) : id);
    if (!seats.length || new Set(localIds).size !== seats.length || localIds.some((id) => !id.trim())
      || seats.some((id) => id.includes(':') && !id.startsWith(`${floor.floorKey}:`))
      || floor.totalSeats !== seats.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['seatMaps', index, 'seatConfig'],
        message: '해당 층의 좌석에 등급을 한 번씩 지정하고 좌석 수를 확인해주세요' });
    }
    if (localIds.some((id) => `${floor.floorKey}:${id}`.length > 120)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['seatMaps', index, 'seatConfig'],
        message: '층과 좌석을 합친 식별자는 120자 이하여야 합니다' });
    }
  }
});
export type CreateVenueLayoutInput = z.infer<typeof createVenueLayoutSchema>;

export interface VenueLayoutSummary {
  id: string;
  venueId: string;
  venueName: string;
  layoutName: string;
  version: number;
  totalSeats: number;
  floorCount: number;
  createdAt: string;
}

export interface VenueLayoutDetail extends VenueLayoutSummary {
  seatMaps: z.infer<typeof performanceSeatMapSchema>[];
}
