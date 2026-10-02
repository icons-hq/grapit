/**
 * KST(Asia/Seoul) 자정 경계를 UTC Date로 pre-compute하는 헬퍼.
 *
 * WHERE 절에서 `reservations.createdAt` 컬럼과 UTC Date를 직접 비교하여
 * `(status, created_at)` index가 그대로 활용되도록 한다. `AT TIME ZONE
 * 'Asia/Seoul'` 로 컬럼을 래핑하면 index가 무력화되므로 (review MEDIUM 4),
 * boundary 계산은 Node 측에서 진행하고 DB에는 raw Date만 전달한다.
 *
 * 또한 revenue-trend의 bucket skeleton (일별/주별 빈 날짜 0 채움)도
 * 이 모듈에서 제공한다 (review MEDIUM 6).
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

/**
 * Returns UTC Date boundaries for an N-day window ending at "tomorrow 00:00 KST" (exclusive).
 *
 * Use as:
 *   where(and(
 *     gte(reservations.createdAt, startUtc),
 *     lt(reservations.createdAt, endUtc),
 *   ))
 *
 * 컬럼이 그대로 비교 대상이므로 (status, created_at) index eligible.
 *
 * @param days 윈도우 길이(일). `1` = 오늘만, `7` = 오늘 포함 최근 7일, `30` = 오늘 포함 최근 30일.
 *             `days < 1` 은 비어 있는 윈도우가 되어 의미가 없으므로 에러를 throw 한다.
 */
export function kstBoundaryToUtc(days: number): { startUtc: Date; endUtc: Date } {
  if (!Number.isInteger(days) || days < 1) {
    throw new RangeError(
      `kstBoundaryToUtc: days must be a positive integer (got ${String(days)})`,
    );
  }
  const nowUtcMs = Date.now();
  const nowKstMs = nowUtcMs + KST_OFFSET_MS;
  // KST 기준 오늘 00:00 (자정)의 KST epoch ms.
  const kstTodayStartMs = Math.floor(nowKstMs / DAY_MS) * DAY_MS;
  // 내일 00:00 KST = endUtc.
  const kstEndOfTodayMs = kstTodayStartMs + DAY_MS;
  // startUtc = (내일 KST 00:00) - days * 24h. days=1 이면 오늘 00:00 KST.
  const kstStartMs = kstEndOfTodayMs - days * DAY_MS;
  return {
    startUtc: new Date(kstStartMs - KST_OFFSET_MS),
    endUtc: new Date(kstEndOfTodayMs - KST_OFFSET_MS),
  };
}

/**
 * "오늘 KST 00:00" ~ "내일 KST 00:00" UTC boundary.
 * 오늘 하루만 집계할 때 사용.
 *
 * NOTE: `kstBoundaryToUtc(1)` 을 호출한다. 과거에 `kstBoundaryToUtc(0)` 이었을 때는
 * `startUtc === endUtc` 가 되어 WHERE 절이 항상 empty였다. `days` 는 윈도우 길이이므로
 * "오늘만" 은 `1` 이다.
 */
export function kstTodayBoundaryUtc(): { startUtc: Date; endUtc: Date } {
  return kstBoundaryToUtc(1);
}

/**
 * YYYY-MM-DD bucket list in KST for the last `days` days, inclusive of today.
 * Returned ASC by date (가장 오래된 날짜가 맨 앞).
 *
 * review MEDIUM 6: DB 결과에 없는 날짜도 0 revenue로 표시하기 위한 skeleton.
 */
export function buildDailyBucketSkeleton(days: number): string[] {
  const nowKstMs = Date.now() + KST_OFFSET_MS;
  const todayStartMs = Math.floor(nowKstMs / DAY_MS) * DAY_MS;
  const buckets: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const dayMs = todayStartMs - i * DAY_MS;
    // KST epoch ms를 UTC Date로 해석해 YYYY-MM-DD 추출.
    const kst = new Date(dayMs);
    const y = kst.getUTCFullYear();
    const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
    const d = String(kst.getUTCDate()).padStart(2, '0');
    buckets.push(`${y}-${m}-${d}`);
  }
  return buckets;
}

/**
 * ISO 8601 week label ("2026-W17") of a KST calendar day, aligned with
 * Postgres `to_char(date_trunc('week', ts), 'IYYY-"W"IW')`.
 *
 * Rule: "week 1 of ISO year Y is the week containing the first Thursday of Y"
 * (equivalently, the week containing Jan 4). Weeks roll across calendar-year
 * boundaries — e.g. the week of 2026-12-28..2027-01-03 is 2026-W53 even though
 * it contains Jan 1 2027 (WR-02).
 *
 * @param kstDayStartMs KST epoch ms of the day's 00:00 (UTC fields = KST date).
 */
function isoWeekLabelForKstDay(kstDayStartMs: number): string {
  const kst = new Date(kstDayStartMs);
  // 1) `target` is the Thursday of the ISO week we want to label. The ISO year
  //    is whatever calendar year that Thursday falls in.
  // 2) `week1Monday` = Monday of ISO week 1 of that ISO year, derived from Jan 4.
  // 3) weekNum = ((targetMonday - week1Monday) / 7 days) + 1.
  const target = new Date(
    Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()),
  );
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum); // move to Thursday
  const isoYear = target.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  const targetMonday = new Date(target);
  targetMonday.setUTCDate(target.getUTCDate() - 3); // Thu -> Mon
  const weekNum =
    Math.round((targetMonday.getTime() - week1Monday.getTime()) / (7 * DAY_MS)) + 1;
  return `${isoYear}-W${String(weekNum).padStart(2, '0')}`;
}

/**
 * ISO week bucket list (e.g. "2026-W17") for the last `weeks` weeks in KST.
 * Postgres `to_char(..., 'IYYY-"W"IW')` 결과와 동일한 형식을 목표로 한다.
 *
 * NOTE: 매출 추이처럼 `kstBoundaryToUtc(days)` 윈도우와 맞춰야 하는 경우에는
 * `buildWeeklyBucketSkeletonForWindow(days)` 를 사용한다. `ceil(days / 7)` 주를
 * 오늘부터 7일 간격으로 세면 윈도우 시작일이 속한 가장 오래된 부분 주가 빠진다.
 */
export function buildWeeklyBucketSkeleton(weeks: number): string[] {
  const nowKstMs = Date.now() + KST_OFFSET_MS;
  const todayStartMs = Math.floor(nowKstMs / DAY_MS) * DAY_MS;
  const buckets: string[] = [];
  const seen = new Set<string>();
  for (let i = weeks - 1; i >= 0; i -= 1) {
    const label = isoWeekLabelForKstDay(todayStartMs - i * 7 * DAY_MS);
    if (!seen.has(label)) {
      seen.add(label);
      buckets.push(label);
    }
  }
  return buckets;
}

/**
 * Every ISO week (ASC) that overlaps the `days`-day KST window ending today,
 * i.e. the same window as `kstBoundaryToUtc(days)`. The oldest bucket is the
 * (possibly partial) week containing `today - (days - 1)`.
 *
 * review MEDIUM 6: 90d period에서 빈 주 0 revenue 채움용.
 */
export function buildWeeklyBucketSkeletonForWindow(days: number): string[] {
  if (!Number.isInteger(days) || days < 1) {
    throw new RangeError(
      `buildWeeklyBucketSkeletonForWindow: days must be a positive integer (got ${String(days)})`,
    );
  }
  const nowKstMs = Date.now() + KST_OFFSET_MS;
  const todayStartMs = Math.floor(nowKstMs / DAY_MS) * DAY_MS;
  const buckets: string[] = [];
  const seen = new Set<string>();
  for (let i = days - 1; i >= 0; i -= 1) {
    const label = isoWeekLabelForKstDay(todayStartMs - i * DAY_MS);
    if (!seen.has(label)) {
      seen.add(label);
      buckets.push(label);
    }
  }
  return buckets;
}
