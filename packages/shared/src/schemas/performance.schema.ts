import { z } from 'zod';
import { SUPPORTED_LOCALES } from '../constants/locales';
import {
  BANNER_DEVICE_TARGETS,
  BANNER_PLACEMENTS,
  BANNER_STATUSES,
  DEFAULT_PERFORMANCE_BOOKING_POLICY,
  GENRES,
  PERFORMANCE_PUBLISH_LIFECYCLE,
  PERFORMANCE_ALLOWED_PAYMENT_METHODS,
  PERFORMANCE_STATUSES,
} from '../types/performance.types';

const booleanQueryParam = z.preprocess((value) => {
  if (value === undefined || value === '') return false;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}, z.boolean());

const isoDatetime = (label: string) =>
  z.string().datetime({ message: `${label}은 ISO datetime 형식이어야 합니다` });

export const performancePublishLifecycleSchema = z.enum(
  PERFORMANCE_PUBLISH_LIFECYCLE,
);
export const performanceStatusSchema = z.enum(PERFORMANCE_STATUSES);
export const bannerPlacementSchema = z.enum(BANNER_PLACEMENTS);
export const bannerDeviceTargetSchema = z.enum(BANNER_DEVICE_TARGETS);
export const bannerStatusSchema = z.enum(BANNER_STATUSES);

export const performanceQuerySchema = z.object({
  genre: z.enum(GENRES).optional(),
  locale: z.enum(SUPPORTED_LOCALES).optional(),
  sub: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['latest', 'popular']).default('latest'),
  ended: booleanQueryParam,
});
export type PerformanceQuery = z.infer<typeof performanceQuerySchema>;

export const searchQuerySchema = z.object({
  q: z.string().min(1),
  genre: z.enum(GENRES).optional(),
  locale: z.enum(SUPPORTED_LOCALES).optional(),
  ended: booleanQueryParam,
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const createBannerSchema = z.object({
  imageUrl: z.string().url('올바른 이미지 URL을 입력해주세요'),
  linkUrl: z.string().url().nullable().optional(),
  placement: bannerPlacementSchema.default('home_hero'),
  deviceTarget: bannerDeviceTargetSchema.default('all'),
  startsAt: isoDatetime('배너 시작 시각').nullable().optional(),
  endsAt: isoDatetime('배너 종료 시각').nullable().optional(),
  status: bannerStatusSchema.default('active'),
  sortOrder: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
}).superRefine((value, ctx) => {
  if (!value.startsAt || !value.endsAt) return;
  if (Date.parse(value.endsAt) < Date.parse(value.startsAt)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: '배너 종료 시각은 시작 시각보다 빠를 수 없습니다',
      path: ['endsAt'],
    });
  }
});
export type CreateBannerInput = z.input<typeof createBannerSchema>;

export const seatMapConfigSchema = z.object({
  tiers: z.array(z.object({
    tierName: z.string().min(1),
    color: z.string().min(1),
    seatIds: z.array(z.string()),
  })),
});
export type SeatMapConfigInput = z.infer<typeof seatMapConfigSchema>;

export const performanceSeatMapSchema = z.object({
  floorKey: z.string().min(1, '층 키를 입력해주세요').max(20),
  floorLabel: z.string().min(1, '층 라벨을 입력해주세요').max(100),
  sortOrder: z.number().int().min(0).default(0),
  svgUrl: z.string().url('올바른 좌석맵 URL을 입력해주세요'),
  seatConfig: seatMapConfigSchema.nullable().optional().default(null),
  totalSeats: z.number().int().min(0).default(0),
});
export type PerformanceSeatMapInput = z.infer<typeof performanceSeatMapSchema>;

export const performanceBookingPolicySchema = z.object({
  maxTicketsPerUser: z
    .number()
    .int()
    .positive('최대 예매 가능 매수는 1 이상이어야 합니다'),
  allowedPaymentMethods: z
    .array(z.enum(PERFORMANCE_ALLOWED_PAYMENT_METHODS))
    .min(1, '최소 1개의 결제 수단이 필요합니다'),
  changePolicyEnabled: z.boolean(),
  paymentWindowMinutes: z
    .number()
    .int()
    .positive('결제 가능 시간은 1분 이상이어야 합니다'),
  seatHoldMinutes: z
    .number()
    .int()
    .positive('좌석 hold 시간은 1분 이상이어야 합니다'),
  cancelledSeatHoldMinMinutes: z
    .number()
    .int()
    .positive('취소 좌석 hold 최소 시간은 1분 이상이어야 합니다'),
  cancelledSeatHoldMaxMinutes: z
    .number()
    .int()
    .positive('취소 좌석 hold 최대 시간은 1분 이상이어야 합니다'),
  manualOpenEnabled: z.boolean(),
  bookingStartsAt: isoDatetime('예매 오픈 시각').nullable().optional().default(null),
}).superRefine((value, ctx) => {
  if (value.cancelledSeatHoldMaxMinutes < value.cancelledSeatHoldMinMinutes) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: '취소 좌석 hold 최대 시간은 최소 시간보다 작을 수 없습니다',
      path: ['cancelledSeatHoldMaxMinutes'],
    });
  }
});
export type PerformanceBookingPolicyInput = z.infer<
  typeof performanceBookingPolicySchema
>;

export const legacySeatMapSaveSchema = z.object({
  svgUrl: z.string().url('올바른 좌석맵 URL을 입력해주세요'),
  seatConfig: seatMapConfigSchema,
  totalSeats: z.number().int().min(0).optional(),
});
export type LegacySeatMapSaveInput = z.infer<typeof legacySeatMapSaveSchema>;

export const floorAwareSeatMapSaveSchema = z.object({
  seatMaps: z
    .array(performanceSeatMapSchema)
    .min(1, '최소 1개의 층 좌석맵이 필요합니다'),
  bookingPolicy: performanceBookingPolicySchema.optional(),
});
export type FloorAwareSeatMapSaveInput = z.infer<
  typeof floorAwareSeatMapSaveSchema
>;

export const saveSeatMapPayloadSchema = z.union([
  legacySeatMapSaveSchema,
  floorAwareSeatMapSaveSchema,
]);
export type SaveSeatMapPayloadInput = z.infer<typeof saveSeatMapPayloadSchema>;

export const performanceDetailImageSchema = z.object({
  imageUrl: z.string().url('올바른 상세 이미지 URL을 입력해주세요'),
  altText: z.string().max(200, '대체 텍스트는 200자 이하여야 합니다').nullable().optional(),
  sortOrder: z.number().int().min(0).default(0),
});
export const performanceDetailImagesSchema = z
  .array(performanceDetailImageSchema)
  .optional()
  .default([]);
export type PerformanceDetailImageInput = z.infer<
  typeof performanceDetailImageSchema
>;

export const createPerformanceSchema = z.object({
  title: z.string().min(1, '공연명을 입력해주세요').max(255),
  genre: z.enum(GENRES, { required_error: '장르를 선택해주세요' }),
  subcategory: z.string().max(100).nullable().optional(),
  venueName: z.string().min(1, '장소를 입력해주세요').max(255),
  venueAddress: z.string().max(500).nullable().optional(),
  venueAccessNotes: z.string().max(2000).nullable().optional(),
  transportSummary: z.string().max(2000).nullable().optional(),
  posterUrl: z.string().url().nullable().optional(),
  description: z.string().nullable().optional(),
  descriptionVisible: z.boolean().default(true),
  startDate: z.string().min(1, '시작일을 입력해주세요'),
  endDate: z.string().min(1, '종료일을 입력해주세요'),
  runtime: z.string().max(50).nullable().optional(),
  ageRating: z.string().min(1, '관람연령을 입력해주세요').max(50),
  status: performanceStatusSchema.default('upcoming'),
  salesInfo: z.string().nullable().optional(),
  salesInfoVisible: z.boolean().default(true),
  detailImages: performanceDetailImagesSchema,
  publishState: performancePublishLifecycleSchema.default('draft'),
  publishReviewRequestedAt: isoDatetime('게시 검토 요청 시각').nullable().optional(),
  publishReadyAt: isoDatetime('게시 준비 완료 시각').nullable().optional(),
  publishedAt: isoDatetime('게시 시각').nullable().optional(),
  publishedByUserId: z.string().uuid().nullable().optional(),
  priceTiers: z.array(z.object({
    tierName: z.string().min(1, '등급명을 입력해주세요').max(50),
    price: z.number().int().min(0, '가격은 0 이상이어야 합니다'),
    sortOrder: z.number().int().min(0).default(0),
  })).min(1, '최소 1개의 가격 등급이 필요합니다'),
  showtimes: z.array(z.object({
    showtimeId: z.string().uuid().optional(),
    dateTime: z.string().min(1, '회차 일시를 입력해주세요'),
  })).optional().default([]),
  castings: z.array(z.object({
    actorName: z.string().min(1, '배우 이름을 입력해주세요').max(100),
    roleName: z.string().max(100).nullable().optional(),
    photoUrl: z.string().url().nullable().optional(),
    sortOrder: z.number().int().min(0).default(0),
  })).optional().default([]),
  seatMaps: z.array(performanceSeatMapSchema).optional().default([]),
  bookingPolicy: performanceBookingPolicySchema
    .optional()
    .default(DEFAULT_PERFORMANCE_BOOKING_POLICY),
});

export type CreatePerformanceInput = z.infer<typeof createPerformanceSchema>;
export type CreatePerformanceFormInput = z.input<typeof createPerformanceSchema>;

export const updatePerformanceSchema = createPerformanceSchema.partial();
export type UpdatePerformanceInput = z.infer<typeof updatePerformanceSchema>;
