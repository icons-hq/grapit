import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  and,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  type SQL,
} from 'drizzle-orm';

import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import {
  supportFaqs,
  supportNotices,
  supportNoticeCategoryEnum,
  supportThreadCategoryEnum,
  supportThreadPriorityEnum,
} from '../../database/schema/index.js';
import { CacheService } from '../performance/cache.service.js';
import {
  AdminAuditService,
  type AdminAuditAction,
} from './admin-audit.service.js';

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

/**
 * Public support content is cached per locale. Every admin mutation clears all
 * locale keys after commit, so the TTL only bounds scheduled/ending notices and
 * the rare read-before-commit race.
 */
export const PUBLIC_SUPPORT_CONTENT_CACHE_TTL_SECONDS = 30;

export function publicSupportContentCacheKey(
  locale: SupportContentLocale,
): string {
  return `support-content:public:v1:${locale}`;
}

/**
 * Notices in these categories are shown in a fallback language when the
 * viewer's locale has no published version in the same translation group.
 */
export const LOCALE_FALLBACK_NOTICE_CATEGORIES = [
  'urgent',
  'maintenance',
  'payment',
] as const satisfies readonly SupportNoticeCategory[];

const NOTICE_LOCALE_FALLBACK_CHAIN: Record<
  SupportContentLocale,
  readonly SupportContentLocale[]
> = {
  ko: [],
  en: ['ko'],
  th: ['en', 'ko'],
  'zh-CN': ['en', 'ko'],
};

type FaqRow = typeof supportFaqs.$inferSelect;
type NoticeRow = typeof supportNotices.$inferSelect;
type NewFaqRow = typeof supportFaqs.$inferInsert;
type NewNoticeRow = typeof supportNotices.$inferInsert;
type SupportContentStore = DrizzleDB | SupportContentMemoryStore;
type AuditSnapshot = Record<string, unknown>;

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
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
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
  expectedUpdatedAt?: string;
}

export interface CreateNoticeInput extends SupportContentActorInput {
  category: SupportNoticeCategory;
  locale: SupportContentLocale;
  title: string;
  body: string;
  priority?: SupportNoticePriority;
  scheduledAt?: string | null;
  endsAt?: string | null;
  translationUse?: SupportContentTranslationUse;
  translationOfNoticeId?: string;
}

export interface UpdateNoticeInput extends SupportContentActorInput {
  category?: SupportNoticeCategory;
  title?: string;
  body?: string;
  priority?: SupportNoticePriority;
  scheduledAt?: string | null;
  endsAt?: string | null;
  translationUse?: SupportContentTranslationUse;
  expectedUpdatedAt?: string;
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
  startsAt: string | null;
  endsAt: string | null;
  translationGroupId: string | null;
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

export interface PublicSupportFaq {
  id: string;
  category: SupportFaqCategory;
  locale: SupportContentLocale;
  question: string;
  answer: string;
  sortOrder: number;
  isPinned: boolean;
  updatedAt: string;
}

export interface PublicSupportNotice {
  id: string;
  category: SupportNoticeCategory;
  locale: SupportContentLocale;
  title: string;
  body: string;
  priority: SupportNoticePriority;
  /** When the notice became visible: the later of publish and schedule time. */
  publishedAt: string | null;
}

export interface PublicSupportContentList {
  faqs: PublicSupportFaq[];
  notices: PublicSupportNotice[];
}

export interface PublishedSupportContentFilters {
  locale: SupportContentLocale;
}

interface ReviewTransition {
  reviewState: SupportContentReviewState;
  reviewedByUserId: string | null;
  reviewedAt: Date | null;
  publishedAt: Date | null;
}

@Injectable()
export class AdminSupportContentService {
  private readonly publicLoads = new Map<
    SupportContentLocale,
    Promise<PublicSupportContentList>
  >();

  constructor(
    @Inject(DRIZZLE) private readonly store: SupportContentStore,
    @Inject(AdminAuditService) private readonly auditService: AdminAuditService,
    @Inject(CacheService) private readonly cache: CacheService,
  ) {}

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

  async listPublished(
    filters: PublishedSupportContentFilters,
  ): Promise<PublicSupportContentList> {
    const locale = filters.locale;
    const cached = await this.cache.get<PublicSupportContentList>(
      publicSupportContentCacheKey(locale),
    );
    if (cached) return cached;

    // Collapse concurrent misses on this instance into one DB read per locale.
    const pending = this.publicLoads.get(locale);
    if (pending) return pending;

    const load = this.loadPublished(locale).finally(() => {
      this.publicLoads.delete(locale);
    });
    this.publicLoads.set(locale, load);
    return load;
  }

  async getFaq(id: string): Promise<AdminSupportFaq> {
    return this.mapFaq(await this.findFaqRow(this.store, id));
  }

  async getNotice(id: string): Promise<AdminSupportNotice> {
    return this.mapNotice(await this.findNoticeRow(this.store, id));
  }

  async createFaq(input: CreateFaqInput): Promise<AdminSupportFaq> {
    const now = this.now();
    const translationUse = normalizeTranslationUse(
      input.locale,
      input.translationUse,
    );
    const reviewState = initialReviewState(input.locale, translationUse);
    const row: FaqRow = {
      id: randomUUID(),
      category: input.category,
      locale: input.locale,
      question: requireText(input.question, '질문'),
      answer: requireText(input.answer, '답변'),
      sortOrder: input.sortOrder ?? 0,
      isPinned: input.isPinned ?? false,
      reviewState,
      translationUse,
      reviewedByUserId: isPublishReadyReviewState(reviewState)
        ? input.actorUserId
        : null,
      reviewedAt: isPublishReadyReviewState(reviewState) ? now : null,
      publishedAt: null,
      archivedAt: null,
      createdByUserId: input.actorUserId,
      updatedByUserId: input.actorUserId,
      createdAt: now,
      updatedAt: now,
    };

    const inserted = await this.inTransaction(async (db) => {
      const created = await this.insertFaqRow(db, row);
      await this.writeAudit(db, input, {
        action: 'support.content.create',
        resourceType: 'support_faq',
        resourceId: created.id,
        before: {},
        after: faqAuditSnapshot(created),
      });
      return created;
    });

    await this.invalidatePublicCache();
    return this.mapFaq(inserted);
  }

  async updateFaq(id: string, input: UpdateFaqInput): Promise<AdminSupportFaq> {
    const updated = await this.inTransaction(async (db) => {
      const existing = await this.lockFaqRow(db, id);
      assertExpectedUpdatedAt(existing.updatedAt, input.expectedUpdatedAt);

      const now = this.now();
      const locale = existing.locale as SupportContentLocale;
      const translationUse = normalizeTranslationUse(
        locale,
        input.translationUse ?? existing.translationUse,
      );
      const question = input.question === undefined
        ? existing.question
        : requireText(input.question, '질문');
      const answer = input.answer === undefined
        ? existing.answer
        : requireText(input.answer, '답변');
      const contentChanged =
        question !== existing.question ||
        answer !== existing.answer ||
        translationUse !==
          normalizeTranslationUse(locale, existing.translationUse);
      const transition = resolveEditTransition(existing, {
        locale,
        translationUse,
        contentChanged,
        actorUserId: input.actorUserId,
        now,
      });

      const next = await this.updateFaqRow(db, id, {
        ...(input.category ? { category: input.category } : {}),
        question,
        answer,
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.isPinned !== undefined ? { isPinned: input.isPinned } : {}),
        translationUse,
        ...transition,
        updatedByUserId: input.actorUserId,
        updatedAt: now,
      });
      await this.writeAudit(db, input, {
        action: 'support.content.update',
        resourceType: 'support_faq',
        resourceId: id,
        before: faqAuditSnapshot(existing),
        after: faqAuditSnapshot(next),
      });
      return next;
    });

    await this.invalidatePublicCache();
    return this.mapFaq(updated);
  }

  async reviewFaq(
    id: string,
    input: SupportContentActorInput,
  ): Promise<AdminSupportFaq> {
    const updated = await this.inTransaction(async (db) => {
      const existing = await this.lockFaqRow(db, id);
      assertReviewable(existing.reviewState as SupportContentReviewState);
      const now = this.now();
      const next = await this.updateFaqRow(db, id, {
        reviewState: 'approved',
        reviewedByUserId: input.actorUserId,
        reviewedAt: now,
        updatedByUserId: input.actorUserId,
        updatedAt: now,
      });
      await this.writeAudit(db, input, {
        action: 'support.content.review',
        resourceType: 'support_faq',
        resourceId: id,
        before: faqAuditSnapshot(existing),
        after: faqAuditSnapshot(next),
      });
      return next;
    });

    await this.invalidatePublicCache();
    return this.mapFaq(updated);
  }

  async publishFaq(
    id: string,
    input: SupportContentActorInput,
  ): Promise<AdminSupportFaq> {
    const updated = await this.inTransaction(async (db) => {
      const existing = await this.lockFaqRow(db, id);
      this.assertCanPublish(existing);
      const now = this.now();
      const next = await this.updateFaqRow(db, id, {
        reviewState: 'published',
        publishedAt: now,
        archivedAt: null,
        updatedByUserId: input.actorUserId,
        updatedAt: now,
      });
      await this.writeAudit(db, input, {
        action: 'support.content.publish',
        resourceType: 'support_faq',
        resourceId: id,
        before: faqAuditSnapshot(existing),
        after: faqAuditSnapshot(next),
      });
      return next;
    });

    await this.invalidatePublicCache();
    return this.mapFaq(updated);
  }

  async archiveFaq(
    id: string,
    input: SupportContentActorInput,
  ): Promise<AdminSupportFaq> {
    const updated = await this.inTransaction(async (db) => {
      const existing = await this.lockFaqRow(db, id);
      const now = this.now();
      const next = await this.updateFaqRow(db, id, {
        reviewState: 'archived',
        archivedAt: now,
        updatedByUserId: input.actorUserId,
        updatedAt: now,
      });
      await this.writeAudit(db, input, {
        action: 'support.content.archive',
        resourceType: 'support_faq',
        resourceId: id,
        before: faqAuditSnapshot(existing),
        after: faqAuditSnapshot(next),
      });
      return next;
    });

    await this.invalidatePublicCache();
    return this.mapFaq(updated);
  }

  async createNotice(input: CreateNoticeInput): Promise<AdminSupportNotice> {
    const now = this.now();
    const translationUse = normalizeTranslationUse(
      input.locale,
      input.translationUse,
    );
    const reviewState = initialReviewState(input.locale, translationUse);
    const scheduledAt = parseOptionalDate(input.scheduledAt);
    const endsAt = parseOptionalDate(input.endsAt);
    assertNoticeWindow({ scheduledAt, startsAt: null, endsAt });

    const inserted = await this.inTransaction(async (db) => {
      const id = randomUUID();
      const translationGroupId = input.translationOfNoticeId
        ? await this.joinTranslationGroup(
            db,
            input.translationOfNoticeId,
            input.locale,
          )
        : id;
      const row: NoticeRow = {
        id,
        category: input.category,
        locale: input.locale,
        title: requireText(input.title, '제목'),
        body: requireText(input.body, '내용'),
        status: 'draft',
        priority: input.priority ?? defaultNoticePriority(input.category),
        reviewState,
        translationUse,
        startsAt: null,
        endsAt,
        scheduledAt,
        translationGroupId,
        reviewedByUserId: isPublishReadyReviewState(reviewState)
          ? input.actorUserId
          : null,
        reviewedAt: isPublishReadyReviewState(reviewState) ? now : null,
        publishedAt: null,
        archivedAt: null,
        createdByUserId: input.actorUserId,
        updatedByUserId: input.actorUserId,
        createdAt: now,
        updatedAt: now,
      };
      const created = await this.insertNoticeRow(db, row);
      await this.writeAudit(db, input, {
        action: 'support.content.create',
        resourceType: 'support_notice',
        resourceId: created.id,
        before: {},
        after: noticeAuditSnapshot(created),
      });
      return created;
    });

    await this.invalidatePublicCache();
    return this.mapNotice(inserted);
  }

  async updateNotice(
    id: string,
    input: UpdateNoticeInput,
  ): Promise<AdminSupportNotice> {
    const updated = await this.inTransaction(async (db) => {
      const existing = await this.lockNoticeRow(db, id);
      assertExpectedUpdatedAt(existing.updatedAt, input.expectedUpdatedAt);

      const now = this.now();
      const locale = existing.locale as SupportContentLocale;
      const translationUse = normalizeTranslationUse(
        locale,
        input.translationUse ?? existing.translationUse,
      );
      const title = input.title === undefined
        ? existing.title
        : requireText(input.title, '제목');
      const body = input.body === undefined
        ? existing.body
        : requireText(input.body, '내용');
      const contentChanged =
        title !== existing.title ||
        body !== existing.body ||
        translationUse !==
          normalizeTranslationUse(locale, existing.translationUse);
      const scheduledAt = input.scheduledAt === undefined
        ? existing.scheduledAt
        : parseOptionalDate(input.scheduledAt);
      const endsAt = input.endsAt === undefined
        ? existing.endsAt
        : parseOptionalDate(input.endsAt);
      assertNoticeWindow({ scheduledAt, startsAt: existing.startsAt, endsAt });

      const category = input.category ?? (existing.category as SupportNoticeCategory);
      const priority = input.priority
        ?? (input.category === 'urgent' && existing.category !== 'urgent'
          ? 'urgent'
          : (existing.priority as SupportNoticePriority));
      const transition = resolveEditTransition(existing, {
        locale,
        translationUse,
        contentChanged,
        actorUserId: input.actorUserId,
        now,
      });

      const next = await this.updateNoticeRow(db, id, {
        category,
        title,
        body,
        priority,
        scheduledAt,
        endsAt,
        status: noticeStatusFor(transition.reviewState),
        translationUse,
        ...transition,
        updatedByUserId: input.actorUserId,
        updatedAt: now,
      });
      await this.writeAudit(db, input, {
        action: 'support.content.update',
        resourceType: 'support_notice',
        resourceId: id,
        before: noticeAuditSnapshot(existing),
        after: noticeAuditSnapshot(next),
      });
      return next;
    });

    await this.invalidatePublicCache();
    return this.mapNotice(updated);
  }

  async reviewNotice(
    id: string,
    input: SupportContentActorInput,
  ): Promise<AdminSupportNotice> {
    const updated = await this.inTransaction(async (db) => {
      const existing = await this.lockNoticeRow(db, id);
      assertReviewable(existing.reviewState as SupportContentReviewState);
      const now = this.now();
      const next = await this.updateNoticeRow(db, id, {
        status: noticeStatusFor('approved'),
        reviewState: 'approved',
        reviewedByUserId: input.actorUserId,
        reviewedAt: now,
        updatedByUserId: input.actorUserId,
        updatedAt: now,
      });
      await this.writeAudit(db, input, {
        action: 'support.content.review',
        resourceType: 'support_notice',
        resourceId: id,
        before: noticeAuditSnapshot(existing),
        after: noticeAuditSnapshot(next),
      });
      return next;
    });

    await this.invalidatePublicCache();
    return this.mapNotice(updated);
  }

  async publishNotice(
    id: string,
    input: SupportContentActorInput,
  ): Promise<AdminSupportNotice> {
    const updated = await this.inTransaction(async (db) => {
      const existing = await this.lockNoticeRow(db, id);
      this.assertCanPublish(existing);
      const now = this.now();
      if (existing.endsAt && existing.endsAt.getTime() <= now.getTime()) {
        throw new BadRequestException(
          '노출 종료 시각이 지난 공지는 게시할 수 없습니다. 종료 시각을 고친 뒤 게시해주세요',
        );
      }
      const next = await this.updateNoticeRow(db, id, {
        status: 'published',
        reviewState: 'published',
        publishedAt: now,
        archivedAt: null,
        updatedByUserId: input.actorUserId,
        updatedAt: now,
      });
      await this.writeAudit(db, input, {
        action: 'support.content.publish',
        resourceType: 'support_notice',
        resourceId: id,
        before: noticeAuditSnapshot(existing),
        after: noticeAuditSnapshot(next),
      });
      return next;
    });

    await this.invalidatePublicCache();
    return this.mapNotice(updated);
  }

  async archiveNotice(
    id: string,
    input: SupportContentActorInput,
  ): Promise<AdminSupportNotice> {
    const updated = await this.inTransaction(async (db) => {
      const existing = await this.lockNoticeRow(db, id);
      const now = this.now();
      const next = await this.updateNoticeRow(db, id, {
        status: 'archived',
        reviewState: 'archived',
        archivedAt: now,
        updatedByUserId: input.actorUserId,
        updatedAt: now,
      });
      await this.writeAudit(db, input, {
        action: 'support.content.archive',
        resourceType: 'support_notice',
        resourceId: id,
        before: noticeAuditSnapshot(existing),
        after: noticeAuditSnapshot(next),
      });
      return next;
    });

    await this.invalidatePublicCache();
    return this.mapNotice(updated);
  }

  private async loadPublished(
    locale: SupportContentLocale,
  ): Promise<PublicSupportContentList> {
    const now = this.now();
    // Sequential reads keep a cache miss to one pool connection at a time.
    const faqs = await this.listPublishedFaqRows(locale);
    const notices = await this.listPublishedNoticeRows(locale, now);
    const result: PublicSupportContentList = {
      faqs: faqs.map((row) => this.mapPublicFaq(row)),
      notices: notices.map((row) => this.mapPublicNotice(row)),
    };

    await this.cache.set(
      publicSupportContentCacheKey(locale),
      result,
      PUBLIC_SUPPORT_CONTENT_CACHE_TTL_SECONDS,
    );
    return result;
  }

  private async invalidatePublicCache(): Promise<void> {
    // Fallback notices cross locales, so every locale key is affected.
    await this.cache.invalidate(
      ...SUPPORT_CONTENT_LOCALES.map(publicSupportContentCacheKey),
    );
  }

  private async inTransaction<T>(
    fn: (db: SupportContentStore) => Promise<T>,
  ): Promise<T> {
    if (isMemoryStore(this.store)) return fn(this.store);
    return this.store.transaction(async (tx) => fn(tx as unknown as DrizzleDB));
  }

  private async writeAudit(
    db: SupportContentStore,
    actor: SupportContentActorInput,
    entry: {
      action: AdminAuditAction;
      resourceType: 'support_faq' | 'support_notice';
      resourceId: string;
      before: AuditSnapshot;
      after: AuditSnapshot;
    },
  ): Promise<void> {
    await this.auditService.write(
      {
        actorUserId: actor.actorUserId,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        status: 'success',
        before: entry.before,
        after: entry.after,
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent ?? null,
        requestId: actor.requestId ?? null,
      },
      isMemoryStore(db) ? undefined : db,
    );
  }

  /**
   * Resolves the translation group for a new locale version of an existing
   * notice. Legacy source rows without a group adopt their own id as the group.
   */
  private async joinTranslationGroup(
    db: SupportContentStore,
    sourceNoticeId: string,
    locale: SupportContentLocale,
  ): Promise<string> {
    const source = await this.lockNoticeRow(db, sourceNoticeId);
    const groupId = source.translationGroupId ?? source.id;
    if (groupId !== source.id) {
      // The group id is the first source notice's id. Locking it serializes
      // concurrent translations of any member so the duplicate check holds.
      await this.lockNoticeRow(db, groupId).catch((error: unknown) => {
        if (!(error instanceof NotFoundException)) throw error;
      });
    }

    const members = isMemoryStore(db)
      ? db.notices.filter(
          (row) => (row.translationGroupId ?? row.id) === groupId,
        )
      : await db
          .select()
          .from(supportNotices)
          .where(
            or(
              eq(supportNotices.translationGroupId, groupId),
              eq(supportNotices.id, groupId),
            ),
          );
    const duplicate = members.find(
      (row) => row.locale === locale && row.reviewState !== 'archived',
    );
    if (duplicate) {
      throw new BadRequestException('이미 같은 언어의 번역본이 있습니다');
    }

    if (!source.translationGroupId) {
      await this.updateNoticeRow(db, source.id, { translationGroupId: groupId });
    }
    return groupId;
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

  private async listPublishedFaqRows(
    locale: SupportContentLocale,
  ): Promise<FaqRow[]> {
    const rows = isMemoryStore(this.store)
      ? this.store.faqs
      : await this.store
          .select()
          .from(supportFaqs)
          .where(
            and(
              eq(supportFaqs.locale, locale),
              eq(supportFaqs.reviewState, 'published'),
            ),
          );

    return rows
      .filter(
        (row) => row.locale === locale && row.reviewState === 'published',
      )
      .sort(comparePublicFaqRows);
  }

  private async listPublishedNoticeRows(
    locale: SupportContentLocale,
    now: Date,
  ): Promise<NoticeRow[]> {
    const fallbackLocales = NOTICE_LOCALE_FALLBACK_CHAIN[locale];
    const localeScope = fallbackLocales.length > 0
      ? or(
          eq(supportNotices.locale, locale),
          and(
            inArray(supportNotices.locale, [...fallbackLocales]),
            inArray(supportNotices.category, [
              ...LOCALE_FALLBACK_NOTICE_CATEGORIES,
            ]),
            isNotNull(supportNotices.translationGroupId),
          ),
        )!
      : eq(supportNotices.locale, locale);

    const rows = isMemoryStore(this.store)
      ? this.store.notices
      : await this.store
          .select()
          .from(supportNotices)
          .where(
            and(
              localeScope,
              eq(supportNotices.status, 'published'),
              eq(supportNotices.reviewState, 'published'),
              or(
                isNull(supportNotices.scheduledAt),
                lte(supportNotices.scheduledAt, now),
              ),
              or(
                isNull(supportNotices.startsAt),
                lte(supportNotices.startsAt, now),
              ),
              or(isNull(supportNotices.endsAt), gt(supportNotices.endsAt, now)),
            ),
          );

    const visible = rows.filter((row) => isPublicNoticeVisible(row, now));
    return selectNoticesForLocale(visible, locale).sort(comparePublicNoticeRows);
  }

  private async findFaqRow(db: SupportContentStore, id: string): Promise<FaqRow> {
    if (isMemoryStore(db)) {
      const row = db.faqs.find((faq) => faq.id === id);
      if (!row) throw new NotFoundException('FAQ를 찾을 수 없습니다');
      return { ...row };
    }

    const [row] = await db
      .select()
      .from(supportFaqs)
      .where(eq(supportFaqs.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('FAQ를 찾을 수 없습니다');
    return row;
  }

  private async lockFaqRow(db: SupportContentStore, id: string): Promise<FaqRow> {
    if (isMemoryStore(db)) return this.findFaqRow(db, id);

    const [row] = await db
      .select()
      .from(supportFaqs)
      .where(eq(supportFaqs.id, id))
      .for('update');
    if (!row) throw new NotFoundException('FAQ를 찾을 수 없습니다');
    return row;
  }

  private async findNoticeRow(
    db: SupportContentStore,
    id: string,
  ): Promise<NoticeRow> {
    if (isMemoryStore(db)) {
      const row = db.notices.find((notice) => notice.id === id);
      if (!row) throw new NotFoundException('공지를 찾을 수 없습니다');
      return { ...row };
    }

    const [row] = await db
      .select()
      .from(supportNotices)
      .where(eq(supportNotices.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('공지를 찾을 수 없습니다');
    return row;
  }

  private async lockNoticeRow(
    db: SupportContentStore,
    id: string,
  ): Promise<NoticeRow> {
    if (isMemoryStore(db)) return this.findNoticeRow(db, id);

    const [row] = await db
      .select()
      .from(supportNotices)
      .where(eq(supportNotices.id, id))
      .for('update');
    if (!row) throw new NotFoundException('공지를 찾을 수 없습니다');
    return row;
  }

  private async insertFaqRow(
    db: SupportContentStore,
    row: FaqRow,
  ): Promise<FaqRow> {
    if (isMemoryStore(db)) {
      db.faqs.push(row);
      return { ...row };
    }

    const [inserted] = await db
      .insert(supportFaqs)
      .values(row satisfies NewFaqRow)
      .returning();
    return inserted!;
  }

  private async insertNoticeRow(
    db: SupportContentStore,
    row: NoticeRow,
  ): Promise<NoticeRow> {
    if (isMemoryStore(db)) {
      db.notices.push(row);
      return { ...row };
    }

    const [inserted] = await db
      .insert(supportNotices)
      .values(row satisfies NewNoticeRow)
      .returning();
    return inserted!;
  }

  private async updateFaqRow(
    db: SupportContentStore,
    id: string,
    patch: Partial<NewFaqRow>,
  ): Promise<FaqRow> {
    if (isMemoryStore(db)) {
      const row = db.faqs.find((faq) => faq.id === id);
      if (!row) throw new NotFoundException('FAQ를 찾을 수 없습니다');
      Object.assign(row, patch);
      return { ...row };
    }

    const [updated] = await db
      .update(supportFaqs)
      .set(patch)
      .where(eq(supportFaqs.id, id))
      .returning();
    if (!updated) throw new NotFoundException('FAQ를 찾을 수 없습니다');
    return updated;
  }

  private async updateNoticeRow(
    db: SupportContentStore,
    id: string,
    patch: Partial<NewNoticeRow>,
  ): Promise<NoticeRow> {
    if (isMemoryStore(db)) {
      const row = db.notices.find((notice) => notice.id === id);
      if (!row) throw new NotFoundException('공지를 찾을 수 없습니다');
      Object.assign(row, patch);
      return { ...row };
    }

    const [updated] = await db
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
      startsAt: toIso(row.startsAt),
      endsAt: toIso(row.endsAt),
      translationGroupId: row.translationGroupId ?? null,
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

  private mapPublicFaq(row: FaqRow): PublicSupportFaq {
    return {
      id: row.id,
      category: row.category as SupportFaqCategory,
      locale: row.locale as SupportContentLocale,
      question: row.question,
      answer: row.answer,
      sortOrder: row.sortOrder,
      isPinned: row.isPinned,
      updatedAt: toIso(row.updatedAt)!,
    };
  }

  private mapPublicNotice(row: NoticeRow): PublicSupportNotice {
    const visibleFrom = noticeVisibleFrom(row);
    return {
      id: row.id,
      category: row.category as SupportNoticeCategory,
      locale: row.locale as SupportContentLocale,
      title: row.title,
      body: row.body,
      priority: row.priority as SupportNoticePriority,
      publishedAt: visibleFrom ? new Date(visibleFrom).toISOString() : null,
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

/**
 * Review/publish state after an operator edit. Operator-authored (ko/en or
 * manual) edits keep published content live; only an assisted translation edit
 * needs another review and therefore leaves the public page.
 */
function resolveEditTransition(
  existing: Pick<
    FaqRow | NoticeRow,
    'reviewState' | 'reviewedByUserId' | 'reviewedAt' | 'publishedAt'
  >,
  edit: {
    locale: SupportContentLocale;
    translationUse: SupportContentTranslationUse;
    contentChanged: boolean;
    actorUserId: string;
    now: Date;
  },
): ReviewTransition {
  if (!edit.contentChanged) {
    return {
      reviewState: existing.reviewState as SupportContentReviewState,
      reviewedByUserId: existing.reviewedByUserId,
      reviewedAt: existing.reviewedAt,
      publishedAt: existing.publishedAt,
    };
  }

  const editState = initialReviewState(edit.locale, edit.translationUse);
  const approved = isPublishReadyReviewState(editState);
  if (existing.reviewState === 'published' && approved) {
    return {
      reviewState: 'published',
      reviewedByUserId: edit.actorUserId,
      reviewedAt: edit.now,
      publishedAt: existing.publishedAt ?? edit.now,
    };
  }

  return {
    reviewState: editState,
    reviewedByUserId: approved ? edit.actorUserId : null,
    reviewedAt: approved ? edit.now : null,
    publishedAt: null,
  };
}

function noticeStatusFor(
  reviewState: SupportContentReviewState,
): SupportNoticeStatus {
  if (reviewState === 'published') return 'published';
  if (reviewState === 'archived') return 'archived';
  return 'draft';
}

function assertReviewable(reviewState: SupportContentReviewState) {
  if (reviewState === 'published' || reviewState === 'archived') {
    throw new BadRequestException(
      '게시 중이거나 보관된 콘텐츠는 검수 완료로 바꿀 수 없습니다',
    );
  }
}

function assertExpectedUpdatedAt(
  updatedAt: Date,
  expectedUpdatedAt: string | undefined,
) {
  if (!expectedUpdatedAt) return;
  const expected = new Date(expectedUpdatedAt);
  if (
    Number.isNaN(expected.getTime()) ||
    expected.getTime() !== updatedAt.getTime()
  ) {
    throw new ConflictException(
      '다른 운영자가 먼저 수정했습니다. 최신 내용을 확인한 뒤 다시 저장해주세요',
    );
  }
}

function assertNoticeWindow(window: {
  scheduledAt: Date | null;
  startsAt: Date | null;
  endsAt: Date | null;
}) {
  if (!window.endsAt) return;
  const visibleFrom = Math.max(
    window.scheduledAt?.getTime() ?? 0,
    window.startsAt?.getTime() ?? 0,
  );
  if (window.endsAt.getTime() <= visibleFrom) {
    throw new BadRequestException(
      '노출 종료 시각은 노출 시작 시각보다 뒤여야 합니다',
    );
  }
}

function defaultNoticePriority(
  category: SupportNoticeCategory,
): SupportNoticePriority {
  return category === 'urgent' ? 'urgent' : 'normal';
}

function requireText(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new BadRequestException(`${label}을(를) 입력해주세요`);
  return trimmed;
}

function parseOptionalDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException('날짜 형식이 올바르지 않습니다');
  }
  return date;
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

function isPublicNoticeVisible(row: NoticeRow, now: Date): boolean {
  const at = now.getTime();
  return row.status === 'published'
    && row.reviewState === 'published'
    && (!row.scheduledAt || row.scheduledAt.getTime() <= at)
    && (!row.startsAt || row.startsAt.getTime() <= at)
    && (!row.endsAt || row.endsAt.getTime() > at);
}

function isLocaleFallbackEligible(row: NoticeRow): boolean {
  return row.translationGroupId !== null
    && row.translationGroupId !== undefined
    && (LOCALE_FALLBACK_NOTICE_CATEGORIES as readonly string[]).includes(
      row.category,
    );
}

function noticeGroupKey(row: NoticeRow): string {
  return row.translationGroupId ?? row.id;
}

/**
 * Picks the viewer's locale rows, then fills translation groups that have no
 * visible version in that locale from the fallback chain (en, then ko) for the
 * categories buyers must not miss.
 */
function selectNoticesForLocale(
  rows: NoticeRow[],
  locale: SupportContentLocale,
): NoticeRow[] {
  const selected = rows.filter((row) => row.locale === locale);
  const coveredGroups = new Set(selected.map(noticeGroupKey));

  for (const fallbackLocale of NOTICE_LOCALE_FALLBACK_CHAIN[locale]) {
    const fallbackRows = rows.filter(
      (row) =>
        row.locale === fallbackLocale &&
        isLocaleFallbackEligible(row) &&
        !coveredGroups.has(noticeGroupKey(row)),
    );
    selected.push(...fallbackRows);
    for (const row of fallbackRows) coveredGroups.add(noticeGroupKey(row));
  }

  return selected;
}

function noticeVisibleFrom(row: NoticeRow): number {
  return Math.max(
    dateTimeOrZero(row.publishedAt),
    dateTimeOrZero(row.scheduledAt),
    dateTimeOrZero(row.startsAt),
  );
}

function faqAuditSnapshot(row: FaqRow): AuditSnapshot {
  return {
    category: row.category,
    locale: row.locale,
    question: row.question,
    answer: row.answer,
    sortOrder: row.sortOrder,
    isPinned: row.isPinned,
    reviewState: row.reviewState,
    translationUse: row.translationUse,
    reviewedByUserId: row.reviewedByUserId,
    publishedAt: toIso(row.publishedAt),
    archivedAt: toIso(row.archivedAt),
  };
}

function noticeAuditSnapshot(row: NoticeRow): AuditSnapshot {
  return {
    category: row.category,
    locale: row.locale,
    title: row.title,
    body: row.body,
    status: row.status,
    priority: row.priority,
    reviewState: row.reviewState,
    translationUse: row.translationUse,
    reviewedByUserId: row.reviewedByUserId,
    scheduledAt: toIso(row.scheduledAt),
    startsAt: toIso(row.startsAt),
    endsAt: toIso(row.endsAt),
    translationGroupId: row.translationGroupId ?? null,
    publishedAt: toIso(row.publishedAt),
    archivedAt: toIso(row.archivedAt),
  };
}

function comparePublicFaqRows(a: FaqRow, b: FaqRow) {
  if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return b.updatedAt.getTime() - a.updatedAt.getTime();
}

const noticePriorityRank: Record<SupportNoticePriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

function comparePublicNoticeRows(a: NoticeRow, b: NoticeRow) {
  const priorityDelta =
    noticePriorityRank[a.priority as SupportNoticePriority] -
    noticePriorityRank[b.priority as SupportNoticePriority];
  if (priorityDelta !== 0) return priorityDelta;
  return noticeVisibleFrom(b) - noticeVisibleFrom(a);
}

function dateTimeOrZero(value: Date | string | null | undefined) {
  if (!value) return 0;
  if (typeof value === 'string') return new Date(value).getTime();
  return value.getTime();
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return value.toISOString();
}
