import { NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { PerformancePreparation, PerformanceSaleOpening } from '@grabit/shared';
import { CHECKOUT_CONFIGURABLE_PAYMENT_METHODS, resolvePerformanceSaleOpening, seatMapConfigSchema } from '@grabit/shared';
import type { DrizzleDB } from '../../database/drizzle.provider.js';
import { adminAuditLogs, bookingPolicies, performanceSeatAssignments, performanceSeatTiers, performances, priceTiers,
  seatMaps, showtimes, translationDrafts, translationSources } from '../../database/schema/index.js';
import { PerformanceIntakeService } from './performance-intake.service.js';
import { requiresManualTranslation } from '../translation/deepl.client.js';

const hasText = (value: string | null | undefined) => Boolean(value?.trim());
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function formatKst(iso: string): string {
  return `${new Date(Date.parse(iso) + KST_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ')} KST`;
}

/** Raw persisted seat-side tier names, as the legacy (non-overlay) checkout matches them. */
function rawSeatTierNames(seatConfig: unknown): string[] {
  const tiers = (seatConfig as { tiers?: unknown } | null)?.tiers;
  return Array.isArray(tiers) ? tiers.flatMap((tier) => {
    const name = (tier as { tierName?: unknown } | null)?.tierName;
    return typeof name === 'string' ? [name] : [];
  }) : [];
}

function describeSaleOpening(opening: PerformanceSaleOpening, published: boolean): string {
  if (opening.mode === 'ended') return '판매 종료 상태 · 공개해도 예매할 수 없습니다.';
  if (opening.mode === 'scheduled') return `판매 시작 ${formatKst(opening.at!)} · 이 시각에 자동으로 판매가 열립니다.`;
  if (opening.mode === 'manual') {
    return '판매 시작 시각 미지정 · 판매 예정 상태라 자동으로 열리지 않습니다. 판매 상태를 판매 중으로 바꿀 때 판매가 열립니다.';
  }
  if (opening.startElapsed) {
    return published
      ? `판매 시작 ${formatKst(opening.at!)} · 판매가 열려 있습니다.`
      : `판매 시작 시각 ${formatKst(opening.at!)}이 이미 지났습니다. 공개하는 즉시 판매가 열리므로 시각을 다시 지정하세요.`;
  }
  return published ? '판매 시작 시각 미지정 · 판매 중 상태라 판매가 열려 있습니다.'
    : '판매 시작 시각 미지정 · 판매 중 상태라 공개하는 즉시 판매가 열립니다.';
}

/** Preparation facts are derived from persisted content, never client checkboxes. */
export async function readPerformancePreparation(db: DrizzleDB, id: string, now: Date = new Date()): Promise<PerformancePreparation> {
  const [performance] = await db.select().from(performances).where(eq(performances.id, id));
  if (!performance) throw new NotFoundException('공연을 찾을 수 없습니다.');
  const [times, tiers, maps, policies, translations, logs, protection, overlayTiers] = await Promise.all([
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
    // Checkout prices seats from this overlay, not from price_tiers, whenever a seat map is linked to it.
    db.select({ tierName: performanceSeatTiers.tierName, price: performanceSeatTiers.price,
      assignments: sql<number>`count(${performanceSeatAssignments.id})::int` })
      .from(performanceSeatTiers)
      .leftJoin(performanceSeatAssignments, eq(performanceSeatAssignments.tierId, performanceSeatTiers.id))
      .where(eq(performanceSeatTiers.performanceId, id))
      .groupBy(performanceSeatTiers.id),
  ]);
  // A published manual-review marker draft is ignored by the public overlay, which shows
  // the Korean source instead, so it does not count as a translation.
  const isTranslated = (row: (typeof translations)[number], locale: string, field: 'title' | 'description', source: string | null) =>
    row.locale === locale && row.field === field && row.source === source && hasText(row.text)
      && !requiresManualTranslation(row.text);
  const locales = (['ko', 'en', 'th', 'zh-CN'] as const).map((locale) => ({ locale,
    title: locale === 'ko' ? hasText(performance.title)
      : translations.some((row) => isTranslated(row, locale, 'title', performance.title)),
    description: locale === 'ko' ? hasText(performance.description)
      : translations.some((row) => isTranslated(row, locale, 'description', performance.description)),
  }));
  const priceByTier = new Map(tiers.map((tier) => [tier.tierName.trim(), tier.price]));
  const configurations = maps.map((map) => seatMapConfigSchema.safeParse(map.seatConfig));
  const configuredSeats = configurations.flatMap((parsed) => parsed.success ? parsed.data.tiers : []);
  const seatCount = configuredSeats.reduce((sum, tier) => sum + tier.seatIds.length, 0);
  const unpricedTiers = tiers.filter((tier) => !(tier.price > 0)).map((tier) => tier.tierName.trim());
  // Checkout prices seats from the overlay when a seat map is linked to it; otherwise it
  // matches raw seat-map tier names against raw price tier names.
  const usesOverlay = maps.some((map) => typeof map.venueLayoutId === 'string');
  const assignedSeatCount = overlayTiers.reduce((sum, tier) => sum + Number(tier.assignments), 0);
  const rawPriceTierNames = new Set(tiers.map((tier) => tier.tierName));
  const sellableSeatsMatch = usesOverlay
    ? assignedSeatCount === seatCount && overlayTiers.filter((tier) => Number(tier.assignments) > 0)
      .every((tier) => tier.price > 0 && priceByTier.get(tier.tierName.trim()) === tier.price)
    : maps.every((map) => rawSeatTierNames(map.seatConfig).every((name) => rawPriceTierNames.has(name)));
  const seatProblems = [
    unpricedTiers.length ? `0원 가격 등급: ${unpricedTiers.join(', ')}` : null,
    sellableSeatsMatch ? null : '판매 좌석 배정·가격이 입력값과 다름(좌석맵을 다시 저장해주세요)',
  ].filter((problem): problem is string => problem !== null);
  const policy = policies[0];
  const published = performance.publishState === 'published';
  const saleOpening = resolvePerformanceSaleOpening({ status: performance.status, bookingStartsAt: policy?.bookingStartsAt ?? null }, now);
  // A stored start that has already passed would open sales the moment an approver publishes.
  const elapsedStartBeforePublish = !published && saleOpening.mode === 'immediate' && saleOpening.startElapsed;
  // Legacy rows may still list VIRTUAL_ACCOUNT or MOBILE_PHONE, which checkout never submits.
  const hasPaymentMethods = (policy?.allowedPaymentMethods ?? []).some((method) =>
    (CHECKOUT_CONFIGURABLE_PAYMENT_METHODS as readonly string[]).includes(method));
  const checks: PerformancePreparation['checks'] = [
    { key: 'basic', label: '기본 정보', step: 'basic', ready: hasText(performance.title) && Boolean(performance.venueId)
      && hasText(performance.ageRating) && performance.startDate <= performance.endDate,
      detail: '공연명, 장소, 기간, 관람 연령을 확인합니다.' },
    { key: 'seats', label: '회차·좌석·가격', step: 'seats', ready: times.length > 0 && tiers.length > 0 && seatCount > 0
      && configurations.every((parsed) => parsed.success) && configuredSeats.every((tier) => priceByTier.has(tier.tierName))
      && seatProblems.length === 0,
      detail: [`${times.length}개 회차 · ${seatCount}석 · ${tiers.length}개 가격 등급`, ...seatProblems].join(' · ') },
    { key: 'locales', label: '한국어·영어 안내', step: 'content', ready: locales.slice(0, 2).every((locale) => locale.title && locale.description),
      detail: '현재 원문과 일치하는 검수·공개된 번역을 확인합니다.' },
    { key: 'sales', label: '판매 설정', step: 'seats', ready: hasPaymentMethods && !elapsedStartBeforePublish,
      detail: `${hasPaymentMethods ? '' : '결제 수단을 1개 이상 선택해주세요. '}${describeSaleOpening(saleOpening, published)}` },
  ];
  return { performanceId: id, title: performance.title, updatedAt: performance.updatedAt.toISOString(),
    publishState: performance.publishState, status: performance.status, bookingStartsAt: policy?.bookingStartsAt?.toISOString() ?? null,
    saleOpening,
    canPublish: checks.every((check) => check.ready), structureProtected: protection.protected, reservationCount: protection.reservationCount, checks, locales,
    history: logs.map((log) => ({ id: log.id, action: log.action, status: log.status, createdAt: log.createdAt.toISOString(), reason: log.reason })) };
}
