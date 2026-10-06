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
] as const;

export const OPTIONAL_CONSENT_ITEM_KEYS = [
  'cross_border_transfer',
  'pdpa_notice',
  'pipl_notice',
  'marketing',
] as const;
export const CONSENT_SOURCE_FLOWS = ['signup', 'social_completion', 'booking'] as const;

/**
 * Rows the booking checkout actually shows (booking terms and privacy notice).
 * `pipa_required` is captured at signup, whose wording already covers booking
 * processing, so booking must not claim it was presented again.
 */
export const BOOKING_CONSENT_ITEM_KEYS = ['terms', 'privacy'] as const;
export const BOOKING_REQUIRED_CONSENT_ITEM_KEYS = BOOKING_CONSENT_ITEM_KEYS;

/** Consent rows backed by a bundled legal document the buyer can open. */
export const CONSENT_DOCUMENT_ITEM_KEYS = [
  'terms',
  'privacy',
  'pipa_required',
  'marketing',
] as const;

/**
 * Version of the legal document each consent row presents. A version is the
 * effective date printed in that document, so an audit row names the exact text
 * the buyer saw:
 * - terms: terms-of-service(.en).md, effective 2026-04-28
 * - privacy, pipa_required: privacy-policy(.en).md v1.2, effective 2026-05-11
 * - marketing: marketing-consent(.en).md, effective 2026-04-28
 *
 * Bump a version only together with an additive `consent_items` seed migration
 * that keeps the previous version active (see the consent version runbook).
 */
export const CONSENT_DOCUMENT_VERSIONS = {
  terms: '2026-04-28',
  privacy: '2026-05-11',
  pipa_required: '2026-05-11',
  marketing: '2026-04-28',
} as const satisfies Record<(typeof CONSENT_DOCUMENT_ITEM_KEYS)[number], string>;

/** Legal documents exist only in Korean and English; other locales read English. */
export const CONSENT_DOCUMENT_LANGUAGES = ['ko', 'en'] as const;

export function resolveConsentDocumentLanguage(
  locale: string,
): (typeof CONSENT_DOCUMENT_LANGUAGES)[number] {
  return locale === 'ko' ? 'ko' : 'en';
}

export function requiredConsentItemKeysFor(
  sourceFlow: (typeof CONSENT_SOURCE_FLOWS)[number] | undefined,
): readonly (typeof CONSENT_ITEM_KEYS)[number][] {
  return sourceFlow === 'booking'
    ? BOOKING_REQUIRED_CONSENT_ITEM_KEYS
    : REQUIRED_CONSENT_ITEM_KEYS;
}

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
    sourceFlow: true,
    items: true,
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

    for (const key of requiredConsentItemKeysFor(capture.sourceFlow)) {
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

export const ADMIN_CONSENT_AUDIT_DEFAULT_LIMIT = 100;
export const ADMIN_CONSENT_AUDIT_MAX_LIMIT = 500;
/** Lookback applied when a query names no period and no user/email/IP. */
export const ADMIN_CONSENT_AUDIT_DEFAULT_WINDOW_DAYS = 7;

/** Admin consent audit query (`GET /admin/consent-audit`), newest first. */
export const consentAuditQuerySchema = z
  .object({
    itemKey: consentItemKeySchema.optional(),
    version: z.string().min(1).optional(),
    language: supportedLocaleSchema.optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    ip: z.string().min(1).optional(),
    userId: z.string().uuid().optional(),
    // Accounts store lower-case addresses (#99); match the same way.
    email: z.string().trim().toLowerCase().email().optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(ADMIN_CONSENT_AUDIT_MAX_LIMIT)
      .default(ADMIN_CONSENT_AUDIT_DEFAULT_LIMIT),
    cursor: z.string().min(1).max(256).optional(),
  })
  .refine(
    (query) => !query.from || !query.to || Date.parse(query.from) <= Date.parse(query.to),
    { path: ['to'], message: 'to must not be earlier than from' },
  );

export interface ConsentAuditRow {
  id: string;
  itemKey: string;
  version: string;
  language: string;
  maskedUser: {
    id: string;
    email: string;
    phone: string;
  };
  maskedIp: string;
  timestamp: string;
  sourceFlow: string;
  accepted: boolean;
}

export interface ConsentAuditPage {
  items: ConsentAuditRow[];
  /** Opaque keyset cursor for the next (older) page, or null on the last page. */
  nextCursor: string | null;
  /** Start of the default lookback window when the server applied one. */
  defaultWindowFrom: string | null;
}

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
