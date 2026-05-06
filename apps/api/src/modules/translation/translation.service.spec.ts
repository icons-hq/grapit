import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TranslationService } from './translation.service.js';

type SourceRow = {
  id: string;
  entityType: string;
  entityId: string;
  field: string;
  sourceLocale: 'ko';
  sourceText: string;
  contentHash: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

type DraftRow = {
  id: string;
  sourceId: string;
  targetLocale: 'en' | 'th' | 'zh-CN' | 'zh-TW';
  status: 'draft' | 'review' | 'published' | 'stale';
  translatedText: string;
  sourceContentHash: string;
  reviewedBy: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

class InMemoryTranslationStore {
  sources: SourceRow[] = [];
  drafts: DraftRow[] = [];

  nextSourceId = 1;
  nextDraftId = 1;

  createSource(input: Omit<SourceRow, 'id' | 'createdAt' | 'updatedAt'>): SourceRow {
    const now = new Date('2026-05-06T00:00:00.000Z');
    const source = {
      id: `source-${this.nextSourceId++}`,
      ...input,
      createdAt: now,
      updatedAt: now,
    };
    this.sources.push(source);
    return source;
  }

  getSource(sourceId: string): SourceRow | undefined {
    return this.sources.find((source) => source.id === sourceId);
  }

  updateSource(sourceId: string, sourceText: string, contentHash: string): SourceRow {
    const source = this.getSource(sourceId);
    if (!source) {
      throw new Error(`source not found: ${sourceId}`);
    }
    source.sourceText = sourceText;
    source.contentHash = contentHash;
    source.updatedAt = new Date('2026-05-06T00:01:00.000Z');
    return source;
  }

  createDraft(input: Omit<DraftRow, 'id' | 'createdAt' | 'updatedAt'>): DraftRow {
    const now = new Date('2026-05-06T00:00:00.000Z');
    const draft = {
      id: `draft-${this.nextDraftId++}`,
      ...input,
      createdAt: now,
      updatedAt: now,
    };
    this.drafts.push(draft);
    return draft;
  }

  getDraft(draftId: string): DraftRow | undefined {
    return this.drafts.find((draft) => draft.id === draftId);
  }
}

describe('TranslationService', () => {
  let store: InMemoryTranslationStore;
  let service: TranslationService;

  beforeEach(() => {
    store = new InMemoryTranslationStore();
    service = new TranslationService(store as never);
  });

  it('creates Korean source content and target drafts for all launch locales', async () => {
    const source = await service.createSource({
      entityType: 'fanmeet',
      entityId: '11111111-1111-1111-1111-111111111111',
      field: 'description',
      sourceText: '팬미팅 안내',
      createdBy: '22222222-2222-2222-2222-222222222222',
    });

    const drafts = await service.generateDrafts(source.id);

    expect(source.sourceLocale).toBe('ko');
    expect(drafts.map((draft) => draft.locale)).toEqual(['en', 'th', 'zh-CN', 'zh-TW']);
    expect(drafts.every((draft) => draft.status === 'draft')).toBe(true);
    expect(drafts.every((draft) => draft.automaticTranslationLabel === true)).toBe(true);
  });

  it('requires operator review before publishing a draft', async () => {
    const source = await service.createSource({
      entityType: 'fanmeet',
      entityId: '11111111-1111-1111-1111-111111111111',
      field: 'description',
      sourceText: '팬미팅 안내',
      createdBy: '22222222-2222-2222-2222-222222222222',
    });
    const [draft] = await service.generateDrafts(source.id);

    await expect(service.publishDraft(draft.id)).rejects.toBeInstanceOf(BadRequestException);

    await service.markReviewed(draft.id, '33333333-3333-3333-3333-333333333333');
    const published = await service.publishDraft(draft.id);

    expect(published.status).toBe('published');
    expect(published.reviewerId).toBe('33333333-3333-3333-3333-333333333333');
    expect(published.automaticTranslationLabel).toBe(true);
  });

  it('marks existing drafts stale when the Korean source is edited', async () => {
    const source = await service.createSource({
      entityType: 'fanmeet',
      entityId: '11111111-1111-1111-1111-111111111111',
      field: 'description',
      sourceText: '기존 안내',
      createdBy: '22222222-2222-2222-2222-222222222222',
    });
    const [draft] = await service.generateDrafts(source.id);
    await service.markReviewed(draft.id, '33333333-3333-3333-3333-333333333333');

    const staleDrafts = await service.markStaleOnSourceEdit(source.id, '수정된 안내');

    expect(staleDrafts).toHaveLength(4);
    expect(staleDrafts.every((item) => item.status === 'stale')).toBe(true);
    await expect(service.publishDraft(draft.id)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns queue rows with audit fields and automatic label state', async () => {
    const source = await service.createSource({
      entityType: 'fanmeet',
      entityId: '11111111-1111-1111-1111-111111111111',
      field: 'description',
      sourceText: '팬미팅 안내',
      createdBy: '22222222-2222-2222-2222-222222222222',
    });
    const [draft] = await service.generateDrafts(source.id);
    await service.markReviewed(draft.id, '33333333-3333-3333-3333-333333333333');

    const queue = await service.listQueue();

    expect(queue[0]).toMatchObject({
      contentType: 'fanmeet',
      locale: 'en',
      status: 'review',
      reviewerId: '33333333-3333-3333-3333-333333333333',
      automaticTranslationLabel: true,
    });
    expect(queue[0].updatedAt).toBeInstanceOf(Date);
  });
});
