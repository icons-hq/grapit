import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import {
  AdminSupportContentService,
  type SupportContentMemoryStore,
} from './admin-support-content.service.js';

const OPERATOR_ID = '00000000-0000-4000-8000-000000000025';

function createStore(): SupportContentMemoryStore {
  return {
    faqs: [],
    notices: [],
  };
}

function createService(store = createStore()) {
  return {
    service: new AdminSupportContentService(store),
    store,
  };
}

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
});
