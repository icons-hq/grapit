import { NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import type { PerformancePreparation } from '@grabit/shared';
import { seatMapConfigSchema } from '@grabit/shared';
import type { DrizzleDB } from '../../database/drizzle.provider.js';
import { adminAuditLogs, bookingPolicies, performances, priceTiers, seatMaps, showtimes,
  translationDrafts, translationSources } from '../../database/schema/index.js';
import { PerformanceIntakeService } from './performance-intake.service.js';

const hasText = (value: string | null | undefined) => Boolean(value?.trim());

/** Preparation facts are derived from persisted content, never client checkboxes. */
export async function readPerformancePreparation(db: DrizzleDB, id: string): Promise<PerformancePreparation> {
  const [performance] = await db.select().from(performances).where(eq(performances.id, id));
  if (!performance) throw new NotFoundException('공연을 찾을 수 없습니다.');
  const [times, tiers, maps, policies, translations, logs, protection] = await Promise.all([
    db.select().from(showtimes).where(eq(showtimes.performanceId, id)),
    db.select().from(priceTiers).where(eq(priceTiers.performanceId, id)),
    db.select().from(seatMaps).where(eq(seatMaps.performanceId, id)),
    db.select().from(bookingPolicies).where(eq(bookingPolicies.performanceId, id)),
    db.select({ field: translationSources.field, source: translationSources.sourceText,
      locale: translationDrafts.targetLocale, text: translationDrafts.translatedText })
      .from(translationSources).innerJoin(translationDrafts, eq(translationDrafts.sourceId, translationSources.id))
      .where(and(eq(translationSources.entityType, 'performance'), eq(translationSources.entityId, id),
        eq(translationSources.sourceLocale, 'ko'), eq(translationDrafts.status, 'published'),
        eq(translationSources.contentHash, translationDrafts.sourceContentHash))),
    db.select().from(adminAuditLogs).where(and(eq(adminAuditLogs.resourceType, 'performance'), eq(adminAuditLogs.resourceId, id)))
      .orderBy(desc(adminAuditLogs.createdAt)).limit(5),
    new PerformanceIntakeService().readStructureProtection(db, id),
  ]);
  const locales = (['ko', 'en', 'th', 'zh-CN'] as const).map((locale) => ({ locale,
    title: locale === 'ko' ? hasText(performance.title) : translations.some((row) => row.locale === locale
      && row.field === 'title' && row.source === performance.title && hasText(row.text)),
    description: locale === 'ko' ? hasText(performance.description) : translations.some((row) => row.locale === locale
      && row.field === 'description' && row.source === performance.description && hasText(row.text)),
  }));
  const tierNames = new Set(tiers.map((tier) => tier.tierName));
  const configurations = maps.map((map) => seatMapConfigSchema.safeParse(map.seatConfig));
  const configuredSeats = configurations.flatMap((parsed) => parsed.success ? parsed.data.tiers : []);
  const seatCount = configuredSeats.reduce((sum, tier) => sum + tier.seatIds.length, 0);
  const policy = policies[0];
  const checks: PerformancePreparation['checks'] = [
    { key: 'basic', label: '기본 정보', step: 'basic', ready: hasText(performance.title) && Boolean(performance.venueId)
      && hasText(performance.ageRating) && performance.startDate <= performance.endDate,
      detail: '공연명, 장소, 기간, 관람 연령을 확인합니다.' },
    { key: 'seats', label: '회차·좌석·가격', step: 'seats', ready: times.length > 0 && tiers.length > 0 && seatCount > 0
      && configurations.every((parsed) => parsed.success) && configuredSeats.every((tier) => tierNames.has(tier.tierName)),
      detail: `${times.length}개 회차 · ${seatCount}석 · ${tiers.length}개 가격 등급` },
    { key: 'locales', label: '한국어·영어 안내', step: 'content', ready: locales.slice(0, 2).every((locale) => locale.title && locale.description),
      detail: '현재 원문과 일치하는 검수·공개된 번역을 확인합니다.' },
    { key: 'sales', label: '판매 설정', step: 'seats', ready: Boolean(policy?.allowedPaymentMethods.length),
      detail: policy?.bookingStartsAt ? `판매 시작 ${policy.bookingStartsAt.toISOString()}` : '시작 시각 미지정 · 판매 상태와 예매 허용 설정을 별도로 확인하세요.' },
  ];
  return { performanceId: id, title: performance.title, updatedAt: performance.updatedAt.toISOString(),
    publishState: performance.publishState, status: performance.status, bookingStartsAt: policy?.bookingStartsAt?.toISOString() ?? null,
    canPublish: checks.every((check) => check.ready), structureProtected: protection.protected, reservationCount: protection.reservationCount, checks, locales,
    history: logs.map((log) => ({ id: log.id, action: log.action, status: log.status, createdAt: log.createdAt.toISOString(), reason: log.reason })) };
}
