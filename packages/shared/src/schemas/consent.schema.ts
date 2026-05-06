import { z } from 'zod';

import { SUPPORTED_LOCALES } from '../constants/locales';

export const CONSENT_ITEM_KEYS = [
  'terms',
  'privacy',
  'pipa_required',
  'cross_border_transfer',
  'pdpa_notice',
  'pipl_notice',
  'marketing',
] as const;

export const REQUIRED_CONSENT_ITEM_KEYS = [
  'terms',
  'privacy',
  'pipa_required',
  'cross_border_transfer',
  'pdpa_notice',
  'pipl_notice',
] as const;

export const OPTIONAL_CONSENT_ITEM_KEYS = ['marketing'] as const;
export const CONSENT_SOURCE_FLOWS = ['signup', 'booking'] as const;

const supportedLocaleSchema = z.enum(SUPPORTED_LOCALES);
const consentItemKeySchema = z.enum(CONSENT_ITEM_KEYS);
const consentSourceFlowSchema = z.enum(CONSENT_SOURCE_FLOWS);
const requiredConsentItemKeys = new Set<string>(REQUIRED_CONSENT_ITEM_KEYS);

export const consentItemSchema = z
  .object({
    key: consentItemKeySchema,
    version: z.string().min(1),
    language: supportedLocaleSchema,
    required: z.boolean(),
    title: z.string().min(1),
    contentHash: z.string().min(1),
    effectiveFrom: z.string().datetime(),
  })
  .superRefine((item, ctx) => {
    if (item.key === 'marketing' && item.required) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['required'],
        message: 'marketing consent must remain optional',
      });
    }

    if (requiredConsentItemKeys.has(item.key) && !item.required) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['required'],
        message: `${item.key} consent is required for this launch`,
      });
    }
  });

export const consentCaptureItemSchema = z.object({
  key: consentItemKeySchema,
  version: z.string().min(1),
  language: supportedLocaleSchema,
  accepted: z.boolean(),
});

export const consentCaptureBaseSchema = z.object({
  userId: z.string().min(1),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  capturedAt: z.string().datetime(),
  ipAddress: z.string().min(1),
  userAgent: z.string().optional(),
  sourceFlow: consentSourceFlowSchema,
  items: z.array(consentCaptureItemSchema).min(1),
});

export const consentCaptureRequestSchema = consentCaptureBaseSchema
  .pick({
    birthDate: true,
    capturedAt: true,
    sourceFlow: true,
    items: true,
  })
  .extend({
    capturedAt: z.string().datetime().optional(),
  });

export const consentCaptureSchema = consentCaptureBaseSchema
  .superRefine((capture, ctx) => {
    if (isUnderFourteen(capture.birthDate, capture.capturedAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['birthDate'],
        message: 'under-14 users are blocked for this launch',
      });
    }

    for (const key of REQUIRED_CONSENT_ITEM_KEYS) {
      const item = capture.items.find((candidate) => candidate.key === key);

      if (!item?.accepted) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['items'],
          message: `${key} consent is required`,
        });
      }
    }
  });

export const consentAuditQuerySchema = z.object({
  itemKey: consentItemKeySchema.optional(),
  version: z.string().min(1).optional(),
  language: supportedLocaleSchema.optional(),
  userId: z.string().min(1).optional(),
  ipAddress: z.string().min(1).optional(),
  capturedFrom: z.string().datetime().optional(),
  capturedTo: z.string().datetime().optional(),
  evidenceMode: z.enum(['masked', 'raw']).default('masked'),
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});

export type ConsentItemKey = (typeof CONSENT_ITEM_KEYS)[number];
export type ConsentSourceFlow = (typeof CONSENT_SOURCE_FLOWS)[number];
export type ConsentItem = z.infer<typeof consentItemSchema>;
export type ConsentCaptureItem = z.infer<typeof consentCaptureItemSchema>;
export type ConsentCaptureRequest = z.infer<typeof consentCaptureRequestSchema>;
export type ConsentCapture = z.infer<typeof consentCaptureSchema>;
export type ConsentAuditQuery = z.infer<typeof consentAuditQuerySchema>;

function isUnderFourteen(birthDate: string, capturedAt: string): boolean {
  const birth = new Date(`${birthDate}T00:00:00.000Z`);
  const captured = new Date(capturedAt);

  if (Number.isNaN(birth.getTime()) || Number.isNaN(captured.getTime())) {
    return false;
  }

  const fourteenthBirthday = new Date(birth);
  fourteenthBirthday.setUTCFullYear(fourteenthBirthday.getUTCFullYear() + 14);

  return captured < fourteenthBirthday;
}
