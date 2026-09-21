import { z } from 'zod';
import { createPerformanceSchema } from './performance.schema';

export const performancePreparationStepSchema = z.enum(['basic', 'seats', 'content', 'review']);
const draftFields = new Set(Object.keys(createPerformanceSchema.shape).filter((field) =>
  !['publishState', 'publishedAt', 'publishedByUserId', 'publishReadyAt', 'publishReviewRequestedAt'].includes(field)));

// Incomplete form values are intentional; full validation occurs when applying.
const draftDataSchema = z.record(z.unknown()).superRefine((data, context) => {
  const structure = createPerformanceSchema.deepPartial().safeParse(data);
  if (!structure.success) {
    for (const issue of structure.error.issues.filter((issue) => issue.code === 'invalid_type')) {
      context.addIssue({ code: 'custom', path: issue.path, message: '입력값 형식을 확인해주세요.' });
    }
  }
  for (const key of Object.keys(data)) {
    if (!draftFields.has(key)) context.addIssue({ code: 'custom', path: [key], message: '초안으로 저장할 수 없는 필드입니다.' });
  }
  if (JSON.stringify(data).length > 500_000) context.addIssue({ code: 'custom', message: '초안이 너무 큽니다.' });
});

export const createPerformanceDraftSchema = z.object({
  performanceId: z.string().uuid().nullable().optional(),
  baseUpdatedAt: z.string().datetime().nullable().optional(),
  data: draftDataSchema,
  step: performancePreparationStepSchema.default('basic'),
});
export const savePerformanceDraftSchema = z.object({
  expectedRevision: z.number().int().positive().max(2_147_483_646),
  data: draftDataSchema,
  step: performancePreparationStepSchema,
});
export const applyPerformanceDraftSchema = savePerformanceDraftSchema.pick({ expectedRevision: true });

export type CreatePerformanceDraftInput = z.infer<typeof createPerformanceDraftSchema>;
export type SavePerformanceDraftInput = z.infer<typeof savePerformanceDraftSchema>;
export type PerformancePreparationStep = z.infer<typeof performancePreparationStepSchema>;
export interface PerformanceDraft {
  id: string;
  performanceId: string | null;
  title: string;
  data: Record<string, unknown>;
  step: PerformancePreparationStep;
  revision: number;
  baseUpdatedAt: string | null;
  appliedAt: string | null;
  updatedAt: string;
}

export interface PerformancePreparation {
  performanceId: string;
  title: string;
  updatedAt: string;
  publishState: 'draft' | 'review' | 'publish_ready' | 'published';
  status: string;
  bookingStartsAt: string | null;
  canPublish: boolean;
  structureProtected: boolean;
  reservationCount: number;
  checks: Array<{ key: string; label: string; ready: boolean; step: PerformancePreparationStep; detail: string }>;
  locales: Array<{ locale: 'ko' | 'en' | 'th' | 'zh-CN'; title: boolean; description: boolean }>;
  history: Array<{ id: string; action: string; status: string; createdAt: string; reason: string | null }>;
}
