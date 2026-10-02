import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AdminAuditWriteInput } from './admin-audit.service.js';
import {
  AdminSupportContentService,
  publicSupportContentCacheKey,
  type SupportContentMemoryStore,
} from './admin-support-content.service.js';

const OPERATOR_ID = '00000000-0000-4000-8000-000000000025';
const SECOND_OPERATOR_ID = '00000000-0000-4000-8000-000000000026';

function createStore(): SupportContentMemoryStore {
  return {
    faqs: [],
    notices: [],
  };
}

function createAuditService() {
  const entries: AdminAuditWriteInput[] = [];
  return {
    entries,
    write: vi.fn(async (input: AdminAuditWriteInput) => {
      entries.push(input);
      return { id: `audit-${entries.length}` };
    }),
  };
}

/** Redis-like fake: JSON round-trip and TTL expiry on the (fakeable) clock. */
function createCache() {
  const values = new Map<string, { json: string; expiresAt: number }>();
  return {
    values,
    get: vi.fn(async (key: string) => {
      const entry = values.get(key);
      if (!entry || entry.expiresAt <= Date.now()) return null;
      return JSON.parse(entry.json) as unknown;
    }),
    set: vi.fn(async (key: string, value: unknown, ttlSeconds = 300) => {
      values.set(key, {
        json: JSON.stringify(value),
        expiresAt: Date.now() + ttlSeconds * 1000,
      });
    }),
    invalidate: vi.fn(async (...keys: string[]) => {
      for (const key of keys) values.delete(key);
    }),
  };
}

function createService(store = createStore()) {
  const audit = createAuditService();
  const cache = createCache();
  return {
    service: new AdminSupportContentService(
      store,
      audit as never,
      cache as never,
    ),
    store,
    audit,
    cache,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('AdminSupportContentService', () => {
  it('creates, edits, reviews, publishes, archives, and lists FAQ rows', async () => {
    const { service } = createService();

    const created = await service.createFaq({
      actorUserId: OPERATOR_ID,
      category: 'booking',
      locale: 'ko',
      question: '예매는 어떻게 하나요?',
      answer: '공연 상세에서 좌석을 선택한 뒤 결제합니다.',
    });

    expect(created).toMatchObject({
      category: 'booking',
      locale: 'ko',
      question: '예매는 어떻게 하나요?',
      answer: '공연 상세에서 좌석을 선택한 뒤 결제합니다.',
      reviewState: 'approved',
      translationUse: 'manual',
      canPublish: true,
      translationUseLabel: null,
      createdByUserId: OPERATOR_ID,
      updatedByUserId: OPERATOR_ID,
    });

    const edited = await service.updateFaq(created.id, {
      actorUserId: OPERATOR_ID,
      question: '좌석 선택 후 예매할 수 있나요?',
      answer: '좌석 선택 후 결제까지 완료하면 예매가 확정됩니다.',
    });
    expect(edited.reviewState).toBe('approved');
    expect(edited.question).toBe('좌석 선택 후 예매할 수 있나요?');

    const reviewed = await service.reviewFaq(created.id, {
      actorUserId: OPERATOR_ID,
    });
    expect(reviewed.reviewedByUserId).toBe(OPERATOR_ID);
    expect(reviewed.reviewedAt).toEqual(expect.any(String));

    const published = await service.publishFaq(created.id, {
      actorUserId: OPERATOR_ID,
    });
    expect(published.reviewState).toBe('published');
    expect(published.publishedAt).toEqual(expect.any(String));

    const archived = await service.archiveFaq(created.id, {
      actorUserId: OPERATOR_ID,
    });
    expect(archived.reviewState).toBe('archived');
    expect(archived.archivedAt).toEqual(expect.any(String));

    const listed = await service.list({ type: 'faq', includeArchived: true });
    expect(listed.faqs).toHaveLength(1);
    expect(listed.notices).toHaveLength(0);
    expect(listed.faqs[0]?.id).toBe(created.id);
  });

  it('creates, edits, reviews, publishes, archives, and lists notice rows', async () => {
    const { service } = createService();

    const created = await service.createNotice({
      actorUserId: OPERATOR_ID,
      category: 'event',
      locale: 'en',
      title: 'Entry notice',
      body: 'Please bring your ticket QR.',
      priority: 'normal',
      scheduledAt: '2026-07-18T09:00:00.000Z',
    });

    expect(created).toMatchObject({
      category: 'event',
      locale: 'en',
      title: 'Entry notice',
      body: 'Please bring your ticket QR.',
      status: 'draft',
      reviewState: 'approved',
      translationUse: 'manual',
      canPublish: true,
      createdByUserId: OPERATOR_ID,
    });

    const edited = await service.updateNotice(created.id, {
      actorUserId: OPERATOR_ID,
      title: 'Updated entry notice',
      body: 'Please bring your QR and ID.',
    });
    expect(edited.title).toBe('Updated entry notice');
    expect(edited.reviewState).toBe('approved');

    const reviewed = await service.reviewNotice(created.id, {
      actorUserId: OPERATOR_ID,
    });
    expect(reviewed.reviewedByUserId).toBe(OPERATOR_ID);

    const published = await service.publishNotice(created.id, {
      actorUserId: OPERATOR_ID,
    });
    expect(published.status).toBe('published');
    expect(published.reviewState).toBe('published');

    const archived = await service.archiveNotice(created.id, {
      actorUserId: OPERATOR_ID,
    });
    expect(archived.status).toBe('archived');
    expect(archived.reviewState).toBe('archived');

    const listed = await service.list({ type: 'notice', includeArchived: true });
    expect(listed.faqs).toHaveLength(0);
    expect(listed.notices).toHaveLength(1);
    expect(listed.notices[0]?.id).toBe(created.id);
  });

  it('blocks unreviewed Thai and Chinese assisted content from publish', async () => {
    const { service } = createService();

    const thaiFaq = await service.createFaq({
      actorUserId: OPERATOR_ID,
      category: 'booking',
      locale: 'th',
      question: 'จองอย่างไร',
      answer: 'เลือกที่นั่งและชำระเงิน',
      translationUse: 'assisted',
    });

    expect(thaiFaq.reviewState).toBe('review');
    expect(thaiFaq.canPublish).toBe(false);
    expect(thaiFaq.translationUseLabel).toBe('자동 번역 검수본');

    await expect(
      service.publishFaq(thaiFaq.id, { actorUserId: OPERATOR_ID }),
    ).rejects.toThrow(BadRequestException);

    const reviewed = await service.reviewFaq(thaiFaq.id, {
      actorUserId: OPERATOR_ID,
    });
    expect(reviewed.reviewState).toBe('approved');
    expect(reviewed.canPublish).toBe(true);

    await expect(
      service.publishFaq(thaiFaq.id, { actorUserId: OPERATOR_ID }),
    ).resolves.toMatchObject({
      reviewState: 'published',
      translationUse: 'assisted',
      translationUseLabel: '자동 번역 검수본',
    });
  });

  it('keeps Korean and English manual source content outside machine draft generation', async () => {
    const { service } = createService();

    const ko = await service.createFaq({
      actorUserId: OPERATOR_ID,
      category: 'event_info',
      locale: 'ko',
      question: '공연 시간은 언제인가요?',
      answer: '상세 페이지의 회차 정보를 확인하세요.',
      translationUse: 'assisted',
    });
    const en = await service.createNotice({
      actorUserId: OPERATOR_ID,
      category: 'general',
      locale: 'en',
      title: 'Manual English notice',
      body: 'This English notice is operator-authored.',
      translationUse: 'assisted',
    });

    expect(ko).toMatchObject({
      locale: 'ko',
      translationUse: 'manual',
      reviewState: 'approved',
      translationUseLabel: null,
      canPublish: true,
    });
    expect(en).toMatchObject({
      locale: 'en',
      translationUse: 'manual',
      reviewState: 'approved',
      translationUseLabel: null,
      canPublish: true,
    });
  });

  it('lists only published public English FAQ and notice content in launch order', async () => {
    const { service, store } = createService();

    const regularFaq = await service.createFaq({
      actorUserId: OPERATOR_ID,
      category: 'payment_error',
      locale: 'en',
      question: 'How do I check my payment?',
      answer: 'Check My page after payment.',
      sortOrder: 1,
    });
    const pinnedFaq = await service.createFaq({
      actorUserId: OPERATOR_ID,
      category: 'booking',
      locale: 'en',
      question: 'When does booking open?',
      answer: 'Booking opens from each event detail page.',
      sortOrder: 20,
      isPinned: true,
    });
    const archivedFaq = await service.createFaq({
      actorUserId: OPERATOR_ID,
      category: 'account',
      locale: 'en',
      question: 'Archived question',
      answer: 'Do not show.',
    });
    await service.createFaq({
      actorUserId: OPERATOR_ID,
      category: 'booking',
      locale: 'ko',
      question: '한국어 질문',
      answer: '영문 페이지에서는 제외합니다.',
      isPinned: true,
    });

    await service.publishFaq(regularFaq.id, { actorUserId: OPERATOR_ID });
    await service.publishFaq(pinnedFaq.id, { actorUserId: OPERATOR_ID });
    await service.publishFaq(archivedFaq.id, { actorUserId: OPERATOR_ID });
    await service.archiveFaq(archivedFaq.id, { actorUserId: OPERATOR_ID });

    store.faqs.find((faq) => faq.id === regularFaq.id)!.updatedAt = new Date(
      '2026-06-03T09:00:00.000Z',
    );
    store.faqs.find((faq) => faq.id === pinnedFaq.id)!.updatedAt = new Date(
      '2026-06-03T08:00:00.000Z',
    );

    const highNotice = await service.createNotice({
      actorUserId: OPERATOR_ID,
      category: 'payment',
      locale: 'en',
      title: 'Payment notice',
      body: 'Payment windows may vary by method.',
      priority: 'high',
    });
    const urgentNotice = await service.createNotice({
      actorUserId: OPERATOR_ID,
      category: 'urgent',
      locale: 'en',
      title: 'Entry notice',
      body: 'Bring your QR ticket.',
      priority: 'urgent',
    });
    const draftNotice = await service.createNotice({
      actorUserId: OPERATOR_ID,
      category: 'general',
      locale: 'en',
      title: 'Draft notice',
      body: 'Do not show.',
    });
    const archivedNotice = await service.createNotice({
      actorUserId: OPERATOR_ID,
      category: 'general',
      locale: 'en',
      title: 'Archived notice',
      body: 'Do not show.',
    });
    await service.createNotice({
      actorUserId: OPERATOR_ID,
      category: 'general',
      locale: 'ko',
      title: '한국어 공지',
      body: '영문 페이지에서는 제외합니다.',
      priority: 'urgent',
    });

    await service.publishNotice(highNotice.id, { actorUserId: OPERATOR_ID });
    await service.publishNotice(urgentNotice.id, { actorUserId: OPERATOR_ID });
    await service.publishNotice(archivedNotice.id, { actorUserId: OPERATOR_ID });
    await service.archiveNotice(archivedNotice.id, { actorUserId: OPERATOR_ID });

    store.notices.find((notice) => notice.id === highNotice.id)!.publishedAt =
      new Date('2026-06-03T10:00:00.000Z');
    store.notices.find((notice) => notice.id === urgentNotice.id)!.publishedAt =
      new Date('2026-06-03T09:00:00.000Z');

    const publicContent = await service.listPublished({ locale: 'en' });

    expect(publicContent.faqs).toEqual([
      {
        id: pinnedFaq.id,
        category: 'booking',
        locale: 'en',
        question: 'When does booking open?',
        answer: 'Booking opens from each event detail page.',
        sortOrder: 20,
        isPinned: true,
        updatedAt: '2026-06-03T08:00:00.000Z',
      },
      {
        id: regularFaq.id,
        category: 'payment_error',
        locale: 'en',
        question: 'How do I check my payment?',
        answer: 'Check My page after payment.',
        sortOrder: 1,
        isPinned: false,
        updatedAt: '2026-06-03T09:00:00.000Z',
      },
    ]);
    expect(publicContent.notices).toEqual([
      {
        id: urgentNotice.id,
        category: 'urgent',
        locale: 'en',
        title: 'Entry notice',
        body: 'Bring your QR ticket.',
        priority: 'urgent',
        publishedAt: '2026-06-03T09:00:00.000Z',
      },
      {
        id: highNotice.id,
        category: 'payment',
        locale: 'en',
        title: 'Payment notice',
        body: 'Payment windows may vary by method.',
        priority: 'high',
        publishedAt: '2026-06-03T10:00:00.000Z',
      },
    ]);
    expect(publicContent.faqs).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: archivedFaq.id }),
        expect.objectContaining({ locale: 'ko' }),
      ]),
    );
    expect(publicContent.notices).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: draftNotice.id }),
        expect.objectContaining({ id: archivedNotice.id }),
        expect.objectContaining({ locale: 'ko' }),
      ]),
    );
  });

  it('returns detail rows and rejects missing support content ids', async () => {
    const { service } = createService();

    const notice = await service.createNotice({
      actorUserId: OPERATOR_ID,
      category: 'maintenance',
      locale: 'zh-CN',
      title: '维护通知',
      body: '维护期间部分功能可能不可用。',
      translationUse: 'assisted',
    });

    await expect(service.getNotice(notice.id)).resolves.toMatchObject({
      id: notice.id,
      locale: 'zh-CN',
      translationUseLabel: '자동 번역 검수본',
    });
    await expect(service.getFaq('missing-faq')).rejects.toThrow(NotFoundException);
    await expect(service.getNotice('missing-notice')).rejects.toThrow(
      NotFoundException,
    );
  });

  describe('editing published content (audit #48)', () => {
    it('keeps a published Korean FAQ live after an operator edit', async () => {
      const { service } = createService();
      const faq = await service.createFaq({
        actorUserId: OPERATOR_ID,
        category: 'booking',
        locale: 'ko',
        question: '예매 오픈 시간은?',
        answer: '오후 8시에 오픈합니다.',
      });
      const published = await service.publishFaq(faq.id, {
        actorUserId: OPERATOR_ID,
      });

      const edited = await service.updateFaq(faq.id, {
        actorUserId: SECOND_OPERATOR_ID,
        category: 'event_info',
        question: '예매 오픈 시간은?',
        answer: '오후 8시 정각에 오픈합니다.',
        translationUse: 'manual',
      });

      expect(edited).toMatchObject({
        reviewState: 'published',
        publishedAt: published.publishedAt,
        reviewedByUserId: SECOND_OPERATOR_ID,
        answer: '오후 8시 정각에 오픈합니다.',
        category: 'event_info',
      });
      const publicContent = await service.listPublished({ locale: 'ko' });
      expect(publicContent.faqs.map((row) => row.answer)).toEqual([
        '오후 8시 정각에 오픈합니다.',
      ]);
    });

    it('keeps a published notice live when the UI resends unchanged fields or only the category changes', async () => {
      const { service } = createService();
      const notice = await service.createNotice({
        actorUserId: OPERATOR_ID,
        category: 'general',
        locale: 'ko',
        title: '예매 오픈 안내',
        body: '오늘 오후 8시에 예매가 열립니다.',
      });
      await service.publishNotice(notice.id, { actorUserId: OPERATOR_ID });

      const recategorized = await service.updateNotice(notice.id, {
        actorUserId: OPERATOR_ID,
        category: 'payment',
        title: '예매 오픈 안내',
        body: '오늘 오후 8시에 예매가 열립니다.',
        translationUse: 'manual',
      });
      expect(recategorized).toMatchObject({
        status: 'published',
        reviewState: 'published',
        category: 'payment',
      });

      const typoFixed = await service.updateNotice(notice.id, {
        actorUserId: OPERATOR_ID,
        body: '오늘 오후 8시 정각에 예매가 열립니다.',
      });
      expect(typoFixed).toMatchObject({
        status: 'published',
        reviewState: 'published',
        publishedAt: recategorized.publishedAt,
      });
      const publicContent = await service.listPublished({ locale: 'ko' });
      expect(publicContent.notices).toEqual([
        expect.objectContaining({
          id: notice.id,
          body: '오늘 오후 8시 정각에 예매가 열립니다.',
        }),
      ]);
    });

    it('unpublishes an assisted translation edit until it is reviewed again, keeping status consistent', async () => {
      const { service } = createService();
      const notice = await service.createNotice({
        actorUserId: OPERATOR_ID,
        category: 'general',
        locale: 'th',
        title: 'ประกาศ',
        body: 'เนื้อหาเดิม',
        translationUse: 'assisted',
      });
      await service.reviewNotice(notice.id, { actorUserId: OPERATOR_ID });
      await service.publishNotice(notice.id, { actorUserId: OPERATOR_ID });

      const edited = await service.updateNotice(notice.id, {
        actorUserId: OPERATOR_ID,
        body: 'เนื้อหาใหม่',
      });

      expect(edited).toMatchObject({
        status: 'draft',
        reviewState: 'review',
        publishedAt: null,
        canPublish: false,
      });
      await expect(service.listPublished({ locale: 'th' })).resolves.toEqual({
        faqs: [],
        notices: [],
      });
    });

    it('rejects review on published content instead of silently unpublishing it', async () => {
      const { service } = createService();
      const faq = await service.createFaq({
        actorUserId: OPERATOR_ID,
        category: 'booking',
        locale: 'en',
        question: 'When does booking open?',
        answer: 'At 8 PM KST.',
      });
      await service.publishFaq(faq.id, { actorUserId: OPERATOR_ID });

      await expect(
        service.reviewFaq(faq.id, { actorUserId: OPERATOR_ID }),
      ).rejects.toThrow(BadRequestException);
      await expect(service.getFaq(faq.id)).resolves.toMatchObject({
        reviewState: 'published',
      });
      await expect(service.listPublished({ locale: 'en' })).resolves.toMatchObject({
        faqs: [expect.objectContaining({ id: faq.id })],
      });

    });

    it('restores archived content through review so it can be published again (audit #133)', async () => {
      const { service, audit } = createService();
      const faq = await service.createFaq({
        actorUserId: OPERATOR_ID,
        category: 'booking',
        locale: 'ko',
        question: '보관했던 질문',
        answer: '다시 게시할 답변',
      });
      await service.publishFaq(faq.id, { actorUserId: OPERATOR_ID });
      await service.archiveFaq(faq.id, { actorUserId: OPERATOR_ID });
      await expect(service.publishFaq(faq.id, { actorUserId: OPERATOR_ID }))
        .rejects.toThrow(BadRequestException);

      const restored = await service.reviewFaq(faq.id, { actorUserId: SECOND_OPERATOR_ID });
      expect(restored).toMatchObject({
        reviewState: 'approved',
        canPublish: true,
        archivedAt: null,
        publishedAt: null,
        reviewedByUserId: SECOND_OPERATOR_ID,
      });
      // Unarchiving alone does not put it back on the public page.
      await expect(service.listPublished({ locale: 'ko' })).resolves.toMatchObject({ faqs: [] });
      expect(audit.entries.at(-1)).toMatchObject({
        action: 'support.content.review',
        resourceType: 'support_faq',
        resourceId: faq.id,
        actorUserId: SECOND_OPERATOR_ID,
        before: expect.objectContaining({ reviewState: 'archived' }),
        after: expect.objectContaining({ reviewState: 'approved', archivedAt: null }),
      });

      await service.publishFaq(faq.id, { actorUserId: SECOND_OPERATOR_ID });
      await expect(service.listPublished({ locale: 'ko' })).resolves.toMatchObject({
        faqs: [expect.objectContaining({ id: faq.id })],
      });

      const notice = await service.createNotice({
        actorUserId: OPERATOR_ID,
        category: 'general',
        locale: 'en',
        title: 'Archived',
        body: 'Archived body',
      });
      await service.archiveNotice(notice.id, { actorUserId: OPERATOR_ID });
      await expect(service.reviewNotice(notice.id, { actorUserId: OPERATOR_ID }))
        .resolves.toMatchObject({ status: 'draft', reviewState: 'approved', archivedAt: null, canPublish: true });
      await expect(service.publishNotice(notice.id, { actorUserId: OPERATOR_ID }))
        .resolves.toMatchObject({ status: 'published', reviewState: 'published' });

      // An assisted translation comes back for another review, never straight to publishable.
      const thai = await service.createNotice({
        actorUserId: OPERATOR_ID,
        category: 'general',
        locale: 'th',
        title: 'ประกาศ',
        body: 'เนื้อหา',
        translationUse: 'assisted',
      });
      await service.archiveNotice(thai.id, { actorUserId: OPERATOR_ID });
      const thaiRestored = await service.reviewNotice(thai.id, { actorUserId: OPERATOR_ID });
      expect(thaiRestored).toMatchObject({ status: 'draft', reviewState: 'review', canPublish: false, reviewedByUserId: null });
      await expect(service.reviewNotice(thai.id, { actorUserId: OPERATOR_ID }))
        .resolves.toMatchObject({ reviewState: 'approved', canPublish: true });
    });
  });

  describe('optimistic concurrency (audit #141)', () => {
    it('rejects a stale edit with 409 instead of overwriting another operator change', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-30T01:00:00.000Z'));
      const { service } = createService();
      const notice = await service.createNotice({
        actorUserId: OPERATOR_ID,
        category: 'general',
        locale: 'ko',
        title: '원본',
        body: '원본 본문',
      });

      vi.setSystemTime(new Date('2026-09-30T01:01:00.000Z'));
      await service.updateNotice(notice.id, {
        actorUserId: SECOND_OPERATOR_ID,
        title: '다른 운영자 수정',
        expectedUpdatedAt: notice.updatedAt,
      });

      vi.setSystemTime(new Date('2026-09-30T01:02:00.000Z'));
      await expect(
        service.updateNotice(notice.id, {
          actorUserId: OPERATOR_ID,
          title: '덮어쓰기 시도',
          expectedUpdatedAt: notice.updatedAt,
        }),
      ).rejects.toThrow(ConflictException);
      await expect(service.getNotice(notice.id)).resolves.toMatchObject({
        title: '다른 운영자 수정',
      });

      const faq = await service.createFaq({
        actorUserId: OPERATOR_ID,
        category: 'booking',
        locale: 'ko',
        question: '질문',
        answer: '답변',
      });
      await expect(
        service.updateFaq(faq.id, {
          actorUserId: OPERATOR_ID,
          answer: '새 답변',
          expectedUpdatedAt: '2026-09-30T00:00:00.000Z',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('admin audit trail (audit #133)', () => {
    it('records create, update, review, publish, and archive with prior body and request context', async () => {
      const { service, audit } = createService();
      const context = {
        actorUserId: OPERATOR_ID,
        ipAddress: '203.0.113.7',
        userAgent: 'Vitest Admin',
        requestId: 'req-support-1',
      };

      const notice = await service.createNotice({
        ...context,
        category: 'refund',
        locale: 'th',
        title: 'ประกาศคืนเงิน',
        body: 'ข้อความเดิม',
        translationUse: 'assisted',
      });
      await service.updateNotice(notice.id, { ...context, body: 'ข้อความใหม่' });
      await service.reviewNotice(notice.id, context);
      await service.publishNotice(notice.id, context);
      await service.archiveNotice(notice.id, context);

      expect(audit.entries.map((entry) => entry.action)).toEqual([
        'support.content.create',
        'support.content.update',
        'support.content.review',
        'support.content.publish',
        'support.content.archive',
      ]);
      for (const entry of audit.entries) {
        expect(entry).toMatchObject({
          actorUserId: OPERATOR_ID,
          resourceType: 'support_notice',
          resourceId: notice.id,
          status: 'success',
          ipAddress: '203.0.113.7',
          userAgent: 'Vitest Admin',
          requestId: 'req-support-1',
        });
      }
      expect(audit.entries[1]?.before).toMatchObject({ body: 'ข้อความเดิม' });
      expect(audit.entries[1]?.after).toMatchObject({ body: 'ข้อความใหม่' });
      expect(audit.entries[3]?.after).toMatchObject({
        reviewState: 'published',
        status: 'published',
        publishedAt: expect.any(String),
      });
      expect(audit.entries[4]?.before).toMatchObject({
        publishedAt: expect.any(String),
        body: 'ข้อความใหม่',
      });
    });

    it('records FAQ mutations as support_faq resources', async () => {
      const { service, audit } = createService();
      const faq = await service.createFaq({
        actorUserId: OPERATOR_ID,
        category: 'booking',
        locale: 'ko',
        question: '질문',
        answer: '답변',
      });
      await service.updateFaq(faq.id, { actorUserId: OPERATOR_ID, answer: '수정 답변' });
      await service.publishFaq(faq.id, { actorUserId: OPERATOR_ID });

      expect(audit.entries.map((entry) => [entry.action, entry.resourceType])).toEqual([
        ['support.content.create', 'support_faq'],
        ['support.content.update', 'support_faq'],
        ['support.content.publish', 'support_faq'],
      ]);
      expect(audit.entries[1]?.before).toMatchObject({ answer: '답변' });
    });
  });

  describe('notice schedule and priority (audit #134)', () => {
    it('hides scheduled notices until their time and drops them after endsAt', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-01T09:00:00.000Z'));
      const { service } = createService();
      const notice = await service.createNotice({
        actorUserId: OPERATOR_ID,
        category: 'event',
        locale: 'ko',
        title: '예매 오픈',
        body: '지금부터 예매할 수 있습니다.',
        scheduledAt: '2026-10-01T11:00:00.000Z',
        endsAt: '2026-10-01T15:00:00.000Z',
      });
      await service.publishNotice(notice.id, { actorUserId: OPERATOR_ID });

      await expect(service.listPublished({ locale: 'ko' })).resolves.toMatchObject({
        notices: [],
      });

      vi.setSystemTime(new Date('2026-10-01T11:00:31.000Z'));
      await expect(service.listPublished({ locale: 'ko' })).resolves.toMatchObject({
        notices: [
          {
            id: notice.id,
            publishedAt: '2026-10-01T11:00:00.000Z',
          },
        ],
      });

      vi.setSystemTime(new Date('2026-10-01T15:00:31.000Z'));
      await expect(service.listPublished({ locale: 'ko' })).resolves.toMatchObject({
        notices: [],
      });
    });

    it('rejects an end time before the start time and publishing an already ended notice', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-01T09:00:00.000Z'));
      const { service } = createService();

      await expect(
        service.createNotice({
          actorUserId: OPERATOR_ID,
          category: 'maintenance',
          locale: 'ko',
          title: '점검',
          body: '점검 안내',
          scheduledAt: '2026-10-01T12:00:00.000Z',
          endsAt: '2026-10-01T11:00:00.000Z',
        }),
      ).rejects.toThrow(BadRequestException);

      const ended = await service.createNotice({
        actorUserId: OPERATOR_ID,
        category: 'maintenance',
        locale: 'ko',
        title: '지난 점검',
        body: '점검 안내',
        endsAt: '2026-10-01T08:00:00.000Z',
      });
      await expect(
        service.publishNotice(ended.id, { actorUserId: OPERATOR_ID }),
      ).rejects.toThrow(BadRequestException);
    });

    it('defaults urgent-category notices to urgent priority so later normal notices do not bury them', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-01T09:00:00.000Z'));
      const { service } = createService();
      const urgent = await service.createNotice({
        actorUserId: OPERATOR_ID,
        category: 'urgent',
        locale: 'ko',
        title: '결제 장애',
        body: '결제가 지연되고 있습니다.',
      });
      expect(urgent.priority).toBe('urgent');
      await service.publishNotice(urgent.id, { actorUserId: OPERATOR_ID });

      vi.setSystemTime(new Date('2026-10-01T09:10:00.000Z'));
      const later = await service.createNotice({
        actorUserId: OPERATOR_ID,
        category: 'general',
        locale: 'ko',
        title: '일반 안내',
        body: '일반 안내입니다.',
      });
      await service.publishNotice(later.id, { actorUserId: OPERATOR_ID });

      const recategorized = await service.createNotice({
        actorUserId: OPERATOR_ID,
        category: 'general',
        locale: 'ko',
        title: '분류 변경',
        body: '긴급으로 바꿉니다.',
      });
      await expect(
        service.updateNotice(recategorized.id, {
          actorUserId: OPERATOR_ID,
          category: 'urgent',
        }),
      ).resolves.toMatchObject({ priority: 'urgent' });

      const publicContent = await service.listPublished({ locale: 'ko' });
      expect(publicContent.notices.map((row) => row.id)).toEqual([
        urgent.id,
        later.id,
      ]);
    });
  });

  describe('legacy urgent notices (audit #134)', () => {
    it('ranks an urgent-category notice stored with normal priority above later normal notices', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-01T09:00:00.000Z'));
      const { service, store } = createService();
      const legacyUrgent = await service.createNotice({
        actorUserId: OPERATOR_ID,
        category: 'urgent',
        locale: 'ko',
        title: '배포 전 긴급 공지',
        body: '배포 전에 만든 긴급 공지',
      });
      await service.publishNotice(legacyUrgent.id, { actorUserId: OPERATOR_ID });
      // Created before the category default existed: the stored priority is normal.
      store.notices.find((row) => row.id === legacyUrgent.id)!.priority = 'normal';

      vi.setSystemTime(new Date('2026-10-01T09:10:00.000Z'));
      const later = await service.createNotice({
        actorUserId: OPERATOR_ID,
        category: 'general',
        locale: 'ko',
        title: '나중 일반 공지',
        body: '나중에 게시한 일반 공지',
        priority: 'high',
      });
      await service.publishNotice(later.id, { actorUserId: OPERATOR_ID });

      const content = await service.listPublished({ locale: 'ko' });
      expect(content.notices.map((row) => row.id)).toEqual([legacyUrgent.id, later.id]);
      // Display data is not rewritten.
      expect(content.notices[0]?.priority).toBe('normal');
    });
  });

  describe('locale fallback for critical notices (audit #168)', () => {
    it('shows a Korean-only urgent notice to en, th, and zh-CN viewers until a translation is published', async () => {
      const { service } = createService();
      const urgent = await service.createNotice({
        actorUserId: OPERATOR_ID,
        category: 'urgent',
        locale: 'ko',
        title: '결제 장애 안내',
        body: '결제가 지연되고 있습니다.',
      });
      await service.publishNotice(urgent.id, { actorUserId: OPERATOR_ID });
      const general = await service.createNotice({
        actorUserId: OPERATOR_ID,
        category: 'general',
        locale: 'ko',
        title: '일반 안내',
        body: '한국어 전용 일반 안내',
      });
      await service.publishNotice(general.id, { actorUserId: OPERATOR_ID });

      for (const locale of ['en', 'th', 'zh-CN'] as const) {
        const content = await service.listPublished({ locale });
        expect(content.notices).toEqual([
          expect.objectContaining({ id: urgent.id, locale: 'ko' }),
        ]);
      }

      const english = await service.createNotice({
        actorUserId: OPERATOR_ID,
        category: 'urgent',
        locale: 'en',
        title: 'Payment delay',
        body: 'Payments are delayed.',
        translationOfNoticeId: urgent.id,
      });
      expect(english.translationGroupId).toBe(urgent.id);
      // Draft translations do not hide the fallback yet.
      await expect(service.listPublished({ locale: 'en' })).resolves.toMatchObject({
        notices: [{ id: urgent.id }],
      });

      await service.publishNotice(english.id, { actorUserId: OPERATOR_ID });
      await expect(service.listPublished({ locale: 'en' })).resolves.toMatchObject({
        notices: [{ id: english.id, locale: 'en' }],
      });
      await expect(service.listPublished({ locale: 'th' })).resolves.toMatchObject({
        notices: [{ id: english.id, locale: 'en' }],
      });

      const thai = await service.createNotice({
        actorUserId: OPERATOR_ID,
        category: 'urgent',
        locale: 'th',
        title: 'การชำระเงินล่าช้า',
        body: 'การชำระเงินล่าช้า',
        translationOfNoticeId: english.id,
      });
      await service.publishNotice(thai.id, { actorUserId: OPERATOR_ID });
      await expect(service.listPublished({ locale: 'th' })).resolves.toMatchObject({
        notices: [{ id: thai.id, locale: 'th' }],
      });
      await expect(service.listPublished({ locale: 'zh-CN' })).resolves.toMatchObject({
        notices: [{ id: english.id, locale: 'en' }],
      });
      await expect(service.listPublished({ locale: 'ko' })).resolves.toMatchObject({
        notices: [{ id: urgent.id }, { id: general.id }],
      });
    });

    it('keeps legacy unlinked notices in their own locale and rejects a second translation for the same locale', async () => {
      const { service, store, audit } = createService();
      const legacy = await service.createNotice({
        actorUserId: OPERATOR_ID,
        category: 'payment',
        locale: 'ko',
        title: '기존 결제 공지',
        body: '번역 연결 이전에 만든 공지',
      });
      await service.publishNotice(legacy.id, { actorUserId: OPERATOR_ID });
      store.notices.find((row) => row.id === legacy.id)!.translationGroupId = null;
      const legacyUpdatedAt = store.notices.find((row) => row.id === legacy.id)!.updatedAt;

      await expect(service.listPublished({ locale: 'th' })).resolves.toMatchObject({
        notices: [],
      });

      const english = await service.createNotice({
        actorUserId: OPERATOR_ID,
        category: 'payment',
        locale: 'en',
        title: 'Payment notice',
        body: 'Linked later',
        translationOfNoticeId: legacy.id,
        ipAddress: '198.51.100.7',
        requestId: 'req-link',
      });
      expect(english.translationGroupId).toBe(legacy.id);
      await expect(service.getNotice(legacy.id)).resolves.toMatchObject({
        translationGroupId: legacy.id,
        // Linking is not a content edit; an operator editing the source keeps their base version.
        updatedAt: legacyUpdatedAt.toISOString(),
      });
      // Linking changes the legacy source's public exposure, so it is audited on the source.
      expect(audit.entries.filter((entry) => entry.resourceId === legacy.id).at(-1)).toMatchObject({
        action: 'support.content.update',
        resourceType: 'support_notice',
        actorUserId: OPERATOR_ID,
        before: { translationGroupId: null },
        after: { translationGroupId: legacy.id },
        ipAddress: '198.51.100.7',
        requestId: 'req-link',
      });
      await expect(
        service.createNotice({
          actorUserId: OPERATOR_ID,
          category: 'payment',
          locale: 'en',
          title: 'Duplicate',
          body: 'Duplicate',
          translationOfNoticeId: legacy.id,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects restoring an archived translation while another version of its locale is live in the group', async () => {
      const { service, audit } = createService();
      const source = await service.createNotice({
        actorUserId: OPERATOR_ID,
        category: 'urgent',
        locale: 'ko',
        title: '결제 장애 안내',
        body: '결제가 지연되고 있습니다.',
      });
      await service.publishNotice(source.id, { actorUserId: OPERATOR_ID });
      const archivedEnglish = await service.createNotice({
        actorUserId: OPERATOR_ID,
        category: 'urgent',
        locale: 'en',
        title: 'Payment delay (old)',
        body: 'Old wording',
        translationOfNoticeId: source.id,
      });
      await service.publishNotice(archivedEnglish.id, { actorUserId: OPERATOR_ID });
      await service.archiveNotice(archivedEnglish.id, { actorUserId: OPERATOR_ID });
      // Archiving frees the locale, so a replacement translation can be registered.
      const replacement = await service.createNotice({
        actorUserId: OPERATOR_ID,
        category: 'urgent',
        locale: 'en',
        title: 'Payment delay',
        body: 'New wording',
        translationOfNoticeId: source.id,
      });
      await service.publishNotice(replacement.id, { actorUserId: OPERATOR_ID });
      const auditCount = audit.entries.length;

      await expect(service.reviewNotice(archivedEnglish.id, { actorUserId: OPERATOR_ID }))
        .rejects.toThrow('이미 같은 언어의 번역본이 있습니다');
      await expect(service.getNotice(archivedEnglish.id)).resolves.toMatchObject({
        status: 'archived',
        reviewState: 'archived',
      });
      expect(audit.entries).toHaveLength(auditCount);
      // English viewers keep seeing exactly one version of the notice.
      await expect(service.listPublished({ locale: 'en' })).resolves.toMatchObject({
        notices: [{ id: replacement.id }],
      });

      // The same rule covers the group's source row.
      await service.archiveNotice(source.id, { actorUserId: OPERATOR_ID });
      const korean = await service.createNotice({
        actorUserId: OPERATOR_ID,
        category: 'urgent',
        locale: 'ko',
        title: '결제 장애 안내(수정)',
        body: '새 원문',
        translationOfNoticeId: replacement.id,
      });
      await expect(service.reviewNotice(source.id, { actorUserId: OPERATOR_ID }))
        .rejects.toThrow(BadRequestException);

      // Once the live version is archived, the old one can come back.
      await service.archiveNotice(replacement.id, { actorUserId: OPERATOR_ID });
      await expect(service.reviewNotice(archivedEnglish.id, { actorUserId: OPERATOR_ID }))
        .resolves.toMatchObject({ status: 'draft', reviewState: 'approved', archivedAt: null });
      await service.archiveNotice(korean.id, { actorUserId: OPERATOR_ID });
      await expect(service.reviewNotice(source.id, { actorUserId: OPERATOR_ID }))
        .resolves.toMatchObject({ reviewState: 'approved' });
    });
  });

  describe('editing archived content', () => {
    it('keeps an edited archived en translation archived so its locale never shows two versions', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-01T01:00:00.000Z'));
      const { service, audit } = createService();
      const source = await service.createNotice({
        actorUserId: OPERATOR_ID,
        category: 'urgent',
        locale: 'ko',
        title: '결제 장애 안내',
        body: '결제가 지연되고 있습니다.',
      });
      await service.publishNotice(source.id, { actorUserId: OPERATOR_ID });
      const oldEnglish = await service.createNotice({
        actorUserId: OPERATOR_ID,
        category: 'urgent',
        locale: 'en',
        title: 'Payment delay (old)',
        body: 'Old wording',
        translationOfNoticeId: source.id,
      });
      await service.publishNotice(oldEnglish.id, { actorUserId: OPERATOR_ID });
      vi.setSystemTime(new Date('2026-10-01T02:00:00.000Z'));
      const archived = await service.archiveNotice(oldEnglish.id, { actorUserId: OPERATOR_ID });
      const replacement = await service.createNotice({
        actorUserId: OPERATOR_ID,
        category: 'urgent',
        locale: 'en',
        title: 'Payment delay',
        body: 'New wording',
        translationOfNoticeId: source.id,
      });
      await service.publishNotice(replacement.id, { actorUserId: OPERATOR_ID });

      vi.setSystemTime(new Date('2026-10-01T03:00:00.000Z'));
      const edited = await service.updateNotice(oldEnglish.id, {
        actorUserId: SECOND_OPERATOR_ID,
        title: 'Payment delay (old, corrected)',
        expectedUpdatedAt: archived.updatedAt,
      });

      expect(edited).toMatchObject({
        title: 'Payment delay (old, corrected)',
        status: 'archived',
        reviewState: 'archived',
        canPublish: false,
        archivedAt: archived.archivedAt,
        reviewedByUserId: archived.reviewedByUserId,
        reviewedAt: archived.reviewedAt,
        publishedAt: archived.publishedAt,
      });
      expect(audit.entries.at(-1)).toMatchObject({
        action: 'support.content.update',
        resourceId: oldEnglish.id,
        after: expect.objectContaining({ reviewState: 'archived', status: 'archived' }),
      });
      await expect(service.publishNotice(oldEnglish.id, { actorUserId: OPERATOR_ID }))
        .rejects.toThrow(BadRequestException);
      await expect(service.listPublished({ locale: 'en' })).resolves.toMatchObject({
        notices: [{ id: replacement.id }],
      });
      // 보관 해제 is still the only way back, and it keeps the group check.
      await expect(service.reviewNotice(oldEnglish.id, { actorUserId: OPERATOR_ID }))
        .rejects.toThrow('이미 같은 언어의 번역본이 있습니다');
    });

    it('keeps an edited archived FAQ archived (FAQ shares the edit transition)', async () => {
      const { service } = createService();
      const faq = await service.createFaq({
        actorUserId: OPERATOR_ID,
        category: 'booking',
        locale: 'ko',
        question: '보관한 질문',
        answer: '보관한 답변',
      });
      await service.publishFaq(faq.id, { actorUserId: OPERATOR_ID });
      const archived = await service.archiveFaq(faq.id, { actorUserId: OPERATOR_ID });

      const edited = await service.updateFaq(faq.id, {
        actorUserId: OPERATOR_ID,
        answer: '고친 답변',
      });

      expect(edited).toMatchObject({
        answer: '고친 답변',
        reviewState: 'archived',
        canPublish: false,
        archivedAt: archived.archivedAt,
        publishedAt: archived.publishedAt,
        reviewedByUserId: archived.reviewedByUserId,
      });
      await expect(service.publishFaq(faq.id, { actorUserId: OPERATOR_ID }))
        .rejects.toThrow(BadRequestException);
      await expect(service.listPublished({ locale: 'ko' })).resolves.toMatchObject({ faqs: [] });
    });

    it('rejects publishing a notice while another version of its locale is live in the group', async () => {
      const { service, store, audit } = createService();
      const source = await service.createNotice({
        actorUserId: OPERATOR_ID,
        category: 'payment',
        locale: 'ko',
        title: '결제 안내',
        body: '결제 안내 본문',
      });
      await service.publishNotice(source.id, { actorUserId: OPERATOR_ID });
      const first = await service.createNotice({
        actorUserId: OPERATOR_ID,
        category: 'payment',
        locale: 'en',
        title: 'Payment notice (first)',
        body: 'First',
        translationOfNoticeId: source.id,
      });
      await service.archiveNotice(first.id, { actorUserId: OPERATOR_ID });
      const second = await service.createNotice({
        actorUserId: OPERATOR_ID,
        category: 'payment',
        locale: 'en',
        title: 'Payment notice (second)',
        body: 'Second',
        translationOfNoticeId: source.id,
      });
      await service.publishNotice(second.id, { actorUserId: OPERATOR_ID });
      // State left by the pre-fix edit: an archived translation edited back to approved.
      Object.assign(store.notices.find((row) => row.id === first.id)!, {
        status: 'draft',
        reviewState: 'approved',
        archivedAt: null,
      });
      const auditCount = audit.entries.length;

      await expect(service.publishNotice(first.id, { actorUserId: OPERATOR_ID }))
        .rejects.toThrow('같은 언어의 게시 중인 번역본이 있습니다');
      expect(audit.entries).toHaveLength(auditCount);
      await expect(service.listPublished({ locale: 'en' })).resolves.toMatchObject({
        notices: [{ id: second.id }],
      });

      // A second unarchived draft of the locale also blocks publishing the live one again.
      await expect(service.publishNotice(second.id, { actorUserId: OPERATOR_ID }))
        .rejects.toThrow('같은 언어의 번역본이 이미 있습니다');

      // Once the other version is archived, the locale has one version and publishing works.
      await service.archiveNotice(second.id, { actorUserId: OPERATOR_ID });
      await expect(service.publishNotice(first.id, { actorUserId: OPERATOR_ID }))
        .resolves.toMatchObject({ status: 'published', reviewState: 'published' });
    });
  });

  describe('public read cache (audit #132)', () => {
    it('serves repeat reads from cache, collapses concurrent misses, and invalidates on mutation', async () => {
      const { service, store, cache } = createService();
      const faq = await service.createFaq({
        actorUserId: OPERATOR_ID,
        category: 'booking',
        locale: 'ko',
        question: '질문',
        answer: '답변',
      });
      await service.publishFaq(faq.id, { actorUserId: OPERATOR_ID });
      cache.set.mockClear();

      const [first, second] = await Promise.all([
        service.listPublished({ locale: 'ko' }),
        service.listPublished({ locale: 'ko' }),
      ]);
      expect(first).toEqual(second);
      expect(cache.set).toHaveBeenCalledTimes(1);
      expect(cache.set).toHaveBeenCalledWith(
        publicSupportContentCacheKey('ko'),
        expect.any(Object),
        30,
      );

      // A direct store change is invisible while the cached copy is valid.
      store.faqs[0]!.answer = '캐시 밖 변경';
      await expect(service.listPublished({ locale: 'ko' })).resolves.toMatchObject({
        faqs: [{ answer: '답변' }],
      });

      await service.archiveFaq(faq.id, { actorUserId: OPERATOR_ID });
      expect(cache.invalidate).toHaveBeenLastCalledWith(
        publicSupportContentCacheKey('ko'),
        publicSupportContentCacheKey('en'),
        publicSupportContentCacheKey('th'),
        publicSupportContentCacheKey('zh-CN'),
      );
      await expect(service.listPublished({ locale: 'ko' })).resolves.toEqual({
        faqs: [],
        notices: [],
      });
    });
  });
});
