---
quick_id: 260507-ok2
slug: ci-cd-cli
status: completed
date: 2026-05-07
branch: gsd/phase-23-launch-foundation
base_commit: 7d5d37542dc3767f1d2be7af0cf460b6a9630358
---

# Quick Task 260507-ok2 Summary

## Outcome

production deploy가 `drizzle-kit migrate` 단계에서만 실패하던 원인을 `genre` enum transaction 경계로 고정했다. `deploy.yml`에 `0009_two_event_categories.sql` pre-migration step을 추가해 enum value를 먼저 committed 상태로 만든 뒤 기존 migration을 이어가도록 바꿨고, orphan 상태였던 launch consent seed는 forward-only `0011_seed_launch_consent_items.sql`로 복구했다.

## Workspace Safety

- `HEAD`와 orchestrator expected base가 모두 `7d5d37542dc3767f1d2be7af0cf460b6a9630358`로 일치했다.
- 작업 시작 시 branch는 `gsd/phase-23-launch-foundation`이었고 dirty worktree는 없었다.
- protected branch / unexpected worktree blocker는 발견되지 않았다.

## Locked Evidence

### GitHub Actions

`gh run view 25484595049 --log-failed` 결과:

- 실패 job: `deploy-api`
- 실패 step: `Run migrations`
- 실패 시각: `2026-05-07T08:24:16Z`
- 실패 명령: `pnpm --filter @grabit/api exec drizzle-kit migrate`
- image build / push / Cloud Run rollout 단계까지 진행되지 못했다.

### GCP / Cloud SQL

`gcloud logging read 'timestamp>="2026-05-07T08:23:00Z" AND timestamp<="2026-05-07T08:25:00Z"' --limit=50` 결과:

- `2026-05-07T08:24:16.397097Z`
  `ERROR: unsafe use of new value "ip_popup" of enum type genre`
- `2026-05-07T08:24:16.397766Z`
  `HINT: New enum values must be committed before they can be used.`
- 같은 시각 Cloud SQL statement log가 `UPDATE performances ... 'ip_popup'::genre ...`를 직접 기록했다.

## Changes Applied

### 1. Deploy workflow

파일: `.github/workflows/deploy.yml`

- `Start Cloud SQL Auth Proxy` 다음에 `Pre-apply event category enum migration` step을 추가했다.
- 새 step은 `pnpm --filter @grabit/api exec node --input-type=module`로 `src/database/migrations/0009_two_event_categories.sql`을 읽고, `pg` client로 statement-breakpoint 단위 실행한다.
- 이후 기존 `Run migrations` step이 그대로 `drizzle-kit migrate`를 수행해 `0010_collapse_legacy_genres.sql`이 이미 committed 된 enum 값을 사용하게 만들었다.

### 2. Forward-only consent seed recovery

파일:

- `apps/api/src/database/migrations/0011_seed_launch_consent_items.sql`
- `apps/api/src/database/migrations/meta/_journal.json`
- `apps/api/src/database/schema/launch-foundation.schema.spec.ts`

- orphan 상태였던 launch consent seed를 historical `0009` 복원 대신 새 `0011_seed_launch_consent_items.sql`로 추가했다.
- `_journal.json`에 `0011_seed_launch_consent_items`를 append 했다.
- schema contract spec은 이제 `0011_seed_launch_consent_items.sql`을 읽고, journal에 `0009_two_event_categories -> 0010_collapse_legacy_genres -> 0011_seed_launch_consent_items` 순서가 유지되는지 검증한다.
- spec은 old journal tag `0009_seed_launch_consent_items`가 다시 들어오지 않도록 고정한다.

## Verification

### PostgreSQL 16 prod-like repro

`postgres:16` 컨테이너 + `pg` client 재현 결과:

- single transaction (`BEGIN -> 0009 add values -> 0010 update`) 결과:
  `unsafe use of new value "ip_popup" of enum type genre`
- split transactions (`0009` committed first, then `0010`) 결과:
  `[{"genre":"ip_popup"},{"genre":"artist_celebrity"}]`
- orchestrator 재검증에서 production patch와 더 가까운 경로도 확인했다:
  `0009`를 먼저 commit한 뒤, 같은 transaction 안에서 `0009`를 다시 실행하고 `0010`을 실행하면
  `[{"genre":"ip_popup"},{"genre":"artist_celebrity"}]`로 성공했다.

이 재현은 deploy fix의 핵심 가정과 정확히 일치한다.

### Test command

`pnpm --filter @grabit/api test -- src/database/schema/launch-foundation.schema.spec.ts`

- exit code `0`
- `Test Files 42 passed (42)`
- `Tests 505 passed (505)`
- target file `database/schema/launch-foundation.schema.spec.ts` passed

### File grep

`rg -n "0009_two_event_categories|0010_collapse_legacy_genres|0011_seed_launch_consent_items|Pre-apply event category enum migration|Run migrations" .github/workflows/deploy.yml apps/api/src/database/migrations/meta/_journal.json apps/api/src/database/schema/launch-foundation.schema.spec.ts`

- `deploy.yml`에 pre-migration step과 `Run migrations` 순서가 함께 존재함을 확인했다.
- `_journal.json`에 `0009`, `0010`, `0011` tag가 모두 존재함을 확인했다.
- schema spec이 `0011` seed file과 forward-only journal order를 검사함을 확인했다.

## Commits

- `dc9dba0` `fix(quick-260507-ok2): pre-apply enum migration in deploy workflow`
- `d1d6633` `fix(quick-260507-ok2): restore consent seed migration history`

## Notes

- `apps/api/src/database/migrations/0009_seed_launch_consent_items.sql` 파일은 디스크에 남아 있지만 journal에서는 더 이상 사용되지 않는다.
- 이번 수정은 deploy/migration failure 범위만 다뤘고, unrelated refactor는 하지 않았다.
