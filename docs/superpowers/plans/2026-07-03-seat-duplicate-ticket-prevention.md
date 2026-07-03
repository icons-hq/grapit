# 좌석 중복 발권 재발 방지 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) 문법으로 추적한다.

**Goal:** 취소/해제 경로가 다른 예매가 소유한 sold 좌석을 available로 되돌리는 것을 코드 가드 + DB 부분 유니크 인덱스로 이중 차단한다.

**Architecture:** (1) `seat_inventories` 해제(available/held_cancelled 전환) 지점 5곳 전부에 "같은 좌석에 유효 ticket_items가 없을 때만" 상관 서브쿼리(NOT EXISTS) 가드를 추가한다. (2) `ticket_items`에 `(showtime_id, floor_key, seat_key)` 부분 유니크 인덱스(status가 active/cancellation_pending일 때)를 추가해 마지막 방어선을 만든다. (3) 판매 확정 경로에서 이 인덱스 위반(23505)을 기존 `ConflictException` 보상 흐름으로 매핑한다.

**Tech Stack:** NestJS 11, Drizzle ORM 0.4x + drizzle-kit, PostgreSQL 16, vitest.

## 근본 원인 (요약)

- 판매 확정은 `available → sold`만 허용하고 충돌 시 `ConflictException`을 던지므로 안전하다 (`reservation-finalization.service.ts:707`, `payment.service.ts:1777`).
- 그러나 해제 경로들은 좌석 identity(`showtime + floor + seat`)만으로 공유 행인 `seat_inventories`를 갱신하며, **현재 그 좌석을 소유한 유효 ticket_items가 있는지 확인하지 않는다.** 오래된 동일 좌석 예매의 취소/정리가 새 판매 이후에 실행되면 sold 좌석이 다시 열리고, 이후 정상 결제로 중복 발권이 발생한다 (프로덕션 7건 확인, 핸드오프 문서 참조).
- DB에도 "동일 좌석에 유효 티켓 1장" 불변식이 없다 (`ticket_items` 유니크는 `(reservation_id, seat_key)`뿐).

### 해제 경로 인벤토리와 현재 가드

| 경로 | 파일:라인 | 현재 가드 | sold 좌석 오염 가능 |
|------|-----------|-----------|---------------------|
| 전액취소 finalizer `sold → held_cancelled` | `apps/api/src/modules/cancellation/payment-cancellation-finalizer.service.ts:480` | `status='sold'` (소유권 확인 없음) | **가능** |
| finalizer `held_cancelled` 재무장 | 동일 파일 `:514` | `status='held_cancelled'` | 간접 (release 재무장) |
| 지연 해제 워커 `held_cancelled → available` | `apps/api/src/modules/jobs/cancelled-seat-release.worker.ts:149` | `status='held_cancelled'` + `reopenJobId` | 모순 상태 시 가능 |
| 티켓아이템 취소 → `available` | `apps/api/src/modules/reservation/reservation.service.ts:2537` | **상태 가드 없음** | **가능** |
| 레거시 전체예매 취소 → `available` | `apps/api/src/modules/reservation/reservation.service.ts:2764` | **상태 가드 없음** | **가능** |
| 관리자 수동 오픈 | `apps/api/src/modules/admin/admin-booking.service.ts:2018` | `status='held_cancelled'` | 모순 상태 시 가능 |
| 관리자 좌석 활성/비활성 | `apps/api/src/modules/admin/admin-seat-operations.service.ts:340` | `available↔disabled`만 허용 | 불가 (수정 불필요) |

## Global Constraints

- pnpm 모노레포. 모든 명령은 레포 루트에서 `pnpm --filter @grabit/api ...`로 실행.
- drizzle-kit은 `DOTENV_CONFIG_PATH=../../.env` 지정 필수 (CLAUDE.md Conventions).
- 기존 dirty 상태(`M pnpm-workspace.yaml`, `?? output/`)는 커밋에 포함하지 않는다.
- 커밋 메시지는 기존 컨벤션(`fix(booking): ...` 한국어 제목)을 따른다.
- **배포 게이트:** Task 8의 마이그레이션은 프로덕션 중복 7건 정리(운영 결정: 좌석별 유효 티켓 선정 + 환불/재배정) 전에는 프로덕션에 적용하면 안 된다. Task 1~7 코드 가드는 즉시 배포 가능하며 데이터 정리와 독립적이다.

---

### Task 1: 좌석 소유권 가드 헬퍼

**Files:**
- Create: `apps/api/src/database/seat-ownership.ts`
- Test: `apps/api/src/database/seat-ownership.spec.ts`

**Interfaces:**
- Produces: `ACTIVE_TICKET_ITEM_STATUSES: readonly ['active', 'cancellation_pending']`
- Produces: `ACTIVE_SEAT_UNIQUE_INDEX = 'uq_ticket_items_active_seat'` (Task 8의 인덱스 이름과 반드시 일치)
- Produces: `noActiveTicketItemOnSeat(): SQL` — `seat_inventories` UPDATE의 WHERE 절 전용 상관 NOT EXISTS 조건
- Produces: `isActiveSeatUniqueViolation(error: unknown): boolean` — pg 23505 + 해당 인덱스 위반 판별 (drizzle 래핑 `cause` 체인 포함)

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// apps/api/src/database/seat-ownership.spec.ts
import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  ACTIVE_SEAT_UNIQUE_INDEX,
  isActiveSeatUniqueViolation,
  noActiveTicketItemOnSeat,
} from './seat-ownership.js';

describe('noActiveTicketItemOnSeat', () => {
  it('renders a correlated NOT EXISTS guard against active ticket items', () => {
    const rendered = new PgDialect().sqlToQuery(noActiveTicketItemOnSeat());

    expect(rendered.sql).toContain('not exists');
    expect(rendered.sql).toContain('"ticket_items"');
    expect(rendered.sql).toContain('"seat_inventories"."seat_key"');
    expect(rendered.sql).toContain("'active'");
    expect(rendered.sql).toContain("'cancellation_pending'");
  });
});

describe('isActiveSeatUniqueViolation', () => {
  it('matches a pg unique violation on the active seat index', () => {
    const error = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: ACTIVE_SEAT_UNIQUE_INDEX,
    });
    expect(isActiveSeatUniqueViolation(error)).toBe(true);
  });

  it('matches when the pg error is wrapped as a cause', () => {
    const cause = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: ACTIVE_SEAT_UNIQUE_INDEX,
    });
    expect(isActiveSeatUniqueViolation(new Error('query failed', { cause }))).toBe(true);
  });

  it('rejects other unique violations and non-errors', () => {
    expect(isActiveSeatUniqueViolation(Object.assign(new Error('x'), {
      code: '23505',
      constraint: 'idx_ticket_items_reservation_seat',
    }))).toBe(false);
    expect(isActiveSeatUniqueViolation(null)).toBe(false);
    expect(isActiveSeatUniqueViolation(new Error('plain'))).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @grabit/api exec vitest run src/database/seat-ownership.spec.ts`
Expected: FAIL — `Cannot find module './seat-ownership.js'`

- [ ] **Step 3: 최소 구현**

```ts
// apps/api/src/database/seat-ownership.ts
import { sql, type SQL } from 'drizzle-orm';
import { seatInventories } from './schema/seat-inventories.js';
import { ticketItems } from './schema/ticket-items.js';

export const ACTIVE_TICKET_ITEM_STATUSES = ['active', 'cancellation_pending'] as const;

export const ACTIVE_SEAT_UNIQUE_INDEX = 'uq_ticket_items_active_seat';

/**
 * seat_inventories 해제(available/held_cancelled 전환) 전, 같은 좌석을 점유 중인
 * 유효(active/cancellation_pending) ticket_items가 없음을 보장하는 상관 조건.
 * seat_inventories를 대상으로 하는 UPDATE의 WHERE 절에서만 사용해야 한다.
 */
export function noActiveTicketItemOnSeat(): SQL {
  return sql`not exists (
    select 1 from ${ticketItems}
    where ${ticketItems.showtimeId} = ${seatInventories.showtimeId}
      and ${ticketItems.floorKey} = ${seatInventories.floorKey}
      and ${ticketItems.seatKey} = ${seatInventories.seatKey}
      and ${ticketItems.status} in ('active', 'cancellation_pending')
  )`;
}

export function isActiveSeatUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current; depth += 1) {
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (candidate.code === '23505' && candidate.constraint === ACTIVE_SEAT_UNIQUE_INDEX) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @grabit/api exec vitest run src/database/seat-ownership.spec.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/database/seat-ownership.ts apps/api/src/database/seat-ownership.spec.ts
git commit -m "feat(booking): 좌석 해제 소유권 가드 헬퍼 추가"
```

---

### Task 2: 지연 해제 워커 가드

**Files:**
- Modify: `apps/api/src/modules/jobs/cancelled-seat-release.worker.ts:141-181` (`releaseHeldSeats`)
- Test: `apps/api/src/modules/jobs/cancelled-seat-release.worker.spec.ts` (기존 spec에 테스트 추가)

**Interfaces:**
- Consumes: `noActiveTicketItemOnSeat()` (Task 1)
- 동작 변경: 유효 티켓이 점유 중인 좌석은 `held_cancelled`인 채로 두고 released 목록/broadcast에서 제외 + warn 로그.

- [ ] **Step 1: 실패하는 테스트 작성** — 기존 spec 파일 하단에 추가

```ts
// cancelled-seat-release.worker.spec.ts 에 추가
// 상단 import에 추가: import { PgDialect } from 'drizzle-orm/pg-core';
//                    import type { SQL } from 'drizzle-orm';

it('does not release a seat and includes the active-ticket guard in the where clause', async () => {
  const whereArgs: unknown[] = [];
  const db = {
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn((condition: unknown) => {
          whereArgs.push(condition);
          return { returning: vi.fn().mockResolvedValue([]) };
        }),
      })),
    })),
  };
  const worker = new CancelledSeatReleaseWorker(db as never);

  const released = await (worker as unknown as {
    releaseHeldSeats: (
      showtimeId: string,
      seatIdentities: Array<{ floorKey: string; seatId: string; seatKey: string }>,
      releaseJobId: string,
    ) => Promise<unknown[]>;
  }).releaseHeldSeats(
    'showtime-1',
    [{ floorKey: '1F', seatId: 'A-10', seatKey: '1F:A-10' }],
    'release-job-1',
  );

  expect(released).toEqual([]);
  const renderedWhere = new PgDialect().sqlToQuery(whereArgs[0] as SQL).sql;
  expect(renderedWhere).toContain('not exists');
  expect(renderedWhere).toContain('"ticket_items"');
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @grabit/api exec vitest run src/modules/jobs/cancelled-seat-release.worker.spec.ts`
Expected: FAIL — rendered where에 `not exists` 없음

- [ ] **Step 3: 구현** — `releaseHeldSeats`의 where에 가드 추가 + 미해제 좌석 warn

```ts
// cancelled-seat-release.worker.ts
// import 추가:
import { noActiveTicketItemOnSeat } from '../../database/seat-ownership.js';

// releaseHeldSeats 루프의 .where(...)를 다음으로 교체:
        .where(
          and(
            eq(seatInventories.showtimeId, showtimeId),
            eq(seatInventories.floorKey, seatIdentity.floorKey),
            eq(seatInventories.seatKey, seatIdentity.seatKey),
            eq(seatInventories.status, 'held_cancelled'),
            eq(seatInventories.reopenJobId, releaseJobId),
            noActiveTicketItemOnSeat(),
          ),
        )

// 루프 내부, released.length === 0인 경우 warn 추가:
      if (released.length > 0) {
        releasedSeats.push(seatIdentity);
      } else {
        this.logger.warn(
          `Skipped cancelled-seat release: seat is not releasable (active ticket item or state changed). showtimeId=${showtimeId}, seatKey=${seatIdentity.seatKey}, releaseJobId=${releaseJobId}`,
        );
      }
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @grabit/api exec vitest run src/modules/jobs/cancelled-seat-release.worker.spec.ts`
Expected: PASS (기존 테스트 포함 전체)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/jobs/cancelled-seat-release.worker.ts apps/api/src/modules/jobs/cancelled-seat-release.worker.spec.ts
git commit -m "fix(booking): 지연 좌석 해제 시 유효 티켓 점유 좌석 보호"
```

---

### Task 3: 전액취소 finalizer 가드 + 타 예매 소유 좌석 스킵

**Files:**
- Modify: `apps/api/src/modules/cancellation/payment-cancellation-finalizer.service.ts:480-546` (seat 해제 루프)
- Test: `apps/api/src/modules/cancellation/payment-cancellation-finalizer.service.spec.ts` (기존 spec에 테스트 추가)

**Interfaces:**
- Consumes: `noActiveTicketItemOnSeat()`, `ACTIVE_TICKET_ITEM_STATUSES` (Task 1)
- 동작 변경: `sold → held_cancelled`와 `held_cancelled` 재무장 모두 가드. 두 UPDATE가 모두 0행이고 **다른 예매의 유효 티켓이 좌석을 점유 중이면** 예외 대신 warn 로그 후 해당 좌석만 건너뛴다(환불 흐름은 계속 진행). 점유자도 없으면 기존대로 `BadRequestException`.

- [ ] **Step 1: 실패하는 테스트 작성** — 기존 spec의 mock 헬퍼(`createContext`, UpdateCall 캡처 패턴)를 재사용해 추가. 핵심 시나리오:

```ts
// payment-cancellation-finalizer.service.spec.ts 에 추가
// (이 spec의 기존 db/tx mock 빌더를 그대로 사용하되, seatInventories 대상 update 2회가
//  모두 빈 배열을 반환하고, ticketItems 대상 select가 타 예매 소유자를 반환하도록 구성)

it('skips seat release without throwing when another reservation actively owns the seat', async () => {
  // 1) seatInventories update(sold→held_cancelled) → returning []
  // 2) seatInventories update(held_cancelled 재무장) → returning []
  // 3) ticketItems select(active owner 확인) → [{ reservationId: 'other-reservation' }]
  // 기대: finalizeFullPaymentCancellation이 reject되지 않고 완료되고,
  //       해당 좌석은 release job 대상(seatReleaseStates)에 포함되지 않는다.
  //       또한 두 update의 where 렌더링에 'not exists'가 포함된다.
});

it('still throws when seat inventory rows are missing and no active owner exists', async () => {
  // 위와 동일하되 3) select → [] 반환.
  // 기대: '취소할 좌석 재고 상태가 유효하지 않습니다' BadRequestException 유지.
});
```

두 테스트 모두 기존 spec의 전액취소 성공 테스트 하나를 복제한 뒤 seat 관련 mock만 위처럼 바꿔 완성한다. where 렌더링 검증은 Task 2와 동일하게 `new PgDialect().sqlToQuery(...)` 사용.

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @grabit/api exec vitest run src/modules/cancellation/payment-cancellation-finalizer.service.spec.ts`
Expected: FAIL — 첫 테스트는 BadRequestException으로 reject, 둘째는 where에 not exists 없음

- [ ] **Step 3: 구현** — 좌석 해제 루프 교체

```ts
// payment-cancellation-finalizer.service.ts
// import 추가:
import {
  ACTIVE_TICKET_ITEM_STATUSES,
  noActiveTicketItemOnSeat,
} from '../../database/seat-ownership.js';

// for (const seatIdentity of seatIdentities) { ... } 루프를 다음으로 교체:
      for (const seatIdentity of seatIdentities) {
        const updatedSoldSeatInventory = await tx
          .update(seatInventories)
          .set({
            status: 'held_cancelled',
            lockedBy: null,
            lockedUntil: null,
            soldAt: null,
            heldCancelledAt: now,
            reopenHoldUntil: releaseAt,
            reopenJobId: JOB_ENQUEUE_FAILED,
          })
          .where(
            and(
              eq(seatInventories.showtimeId, input.context.reservation.showtimeId),
              eq(seatInventories.floorKey, seatIdentity.floorKey),
              eq(seatInventories.seatKey, seatIdentity.seatKey),
              eq(seatInventories.status, 'sold'),
              noActiveTicketItemOnSeat(),
            ),
          )
          .returning({ id: seatInventories.id });

        if (updatedSoldSeatInventory.length === 1) {
          seatReleaseStates.push({
            seatIdentity,
            reopenJobId: JOB_ENQUEUE_FAILED,
          });
          continue;
        }

        if (updatedSoldSeatInventory.length > 1) {
          throw new BadRequestException('취소할 좌석 재고 상태가 유효하지 않습니다');
        }

        const updatedHeldCancelledSeatInventory = await tx
          .update(seatInventories)
          .set({
            status: 'held_cancelled',
            lockedBy: null,
            lockedUntil: null,
            soldAt: null,
            heldCancelledAt: sql`coalesce(${seatInventories.heldCancelledAt}, ${now})`,
            reopenHoldUntil: sql`case when ${seatInventories.reopenJobId} is not null and ${seatInventories.reopenJobId} <> ${JOB_ENQUEUE_FAILED} then ${seatInventories.reopenHoldUntil} else ${releaseAt} end`,
            reopenJobId: sql`case when ${seatInventories.reopenJobId} is not null and ${seatInventories.reopenJobId} <> ${JOB_ENQUEUE_FAILED} then ${seatInventories.reopenJobId} else ${JOB_ENQUEUE_FAILED} end`,
          })
          .where(
            and(
              eq(seatInventories.showtimeId, input.context.reservation.showtimeId),
              eq(seatInventories.floorKey, seatIdentity.floorKey),
              eq(seatInventories.seatKey, seatIdentity.seatKey),
              eq(seatInventories.status, 'held_cancelled'),
              noActiveTicketItemOnSeat(),
            ),
          )
          .returning({
            id: seatInventories.id,
            reopenJobId: seatInventories.reopenJobId,
          });

        if (updatedHeldCancelledSeatInventory.length === 1) {
          seatReleaseStates.push({
            seatIdentity,
            reopenJobId: updatedHeldCancelledSeatInventory[0]?.reopenJobId ?? JOB_ENQUEUE_FAILED,
          });
          continue;
        }

        // 같은 좌석이 이미 다른 예매의 유효 티켓 소유라면 좌석 해제만 건너뛰고
        // 환불/취소 확정은 계속 진행한다 (중복 발권 방지의 핵심 가드).
        const [activeOwner] = await tx
          .select({ reservationId: ticketItems.reservationId })
          .from(ticketItems)
          .where(
            and(
              eq(ticketItems.showtimeId, input.context.reservation.showtimeId),
              eq(ticketItems.floorKey, seatIdentity.floorKey),
              eq(ticketItems.seatKey, seatIdentity.seatKey),
              inArray(ticketItems.status, [...ACTIVE_TICKET_ITEM_STATUSES]),
            ),
          )
          .limit(1);

        if (activeOwner) {
          this.logger.warn(
            `Seat release skipped: seat is owned by an active ticket item of another reservation. showtimeId=${input.context.reservation.showtimeId}, seatKey=${seatIdentity.seatKey}, cancelledReservationId=${input.context.reservation.id}, ownerReservationId=${activeOwner.reservationId}`,
          );
          continue;
        }

        throw new BadRequestException('취소할 좌석 재고 상태가 유효하지 않습니다');
      }
```

`inArray`, `ticketItems`가 import되어 있는지 확인하고 없으면 추가한다 (`ticketItems`는 이미 이 파일에서 사용 중).

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @grabit/api exec vitest run src/modules/cancellation/payment-cancellation-finalizer.service.spec.ts`
Expected: PASS (기존 테스트 포함 전체)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/cancellation/payment-cancellation-finalizer.service.ts apps/api/src/modules/cancellation/payment-cancellation-finalizer.service.spec.ts
git commit -m "fix(refund): 전액취소 확정 시 타 예매 소유 좌석 해제 차단"
```

---

### Task 4: 티켓아이템 취소 경로 가드

**Files:**
- Modify: `apps/api/src/modules/reservation/reservation.service.ts:2537-2578` (티켓아이템 취소 tx의 seat_inventories 갱신)
- Test: `apps/api/src/modules/reservation/reservation.service.spec.ts` (기존 spec에 테스트 추가)

**Interfaces:**
- Consumes: `noActiveTicketItemOnSeat()` (Task 1)
- 동작 변경: 상태 필터(`sold`/`held_cancelled`) + 소유권 가드 추가. 실제로 해제된 경우에만 `available` broadcast (가드로 0행이면 broadcast 생략 + warn).

- [ ] **Step 1: 실패하는 테스트 작성** — 기존 spec의 티켓아이템 취소 성공 테스트를 복제해, seatInventories update가 `returning([])`을 반환하도록 바꾸고 다음을 기대:

```ts
it('does not broadcast available when the seat is still owned by an active ticket item', async () => {
  // seatInventories 대상 tx.update(...).where(...).returning() → [] 로 mock.
  // 기대 1: bookingGateway.broadcastSeatUpdate가 호출되지 않는다.
  // 기대 2: 캡처한 where 렌더링에 'not exists'와 seat_inventories status 필터가 포함된다.
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @grabit/api exec vitest run src/modules/reservation/reservation.service.spec.ts`
Expected: FAIL — broadcast가 호출되거나 where에 not exists 없음

- [ ] **Step 3: 구현**

```ts
// reservation.service.ts (티켓아이템 취소 tx 내부, 2537 부근)
// import 추가:
import { noActiveTicketItemOnSeat } from '../../database/seat-ownership.js';

// 기존 무조건 update를 다음으로 교체:
        const freedSeatInventories = await tx
          .update(seatInventories)
          .set({
            status: 'available',
            soldAt: null,
            lockedBy: null,
            lockedUntil: null,
            reopenHoldUntil: null,
            reopenJobId: null,
            heldCancelledAt: null,
          })
          .where(
            and(
              eq(seatInventories.showtimeId, committedCancellation.context.showtimeId),
              eq(seatInventories.floorKey, committedCancellation.context.floorKey),
              or(
                eq(seatInventories.seatKey, committedCancellation.context.seatKey),
                and(
                  sql`${seatInventories.seatKey} IS NULL`,
                  eq(seatInventories.seatId, committedCancellation.context.seatId),
                ),
              ),
              inArray(seatInventories.status, ['sold', 'held_cancelled']),
              noActiveTicketItemOnSeat(),
            ),
          )
          .returning({ id: seatInventories.id });

        if (freedSeatInventories.length === 0) {
          this.logger.warn(
            `Seat inventory not reopened on ticket-item cancel (ownership guard). ticketItemId=${ticketItemId}, seatKey=${committedCancellation.context.seatKey}`,
          );
        }

// tx 콜백의 return을 조건부로 교체:
        return freedSeatInventories.length > 0
          ? {
              showtimeId: committedCancellation.context.showtimeId,
              seatKey: committedCancellation.context.seatKey,
            }
          : null;
```

`seatToBroadcast` 선언이 null 허용인지 확인한다 (`if (seatToBroadcast)` 분기가 이미 있으므로 대부분 그대로 동작).

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @grabit/api exec vitest run src/modules/reservation/reservation.service.spec.ts`
Expected: PASS (기존 테스트 포함 전체)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/reservation/reservation.service.ts apps/api/src/modules/reservation/reservation.service.spec.ts
git commit -m "fix(booking): 티켓 취소 시 유효 티켓 점유 좌석 재오픈 차단"
```

---

### Task 5: 레거시 전체예매 취소 경로 가드

**Files:**
- Modify: `apps/api/src/modules/reservation/reservation.service.ts:2758-2819` (레거시 취소 seat 복원 + broadcast)
- Test: `apps/api/src/modules/reservation/reservation.service.spec.ts` (기존 spec에 테스트 추가)

**Interfaces:**
- Consumes: `noActiveTicketItemOnSeat()` (Task 1)
- 동작 변경: 상태 필터 + 소유권 가드. broadcast는 실제 해제된 좌석만 (기존: 취소 후 reservation_seats 전체 재조회 broadcast).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
it('legacy full-reservation cancel does not reopen seats owned by active ticket items', async () => {
  // seatInventories update → returning([]) mock.
  // 기대 1: 해당 좌석에 대한 broadcastSeatUpdate 미호출.
  // 기대 2: where 렌더링에 'not exists' + status 필터 포함.
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @grabit/api exec vitest run src/modules/reservation/reservation.service.spec.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

```ts
// reservation.service.ts (레거시 취소)
// try 블록 밖, showtimeId 선언 옆에 추가:
    const freedSeatIds: string[] = [];

// 좌석 복원 루프를 다음으로 교체:
        for (const seat of cancelledSeats) {
          const seatIdentity = normalizeSeatIdentity({ seatId: seat.seatId });
          const freed = await tx
            .update(seatInventories)
            .set({ status: 'available', soldAt: null, lockedBy: null, lockedUntil: null })
            .where(
              and(
                eq(seatInventories.showtimeId, row.showtime_id),
                eq(seatInventories.floorKey, seatIdentity.floorKey),
                or(
                  eq(seatInventories.seatKey, seatIdentity.seatKey),
                  and(
                    sql`${seatInventories.seatKey} IS NULL`,
                    eq(seatInventories.seatId, seatIdentity.seatId),
                  ),
                ),
                inArray(seatInventories.status, ['sold', 'held_cancelled']),
                noActiveTicketItemOnSeat(),
              ),
            )
            .returning({ id: seatInventories.id });

          if (freed.length > 0) {
            freedSeatIds.push(seat.seatId);
          } else {
            this.logger.warn(
              `Legacy cancel: seat inventory not reopened (ownership guard). reservationId=${reservationId}, seatKey=${seatIdentity.seatKey}`,
            );
          }
        }

// 취소 후 broadcast 블록(기존 reservation_seats 재조회)을 다음으로 교체:
    if (showtimeId) {
      for (const seatId of freedSeatIds) {
        this.bookingGateway.broadcastSeatUpdate(showtimeId, seatId, 'available');
      }
    }
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @grabit/api exec vitest run src/modules/reservation/reservation.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/reservation/reservation.service.ts apps/api/src/modules/reservation/reservation.service.spec.ts
git commit -m "fix(booking): 레거시 전체취소 시 유효 티켓 점유 좌석 보호"
```

---

### Task 6: 관리자 수동 오픈 가드

**Files:**
- Modify: `apps/api/src/modules/admin/admin-booking.service.ts:2016-2045` (수동 오픈 tx + broadcast)
- Test: `apps/api/src/modules/admin/admin-booking.service.spec.ts` (기존 spec에 테스트 추가)

**Interfaces:**
- Consumes: `noActiveTicketItemOnSeat()` (Task 1)
- 동작 변경: held_cancelled 가드에 소유권 가드 추가(모순 상태 방어). 실제 해제된 좌석만 broadcast, 건너뛴 좌석은 warn.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
it('manual open skips seats occupied by an active ticket item and broadcasts only released seats', async () => {
  // seatInventories update → returning([]) mock.
  // 기대 1: broadcastSeatUpdate 미호출. 기대 2: where 렌더링에 'not exists' 포함.
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @grabit/api exec vitest run src/modules/admin/admin-booking.service.spec.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

```ts
// admin-booking.service.ts
// import 추가:
import { noActiveTicketItemOnSeat } from '../../database/seat-ownership.js';

// tx 앞에 선언:
    const releasedSeatIds: string[] = [];

// tx 내부 좌석 루프를 다음으로 교체 (seats와 seatIdentities는 같은 순서):
      for (const seat of seats) {
        const seatIdentity = normalizeReservationSeatIdentity(seat.seatId);
        const released = await tx
          .update(seatInventories)
          .set({
            status: 'available',
            lockedBy: null,
            lockedUntil: null,
            soldAt: null,
            heldCancelledAt: null,
            reopenHoldUntil: null,
            reopenJobId: null,
          })
          .where(
            and(
              eq(seatInventories.showtimeId, context.reservation.showtimeId),
              eq(seatInventories.floorKey, seatIdentity.floorKey),
              eq(seatInventories.seatKey, seatIdentity.seatKey),
              eq(seatInventories.status, 'held_cancelled'),
              noActiveTicketItemOnSeat(),
            ),
          )
          .returning({ id: seatInventories.id });

        if (released.length > 0) {
          releasedSeatIds.push(seat.seatId);
        } else {
          this.logger.warn(
            `Manual open skipped (ownership guard or state changed). reservationId=${reservationId}, seatKey=${seatIdentity.seatKey}`,
          );
        }
      }

// broadcast 루프를 다음으로 교체:
    for (const seatId of releasedSeatIds) {
      this.bookingGateway.broadcastSeatUpdate(
        context.reservation.showtimeId,
        seatId,
        'available',
      );
    }
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @grabit/api exec vitest run src/modules/admin/admin-booking.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/admin/admin-booking.service.ts apps/api/src/modules/admin/admin-booking.service.spec.ts
git commit -m "fix(admin): 수동 오픈 시 유효 티켓 점유 좌석 보호"
```

---

### Task 7: 판매 확정 경로의 유니크 위반 → ConflictException 매핑

**Files:**
- Modify: `apps/api/src/modules/reservation/reservation-finalization.service.ts:678-698` (ticketItems insert)
- Modify: `apps/api/src/modules/payment/payment.service.ts:1758-1775` (webhook 경로 ticketItems insert)
- Test: `apps/api/src/modules/reservation/reservation-finalization.service.spec.ts` (기존 spec에 테스트 추가)

**Interfaces:**
- Consumes: `isActiveSeatUniqueViolation()` (Task 1)
- 목적: Task 8의 부분 유니크 인덱스가 발동하면(동시성 최후 방어선) raw 23505가 아니라 기존 `ConflictException('판매 불가능한 좌석입니다')` 보상 흐름(결제 자동취소)으로 이어지게 한다.

- [ ] **Step 1: 실패하는 테스트 작성** — 기존 spec의 `createDependencies()`/`chainResult`/`ticketLimitResult` 헬퍼 재사용

```ts
// reservation-finalization.service.spec.ts 에 추가
it('cancels the approved payment when ticket item insert hits the active-seat unique index', async () => {
  const { service, db, tossClient } = createDependencies();

  db.select
    .mockReturnValueOnce(chainResult([]))
    .mockReturnValueOnce(chainResult([
      {
        id: 'reservation-dup-1',
        userId: 'user-1',
        showtimeId: 'showtime-1',
        status: 'PENDING_PAYMENT',
        totalAmount: 52000,
        admissionActiveUntilAt: new Date(Date.now() + 60_000),
      },
    ]))
    .mockReturnValueOnce(chainResult([
      { seatId: '1F:A-1', tierName: 'VIP', price: 50000, row: 'A', number: '1' },
    ]));
  tossClient.confirmPayment.mockResolvedValue({
    paymentKey: 'payment-key-dup',
    orderId: 'order-dup-1',
    method: '카드',
    totalAmount: 52000,
    approvedAt: '2026-07-03T00:00:00.000Z',
  });
  tossClient.cancelPayment.mockResolvedValue({
    paymentKey: 'payment-key-dup',
    orderId: 'order-dup-1',
    status: 'CANCELED',
    cancels: [{ cancelStatus: 'DONE' }],
  });

  const uniqueViolation = Object.assign(
    new Error('duplicate key value violates unique constraint "uq_ticket_items_active_seat"'),
    { code: '23505', constraint: 'uq_ticket_items_active_seat' },
  );
  const tx = {
    execute: vi.fn().mockResolvedValue(ticketLimitResult()),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue(
          Object.assign(Promise.resolve([]), {
            returning: vi.fn().mockResolvedValue([{ id: 'seat-inventory-1' }]),
          }),
        ),
      }),
    }),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn(() => {
        if (table === payments) {
          return { returning: vi.fn().mockResolvedValue([{ id: 'payment-dup-1' }]) };
        }
        if (table === ticketItems) {
          return { returning: vi.fn().mockRejectedValue(uniqueViolation) };
        }
        return {};
      }),
    })),
    select: emptyBenefitConfigurationSelect(),
  };
  db.transaction.mockImplementation(async (cb: (tx: typeof tx) => Promise<unknown>) => cb(tx));

  await expect(
    service.confirmAndCreateReservation(
      { paymentKey: 'payment-key-dup', orderId: 'order-dup-1', amount: 52000 },
      'user-1',
    ),
  ).rejects.toThrow('판매 불가능한 좌석입니다');

  expect(tossClient.cancelPayment).toHaveBeenCalled();
});
```

(mock 체인 순서가 실제 서비스 흐름과 다르면 기존 성공-경로 테스트의 mock 구성을 기준으로 조정한다. 기대 결과 2가지 — `ConflictException` 메시지로 reject + `cancelPayment` 호출 — 는 변경하지 않는다.)

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @grabit/api exec vitest run src/modules/reservation/reservation-finalization.service.spec.ts`
Expected: FAIL — raw 23505가 ConflictException으로 매핑되지 않아 cancelPayment 미호출 (또는 다른 에러 메시지로 reject)

- [ ] **Step 3: 구현**

```ts
// reservation-finalization.service.ts — ticketItems insert를 try/catch로 감싼다:
// import 추가:
import { isActiveSeatUniqueViolation } from '../../database/seat-ownership.js';

          let insertedTicketItems: Array<{ id: string; tierName: string }>;
          try {
            insertedTicketItems = await tx.insert(ticketItems).values(
              pendingSeats.map((seat) => ({
                /* 기존 값 그대로 */
              })),
            ).returning({
              id: ticketItems.id,
              tierName: ticketItems.tierName,
            });
          } catch (error) {
            if (isActiveSeatUniqueViolation(error)) {
              throw new ConflictException('판매 불가능한 좌석입니다');
            }
            throw error;
          }
```

```ts
// payment.service.ts — webhook 경로 ticketItems insert에 동일 매핑:
// import 추가:
import { isActiveSeatUniqueViolation } from '../../database/seat-ownership.js';

        try {
          await tx.insert(ticketItems).values(
            pendingSeats.map((seat) => ({
              /* 기존 값 그대로 */
            })),
          );
        } catch (error) {
          if (isActiveSeatUniqueViolation(error)) {
            throw new ConflictException('판매 불가능한 좌석입니다');
          }
          throw error;
        }
```

(webhook 경로는 기존 `catch (error) { if (error instanceof ConflictException) → compensateAsyncDoneSeatFailure }`가 이어받는다.)

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @grabit/api exec vitest run src/modules/reservation/reservation-finalization.service.spec.ts src/modules/payment/payment.service.spec.ts`
Expected: PASS (기존 테스트 포함 전체)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/reservation/reservation-finalization.service.ts apps/api/src/modules/payment/payment.service.ts apps/api/src/modules/reservation/reservation-finalization.service.spec.ts
git commit -m "fix(booking): 좌석 유니크 인덱스 위반을 결제 보상 흐름으로 매핑"
```

---

### Task 8: ticket_items 부분 유니크 인덱스 (스키마 + 마이그레이션)

**Files:**
- Modify: `apps/api/src/database/schema/ticket-items.ts:79-89` (인덱스 배열)
- Create (자동 생성): `apps/api/src/database/migrations/0033_*.sql`

**Interfaces:**
- Produces: DB 인덱스 `uq_ticket_items_active_seat` — Task 1의 `ACTIVE_SEAT_UNIQUE_INDEX`, Task 7의 매핑과 이름이 일치해야 한다.

- [ ] **Step 1: 스키마 수정**

```ts
// ticket-items.ts
// import 추가:
import { sql } from 'drizzle-orm';

// 인덱스 배열에 추가:
    uniqueIndex('uq_ticket_items_active_seat')
      .on(table.showtimeId, table.floorKey, table.seatKey)
      .where(sql`status in ('active', 'cancellation_pending')`),
```

- [ ] **Step 2: 마이그레이션 생성**

Run (레포 루트에서): `DOTENV_CONFIG_PATH=../../.env pnpm --filter @grabit/api exec drizzle-kit generate`
Expected: `0033_*.sql` 생성, 내용에 `CREATE UNIQUE INDEX "uq_ticket_items_active_seat" ON "ticket_items" ... WHERE status in ('active', 'cancellation_pending')` 포함. 생성된 SQL을 열어 직접 확인한다.

- [ ] **Step 3: 로컬 DB 적용 및 회귀 확인**

Run: `DOTENV_CONFIG_PATH=../../.env pnpm --filter @grabit/api exec drizzle-kit migrate`
Run: `pnpm --filter @grabit/api test && pnpm --filter @grabit/api typecheck`
Expected: 마이그레이션 성공, 전체 테스트/타입체크 PASS

- [ ] **Step 4: 프로덕션 preflight 쿼리 문서 확인** — 아래 쿼리가 0행일 때만 프로덕션 마이그레이션 가능 (현재는 중복 7건이 있어 실패한다. 데이터 정리 후 진행):

```sql
SELECT showtime_id, floor_key, seat_key, count(*)
FROM ticket_items
WHERE status IN ('active', 'cancellation_pending')
GROUP BY 1, 2, 3
HAVING count(*) > 1;
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/database/schema/ticket-items.ts apps/api/src/database/migrations/
git commit -m "feat(booking): 좌석당 유효 티켓 1장 부분 유니크 인덱스 추가"
```

---

## 최종 검증

- [ ] `pnpm --filter @grabit/api test` 전체 PASS
- [ ] `pnpm --filter @grabit/api typecheck` PASS
- [ ] `pnpm --filter @grabit/api lint` PASS

## 배포/운영 순서 (코드 밖 체크리스트)

1. **즉시:** Task 1~7 코드 가드 배포 — 데이터 정리와 무관하게 신규 중복 발생을 차단한다.
2. **운영 결정:** 기존 중복 7좌석(핸드오프 문서 목록)에 대해 좌석별 유효 티켓 선정, 나머지 티켓 환불/재배정/고객 안내. 이 계획의 범위 밖이며 사용자 결정 필요.
3. **정리 완료 후:** Task 8 preflight 쿼리 0행 확인 → CI/CD에서 `drizzle-kit migrate` 실행 (CLAUDE.md 프로덕션 마이그레이션 규칙 준수).
