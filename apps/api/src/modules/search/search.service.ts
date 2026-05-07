import { Inject, Injectable } from '@nestjs/common';
import { eq, desc, sql, and, ne } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import { performances, venues } from '../../database/schema/index.js';
import type {
  PerformanceCardData,
  SearchResponse,
  SearchQuery,
} from '@grabit/shared';
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

    const conditions: ReturnType<typeof eq>[] = [];

    if (genre) {
      conditions.push(eq(performances.genre, genre));
    }

    if (!ended) {
      conditions.push(ne(performances.status, 'ended'));
    }

    // tsvector + ILIKE combined search
    const searchCondition = sql`(
      search_vector @@ plainto_tsquery('simple', ${q})
      OR ${performances.title} ILIKE ${'%' + q + '%'}
    )`;

    const whereClause = conditions.length > 0
      ? and(searchCondition, ...conditions)
      : searchCondition;

    const [data, countResult] = await Promise.all([
      this.db
        .select({
          id: performances.id,
          title: performances.title,
          genre: performances.genre,
          posterUrl: performances.posterUrl,
          status: performances.status,
          startDate: performances.startDate,
          endDate: performances.endDate,
          venueName: venues.name,
        })
        .from(performances)
        .leftJoin(venues, eq(performances.venueId, venues.id))
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

    const cards: PerformanceCardData[] = data.map((row) => ({
      id: row.id,
      title: row.title,
      genre: row.genre,
      posterUrl: row.posterUrl,
      status: row.status,
      startDate: row.startDate?.toISOString() ?? '',
      endDate: row.endDate?.toISOString() ?? '',
      venueName: row.venueName ?? null,
    }));

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
