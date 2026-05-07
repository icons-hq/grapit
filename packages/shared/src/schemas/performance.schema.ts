import { z } from 'zod';
import { SUPPORTED_LOCALES } from '../constants/locales';
import { GENRES } from '../types/performance.types';

const booleanQueryParam = z.preprocess((value) => {
  if (value === undefined || value === '') return false;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}, z.boolean());

export const createPerformanceSchema = z.object({
  title: z.string().min(1, '공연명을 입력해주세요').max(255),
  genre: z.enum(GENRES, { required_error: '장르를 선택해주세요' }),
  subcategory: z.string().max(100).nullable().optional(),
  venueName: z.string().min(1, '장소를 입력해주세요').max(255),
  venueAddress: z.string().max(500).nullable().optional(),
  posterUrl: z.string().url().nullable().optional(),
  description: z.string().nullable().optional(),
  startDate: z.string().min(1, '시작일을 입력해주세요'),
  endDate: z.string().min(1, '종료일을 입력해주세요'),
  runtime: z.string().max(50).nullable().optional(),
  ageRating: z.string().min(1, '관람연령을 입력해주세요').max(50),
  salesInfo: z.string().nullable().optional(),
  priceTiers: z.array(z.object({
    tierName: z.string().min(1, '등급명을 입력해주세요').max(50),
    price: z.number().int().min(0, '가격은 0 이상이어야 합니다'),
    sortOrder: z.number().int().min(0).default(0),
  })).min(1, '최소 1개의 가격 등급이 필요합니다'),
  showtimes: z.array(z.object({
    dateTime: z.string().min(1, '회차 일시를 입력해주세요'),
  })).optional().default([]),
  castings: z.array(z.object({
    actorName: z.string().min(1, '배우 이름을 입력해주세요').max(100),
    roleName: z.string().max(100).nullable().optional(),
    photoUrl: z.string().url().nullable().optional(),
    sortOrder: z.number().int().min(0).default(0),
  })).optional().default([]),
});

export type CreatePerformanceInput = z.infer<typeof createPerformanceSchema>;
export type CreatePerformanceFormInput = z.input<typeof createPerformanceSchema>;

export const updatePerformanceSchema = createPerformanceSchema.partial();
export type UpdatePerformanceInput = z.infer<typeof updatePerformanceSchema>;

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
  sortOrder: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});
export type CreateBannerInput = z.infer<typeof createBannerSchema>;

export const seatMapConfigSchema = z.object({
  tiers: z.array(z.object({
    tierName: z.string().min(1),
    color: z.string().min(1),
    seatIds: z.array(z.string()),
  })),
});
export type SeatMapConfigInput = z.infer<typeof seatMapConfigSchema>;
