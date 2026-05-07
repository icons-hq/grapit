import { and, eq, inArray } from 'drizzle-orm';
import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  type PerformanceCardData,
  type PerformanceWithDetails,
} from '@grabit/shared';
import type { DrizzleDB } from '../../database/drizzle.provider.js';
import {
  translationDrafts,
  translationSources,
} from '../../database/schema/index.js';

export const REVIEWED_TRANSLATION_SOURCE = 'machine_reviewed' as const;

export type PerformanceTranslationField = 'title' | 'description' | 'salesInfo';

type TranslationRow = {
  entityId: string;
  field: string;
  translatedText: string;
};

type TranslationMap = Map<
  string,
  Partial<Record<PerformanceTranslationField, string>>
>;

export function resolvePerformanceTranslationLocale(locale?: string | null) {
  return locale && isSupportedLocale(locale) ? locale : DEFAULT_LOCALE;
}

export function shouldOverlayPerformanceTranslations(locale?: string | null) {
  return resolvePerformanceTranslationLocale(locale) !== DEFAULT_LOCALE;
}

export async function fetchReviewedPerformanceTranslations(
  db: DrizzleDB,
  entityIds: readonly string[],
  targetLocale: string | null | undefined,
  fields: readonly PerformanceTranslationField[],
): Promise<TranslationMap> {
  const locale = resolvePerformanceTranslationLocale(targetLocale);
  if (locale === DEFAULT_LOCALE || entityIds.length === 0 || fields.length === 0) {
    return new Map();
  }

  const rows: TranslationRow[] = await db
    .select({
      entityId: translationSources.entityId,
      field: translationSources.field,
      translatedText: translationDrafts.translatedText,
    })
    .from(translationDrafts)
    .innerJoin(
      translationSources,
      eq(translationDrafts.sourceId, translationSources.id),
    )
    .where(
      and(
        eq(translationSources.entityType, 'performance'),
        inArray(translationSources.entityId, [...entityIds]),
        inArray(translationSources.field, [...fields]),
        eq(translationSources.sourceLocale, DEFAULT_LOCALE),
        eq(translationDrafts.targetLocale, locale),
        eq(translationDrafts.status, 'published'),
        eq(
          translationDrafts.sourceContentHash,
          translationSources.contentHash,
        ),
      ),
    );

  return rows.reduce<TranslationMap>((map, row) => {
    if (!fields.includes(row.field as PerformanceTranslationField)) {
      return map;
    }

    const field = row.field as PerformanceTranslationField;
    const existing = map.get(row.entityId) ?? {};
    existing[field] = row.translatedText;
    map.set(row.entityId, existing);
    return map;
  }, new Map());
}

export async function overlayReviewedCardTranslations(
  db: DrizzleDB,
  cards: PerformanceCardData[],
  targetLocale?: string | null,
): Promise<PerformanceCardData[]> {
  if (!shouldOverlayPerformanceTranslations(targetLocale)) {
    return cards;
  }

  const translations = await fetchReviewedPerformanceTranslations(
    db,
    cards.map((card) => card.id),
    targetLocale,
    ['title'],
  );

  return cards.map((card) => {
    const title = translations.get(card.id)?.title;
    if (!title) {
      return card;
    }

    return {
      ...card,
      title,
      automaticTranslationLabel: true,
      translatedBy: REVIEWED_TRANSLATION_SOURCE,
    };
  });
}

export async function overlayReviewedDetailTranslations(
  db: DrizzleDB,
  performance: PerformanceWithDetails,
  targetLocale?: string | null,
): Promise<PerformanceWithDetails> {
  if (!shouldOverlayPerformanceTranslations(targetLocale)) {
    return performance;
  }

  const translations = (
    await fetchReviewedPerformanceTranslations(
      db,
      [performance.id],
      targetLocale,
      ['title', 'description', 'salesInfo'],
    )
  ).get(performance.id);

  if (!translations) {
    return performance;
  }

  const translatedPerformance = {
    ...performance,
    title: translations.title ?? performance.title,
    description: translations.description ?? performance.description,
    salesInfo: translations.salesInfo ?? performance.salesInfo,
  };

  const hasOverlay =
    translatedPerformance.title !== performance.title ||
    translatedPerformance.description !== performance.description ||
    translatedPerformance.salesInfo !== performance.salesInfo;

  if (!hasOverlay) {
    return performance;
  }

  return {
    ...translatedPerformance,
    automaticTranslationLabel: true,
    translatedBy: REVIEWED_TRANSLATION_SOURCE,
  };
}
