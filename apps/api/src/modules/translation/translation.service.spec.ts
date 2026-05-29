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
  targetLocale: string;
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
  let deeplClient: {
    translateText: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    store = new InMemoryTranslationStore();
    deeplClient = {
      translateText: vi.fn(async (text: string, locale: string) => ({
        status: 'translated',
        text: `${locale}:${text}`,
        targetLang: locale,
      })),
    };
    service = new TranslationService(store as never, deeplClient as never);
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
    expect(drafts.map((draft) => draft.locale)).toEqual(['en', 'th', 'zh-CN']);
    expect(drafts.every((draft) => draft.status === 'draft')).toBe(true);
    expect(drafts.every((draft) => draft.automaticTranslationLabel === true)).toBe(true);
  });

  it('excludes stale unsupported target locales from the admin queue', async () => {
    const source = await service.createSource({
      entityType: 'fanmeet',
      entityId: '11111111-1111-1111-1111-111111111111',
      field: 'description',
      sourceText: '팬미팅 안내',
      createdBy: '22222222-2222-2222-2222-222222222222',
    });
    await service.generateDrafts(source.id);
    store.createDraft({
      sourceId: source.id,
      targetLocale: 'zh-TW',
      status: 'published',
      translatedText: '繁體中文舊資料',
      sourceContentHash: source.contentHash,
      reviewedBy: null,
      publishedAt: new Date('2026-05-06T00:00:00.000Z'),
    });

    const queue = await service.listQueue();

    expect(queue.map((draft) => draft.locale)).toEqual(['en', 'th', 'zh-CN']);
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

  it('persists operator-edited translated text during review before publish', async () => {
    const source = await service.createSource({
      entityType: 'fanmeet',
      entityId: '11111111-1111-1111-1111-111111111111',
      field: 'description',
      sourceText: '팬미팅 안내',
      createdBy: '22222222-2222-2222-2222-222222222222',
    });
    const [draft] = await service.generateDrafts(source.id);

    const reviewed = await service.markReviewed(
      draft.id,
      '33333333-3333-3333-3333-333333333333',
      'Reviewed operator copy',
    );
    const published = await service.publishDraft(draft.id);

    expect(reviewed.translatedText).toBe('Reviewed operator copy');
    expect(published.translatedText).toBe('Reviewed operator copy');
  });

  it('does not move published drafts back to review', async () => {
    const source = await service.createSource({
      entityType: 'fanmeet',
      entityId: '11111111-1111-1111-1111-111111111111',
      field: 'description',
      sourceText: '팬미팅 안내',
      createdBy: '22222222-2222-2222-2222-222222222222',
    });
    const [draft] = await service.generateDrafts(source.id);
    await service.markReviewed(draft.id, '33333333-3333-3333-3333-333333333333');
    await service.publishDraft(draft.id);

    await expect(
      service.markReviewed(draft.id, '44444444-4444-4444-8444-444444444444'),
    ).rejects.toThrow('이미 게시된 번역은 검수 상태로 되돌릴 수 없습니다');
    expect(store.getDraft(draft.id)?.status).toBe('published');
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

    expect(staleDrafts).toHaveLength(3);
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
      field: 'description',
      sourceText: '팬미팅 안내',
      locale: 'en',
      status: 'review',
      reviewerId: '33333333-3333-3333-3333-333333333333',
      automaticTranslationLabel: true,
    });
    expect(queue[0].updatedAt).toBeInstanceOf(Date);
  });

  it('applies queue filters for content type, locale, status, and updated date range', async () => {
    const source = await service.createSource({
      entityType: 'performance',
      entityId: '11111111-1111-1111-1111-111111111111',
      field: 'description',
      sourceText: '팬미팅 안내',
      createdBy: '22222222-2222-2222-2222-222222222222',
    });
    const drafts = await service.generateDrafts(source.id);
    const reviewed = await service.markReviewed(
      drafts[0].id,
      '33333333-3333-3333-3333-333333333333',
    );
    const updatedFrom = new Date(reviewed.updatedAt.getTime() - 1_000).toISOString();
    const updatedTo = new Date(reviewed.updatedAt.getTime() + 1_000).toISOString();

    const queue = await service.listQueue({
      contentType: 'performance',
      locale: 'en',
      status: 'review',
      updatedFrom,
      updatedTo,
    });

    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      contentType: 'performance',
      locale: 'en',
      status: 'review',
    });
  });

  it('supersedes older published drafts for the same source and locale before publishing', async () => {
    const source = await service.createSource({
      entityType: 'fanmeet',
      entityId: '11111111-1111-1111-1111-111111111111',
      field: 'description',
      sourceText: '팬미팅 안내',
      createdBy: '22222222-2222-2222-2222-222222222222',
    });
    const [firstDraft] = await service.generateDrafts(source.id);
    await service.markReviewed(firstDraft.id, '33333333-3333-3333-3333-333333333333');
    await service.publishDraft(firstDraft.id);

    const secondDraft = store.createDraft({
      sourceId: source.id,
      targetLocale: 'en',
      status: 'review',
      translatedText: 'Second reviewed copy',
      sourceContentHash: source.contentHash,
      reviewedBy: '44444444-4444-4444-8444-444444444444',
      publishedAt: null,
    });
    const published = await service.publishDraft(secondDraft.id);

    expect(published.status).toBe('published');
    expect(store.getDraft(firstDraft.id)?.status).toBe('stale');
    expect(store.getDraft(secondDraft.id)?.status).toBe('published');
  });

  it('blocks legal-sensitive content before any translation provider call', async () => {
    const source = await service.createSource({
      entityType: 'legal',
      entityId: '11111111-1111-1111-1111-111111111111',
      field: 'terms',
      sourceText: '법적 고지',
      createdBy: '22222222-2222-2222-2222-222222222222',
    });

    await expect(service.generateDrafts(source.id)).rejects.toThrow(
      '법적 고지는 자동 번역할 수 없습니다',
    );
    expect(deeplClient.translateText).not.toHaveBeenCalled();
  });

  it('keeps missing-key provider output as reviewable drafts instead of published content', async () => {
    deeplClient.translateText.mockResolvedValue({
      status: 'unavailable',
      text: '[manual-review:deepl-unavailable] 팬미팅 안내',
      targetLang: 'EN-US',
    });
    const source = await service.createSource({
      entityType: 'fanmeet',
      entityId: '11111111-1111-1111-1111-111111111111',
      field: 'description',
      sourceText: '팬미팅 안내',
      createdBy: '22222222-2222-2222-2222-222222222222',
    });

    const drafts = await service.generateDrafts(source.id);

    expect(drafts[0]).toMatchObject({
      status: 'draft',
      translatedText: '[manual-review:deepl-unavailable] 팬미팅 안내',
      automaticTranslationLabel: true,
    });
    expect(drafts.some((draft) => draft.status === 'published')).toBe(false);
  });
});
