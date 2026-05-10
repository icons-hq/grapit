---
phase: 24-traffic-booking-payment-core
reviewed: 2026-05-10T09:59:11Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - apps/api/src/modules/jobs/cancelled-seat-release.worker.spec.ts
  - apps/api/src/modules/jobs/cancelled-seat-release.worker.ts
  - apps/api/src/modules/jobs/jobs.module.ts
  - apps/api/src/modules/jobs/pgboss.provider.spec.ts
  - apps/api/src/modules/jobs/pgboss.provider.ts
  - apps/api/src/modules/jobs/refund-cancel-retry.worker.spec.ts
  - apps/api/src/modules/jobs/refund-cancel-retry.worker.ts
  - apps/api/src/modules/refund/refund.service.spec.ts
  - apps/api/src/modules/refund/refund.service.ts
  - apps/api/src/modules/ticket/qr-ticket.service.spec.ts
  - apps/api/src/modules/ticket/qr-ticket.service.ts
findings:
  critical: 0
  warning: 0
  info: 0
  total: 0
status: clean
---

# Phase 24: Code Review Report

**Reviewed:** 2026-05-10T09:59:11Z
**Depth:** standard
**Files Reviewed:** 11
**Status:** clean

## Summary

PASS. Phase 24 gap-closure 범위(`44c0184..HEAD`, HEAD `404773b`)의 refund/pg-boss worker durability 변경 11개 파일을 재검토했다. 이전 blocker였던 pg-boss queue bootstrap 누락과 refund retry enqueue/schedule state 손실은 코드와 테스트 양쪽에서 해결된 것으로 확인했다.

추가 blocker, warning, info finding은 없다.

## Prior Blocker Resolution

- pg-boss queue bootstrap: `PG_BOSS_JOB_NAMES`가 `release-cancelled-seat`, `refund-cancel-retry`, `qr-ticket-email-resend`를 모두 중앙 registry로 내보내고, provider가 `boss.start()` 이후 `bootstrapPgBossQueues()`로 모든 queue에 `createQueue()`를 호출한다. 실제 설치된 `pg-boss@12.18.2`의 README/source도 `createQueue()` 선행이 필요하고 `work()` handler가 batch array를 받는 계약임을 확인했다.
- refund retry durability: `scheduleRefundCancelRetry()`와 worker `scheduleRetry()`가 `send()` throw/null을 `null`로 흡수하고, `recordRefundCancelRetrySchedule()`/`recordRetryScheduleState()`가 `refundCancelRetry.status`, `jobId`, `attempt`, `scheduledAt`/`failedAt`, `customerServiceCtaVisible`을 지속화한다. duplicate request는 non-terminal refund에 stored job id가 없을 때 enqueue를 재시도한다.
- pg-boss export/prototype: named `PgBoss` export resolution과 `markBossAvailable()` prototype 보존 spec이 있다.
- batch worker handlers: cancelled-seat, refund retry, QR reminder workers 모두 `async ([job]) => ...` 형태로 batch payload를 소비하고 spec이 handler invocation을 검증한다.
- QR revocation on refund: direct refund success와 delayed retry success 모두 `tickets.status = 'revoked'`, `revokedAt`을 갱신한다.
- stale seat release guards: release worker가 `held_cancelled`와 `reopenJobId`를 함께 조건으로 걸고, stale release는 broadcast하지 않는다.
- final retry behavior: `retryCount = REFUND_CANCEL_MAX_RETRIES - 1` 상태에서 마지막 Toss cancel attempt를 실행한 뒤 transient failure면 exhausted로 전환하는 spec이 있다.
- Toss completion condition: `isTossCancelCompleted()`는 `CANCELED`만 완료로 인정하고 `DONE`/`PARTIAL_CANCELED`는 완료 처리하지 않는다.
- preallocated release job ids: refund success before transaction 단계에서 release job id를 preallocate하고, enqueue 성공 시 같은 id를 `seatInventories.reopenJobId`에 저장한다. enqueue 실패 시 `JOB_ENQUEUE_FAILED` sentinel을 저장한다.

## Tests Reviewed

- `apps/api/src/modules/jobs/pgboss.provider.spec.ts`: named export/prototype 보존, all queue bootstrap.
- `apps/api/src/modules/jobs/cancelled-seat-release.worker.spec.ts`: batch handler, imminent guard, stale release guard, broadcast gating.
- `apps/api/src/modules/jobs/refund-cancel-retry.worker.spec.ts`: batch handler, transient retry reschedule, schedule failure persistence, final retry, QR revocation/seat hold fallback.
- `apps/api/src/modules/refund/refund.service.spec.ts`: Toss `CANCELED`-only completion, duplicate retry re-enqueue, `send()` throw schedule failure state, QR revocation, admin audit, preallocated release job id.
- `apps/api/src/modules/ticket/qr-ticket.service.spec.ts`: QR email queue name, batch handler, persisted revoked/expired/used and cancelled reservation/payment invalidation.

## Verification

- `node` inspection of installed `pg-boss@12.18.2`: named `PgBoss` export, `createQueue`, `send`, `work` prototype methods present.
- `pnpm --filter @grabit/api exec tsc --noEmit`: PASS.
- `pnpm --filter @grabit/api exec vitest run src/modules/jobs/pgboss.provider.spec.ts src/modules/jobs/cancelled-seat-release.worker.spec.ts src/modules/jobs/refund-cancel-retry.worker.spec.ts src/modules/refund/refund.service.spec.ts src/modules/ticket/qr-ticket.service.spec.ts`: PASS, 5 files / 28 tests.
- `pnpm --filter @grabit/api build`: PASS, 0 TypeScript issues, 204 files compiled.

---

_Reviewed: 2026-05-10T09:59:11Z_  
_Reviewer: the agent (gsd-code-reviewer)_  
_Depth: standard_
