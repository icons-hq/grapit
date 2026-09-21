import { createHash } from 'node:crypto';
import { and, eq, inArray, ne } from 'drizzle-orm';
import type { UpdatePerformanceInput } from '@grabit/shared';
import type { DrizzleDB } from '../../database/drizzle.provider.js';
import { translationDrafts, translationSources } from '../../database/schema/index.js';

export async function invalidateChangedPerformanceTranslations(db: DrizzleDB, performanceId: string, input: UpdatePerformanceInput) {
  for (const field of ['title', 'description', 'salesInfo'] as const) {
    if (input[field] === undefined) continue;
    const sourceText = input[field] ?? '';
    const contentHash = createHash('sha256').update(sourceText, 'utf8').digest('hex');
    const sources = await db.update(translationSources).set({ sourceText, contentHash, updatedAt: new Date() })
      .where(and(eq(translationSources.entityType, 'performance'), eq(translationSources.entityId, performanceId),
        eq(translationSources.field, field), ne(translationSources.sourceText, sourceText))).returning({ id: translationSources.id });
    if (sources.length) await db.update(translationDrafts).set({ status: 'stale', updatedAt: new Date() })
      .where(inArray(translationDrafts.sourceId, sources.map((source) => source.id)));
  }
}
