# Phase 21: Verification artifact backfill - Pattern Map

**Mapped:** 2026-05-04
**Files analyzed:** 6
**Analogs found:** 6 / 6

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `.planning/phases/06-social-login-bugfix/06-VERIFICATION.md` | verification artifact | batch evidence aggregation + requirement traceability | `.planning/phases/19-seat-lock-ownership-enforcement/19-VERIFICATION.md` | exact |
| `.planning/phases/08-r2/08-VERIFICATION.md` | verification artifact | batch evidence aggregation + external ops evidence | `.planning/phases/18-password-reset-production-api-origin-fix/18-VERIFICATION.md` | exact |
| `.planning/phases/13-grapit-grabit-rename/13-VERIFICATION.md` | verification artifact | batch evidence aggregation + human-deferred UAT | `.planning/phases/20-valkey-production-connectivity-contract/20-VERIFICATION.md` | exact |
| `.planning/phases/15-resend-heygrabit-com-cutover-transactional-email-secret-mana/15-VERIFICATION.md` | verification artifact | batch evidence aggregation + human-deferred ops UAT | `.planning/phases/20-valkey-production-connectivity-contract/20-VERIFICATION.md` | exact |
| `.planning/phases/06-social-login-bugfix/06-02-SUMMARY.md` | metadata/frontmatter | requirement traceability metadata update | `.planning/phases/13-grapit-grabit-rename/13-01-SUMMARY.md` | role-match |
| `.planning/phases/08-r2/08-03-SUMMARY.md` | metadata/frontmatter | requirement traceability metadata update | `.planning/phases/08-r2/08-01-SUMMARY.md` | exact |

## Pattern Assignments

### `.planning/phases/06-social-login-bugfix/06-VERIFICATION.md` (verification artifact, batch evidence aggregation)

**Analog:** `.planning/phases/19-seat-lock-ownership-enforcement/19-VERIFICATION.md`

**Frontmatter pattern** (lines 1-16):

```markdown
---
phase: 19-seat-lock-ownership-enforcement
verified: 2026-04-29T10:30:30Z
status: passed
score: 11/11 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: blocked_before_fix
  previous_score: 8/11
  gaps_closed:
    - "payment confirm validates locks before Toss and consumes locks before DB sold transition"
    - "post-Toss lock consume failure runs compensation and does not mark seats sold"
    - "tests materially cover Phase 19 critical payment boundary paths"
  gaps_remaining: []
  regressions: []
---
```

**Core verification pattern** (lines 25-45):

```markdown
## Goal Achievement

Phase 19 is now achieved. The previous blocker was the post-Toss boundary: locks were consumed after DB sold commit and consume failure was treated as cleanup. Live code now consumes active owned locks after Toss confirm but before the DB sold/payment transaction, and the consume failure path cancels Toss, skips the DB transaction, and skips sold broadcasts.

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | reservation prepare verifies active lock owner for every requested seat and rejects missing/expired/other-owner locks | VERIFIED | Quick regression check: `prepareReservation()` still calls `bookingService.assertOwnedSeatLocks(...)` for existing pending and new pending paths at `apps/api/src/modules/reservation/reservation.service.ts:255` and `:278`; regression test names remain at `reservation.service.spec.ts:466`, `:487`, `:508`. |
...
**Score:** 11/11 truths verified
```

**Requirements coverage pattern** (lines 93-102):

```markdown
### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| VALK-03 | 19-01, 19-02, 19-03, 19-04 | 좌석 잠금 Lua 스크립트 Valkey 호환성 검증 및 수정 | SATISFIED | Ownership Lua helpers, InMemoryRedis parity, prepare validation, post-Toss/pre-DB consume, and consume failure compensation are present and tested. |
| UX-02 | 19-01, 19-04 | SVG 좌석맵 스테이지 방향 표시 | SATISFIED | Phase 19 web changes preserve seat selection flow; no regression evidence found in quick check. |
```

**No-human-needed closeout pattern** (lines 110-116):

```markdown
### Human Verification Required

None. The previously failed truths are backend control-flow and test assertion contracts, and they are programmatically verified.

### Gaps Summary

No remaining gaps. The previous blockers for truths #8, #9, and #11 are closed: lock consume now happens before the DB sold transition, consume failure compensates Toss and prevents sold side effects, and regression tests assert the corrected behavior.
```

**Target evidence to cite for AUTH-01:**

From `.planning/phases/06-social-login-bugfix/06-01-SUMMARY.md` lines 49-74:

```markdown
**A. Strategy callbackURL 수정 (근본 원인 버그)**
- kakao.strategy.ts: `/auth/kakao/callback` -> `/auth/social/kakao/callback`
- naver.strategy.ts: `/auth/naver/callback` -> `/auth/social/naver/callback`
- google.strategy.ts: `/auth/google/callback` -> `/auth/social/google/callback`
...
**F/G. 테스트**
- 3개 strategy spec에 callbackURL 기본값 검증 테스트 추가
- social-auth.guard.spec.ts 신규 생성 (9개 테스트)
- 전체 auth 모듈 36개 테스트 통과
```

From `.planning/phases/06-social-login-bugfix/06-02-SUMMARY.md` lines 57-58 and 95-98:

```markdown
1. **Task 1: Playwright 설정 + 소셜 로그인 E2E 테스트 작성** - `bf24815` (test)
2. **Task 2: 소셜 로그인 재로그인 수동 검증** - VERIFIED (카카오/네이버/구글 모두 성공)
...
## Manual Verification (Completed)

카카오/네이버/구글 세 프로바이더 모두 재로그인 수동 검증 완료 (2026-04-09). 추가 발견: validate() 메서드의 done() 수동 호출 버그 수정 (53da7d8).
```

From `.planning/phases/06-social-login-bugfix/06-VALIDATION.md` lines 39-49 and 60-65:

```markdown
| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | callbackURL /social/ 포함 | T-06-01 | callbackURL이 컨트롤러 라우트와 일치 | unit | `vitest run src/modules/auth/strategies` | ✅ | ✅ green |
...
| 06-02-01 | 02 | 2 | E2E 테스트 인프라 | — | N/A | config | playwright.config.ts 존재 | ✅ | ✅ green |
...
| 3 provider 재로그인 (카카오/네이버/구글) | AUTH-01 | OAuth provider 로그인 페이지의 봇 감지(CAPTCHA, 2FA)로 자동화 불가 | 1. pnpm dev 실행 2. 소셜 로그인 → 가입 → 로그아웃 → 재로그인 성공 확인 |
```

From `.planning/phases/06-social-login-bugfix/06-UAT.md` lines 15-41:

```markdown
### 1. 소셜 로그인 정상 동작 (카카오/네이버/구글)
expected: 카카오, 네이버, 구글 중 하나의 소셜 로그인 버튼을 클릭하면 해당 OAuth 제공자 페이지로 이동하고, 인증 완료 후 콜백 페이지(/auth/callback)로 정상 리다이렉트되어 로그인이 완료된다.
result: pass
...
total: 5
passed: 5
issues: 0
pending: 0
skipped: 0
blocked: 0
```

Planner note: use `status: passed` for `06-VERIFICATION.md` if only AUTH-01 backfill is in scope. The evidence is historical, so include a sentence such as "Backfilled from 2026-04-09 Phase 06 evidence; no new runtime OAuth provider query was performed."

---

### `.planning/phases/08-r2/08-VERIFICATION.md` (verification artifact, external ops evidence)

**Analog:** `.planning/phases/18-password-reset-production-api-origin-fix/18-VERIFICATION.md`

**Human/partial-aware frontmatter pattern** (lines 1-11):

```markdown
---
phase: 18-password-reset-production-api-origin-fix
verified: 2026-04-29T06:32:43Z
status: human_needed
score: 13/14 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Sentry email-service observation"
    expected: "Record either `Sentry component:email-service recent 24h count: 0 after UAT` or a redacted captured event id after dashboard/API inspection."
    why_human: "Sentry dashboard/API was not independently inspected; current UAT records an explicit caveat instead of zero-count or event-id evidence."
---
```

**Observable truths pattern with uncertain row** (lines 22-41):

```markdown
### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | password reset confirm submit이 production web에서 public API origin을 사용하고 `/api` rewrite가 `localhost:8080`으로 새지 않는다. | VERIFIED | `reset-password/page.tsx:176` uses `fetch(apiUrl('/api/v1/auth/password-reset/confirm'))`; `api-url.ts:16-52` joins configured origin and rejects bad production origins; `next.config.ts:35-38` returns `[]` in production. |
...
| 14 | Sentry/email observability evidence records zero-count after UAT or a specific captured event id without PII. | UNCERTAIN | `18-HUMAN-UAT.md:171-176` leaves both Sentry evidence checkboxes unchecked, states dashboard/API evidence was not available, and explicitly preserves `human_needed`; `18-HUMAN-UAT.md:184` records "not independently inspected". Needs human Sentry inspection. |
```

**Requirements coverage with requirement-defined and planning-only statuses** (lines 98-108):

```markdown
### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| DEBT-01 | 18-01, 18-02 | Defined in `.planning/REQUIREMENTS.md`: Password reset 이메일 기능 실구현 | SATISFIED | Reset confirm uses public API origin; production smoke records reset email, confirm POST 200, and login success; UAT redaction passed. |
| CUTOVER-01 | 18-02 | Planning-only ID from ROADMAP Phase 15, not defined in `.planning/REQUIREMENTS.md` | RECORDED, NOT REQUIREMENTS-DEFINED | UAT records Phase 15 final state and sender evidence, but REQUIREMENTS.md has no CUTOVER-01 entry. |
```

**Target evidence to cite for R2-01..R2-04:**

From `.planning/phases/08-r2/08-01-SUMMARY.md` lines 20-33 and 50-63:

```markdown
key-files:
  created: []
  modified:
    - apps/api/src/modules/admin/upload.service.ts
    - apps/api/src/modules/admin/upload.service.spec.ts
...
requirements-completed: [R2-01, R2-03]
...
- S3Client 생성자에 forcePathStyle: true 추가로 R2 path-style URL 사용 보장
- S3Client mock 호출 인자를 검증하는 유닛 테스트 추가
- 기존 14개 테스트 포함 전체 160개 테스트 회귀 없이 통과
```

From `.planning/phases/08-r2/08-02-SUMMARY.md` lines 55-75:

```markdown
- next.config.ts에 NEXT_PUBLIC_R2_HOSTNAME 환경변수 기반 동적 remotePatterns 설정으로 코드 변경 없이 도메인 전환 가능
- Dockerfile에 NEXT_PUBLIC_R2_HOSTNAME build arg 추가하여 빌드 시 주입 가능
- deploy.yml에 R2 시크릿 5개를 secrets 섹션으로 Cloud Run 주입 (T-08-04 위협 완화)
- deploy.yml web 빌드에 R2_PUBLIC_HOSTNAME build arg 전달
...
- remotePatterns에 spread + 조건부 패턴 사용: 환경변수 미설정 시 빈 배열 유지하여 로컬 개발에 영향 없음
- R2 credentials(ACCESS_KEY_ID, SECRET_ACCESS_KEY)를 평문 env_vars가 아닌 secrets 섹션에 배치: T-08-04 위협 완화
```

From `.planning/phases/08-r2/08-03-SUMMARY.md` lines 20-36 and 37-59:

```markdown
### Task 1: Cloudflare R2 인프라 설정
- **버킷 생성**: `grapit-assets` (wrangler CLI)
- **공개 접근 활성화**: `https://pub-9eb4eb2187b94ca8a746f62301c0a87f.r2.dev` (wrangler CLI)
- **CORS 설정**: AllowedOrigins: 프로덕션 웹 + localhost, AllowedHeaders: content-type, Methods: GET/PUT/HEAD (wrangler CLI)
- **API 토큰 발급**: Object Read & Write, grapit-assets 스코프 (Dashboard)
- **GCP Secret Manager**: 시크릿 5개 생성 + Cloud Run SA 접근 권한 부여 (gcloud CLI)
...
| CORS AllowedHeaders includes content-type | PASS |
...
- R2-02: CORS AllowedHeaders 와일드카드 불가 → `content-type` 명시적 지정으로 해결
```

From `.planning/quick/260427-pcf-r2-cors/260427-pcf-SUMMARY.md` lines 77-116:

```markdown
## R2 버킷 CORS 정비 (2026-04-28 적용 완료)

조사 결과 기존 룰의 `allowed_headers` 가 `content-type` 만 등록되어 있었음 →
SDK 가 추가하는 모든 `x-amz-*` 헤더가 preflight 에서 거부되는 구조적 원인.

`wrangler r2 bucket cors set grapit-assets --file ./grapit-assets-cors.json --force`
로 다음 룰 적용 (Cloudflare wrangler 스키마 기준):
...
          "content-type", "content-length",
          "x-amz-checksum-crc32", "x-amz-checksum-crc32c",
          "x-amz-checksum-sha1", "x-amz-checksum-sha256",
          "x-amz-sdk-checksum-algorithm",
...
`wrangler r2 bucket cors list grapit-assets` 로 적용 검증 완료.
```

Planner note: preserve chronology. Phase 08 itself proves `content-type` AllowedHeaders; quick `260427-pcf` proves later production checksum-header hardening. Do not write as if checksum headers were part of the original Phase 08 work.

---

### `.planning/phases/13-grapit-grabit-rename/13-VERIFICATION.md` (verification artifact, human-deferred UAT)

**Analog:** `.planning/phases/20-valkey-production-connectivity-contract/20-VERIFICATION.md`

**Human-needed frontmatter pattern** (lines 1-17):

```markdown
---
phase: 20-valkey-production-connectivity-contract
verified: 2026-04-30T09:08:34Z
status: human_needed
pending_production_smoke: true
score: 6/9 must-haves verified
overrides_applied: 0
human_needed: true
evidence_artifact: .planning/phases/20-valkey-production-connectivity-contract/20-HUMAN-UAT.md
human_verification:
  - test: "Run revision-scoped production Valkey smoke"
    expected: "20-HUMAN-UAT.md contains checked PASS evidence for health, Lua lock/status/unlock, Socket.IO two-instance propagation, idle reconnect, log/Sentry cleanliness, scale restore, and final result."
    why_human: "The user explicitly requested skipping production smoke; PSC/private networking, production auth, Cloud Run revision traffic, and safe fixture approval cannot be proven from local code checks."
---
```

**Human-needed truth rows pattern** (lines 30-44):

```markdown
### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 7 | Cloud Run revision has recorded Valkey ping, Lua lock path, and Socket.IO propagation smoke evidence. | HUMAN NEEDED | `20-HUMAN-UAT.md` has no checked PASS rows and no `Production Smoke Run` append. User requested skipping this smoke. |
| 8 | Socket.IO `seat-update` propagation is proven across two Cloud Run API instances. | HUMAN NEEDED | Smoke code requires distinct instance IDs (`smoke-valkey-production.mjs:584-593`), but no production run evidence exists. Session affinity at `.github/workflows/deploy.yml:124` makes operator evidence mandatory. |
| 9 | Idle reconnect runtime proof and log/Sentry cleanliness are recorded for the smoke window. | HUMAN NEEDED | Script implements idle/log checks (`smoke-valkey-production.mjs:604-640`), but `20-HUMAN-UAT.md` has no idle/log PASS evidence. |

**Score:** 6/9 truths verified
```

**Human verification required section** (lines 117-133):

```markdown
### Human Verification Required

### 1. Production Smoke Approval

**Test:** Fill approved smoke env/auth/fixture values and run `pnpm --filter @grabit/web exec node ../../scripts/smoke-valkey-production.mjs --check all`.
**Expected:** `20-HUMAN-UAT.md` records real revision-scoped PASS evidence for health, Lua, Socket.IO, idle reconnect, log/Sentry cleanliness, scale restore, redaction review, and final result.
**Why human:** Requires production auth, safe fixture approval, Cloud Run traffic/revision context, PSC/private networking, and Sentry/Cloud Logging observation.
...
### Gaps Summary

No automated blocker gap was found in the code/config/test artifacts. The phase must remain `human_needed` because the runtime production evidence has intentionally not been collected. Do not mark Phase 20 passed until `20-HUMAN-UAT.md` contains real checked PASS evidence.
```

**Target evidence to cite for satisfied rename parts:**

From `.planning/phases/13-grapit-grabit-rename/13-01-SUMMARY.md` lines 83-88:

```markdown
- **D-10 inventory-driven rename:** STEP 0 에서 `rg` 로 133개 git-tracked 파일 동적 수집 → git ls-files 교차 필터 → 7-pattern bulk sed 적용. 누락 4개 파일 ... 포함 검증.
- **Manifest + lockfile atomic**: 4개 workspace manifest name 이 @grabit/*, 의존성 @grabit/shared 로 변경 + pnpm-lock.yaml 재생성이 같은 PR 에서 이뤄짐. `pnpm install --frozen-lockfile` 통과.
- **Full CI/build pipeline green**: lint 0 errors / typecheck exit 0 / test 422 tests pass (api 283 + web 139) / build exit 0.
- **Decision exception 4건 정확히 보존**...
```

From `.planning/phases/13-grapit-grabit-rename/13-02-SUMMARY.md` lines 65-76:

```markdown
- **SC-2 gate green 확정**: 아래 5 단 audit 전부 통과
  1. `rg -l '\bGrapit\b' apps/web/app apps/web/components --glob '!*.test.*' --glob '!*.spec.*'` → **0 files**
  ...
  5. `./scripts/audit-brand-rename.sh` → `ALL CHECKS PASSED`
...
- **Web build green**: `pnpm --filter @grabit/web build` → 13 routes (6 static + 7 dynamic) emit, exit 0.
- **SC-4 historical preservation 확정**...
```

From `.planning/phases/13-grapit-grabit-rename/13-03-SUMMARY.md` lines 71-92:

```markdown
verification:
  sc_mapping:
    - sc: SC-3
      status: partial
      note: "SC-3 전반부 ... 달성. 나머지 절반(`heygrabit.com` apex cutover + 구 `grapit-*` Cloud Run/AR 정리) 은 Plan 04."
...
    - "health: `curl https://api.heygrabit.com/api/v1/health` → 200 ..."
    - "D-12 api: eventId=`86c6c597ec1647a39e889bd281860904`, Sentry API GET ... → 200 FOUND ..."
    - "D-13: grabit-api env 포함 KAKAO_CALLBACK_URL=https://api.heygrabit.com/api/v1/auth/social/kakao/callback ..."
```

From `.planning/phases/13-grapit-grabit-rename/13-04-SUMMARY.md` lines 72-97 and 168-172:

```markdown
verification:
  sc_mapping:
    - sc: SC-3
      status: pass
      note: "apex heygrabit.com (grabit-web) + www (grabit-web) + api.heygrabit.com (grabit-api) 모두 HTTP 200 ..."
...
  deferred_tasks:
    - "HUMAN-UAT 실기기 테스트 (카카오/네이버/구글 로그인 E2E + 비밀번호 재설정 이메일 + SMS OTP 수신) — 사용자 직접 수행..."
    - "7일 관찰 후 cleanup..."
...
## 5. 잔여 작업

- HUMAN-UAT 실기기 테스트 (13-HUMAN-UAT.md § User-Facing Verification)
- 7-day grace cleanup 실행 (구 grapit-* 리소스 + AR repo + 구 OAuth callback URL 제거)
- Sentry User Auth Token revoke
```

**Target evidence to cite for unresolved/deferred rows:**

From `.planning/phases/13-grapit-grabit-rename/13-UAT.md` lines 71-78 and 80-171:

```markdown
## Summary

total: 12
passed: 8
issues: 4
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "Fresh 시작 시 로컬 API `/api/v1/health` 가 200 반환"
  status: failed
...
- truth: "프로덕션에서 비밀번호 재설정 이메일이 실제 메일박스로 수신됨"
  status: failed
...
- truth: "회원가입 SMS OTP 가 발송되고, 수신된 인증번호를 입력하면 검증에 성공한다"
  status: failed
...
- truth: "법적 문서(약관/개인정보/마케팅)가 heygrabit.com 상의 공개 URL 에서 렌더링되고 연락처 이메일이 @heygrabit.com 로 표기됨"
  status: failed
```

From `.planning/phases/13-grapit-grabit-rename/13-HUMAN-UAT.md` lines 48-80:

```markdown
## User-Facing Verification (T+30min)

- [ ] 카카오 로그인 E2E 성공 (`heygrabit.com` 에서 로그인 → 가입자 정보 확인)
- [ ] 네이버 로그인 E2E 성공
- [ ] 구글 로그인 E2E 성공
- [ ] 비밀번호 재설정 요청 → 수신 이메일 subject `[Grabit] 비밀번호 재설정` 확인 (실제 mailbox)
- [ ] 회원가입 SMS OTP 요청 → 수신 SMS body `[Grabit] 인증번호 XXXXXX (3분 이내 입력)` 확인 (실제 단말)
- [ ] Sentry 새 프로젝트 (grabit-api, grabit-web) 에 prod 트래픽 이벤트 수신 확인
...
- **UAT pass:** _________________ (date: ________)
- **7-day cleanup (`--confirm-after-date=YYYY-MM-DD`):** _________________ (date: ________)
```

Planner note: use `status: human_needed` or `partial_followups_routed`. Do not write `passed` for Phase 13 unless the verification report explicitly limits "passed" to automated/static rename evidence and separately marks UAT/cleanup as human-needed.

---

### `.planning/phases/15-resend-heygrabit-com-cutover-transactional-email-secret-mana/15-VERIFICATION.md` (verification artifact, human-deferred ops UAT)

**Analog:** `.planning/phases/20-valkey-production-connectivity-contract/20-VERIFICATION.md`

Use the same `human_needed` structure as Phase 13 for Naver/Daum inbox and Sentry dashboard evidence.

**Status vocabulary source** (from `.planning/phases/18-password-reset-production-api-origin-fix/18-VERIFICATION.md` lines 102-108):

```markdown
| DEBT-01 | 18-01, 18-02 | Defined in `.planning/REQUIREMENTS.md`: Password reset 이메일 기능 실구현 | SATISFIED | Reset confirm uses public API origin; production smoke records reset email, confirm POST 200, and login success; UAT redaction passed. |
| CUTOVER-04 | 18-02 | Planning-only ID from ROADMAP Phase 15, not defined in `.planning/REQUIREMENTS.md` | PARTIAL, NOT REQUIREMENTS-DEFINED | Cloud Logging `Resend send failed: empty` is recorded; independent Sentry dashboard/API inspection is caveated as unavailable. |
| CUTOVER-06 | 18-01, 18-02 | Planning-only ID from ROADMAP Phase 15, not defined in `.planning/REQUIREMENTS.md` | SATISFIED FOR PHASE 18 EVIDENCE | API auth/email suite passed with 29 files / 323 tests; `.planning/REQUIREMENTS.md` has no CUTOVER-06 entry. |
```

**Target evidence to cite for completed email cutover parts:**

From `.planning/phases/15-resend-heygrabit-com-cutover-transactional-email-secret-mana/15-01-SUMMARY.md` lines 16-29 and 46-58:

```markdown
`email.service.ts` 의 Resend error branch (`if (error)`) 안에 `Sentry.withScope` + `Sentry.captureException` 호출을 삽입했다. 기존 `this.logger.error` + `return { success: false, ... }` 흐름은 변경 없이 유지하고, Sentry 호출만 두 줄 사이에 끼워 넣었다.

PII masking — `scope.setContext('email', { from, toDomain })` — 으로 full email address 대신 도메인만 Sentry로 전송.
...
- email.service.spec: 8/8 ✅ (기존 6 + 신규 2)
- 전체 suite: 307/307 ✅
- typecheck: ✅
- lint: ✅
```

From `.planning/phases/15-resend-heygrabit-com-cutover-transactional-email-secret-mana/15-02-SUMMARY.md` lines 11-14 and 28-40:

```markdown
운영자 sangwopark19icons@gmail.com 가 Resend 대시보드에 `heygrabit.com` 을 추가 (region=Tokyo `ap-northeast-1`) 하고, Resend 가 발급한 3 개 required DNS record ... 등록. dig 4 row 전부 literal match 확인. Resend 대시보드가 `Verified` 상태로 전환됨.
...
- `dig +short TXT resend._domainkey.heygrabit.com | tr -d '" '` → DKIM 발급값과 일치 ✅
- `dig +short MX send.heygrabit.com` → `10 feedback-smtp.ap-northeast-1.amazonses.com.` ... ✅
- `dig +short TXT send.heygrabit.com | tr -d '" '` → `v=spf1 include:amazonses.com ~all` 일치 ✅
- `dig +short TXT _dmarc.heygrabit.com | tr -d '" '` → DMARC 프로젝트 정의값 일치 ✅
```

From `.planning/phases/15-resend-heygrabit-com-cutover-transactional-email-secret-mana/15-03-SUMMARY.md` lines 24-69 and 92-119:

```markdown
**Task 0 — Plan 01 deploy pre-gate (PASS):**
- PR #20 머지 ...
- Cloud Run 신규 revision `grabit-api-00011-5c8` 생성 ...
...
**🚨 추가 critical fix — `resend-api-key` placeholder 교체 (Plan 외 발견):**
- 발견: secret v1 ... placeholder `re_PLACEHOLDER_SET_AGAIN_VERIFY`
...
**Task 3 (3사 UAT) — partial PASS:**
- Resend API direct smoke test ... last_event=`delivered` ✅
- 사용자 Gmail inbox 수신 확인 (spam 아님) ✅ (2026-04-27 15:25 KST)
- Naver/Daum 직접 UAT 는 deferred ...
...
## Production state — final
| Cloud Run service | `grabit-api` ... |
| Serving revision | `grabit-api-00013-lkx` ... |
| `RESEND_API_KEY` secret | v2 enabled ... |
| `RESEND_FROM_EMAIL` secret | v1 enabled = `no-reply@heygrabit.com` |
| Resend domain | heygrabit.com verified ... |
...
- ⏳ Naver/Daum UAT, Sentry dashboard 0건 확인: 운영 트래픽 + 48h window 로 deferred 자연 검증
```

From `.planning/phases/15-resend-heygrabit-com-cutover-transactional-email-secret-mana/15-REVIEW-FIX.md` lines 25-53:

```markdown
### WR-01: Bounded in-process retry for transient Resend failures (Option A)

**Files modified:** `apps/api/src/modules/auth/email/email.service.ts`, `apps/api/src/modules/auth/email/email.service.spec.ts`
**Commit:** `0eec81d` `fix(15): WR-01 add bounded in-process retry for transient Resend failures`
...
- Module-level constants `MAX_SEND_ATTEMPTS = 3` and `RETRY_BASE_MS = 250` keep the policy auditable.
- `RETRYABLE_ERROR(msg)` regex matches Resend's documented transient failure modes plus Node network error codes...
...
1. `rate_limit_exceeded` on attempt 1 → 250ms backoff → succeeds on attempt 2 → 2 send calls, no Sentry capture.
2. Persistent `503 service unavailable` → 3 send calls + 750ms total backoff → Sentry captured once with `attempts: 3`.
```

**Target evidence to cite for human-needed rows:**

From `.planning/phases/15-resend-heygrabit-com-cutover-transactional-email-secret-mana/15-HUMAN-UAT.md` lines 28-52:

```markdown
## SC-1: 프로덕션 3사 inbox 수신 검증 (LOCKED D-14)

**Preconditions (REVIEWS HIGH H2):**
- [ ] UAT 에 사용할 Gmail / Naver / Daum(또는 Kakao) 3 개 주소가 prod grabit DB 에 가입된 계정임을 확인.
...
**체크리스트:**
- [ ] Gmail inbox 수신 시각: __________ (spam 아님 ✅ / spam 분류됨 ❌)
- [ ] Naver inbox 수신 시각: __________ (spam 아님 ✅ / spam 분류됨 ❌)
- [ ] Daum(또는 Kakao) inbox 수신 시각: __________ (spam 아님 ✅ / spam 분류됨 ❌)
```

From `.planning/phases/15-resend-heygrabit-com-cutover-transactional-email-secret-mana/15-HUMAN-UAT.md` lines 73-83 and 169-177:

```markdown
- [x] gcloud logging read (revision scoped) 결과 empty 확인 시각: 2026-04-27 12:00 KST ... + 15:30 KST ...
- [x] 검증 대상 신규 revision 이름: `grabit-api-00013-lkx` ...
- [ ] Sentry email-service 이벤트 0 건 확인 시각 (운영 트래픽 누적 후): __________ (사용자가 Sentry 대시보드에서 직접 확인 — 48h window 종료 시점)
...
- [~] Plan 03 Task 3 (3사 UAT) — Gmail (직접 발송) ✅ inbox 수신 검증. Naver/Daum 은 운영 트래픽으로 자연 검증 (deferred, 48h window 동안 monitor)
- [x] **Resend API direct smoke test PASS** — Gmail inbox 수신 확인 (2026-04-27 15:25 KST, spam 아님)
- [x] SC-2 baseline PASS (revision-scoped gcloud logging empty on `grabit-api-00013-lkx`)
```

Planner note: recommended verification status is `human_needed` because Phase 15 records completed Gmail/direct smoke and logging evidence, but Naver/Daum formal mailbox UAT and Sentry dashboard zero-count evidence remain unchecked.

---

### `.planning/phases/06-social-login-bugfix/06-02-SUMMARY.md` (metadata/frontmatter traceability update)

**Analog:** `.planning/phases/13-grapit-grabit-rename/13-01-SUMMARY.md`

**Multi-line `requirements-completed` pattern** (lines 60-63):

```yaml
requirements-completed:
  - SC-1
  - SC-4
```

**Existing target frontmatter pattern** (from `.planning/phases/06-social-login-bugfix/06-02-SUMMARY.md` lines 24-35):

```yaml
key_decisions:
  - "OAuth provider 페이지 봇 감지로 인해 callback URL 직접 접근 방식으로 E2E 테스트 구성"
patterns_established:
  - "Playwright E2E: apps/web/e2e/ 디렉토리에 spec 파일 배치, webServer로 pnpm dev 자동 실행"
requirements_completed: []
metrics:
  duration: 3m
  completed: "2026-04-09T07:08:15Z"
```

**Backfill pattern to apply:**

```yaml
requirements_completed:
  - AUTH-01
```

**Evidence supporting the metadata update:** `.planning/phases/06-social-login-bugfix/06-02-SUMMARY.md` lines 95-98 and 103-106:

```markdown
## Manual Verification (Completed)

카카오/네이버/구글 세 프로바이더 모두 재로그인 수동 검증 완료 (2026-04-09). 추가 발견: validate() 메서드의 done() 수동 호출 버그 수정 (53da7d8).
...
- Phase 06 완료 — AUTH-01 요구사항 충족
```

Planner note: keep the existing underscore key (`requirements_completed`) in this file. Do not normalize unrelated summary files.

---

### `.planning/phases/08-r2/08-03-SUMMARY.md` (metadata/frontmatter traceability update)

**Analog:** `.planning/phases/08-r2/08-01-SUMMARY.md`

**Inline `requirements-completed` pattern** (from `.planning/phases/08-r2/08-01-SUMMARY.md` lines 29-33):

```yaml
patterns-established:
  - "R2 S3Client는 반드시 forcePathStyle: true 설정 (virtual-hosted-style 미지원)"

requirements-completed: [R2-01, R2-03]
```

**Sibling summary pattern** (from `.planning/phases/08-r2/08-02-SUMMARY.md` lines 34-38):

```yaml
patterns-established:
  - "환경변수 기반 remotePatterns: r2.dev -> cdn.grapit.kr 전환 시 코드 변경 불필요"

requirements-completed: [R2-03, R2-04]
```

**Existing target frontmatter lacks requirement metadata** (from `.planning/phases/08-r2/08-03-SUMMARY.md` lines 1-11):

```yaml
---
phase: 08-r2
plan: 03
status: completed
started: "2026-04-13T03:13:00Z"
completed: "2026-04-13T03:34:00Z"
duration: "21min"
tasks_completed: 2
tasks_total: 2
files_modified: []
---
```

**Backfill pattern to apply:**

```yaml
requirements-completed: [R2-01, R2-02, R2-03, R2-04]
```

Minimal acceptable alternative:

```yaml
requirements-completed: [R2-02]
```

Planner note: prefer the broader list if the verification report explicitly ties each R2 ID to evidence from Phase 08 summaries. At minimum, add R2-02 because the audit names it as orphaned due to missing frontmatter.

## Shared Patterns

### Verification Report Section Order

**Source:** `.planning/phases/18-password-reset-production-api-origin-fix/18-VERIFICATION.md`, `.planning/phases/19-seat-lock-ownership-enforcement/19-VERIFICATION.md`, `.planning/phases/20-valkey-production-connectivity-contract/20-VERIFICATION.md`

**Apply to:** All four new `*-VERIFICATION.md` files.

Use this order:

```markdown
---
phase: <phase-slug>
verified: <timestamp>
status: <passed|human_needed>
score: <n/m must-haves verified>
overrides_applied: 0
---

# Phase XX: <Title> Verification Report

**Phase Goal:** ...
**Verified:** ...
**Status:** ...

## Goal Achievement

### Observable Truths
...
### Required Artifacts
...
### Key Link Verification
...
### Data-Flow Trace (Level 4)
...
### Behavioral Spot-Checks
...
### Requirements Coverage
...
### Anti-Patterns Found
...
### Human Verification Required
...
### Gaps Summary
...
```

Concrete section anchors from analogs:

- `Observable Truths`: `.planning/phases/19-seat-lock-ownership-enforcement/19-VERIFICATION.md` lines 29-45.
- `Required Artifacts`: `.planning/phases/19-seat-lock-ownership-enforcement/19-VERIFICATION.md` lines 47-58.
- `Key Link Verification`: `.planning/phases/19-seat-lock-ownership-enforcement/19-VERIFICATION.md` lines 60-71.
- `Data-Flow Trace`: `.planning/phases/20-valkey-production-connectivity-contract/20-VERIFICATION.md` lines 72-81.
- `Behavioral Spot-Checks`: `.planning/phases/20-valkey-production-connectivity-contract/20-VERIFICATION.md` lines 82-92.
- `Requirements Coverage`: `.planning/phases/18-password-reset-production-api-origin-fix/18-VERIFICATION.md` lines 98-108.
- `Human Verification Required`: `.planning/phases/20-valkey-production-connectivity-contract/20-VERIFICATION.md` lines 117-130.

### Status Vocabulary

**Source:** `.planning/phases/18-password-reset-production-api-origin-fix/18-VERIFICATION.md` lines 24-40 and 100-108; `.planning/phases/20-valkey-production-connectivity-contract/20-VERIFICATION.md` lines 34-42 and 98-105.

**Apply to:** All verification reports.

Use these statuses:

| Status | Use When |
|--------|----------|
| `VERIFIED` | Local artifact/code/command evidence directly proves the truth. |
| `SATISFIED` | Requirement coverage is complete for a requirement defined in `.planning/REQUIREMENTS.md`. |
| `HUMAN NEEDED` | External account/dashboard/runtime evidence is required and not present. |
| `UNCERTAIN` | Evidence exists but does not reach the stated truth; prefer this for a single row inside a mostly verified report. |
| `PARTIAL` / `PARTIAL, NOT REQUIREMENTS-DEFINED` | Some evidence exists, but a defined subcondition is not proven or the ID is planning-only. |
| `RECORDED, NOT REQUIREMENTS-DEFINED` | Planning-only IDs such as `CUTOVER-*` are documented but absent from `.planning/REQUIREMENTS.md`. |

### Non-Fabrication Guard

**Source:** `.planning/v1.1-MILESTONE-AUDIT.md` lines 184-194 and 227-234.

**Apply to:** Phase 13 and 15 most strongly; also R2 CORS chronology.

```markdown
| Gate | Score | Notes |
|------|-------|-------|
| Requirements | 5/33 | Strict 3-source score: REQUIREMENTS traceability + VERIFICATION row + SUMMARY frontmatter |
| Phase verification | 10/14 | Missing `*-VERIFICATION.md`: 06, 08, 13, 15 |
...
- `satisfied`: verification passed, summary frontmatter lists it, and traceability is complete or stale only
- `partial`: implementation evidence exists but one source is missing, stale, or human-needed
- `orphaned`: present in REQUIREMENTS traceability but absent from all phase VERIFICATION files
- `unsatisfied`: integration or verification evidence shows a real blocker
```

Do not convert unchecked human checkboxes or UAT `issue` rows into `SATISFIED`. If a later phase fixed an issue, cite that later artifact separately rather than changing historical Phase 13/15 evidence.

### Requirement Frontmatter Traceability

**Source:** `.planning/v1.1-MILESTONE-AUDIT.md` lines 30-46 and 211-215.

**Apply to:** `06-02-SUMMARY.md` and `08-03-SUMMARY.md`.

Audit gap source:

```markdown
- id: AUTH-01
  status: orphaned
  evidence: "No 06-VERIFICATION.md exists; AUTH-01 is absent from all phase VERIFICATION files."
- id: R2-02
  status: orphaned
  evidence: "08-VERIFICATION.md is missing and R2-02 is not present in any SUMMARY requirements_completed frontmatter."
...
| AUTH-01 | orphaned | Present in REQUIREMENTS traceability but absent from all phase VERIFICATION files |
| R2-02 | orphaned | Claimed in Phase 8 prose, but no verification row and no `requirements_completed` frontmatter |
```

Planner should make only the minimal metadata edits needed for those rows unless another validation pass proves more frontmatter is required.

## No Analog Found

None. All target files have close analogs in existing planning artifacts.

## Metadata

**Analog search scope:** `.planning/phases/**/*-VERIFICATION.md`, `.planning/phases/**/*SUMMARY.md`, target phase evidence files, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, `.planning/v1.1-MILESTONE-AUDIT.md`, `.planning/quick/260427-pcf-r2-cors/260427-pcf-SUMMARY.md`

**Primary analogs read:** 3 verification reports (`18-VERIFICATION.md`, `19-VERIFICATION.md`, `20-VERIFICATION.md`), 4 target phase evidence sets (06, 08, 13, 15), requirements, roadmap, audit, and Phase 21 research.

**Project instructions:** `AGENTS.md` requires Korean user-facing output, existing codebase patterns, GSD workflow artifacts, and no unrelated code/source edits.

**Pattern extraction date:** 2026-05-04
