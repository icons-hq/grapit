import { Injectable, Inject } from '@nestjs/common';
import { sql, eq, inArray, and, gte, lt } from 'drizzle-orm';
import type {
  DashboardSummaryDto,
  DashboardRevenueDto,
  DashboardGenreDto,
  DashboardPaymentDto,
  DashboardTopDto,
  DashboardPeriod,
} from '@grabit/shared';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import {
  reservations,
  payments,
  performances,
  showtimes,
} from '../../database/schema/index.js';
import { CacheService } from '../performance/cache.service.js';
import {
  kstBoundaryToUtc,
  kstTodayBoundaryUtc,
  buildDailyBucketSkeleton,
  buildWeeklyBucketSkeleton,
} from './kst-boundary.js';

/**
 * D-12: 대시보드 캐시 TTL은 항상 60초. cache.set 호출 시 반드시 3번째 인자로 명시.
 */
const DASHBOARD_CACHE_TTL = 60;

/**
 * D-10: Top 10 공연은 최근 30일 고정 윈도우. 사용자 조절 없음.
 */
const TOP_PERFORMANCES_WINDOW_DAYS = 30;

function daysForPeriod(period: DashboardPeriod): number {
  return period === '7d' ? 7 : period === '30d' ? 30 : 90;
}

/**
 * AdminDashboardService — ADM-01~05 읽기 전용 집계 + ADM-06 60s read-through 캐시.
 *
 * 주요 설계 결정:
 *  - WHERE 절은 Node 측에서 pre-compute한 UTC Date boundary와 `reservations.createdAt`을
 *    raw 비교 → `(status, created_at)` index 활용 가능 (review MEDIUM 4).
 *  - GROUP BY의 bucket expression만 `AT TIME ZONE 'Asia/Seoul'`를 사용 (라벨링 목적).
 *  - 매출 추이는 Node 측 skeleton bucket과 DB 결과를 merge하여 빈 날짜/주를 0으로 채움
 *    (review MEDIUM 6).
 *  - 결제수단 분포는 `reservations.status=CONFIRMED AND payments.status=DONE` 두 조건을
 *    모두 요구 (review MEDIUM 5 / Pitfall 5).
 *  - 캐시 무효화 수동 호출 없음 — TTL-only (D-13).
 */
@Injectable()
export class AdminDashboardService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    @Inject(CacheService) private readonly cache: CacheService,
  ) {}

  private async readThrough<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const cached = await this.cache.get<T>(key);
    if (cached !== null) return cached;
    const fresh = await fetcher();
    // D-12: TTL 60초는 항상 명시적으로 전달.
    await this.cache.set(key, fresh, DASHBOARD_CACHE_TTL);
    return fresh;
  }

  // ADM-01 — 오늘 KPI 4종.
  async getSummary(): Promise<DashboardSummaryDto> {
    return this.readThrough('cache:admin:dashboard:summary', async () => {
      // Node 측 boundary pre-compute → raw createdAt 비교 (index eligible).
      const { startUtc, endUtc } = kstTodayBoundaryUtc();
      const todayCreatedAt = and(
        gte(reservations.createdAt, startUtc),
        lt(reservations.createdAt, endUtc),
      );

      // 4-way fan-out (병렬)
      const [bookings, revenue, cancelled, active] = await Promise.all([
        this.db
          .select({ count: sql<number>`count(*)::int` })
          .from(reservations)
          .where(todayCreatedAt),
        this.db
          .select({
            sum: sql<number>`coalesce(sum(${reservations.totalAmount}), 0)::int`,
          })
          .from(reservations)
          // D-07: 매출은 CONFIRMED만 합산.
          .where(and(todayCreatedAt, eq(reservations.status, 'CONFIRMED'))),
        this.db
          .select({ count: sql<number>`count(*)::int` })
          .from(reservations)
          .where(and(todayCreatedAt, eq(reservations.status, 'CANCELLED'))),
        // "활성 공연" = status IN ('selling', 'closing_soon') (RESEARCH Pitfall 6, A2).
        this.db
          .select({ count: sql<number>`count(*)::int` })
          .from(performances)
          .where(inArray(performances.status, ['selling', 'closing_soon'])),
      ]);

      return {
        todayBookings: bookings[0]?.count ?? 0,
        todayRevenue: revenue[0]?.sum ?? 0,
        todayCancelled: cancelled[0]?.count ?? 0,
        activePerformances: active[0]?.count ?? 0,
      };
    });
  }

  // ADM-02 — 매출 추이 (일별/주별 + 빈 bucket 0으로 채움).
  async getRevenueTrend(period: DashboardPeriod): Promise<DashboardRevenueDto> {
    return this.readThrough(`cache:admin:dashboard:revenue:${period}`, async () => {
      // D-09: 7d/30d = day, 90d = week.
      const granularity: 'day' | 'week' = period === '90d' ? 'week' : 'day';
      const days = daysForPeriod(period);
      const { startUtc, endUtc } = kstBoundaryToUtc(days);

      // bucket expression (GROUP BY / SELECT 라벨 용도). sql.raw로 순수 문자열 조각만 사용하여
      // 직렬화 시 순환 참조(PgColumn -> PgTable)가 생기지 않도록 한다. granularity는
      // zod enum에서 derive된 리터럴이라 sql.raw 안전 (Pitfall 8).
      // WHERE 절은 아래에서 여전히 raw createdAt 컬럼 비교로 index를 활용한다.
      const bucketFormat = granularity === 'week' ? 'IYYY-"W"IW' : 'YYYY-MM-DD';
      const bucketExpr = sql.raw(
        `date_trunc('${granularity}', reservations.created_at AT TIME ZONE 'Asia/Seoul')`,
      );
      const bucketLabel = sql.raw(
        `to_char(date_trunc('${granularity}', reservations.created_at AT TIME ZONE 'Asia/Seoul'), '${bucketFormat}')`,
      );

      const rows = await this.db
        .select({
          bucket: sql<string>`${bucketLabel}`,
          revenue: sql<number>`coalesce(sum(reservations.total_amount), 0)::int`,
          count: sql<number>`count(*)::int`,
        })
        .from(reservations)
        // review MEDIUM 4: WHERE는 raw createdAt 비교 (index eligible).
        .where(
          and(
            eq(reservations.status, 'CONFIRMED'),
            gte(reservations.createdAt, startUtc),
            lt(reservations.createdAt, endUtc),
          ),
        )
        .groupBy(bucketExpr)
        .orderBy(bucketExpr);

      // review MEDIUM 6: skeleton으로 빈 날짜/주 0으로 채움.
      const skeleton =
        granularity === 'week'
          ? buildWeeklyBucketSkeleton(Math.ceil(days / 7))
          : buildDailyBucketSkeleton(days);
      const rowMap = new Map(rows.map((r) => [r.bucket, r]));
      return skeleton.map(
        (b) => rowMap.get(b) ?? { bucket: b, revenue: 0, count: 0 },
      );
    });
  }

  // ADM-03 — 분류별 분포 (D-11: revenue 기간 필터 공유).
  async getGenreDistribution(period: DashboardPeriod): Promise<DashboardGenreDto> {
    return this.readThrough(`cache:admin:dashboard:genre:${period}`, async () => {
      const days = daysForPeriod(period);
      const { startUtc, endUtc } = kstBoundaryToUtc(days);
      const rows = await this.db
        .select({
          genre: sql<string>`${performances.genre}::text`,
          count: sql<number>`count(${reservations.id})::int`,
        })
        .from(reservations)
        .innerJoin(showtimes, eq(reservations.showtimeId, showtimes.id))
        .innerJoin(performances, eq(showtimes.performanceId, performances.id))
        .where(
          and(
            eq(reservations.status, 'CONFIRMED'),
            gte(reservations.createdAt, startUtc),
            lt(reservations.createdAt, endUtc),
          ),
        )
        .groupBy(performances.genre)
        .orderBy(sql`count(${reservations.id}) desc`);
      return rows;
    });
  }

  // ADM-05 — 결제수단 분포 (review MEDIUM 5 / Pitfall 5).
  async getPaymentDistribution(
    period: DashboardPeriod,
  ): Promise<DashboardPaymentDto> {
    return this.readThrough(
      `cache:admin:dashboard:payment:${period}`,
      async () => {
        const days = daysForPeriod(period);
        const { startUtc, endUtc } = kstBoundaryToUtc(days);
        // WR-03: 기존에는 raw SQL fragment로 `reservations.status`, `payments.status`,
        // `reservations.created_at` 식별자를 하드코드했다. 값은 parameter bind라 안전했지만
        // 식별자가 문자열이라 Drizzle이 subquery/CTE 등에서 테이블을 alias하면 조용히 깨질
        // 위험이 있었다. 타입된 `and(eq(...))` 조합으로 재작성해 같은 index(`idx_reservations_status`,
        // `reservations.created_at`)를 계속 탈 수 있게 하면서 식별자 fragility를 제거한다
        // (review MEDIUM 5 / Pitfall 5 — CONFIRMED + DONE 두 조건 동시 요구).
        const rows = await this.db
          .select({
            method: payments.method,
            count: sql<number>`count(*)::int`,
          })
          .from(payments)
          .innerJoin(reservations, eq(payments.reservationId, reservations.id))
          .where(
            and(
              eq(reservations.status, 'CONFIRMED'),
              eq(payments.status, 'DONE'),
              gte(reservations.createdAt, startUtc),
              lt(reservations.createdAt, endUtc),
            ),
          )
          .groupBy(payments.method)
          .orderBy(sql`count(*) desc`);
        return rows;
      },
    );
  }

  // ADM-04 — Top 10 공연 (D-10: 최근 30일 고정).
  async getTopPerformances(): Promise<DashboardTopDto> {
    return this.readThrough('cache:admin:dashboard:top10', async () => {
      const { startUtc, endUtc } = kstBoundaryToUtc(TOP_PERFORMANCES_WINDOW_DAYS);
      const rows = await this.db
        .select({
          performanceId: performances.id,
          title: performances.title,
          genre: sql<string>`${performances.genre}::text`,
          posterUrl: performances.posterUrl,
          bookingCount: sql<number>`count(${reservations.id})::int`,
        })
        .from(reservations)
        .innerJoin(showtimes, eq(reservations.showtimeId, showtimes.id))
        .innerJoin(performances, eq(showtimes.performanceId, performances.id))
        .where(
          and(
            eq(reservations.status, 'CONFIRMED'),
            gte(reservations.createdAt, startUtc),
            lt(reservations.createdAt, endUtc),
          ),
        )
        .groupBy(
          performances.id,
          performances.title,
          performances.genre,
          performances.posterUrl,
        )
        .orderBy(sql`count(${reservations.id}) desc`)
        .limit(10);
      return rows;
    });
  }
}
