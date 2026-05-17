import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, ne, type SQL } from 'drizzle-orm';

import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import {
  supportFaqs,
  supportNotices,
  supportNoticeCategoryEnum,
  supportThreadCategoryEnum,
  supportThreadPriorityEnum,
} from '../../database/schema/index.js';

export const SUPPORT_CONTENT_LOCALES = [
  'ko',
  'en',
  'th',
  'zh-CN',
] as const;

export type SupportContentLocale = (typeof SUPPORT_CONTENT_LOCALES)[number];
export type SupportContentReviewState =
  | 'draft'
  | 'review'
  | 'approved'
  | 'published'
  | 'archived';
export type SupportContentTranslationUse = 'none' | 'manual' | 'assisted';
export type SupportContentType = 'faq' | 'notice';
export type SupportFaqCategory =
  (typeof supportThreadCategoryEnum.enumValues)[number];
export type SupportNoticeCategory =
  (typeof supportNoticeCategoryEnum.enumValues)[number];
export type SupportNoticePriority =
  (typeof supportThreadPriorityEnum.enumValues)[number];
export type SupportNoticeStatus =
  | 'draft'
  | 'review'
  | 'scheduled'
  | 'published'
  | 'archived';

type FaqRow = typeof supportFaqs.$inferSelect;
type NoticeRow = typeof supportNotices.$inferSelect;
type NewFaqRow = typeof supportFaqs.$inferInsert;
type NewNoticeRow = typeof supportNotices.$inferInsert;
type SupportContentStore = DrizzleDB | SupportContentMemoryStore;

export interface SupportContentMemoryStore {
  faqs: FaqRow[];
  notices: NoticeRow[];
}

export interface SupportContentListFilters {
  type?: SupportContentType;
  locale?: SupportContentLocale;
  reviewState?: SupportContentReviewState;
  includeArchived?: boolean;
}

export interface SupportContentActorInput {
  actorUserId: string;
}

export interface CreateFaqInput extends SupportContentActorInput {
  category: SupportFaqCategory;
  locale: SupportContentLocale;
  question: string;
  answer: string;
  sortOrder?: number;
  isPinned?: boolean;
  translationUse?: SupportContentTranslationUse;
}

export interface UpdateFaqInput extends SupportContentActorInput {
  category?: SupportFaqCategory;
  question?: string;
  answer?: string;
  sortOrder?: number;
  isPinned?: boolean;
  translationUse?: SupportContentTranslationUse;
}

export interface CreateNoticeInput extends SupportContentActorInput {
  category: SupportNoticeCategory;
  locale: SupportContentLocale;
  title: string;
  body: string;
  priority?: SupportNoticePriority;
  scheduledAt?: string | null;
  translationUse?: SupportContentTranslationUse;
}

export interface UpdateNoticeInput extends SupportContentActorInput {
  category?: SupportNoticeCategory;
  title?: string;
  body?: string;
  priority?: SupportNoticePriority;
  scheduledAt?: string | null;
  translationUse?: SupportContentTranslationUse;
}

export interface AdminSupportFaq {
  id: string;
  category: SupportFaqCategory;
  locale: SupportContentLocale;
  question: string;
  answer: string;
  sortOrder: number;
  isPinned: boolean;
  reviewState: SupportContentReviewState;
  translationUse: SupportContentTranslationUse;
  translationUseLabel: '자동 번역 검수본' | null;
  canPublish: boolean;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  publishedAt: string | null;
  archivedAt: string | null;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminSupportNotice {
  id: string;
  category: SupportNoticeCategory;
  locale: SupportContentLocale;
  title: string;
  body: string;
  status: SupportNoticeStatus;
  priority: SupportNoticePriority;
  reviewState: SupportContentReviewState;
  translationUse: SupportContentTranslationUse;
  translationUseLabel: '자동 번역 검수본' | null;
  canPublish: boolean;
  scheduledAt: string | null;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  publishedAt: string | null;
  archivedAt: string | null;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminSupportContentList {
  faqs: AdminSupportFaq[];
  notices: AdminSupportNotice[];
}

@Injectable()
export class AdminSupportContentService {
  constructor(@Inject(DRIZZLE) private readonly store: SupportContentStore) {}

  async list(
    filters: SupportContentListFilters = {},
  ): Promise<AdminSupportContentList> {
    const [faqs, notices] = await Promise.all([
      filters.type === 'notice' ? Promise.resolve([]) : this.listFaqRows(filters),
      filters.type === 'faq' ? Promise.resolve([]) : this.listNoticeRows(filters),
    ]);

    return {
      faqs: faqs.map((row) => this.mapFaq(row)),
      notices: notices.map((row) => this.mapNotice(row)),
    };
  }

  async getFaq(id: string): Promise<AdminSupportFaq> {
    return this.mapFaq(await this.requireFaqRow(id));
  }

  async getNotice(id: string): Promise<AdminSupportNotice> {
    return this.mapNotice(await this.requireNoticeRow(id));
  }

  async createFaq(input: CreateFaqInput): Promise<AdminSupportFaq> {
    const now = this.now();
    const translationUse = normalizeTranslationUse(
      input.locale,
      input.translationUse,
    );
    const reviewState = initialReviewState(input.locale, translationUse);
    const row: NewFaqRow = {
      category: input.category,
      locale: input.locale,
      question: input.question.trim(),
      answer: input.answer.trim(),
      sortOrder: input.sortOrder ?? 0,
      isPinned: input.isPinned ?? false,
      reviewState,
      translationUse,
      reviewedByUserId: isPublishReadyReviewState(reviewState)
        ? input.actorUserId
        : null,
      reviewedAt: isPublishReadyReviewState(reviewState) ? now : null,
      createdByUserId: input.actorUserId,
      updatedByUserId: input.actorUserId,
      createdAt: now,
      updatedAt: now,
    };

    if (isMemoryStore(this.store)) {
      const inserted = {
        ...row,
        id: randomUUID(),
        category: input.category,
        locale: input.locale,
        sortOrder: input.sortOrder ?? 0,
        isPinned: input.isPinned ?? false,
        reviewState,
        translationUse,
        reviewedByUserId: row.reviewedByUserId ?? null,
        reviewedAt: row.reviewedAt ?? null,
        publishedAt: null,
        archivedAt: null,
        createdByUserId: input.actorUserId,
        updatedByUserId: input.actorUserId,
        createdAt: now,
        updatedAt: now,
      } satisfies FaqRow;
      this.store.faqs.push(inserted);
      return this.mapFaq(inserted);
    }

    const [inserted] = await this.store
      .insert(supportFaqs)
      .values(row)
      .returning();
    return this.mapFaq(inserted!);
  }

  async updateFaq(id: string, input: UpdateFaqInput): Promise<AdminSupportFaq> {
    const existing = await this.requireFaqRow(id);
    const now = this.now();
    const translationUse = normalizeTranslationUse(
      existing.locale as SupportContentLocale,
      input.translationUse ?? existing.translationUse,
    );
    const contentChanged =
      input.question !== undefined ||
      input.answer !== undefined ||
      input.translationUse !== undefined;
    const nextReviewState = contentChanged
      ? initialReviewState(existing.locale as SupportContentLocale, translationUse)
      : existing.reviewState;
    const patch: Partial<NewFaqRow> = {
      ...(input.category ? { category: input.category } : {}),
      ...(input.question !== undefined ? { question: input.question.trim() } : {}),
      ...(input.answer !== undefined ? { answer: input.answer.trim() } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(input.isPinned !== undefined ? { isPinned: input.isPinned } : {}),
      translationUse,
      reviewState: nextReviewState,
      reviewedByUserId: contentChanged && isPublishReadyReviewState(nextReviewState)
        ? input.actorUserId
        : contentChanged
          ? null
          : existing.reviewedByUserId,
      reviewedAt: contentChanged && isPublishReadyReviewState(nextReviewState)
        ? now
        : contentChanged
          ? null
          : existing.reviewedAt,
      publishedAt: contentChanged ? null : existing.publishedAt,
      updatedByUserId: input.actorUserId,
      updatedAt: now,
    };

    return this.mapFaq(await this.updateFaqRow(id, patch));
  }

  async reviewFaq(
    id: string,
    input: SupportContentActorInput,
  ): Promise<AdminSupportFaq> {
    const now = this.now();
    return this.mapFaq(
      await this.updateFaqRow(id, {
        reviewState: 'approved',
        reviewedByUserId: input.actorUserId,
        reviewedAt: now,
        updatedByUserId: input.actorUserId,
        updatedAt: now,
      }),
    );
  }

  async publishFaq(
    id: string,
    input: SupportContentActorInput,
  ): Promise<AdminSupportFaq> {
    const existing = await this.requireFaqRow(id);
    this.assertCanPublish(existing);
    const now = this.now();
    return this.mapFaq(
      await this.updateFaqRow(id, {
        reviewState: 'published',
        publishedAt: now,
        archivedAt: null,
        updatedByUserId: input.actorUserId,
        updatedAt: now,
      }),
    );
  }

  async archiveFaq(
    id: string,
    input: SupportContentActorInput,
  ): Promise<AdminSupportFaq> {
    const now = this.now();
    return this.mapFaq(
      await this.updateFaqRow(id, {
        reviewState: 'archived',
        archivedAt: now,
        updatedByUserId: input.actorUserId,
        updatedAt: now,
      }),
    );
  }

  async createNotice(input: CreateNoticeInput): Promise<AdminSupportNotice> {
    const now = this.now();
    const translationUse = normalizeTranslationUse(
      input.locale,
      input.translationUse,
    );
    const reviewState = initialReviewState(input.locale, translationUse);
    const row: NewNoticeRow = {
      category: input.category,
      locale: input.locale,
      title: input.title.trim(),
      body: input.body.trim(),
      status: 'draft',
      priority: input.priority ?? 'normal',
      reviewState,
      translationUse,
      scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
      reviewedByUserId: isPublishReadyReviewState(reviewState)
        ? input.actorUserId
        : null,
      reviewedAt: isPublishReadyReviewState(reviewState) ? now : null,
      createdByUserId: input.actorUserId,
      updatedByUserId: input.actorUserId,
      createdAt: now,
      updatedAt: now,
    };

    if (isMemoryStore(this.store)) {
      const inserted = {
        ...row,
        id: randomUUID(),
        category: input.category,
        locale: input.locale,
        status: 'draft',
        priority: input.priority ?? 'normal',
        reviewState,
        translationUse,
        startsAt: null,
        endsAt: null,
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
        reviewedByUserId: row.reviewedByUserId ?? null,
        reviewedAt: row.reviewedAt ?? null,
        publishedAt: null,
        archivedAt: null,
        createdByUserId: input.actorUserId,
        updatedByUserId: input.actorUserId,
        createdAt: now,
        updatedAt: now,
      } satisfies NoticeRow;
      this.store.notices.push(inserted);
      return this.mapNotice(inserted);
    }

    const [inserted] = await this.store
      .insert(supportNotices)
      .values(row)
      .returning();
    return this.mapNotice(inserted!);
  }

  async updateNotice(
    id: string,
    input: UpdateNoticeInput,
  ): Promise<AdminSupportNotice> {
    const existing = await this.requireNoticeRow(id);
    const now = this.now();
    const translationUse = normalizeTranslationUse(
      existing.locale as SupportContentLocale,
      input.translationUse ?? existing.translationUse,
    );
    const contentChanged =
      input.title !== undefined ||
      input.body !== undefined ||
      input.translationUse !== undefined;
    const nextReviewState = contentChanged
      ? initialReviewState(existing.locale as SupportContentLocale, translationUse)
      : existing.reviewState;
    const scheduledAt = input.scheduledAt === undefined
      ? existing.scheduledAt
      : input.scheduledAt
        ? new Date(input.scheduledAt)
        : null;
    const patch: Partial<NewNoticeRow> = {
      ...(input.category ? { category: input.category } : {}),
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.body !== undefined ? { body: input.body.trim() } : {}),
      ...(input.priority ? { priority: input.priority } : {}),
      scheduledAt,
      status: existing.status === 'published' || existing.status === 'archived'
        ? existing.status
        : 'draft',
      translationUse,
      reviewState: nextReviewState,
      reviewedByUserId: contentChanged && isPublishReadyReviewState(nextReviewState)
        ? input.actorUserId
        : contentChanged
          ? null
          : existing.reviewedByUserId,
      reviewedAt: contentChanged && isPublishReadyReviewState(nextReviewState)
        ? now
        : contentChanged
          ? null
          : existing.reviewedAt,
      publishedAt: contentChanged ? null : existing.publishedAt,
      updatedByUserId: input.actorUserId,
      updatedAt: now,
    };

    return this.mapNotice(await this.updateNoticeRow(id, patch));
  }

  async reviewNotice(
    id: string,
    input: SupportContentActorInput,
  ): Promise<AdminSupportNotice> {
    const now = this.now();
    return this.mapNotice(
      await this.updateNoticeRow(id, {
        reviewState: 'approved',
        reviewedByUserId: input.actorUserId,
        reviewedAt: now,
        updatedByUserId: input.actorUserId,
        updatedAt: now,
      }),
    );
  }

  async publishNotice(
    id: string,
    input: SupportContentActorInput,
  ): Promise<AdminSupportNotice> {
    const existing = await this.requireNoticeRow(id);
    this.assertCanPublish(existing);
    const now = this.now();
    return this.mapNotice(
      await this.updateNoticeRow(id, {
        status: 'published',
        reviewState: 'published',
        publishedAt: now,
        archivedAt: null,
        updatedByUserId: input.actorUserId,
        updatedAt: now,
      }),
    );
  }

  async archiveNotice(
    id: string,
    input: SupportContentActorInput,
  ): Promise<AdminSupportNotice> {
    const now = this.now();
    return this.mapNotice(
      await this.updateNoticeRow(id, {
        status: 'archived',
        reviewState: 'archived',
        archivedAt: now,
        updatedByUserId: input.actorUserId,
        updatedAt: now,
      }),
    );
  }

  private async listFaqRows(
    filters: SupportContentListFilters,
  ): Promise<FaqRow[]> {
    if (isMemoryStore(this.store)) {
      return this.store.faqs
        .filter((row) => matchesListFilters(row, filters))
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    }

    const predicates: SQL[] = [];
    if (filters.locale) predicates.push(eq(supportFaqs.locale, filters.locale));
    if (filters.reviewState) {
      predicates.push(eq(supportFaqs.reviewState, filters.reviewState));
    }
    if (!filters.includeArchived) {
      predicates.push(ne(supportFaqs.reviewState, 'archived'));
    }

    return this.store
      .select()
      .from(supportFaqs)
      .where(predicates.length > 0 ? and(...predicates) : undefined)
      .orderBy(desc(supportFaqs.updatedAt));
  }

  private async listNoticeRows(
    filters: SupportContentListFilters,
  ): Promise<NoticeRow[]> {
    if (isMemoryStore(this.store)) {
      return this.store.notices
        .filter((row) => matchesListFilters(row, filters))
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    }

    const predicates: SQL[] = [];
    if (filters.locale) {
      predicates.push(eq(supportNotices.locale, filters.locale));
    }
    if (filters.reviewState) {
      predicates.push(eq(supportNotices.reviewState, filters.reviewState));
    }
    if (!filters.includeArchived) {
      predicates.push(ne(supportNotices.status, 'archived'));
    }

    return this.store
      .select()
      .from(supportNotices)
      .where(predicates.length > 0 ? and(...predicates) : undefined)
      .orderBy(desc(supportNotices.updatedAt));
  }

  private async requireFaqRow(id: string): Promise<FaqRow> {
    if (isMemoryStore(this.store)) {
      const row = this.store.faqs.find((faq) => faq.id === id);
      if (!row) throw new NotFoundException('FAQ를 찾을 수 없습니다');
      return row;
    }

    const [row] = await this.store
      .select()
      .from(supportFaqs)
      .where(eq(supportFaqs.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('FAQ를 찾을 수 없습니다');
    return row;
  }

  private async requireNoticeRow(id: string): Promise<NoticeRow> {
    if (isMemoryStore(this.store)) {
      const row = this.store.notices.find((notice) => notice.id === id);
      if (!row) throw new NotFoundException('공지를 찾을 수 없습니다');
      return row;
    }

    const [row] = await this.store
      .select()
      .from(supportNotices)
      .where(eq(supportNotices.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('공지를 찾을 수 없습니다');
    return row;
  }

  private async updateFaqRow(
    id: string,
    patch: Partial<NewFaqRow>,
  ): Promise<FaqRow> {
    if (isMemoryStore(this.store)) {
      const row = await this.requireFaqRow(id);
      Object.assign(row, patch);
      return row;
    }

    const [updated] = await this.store
      .update(supportFaqs)
      .set(patch)
      .where(eq(supportFaqs.id, id))
      .returning();
    if (!updated) throw new NotFoundException('FAQ를 찾을 수 없습니다');
    return updated;
  }

  private async updateNoticeRow(
    id: string,
    patch: Partial<NewNoticeRow>,
  ): Promise<NoticeRow> {
    if (isMemoryStore(this.store)) {
      const row = await this.requireNoticeRow(id);
      Object.assign(row, patch);
      return row;
    }

    const [updated] = await this.store
      .update(supportNotices)
      .set(patch)
      .where(eq(supportNotices.id, id))
      .returning();
    if (!updated) throw new NotFoundException('공지를 찾을 수 없습니다');
    return updated;
  }

  private assertCanPublish(row: FaqRow | NoticeRow) {
    if (!canPublish(row)) {
      throw new BadRequestException(
        '검수 완료된 FAQ/공지 콘텐츠만 게시할 수 있습니다',
      );
    }
  }

  private mapFaq(row: FaqRow): AdminSupportFaq {
    return {
      id: row.id,
      category: row.category as SupportFaqCategory,
      locale: row.locale as SupportContentLocale,
      question: row.question,
      answer: row.answer,
      sortOrder: row.sortOrder,
      isPinned: row.isPinned,
      reviewState: row.reviewState as SupportContentReviewState,
      translationUse: row.translationUse as SupportContentTranslationUse,
      translationUseLabel: translationUseLabel(row),
      canPublish: canPublish(row),
      reviewedByUserId: row.reviewedByUserId,
      reviewedAt: toIso(row.reviewedAt),
      publishedAt: toIso(row.publishedAt),
      archivedAt: toIso(row.archivedAt),
      createdByUserId: row.createdByUserId,
      updatedByUserId: row.updatedByUserId,
      createdAt: toIso(row.createdAt)!,
      updatedAt: toIso(row.updatedAt)!,
    };
  }

  private mapNotice(row: NoticeRow): AdminSupportNotice {
    return {
      id: row.id,
      category: row.category as SupportNoticeCategory,
      locale: row.locale as SupportContentLocale,
      title: row.title,
      body: row.body,
      status: row.status as SupportNoticeStatus,
      priority: row.priority as SupportNoticePriority,
      reviewState: row.reviewState as SupportContentReviewState,
      translationUse: row.translationUse as SupportContentTranslationUse,
      translationUseLabel: translationUseLabel(row),
      canPublish: canPublish(row),
      scheduledAt: toIso(row.scheduledAt),
      reviewedByUserId: row.reviewedByUserId,
      reviewedAt: toIso(row.reviewedAt),
      publishedAt: toIso(row.publishedAt),
      archivedAt: toIso(row.archivedAt),
      createdByUserId: row.createdByUserId,
      updatedByUserId: row.updatedByUserId,
      createdAt: toIso(row.createdAt)!,
      updatedAt: toIso(row.updatedAt)!,
    };
  }

  private now(): Date {
    return new Date();
  }
}

function isMemoryStore(store: SupportContentStore): store is SupportContentMemoryStore {
  return Array.isArray((store as SupportContentMemoryStore).faqs);
}

function normalizeTranslationUse(
  locale: SupportContentLocale,
  translationUse: SupportContentTranslationUse = 'manual',
): SupportContentTranslationUse {
  if (isManualSourceLocale(locale)) return 'manual';
  return translationUse === 'assisted' ? 'assisted' : 'manual';
}

function initialReviewState(
  locale: SupportContentLocale,
  translationUse: SupportContentTranslationUse,
): SupportContentReviewState {
  if (isManualSourceLocale(locale) || translationUse === 'manual') {
    return 'approved';
  }
  return 'review';
}

function isManualSourceLocale(locale: SupportContentLocale): boolean {
  return locale === 'ko' || locale === 'en';
}

function canPublish(row: Pick<FaqRow | NoticeRow, 'locale' | 'reviewState' | 'translationUse'>): boolean {
  if (row.reviewState === 'archived') return false;
  if (row.reviewState === 'published') return true;
  if (isAssistedNonSource(row)) return row.reviewState === 'approved';
  return row.reviewState === 'approved';
}

function isPublishReadyReviewState(reviewState: SupportContentReviewState) {
  return reviewState === 'approved' || reviewState === 'published';
}

function isAssistedNonSource(
  row: Pick<FaqRow | NoticeRow, 'locale' | 'translationUse'>,
): boolean {
  return !isManualSourceLocale(row.locale as SupportContentLocale)
    && row.translationUse === 'assisted';
}

function translationUseLabel(
  row: Pick<FaqRow | NoticeRow, 'locale' | 'translationUse'>,
): '자동 번역 검수본' | null {
  return isAssistedNonSource(row) ? '자동 번역 검수본' : null;
}

function matchesListFilters(
  row: FaqRow | NoticeRow,
  filters: SupportContentListFilters,
): boolean {
  if (filters.locale && row.locale !== filters.locale) return false;
  if (filters.reviewState && row.reviewState !== filters.reviewState) return false;
  if (!filters.includeArchived && row.reviewState === 'archived') return false;
  return true;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return value.toISOString();
}
