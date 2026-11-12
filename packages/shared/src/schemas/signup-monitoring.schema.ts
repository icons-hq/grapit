import { z } from 'zod';

export const signupMonitoringQuerySchema = z.object({
  period: z.enum(['announcement', 'today', '24h', '7d']).default('today'),
  since: z.string().datetime({ offset: true }).optional(),
}).strict().refine((query) => query.period !== 'announcement' || !!query.since, '공지 기준 시각이 필요합니다');
export type SignupMonitoringQuery = z.infer<typeof signupMonitoringQuerySchema>;

const ratioSchema = z.object({ value: z.string(), count: z.number().int().nonnegative(), rate: z.number() });
export const signupMonitoringResponseSchema = z.object({
  since: z.string().datetime(), until: z.string().datetime(), previousSince: z.string().datetime(), generatedAt: z.string().datetime(),
  summary: z.object({
    signups: z.number().int().nonnegative(), previousSignups: z.number().int().nonnegative(), change: z.number().int(), changeRate: z.number().nullable(),
    emailVerified: z.number().int().nonnegative(), phoneVerified: z.number().int().nonnegative(), marketingConsented: z.number().int().nonnegative(),
    firstPaidMembers: z.number().int().nonnegative(), firstPaidRate: z.number(),
  }),
  hourly: z.array(z.object({ hour: z.string(), signups: z.number().int().nonnegative() })),
  providers: z.array(ratioSchema), countries: z.array(ratioSchema), locales: z.array(ratioSchema),
});
export type SignupMonitoringResponse = z.infer<typeof signupMonitoringResponseSchema>;
