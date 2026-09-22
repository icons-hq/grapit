import { Inject, Injectable } from '@nestjs/common';
import { eq, desc, sql, and, ne } from 'drizzle-orm';
import {
  DEFAULT_LOCALE,
  type PerformanceCardData,
  type SearchResponse,
  type SearchQuery,
} from '@grabit/shared';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import { publicCatalogCardSelection, mapPublicCatalogCard } from '../performance/catalog-card.js';
import { performances, venues, bookingPolicies } from '../../database/schema/index.js';
import {
  overlayReviewedCardTranslations,
  resolvePerformanceTranslationLocale,
} from '../translation/performance-translation-overlay.js';

@Injectable()
export class SearchService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
  ) {}

  async search(query: SearchQuery): Promise<SearchResponse> {
    const { q, genre, ended = false, page = 1, limit = 20 } = query;
    const locale = resolvePerformanceTranslationLocale(query.locale);
    const offset = (page - 1) * limit;

    const conditions: ReturnType<typeof eq>[] = [
      eq(performances.publishState, 'published'),
    ];

    if (genre) {
      conditions.push(eq(performances.genre, genre));
    }

    if (!ended) {
      conditions.push(ne(performances.status, 'ended'));
    }

    // tsvector + ILIKE combined search. Foreign-locale searches also match
    // reviewed published translated titles before the result overlay step.
    const translatedTitleCondition =
      locale === DEFAULT_LOCALE
        ? sql`false`
        : sql`exists (
            select 1
            from translation_sources ts
            inner join translation_drafts td on td.source_id = ts.id
            where ts.entity_type = 'performance'
              and ts.entity_id = ${performances.id}
              and ts.field = 'title'
              and ts.source_locale = ${DEFAULT_LOCALE}
              and td.target_locale = ${locale}
              and td.status = 'published'
              and td.source_content_hash = ts.content_hash
              and (
                td.translated_text ilike ${'%' + q + '%'}
                or to_tsvector('simple', td.translated_text) @@ plainto_tsquery('simple', ${q})
              )
          )`;

    const searchCondition = sql`(
      search_vector @@ plainto_tsquery('simple', ${q})
      OR ${performances.title} ILIKE ${'%' + q + '%'}
      OR ${translatedTitleCondition}
    )`;

    const whereClause = conditions.length > 0
      ? and(searchCondition, ...conditions)
      : searchCondition;

    const [data, countResult] = await Promise.all([
      this.db
        .select(publicCatalogCardSelection)
        .from(performances)
        .leftJoin(venues, eq(performances.venueId, venues.id))
        .leftJoin(bookingPolicies, eq(bookingPolicies.performanceId, performances.id))
        .where(whereClause)
        .orderBy(
          desc(sql`ts_rank(search_vector, plainto_tsquery('simple', ${q}))`),
        )
        .limit(limit)
        .offset(offset),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(performances)
        .where(whereClause),
    ]);

    const total = countResult[0]?.count ?? 0;

    const cards: PerformanceCardData[] = data.map(mapPublicCatalogCard);

    return {
      data: await overlayReviewedCardTranslations(this.db, cards, locale),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      query: q,
    };
  }
}
