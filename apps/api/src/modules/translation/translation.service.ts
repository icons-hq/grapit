import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, desc, eq, gte, inArray, lte, ne, type SQL } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import { translationDrafts } from '../../database/schema/translation-drafts.js';
import { translationSources } from '../../database/schema/translation-sources.js';
import { DeepLClient, type DeepLTranslationResult } from './deepl.client.js';

export const TRANSLATION_TARGET_LOCALES = ['en', 'th', 'zh-CN'] as const;

export type TranslationTargetLocale = (typeof TRANSLATION_TARGET_LOCALES)[number];
export type TranslationStatus = 'draft' | 'review' | 'published' | 'stale';
export type LegalBlockedContentType = 'legal' | 'notice' | 'refund' | 'booking_guide';

export interface CreateTranslationSourceInput {
  entityType: string;
  entityId: string;
  field: string;
  sourceText: string;
  createdBy: string;
}

export interface TranslationSourceResult {
  id: string;
  entityType: string;
  entityId: string;
  field: string;
  sourceLocale: 'ko';
  sourceText: string;
  contentHash: string;
  createdBy: string | null;
  updatedAt: Date;
}

export interface TranslationDraftResult {
  id: string;
  sourceId: string;
  contentType: string;
  field: string;
  sourceText: string;
  locale: TranslationTargetLocale;
  status: TranslationStatus;
  translatedText: string;
  updatedAt: Date;
  reviewerId: string | null;
  automaticTranslationLabel: true;
}

export interface TranslationQueueFilters {
  contentType?: string;
  locale?: TranslationTargetLocale;
  status?: TranslationStatus;
  updatedFrom?: string;
  updatedTo?: string;
}

type SourceRow = typeof translationSources.$inferSelect;
type DraftRow = typeof translationDrafts.$inferSelect;
type DraftSourceContext = Pick<SourceRow, 'entityType' | 'field' | 'sourceText'>;

interface MemoryTranslationStore {
  sources: SourceRow[];
  drafts: DraftRow[];
  createSource(input: Omit<SourceRow, 'id' | 'createdAt' | 'updatedAt'>): SourceRow;
  getSource(sourceId: string): SourceRow | undefined;
  updateSource(sourceId: string, sourceText: string, contentHash: string): SourceRow;
  createDraft(input: Omit<DraftRow, 'id' | 'createdAt' | 'updatedAt'>): DraftRow;
  getDraft(draftId: string): DraftRow | undefined;
}

interface TranslationProvider {
  translateText(
    text: string,
    locale: TranslationTargetLocale,
  ): Promise<DeepLTranslationResult>;
}

const LEGAL_BLOCKED_CONTENT_TYPES = new Set<string>([
  'legal',
  'notice',
  'refund',
  'booking_guide',
]);

function isMemoryStore(db: DrizzleDB | MemoryTranslationStore): db is MemoryTranslationStore {
  return typeof (db as MemoryTranslationStore).createSource === 'function';
}

@Injectable()
export class TranslationService {
  constructor(
    @Inject(DRIZZLE)
    private readonly db: DrizzleDB | MemoryTranslationStore,
    @Optional()
    private readonly deepLClient?: TranslationProvider,
  ) {}

  async createSource(input: CreateTranslationSourceInput): Promise<TranslationSourceResult> {
    const contentHash = this.hashSourceText(input.sourceText);

    if (isMemoryStore(this.db)) {
      return this.mapSource(this.db.createSource({
        entityType: input.entityType,
        entityId: input.entityId,
        field: input.field,
        sourceLocale: 'ko',
        sourceText: input.sourceText,
        contentHash,
        createdBy: input.createdBy,
      }));
    }

    const [source] = await this.db
      .insert(translationSources)
      .values({
        entityType: input.entityType,
        entityId: input.entityId,
        field: input.field,
        sourceLocale: 'ko',
        sourceText: input.sourceText,
        contentHash,
        createdBy: input.createdBy,
      })
      .returning();

    return this.mapSource(source!);
  }

  async generateDrafts(sourceId: string): Promise<TranslationDraftResult[]> {
    const source = await this.findSource(sourceId);
    this.assertTranslatableContentType(source.entityType);
    const drafts = await Promise.all(
      TRANSLATION_TARGET_LOCALES.map(async (locale) => {
        const translatedText = await this.generateDraftText(source.sourceText, locale);
        return this.createDraft(source, locale, translatedText);
      }),
    );

    return drafts.map((draft) => this.mapDraft(draft, source));
  }

  async listQueue(filters: TranslationQueueFilters = {}): Promise<TranslationDraftResult[]> {
    if (isMemoryStore(this.db)) {
      return this.db.drafts
        .map((draft) => {
          const source = this.requireMemorySource(draft.sourceId);
          return { draft, source };
        })
        .filter(({ draft, source }) => this.matchesQueueFilters(draft, source, filters))
        .sort((a, b) => b.draft.updatedAt.getTime() - a.draft.updatedAt.getTime())
        .map(({ draft, source }) => this.mapDraft(draft, source));
    }

    const predicates: SQL[] = [];
    if (filters.contentType) {
      predicates.push(eq(translationSources.entityType, filters.contentType));
    }
    if (filters.locale) {
      predicates.push(eq(translationDrafts.targetLocale, filters.locale));
    } else {
      predicates.push(inArray(translationDrafts.targetLocale, [...TRANSLATION_TARGET_LOCALES]));
    }
    if (filters.status) {
      predicates.push(eq(translationDrafts.status, filters.status));
    }
    if (filters.updatedFrom) {
      predicates.push(gte(translationDrafts.updatedAt, new Date(filters.updatedFrom)));
    }
    if (filters.updatedTo) {
      predicates.push(lte(translationDrafts.updatedAt, new Date(filters.updatedTo)));
    }

    const rows = await this.db
      .select({
        draft: translationDrafts,
        source: {
          entityType: translationSources.entityType,
          field: translationSources.field,
          sourceText: translationSources.sourceText,
        },
      })
      .from(translationDrafts)
      .innerJoin(translationSources, eq(translationDrafts.sourceId, translationSources.id))
      .where(predicates.length > 0 ? and(...predicates) : undefined)
      .orderBy(desc(translationDrafts.updatedAt));

    return rows.map((row) => this.mapDraft(row.draft, row.source));
  }

  async markReviewed(
    draftId: string,
    reviewerId: string,
    translatedText?: string,
  ): Promise<TranslationDraftResult> {
    const draft = await this.findDraft(draftId);
    const source = await this.findSource(draft.sourceId);

    if (draft.status === 'stale') {
      throw new BadRequestException('원문이 변경된 번역 초안은 다시 생성해야 합니다');
    }
    if (draft.status === 'published') {
      throw new BadRequestException('이미 게시된 번역은 검수 상태로 되돌릴 수 없습니다');
    }

    if (isMemoryStore(this.db)) {
      draft.status = 'review';
      if (translatedText) {
        draft.translatedText = translatedText;
      }
      draft.reviewedBy = reviewerId;
      draft.updatedAt = new Date();
      return this.mapDraft(draft, source);
    }

    const [updated] = await this.db
      .update(translationDrafts)
      .set({
        status: 'review',
        ...(translatedText ? { translatedText } : {}),
        reviewedBy: reviewerId,
        updatedAt: new Date(),
      })
      .where(eq(translationDrafts.id, draftId))
      .returning();

    return this.mapDraft(updated!, source);
  }

  async publishDraft(draftId: string): Promise<TranslationDraftResult> {
    const draft = await this.findDraft(draftId);
    const source = await this.findSource(draft.sourceId);

    if (draft.status !== 'review') {
      throw new BadRequestException('검수 완료된 번역만 게시할 수 있습니다');
    }

    if (isMemoryStore(this.db)) {
      this.db.drafts.forEach((candidate) => {
        if (
          candidate.id !== draft.id &&
          candidate.sourceId === draft.sourceId &&
          candidate.targetLocale === draft.targetLocale &&
          candidate.status === 'published'
        ) {
          candidate.status = 'stale';
          candidate.updatedAt = new Date();
        }
      });
      draft.status = 'published';
      draft.publishedAt = new Date();
      draft.updatedAt = new Date();
      return this.mapDraft(draft, source);
    }

    const [published] = await this.db.transaction(async (tx) => {
      await tx
        .update(translationDrafts)
        .set({ status: 'stale', updatedAt: new Date() })
        .where(
          and(
            eq(translationDrafts.sourceId, draft.sourceId),
            eq(translationDrafts.targetLocale, draft.targetLocale),
            eq(translationDrafts.status, 'published'),
            ne(translationDrafts.id, draftId),
          ),
        );

      return tx
        .update(translationDrafts)
        .set({ status: 'published', publishedAt: new Date(), updatedAt: new Date() })
        .where(eq(translationDrafts.id, draftId))
        .returning();
    });

    return this.mapDraft(published!, source);
  }

  async markStaleOnSourceEdit(
    sourceId: string,
    sourceText: string,
  ): Promise<TranslationDraftResult[]> {
    const nextHash = this.hashSourceText(sourceText);

    if (isMemoryStore(this.db)) {
      const source = this.db.updateSource(sourceId, sourceText, nextHash);
      const staleDrafts = this.db.drafts.filter((draft) => draft.sourceId === sourceId);
      staleDrafts.forEach((draft) => {
        draft.status = 'stale';
        draft.sourceContentHash = nextHash;
        draft.updatedAt = new Date();
      });
      return staleDrafts.map((draft) => this.mapDraft(draft, source));
    }

    const [source] = await this.db
      .update(translationSources)
      .set({ sourceText, contentHash: nextHash, updatedAt: new Date() })
      .where(eq(translationSources.id, sourceId))
      .returning();

    if (!source) {
      throw new NotFoundException('번역 원문을 찾을 수 없습니다');
    }

    const staleDrafts = await this.db
      .update(translationDrafts)
      .set({ status: 'stale', sourceContentHash: nextHash, updatedAt: new Date() })
      .where(and(eq(translationDrafts.sourceId, sourceId)))
      .returning();

    return staleDrafts.map((draft) => this.mapDraft(draft, source));
  }

  protected async generateDraftText(
    sourceText: string,
    locale: TranslationTargetLocale,
  ): Promise<string> {
    if (this.deepLClient) {
      const result = await this.deepLClient.translateText(sourceText, locale);
      return result.text;
    }
    return sourceText;
  }

  assertTranslatableContentType(contentType: string): void {
    if (LEGAL_BLOCKED_CONTENT_TYPES.has(contentType)) {
      throw new BadRequestException('법적 고지는 자동 번역할 수 없습니다');
    }
  }

  private async createDraft(
    source: SourceRow,
    locale: TranslationTargetLocale,
    translatedText: string,
  ): Promise<DraftRow> {
    if (isMemoryStore(this.db)) {
      return this.db.createDraft({
        sourceId: source.id,
        targetLocale: locale,
        status: 'draft',
        translatedText,
        sourceContentHash: source.contentHash,
        reviewedBy: null,
        publishedAt: null,
      });
    }

    const [draft] = await this.db
      .insert(translationDrafts)
      .values({
        sourceId: source.id,
        targetLocale: locale,
        status: 'draft',
        translatedText,
        sourceContentHash: source.contentHash,
      })
      .returning();

    return draft!;
  }

  private async findSource(sourceId: string): Promise<SourceRow> {
    if (isMemoryStore(this.db)) {
      return this.requireMemorySource(sourceId);
    }

    const [source] = await this.db
      .select()
      .from(translationSources)
      .where(eq(translationSources.id, sourceId))
      .limit(1);

    if (!source) {
      throw new NotFoundException('번역 원문을 찾을 수 없습니다');
    }

    return source;
  }

  private requireMemorySource(sourceId: string): SourceRow {
    if (!isMemoryStore(this.db)) {
      throw new NotFoundException('번역 원문을 찾을 수 없습니다');
    }
    const source = this.db.getSource(sourceId);
    if (!source) {
      throw new NotFoundException('번역 원문을 찾을 수 없습니다');
    }
    return source;
  }

  private async findDraft(draftId: string): Promise<DraftRow> {
    if (isMemoryStore(this.db)) {
      const draft = this.db.getDraft(draftId);
      if (!draft) {
        throw new NotFoundException('번역 초안을 찾을 수 없습니다');
      }
      return draft;
    }

    const [draft] = await this.db
      .select()
      .from(translationDrafts)
      .where(eq(translationDrafts.id, draftId))
      .limit(1);

    if (!draft) {
      throw new NotFoundException('번역 초안을 찾을 수 없습니다');
    }

    return draft;
  }

  private mapSource(source: SourceRow): TranslationSourceResult {
    return {
      id: source.id,
      entityType: source.entityType,
      entityId: source.entityId,
      field: source.field,
      sourceLocale: 'ko',
      sourceText: source.sourceText,
      contentHash: source.contentHash,
      createdBy: source.createdBy,
      updatedAt: source.updatedAt,
    };
  }

  private mapDraft(draft: DraftRow, source: DraftSourceContext): TranslationDraftResult {
    return {
      id: draft.id,
      sourceId: draft.sourceId,
      contentType: source.entityType,
      field: source.field,
      sourceText: source.sourceText,
      locale: draft.targetLocale as TranslationTargetLocale,
      status: draft.status,
      translatedText: draft.translatedText,
      updatedAt: draft.updatedAt,
      reviewerId: draft.reviewedBy,
      automaticTranslationLabel: true,
    };
  }

  private matchesQueueFilters(
    draft: DraftRow,
    source: SourceRow,
    filters: TranslationQueueFilters,
  ): boolean {
    if (!TRANSLATION_TARGET_LOCALES.includes(draft.targetLocale as TranslationTargetLocale)) {
      return false;
    }
    if (filters.contentType && source.entityType !== filters.contentType) return false;
    if (filters.locale && draft.targetLocale !== filters.locale) return false;
    if (filters.status && draft.status !== filters.status) return false;
    if (filters.updatedFrom && draft.updatedAt < new Date(filters.updatedFrom)) return false;
    if (filters.updatedTo && draft.updatedAt > new Date(filters.updatedTo)) return false;
    return true;
  }

  private hashSourceText(sourceText: string): string {
    return createHash('sha256').update(sourceText, 'utf8').digest('hex');
  }
}
