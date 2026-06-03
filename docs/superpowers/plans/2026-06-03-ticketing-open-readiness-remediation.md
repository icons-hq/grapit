# Ticketing Open Readiness Remediation Implementation Plan

> REQUIRED: Execute this plan with `superpowers:subagent-driven-development`. Before each task, the implementer must research the listed files, restate the task-specific plan, then implement, test, self-review, and commit.

**Goal:** Close the code-remediable launch blockers from `docs/uat/ticketing-open-readiness-uat-2026-05-29.md`, while leaving explicit evidence gates for items that require live provider, production, or operations access.

**Architecture:** Keep changes small and aligned with the current modular monolith. Public launch surfaces use existing Next.js locale routing and existing NestJS support-content tables. Runtime readiness remains no-go unless the external Gate Ledger evidence is provided.

**Tech Stack:** Next.js 16, React 19, TanStack Query, NestJS 11, Drizzle ORM, Vitest, Playwright.

---

## Source Findings

- UAT verdict was **No-Go** because booking was disabled, local Redis was in-memory, cutover gates were unresolved, Toss/SMS happy paths were not proven, support/i18n surfaces had launch gaps, QR rehearsal origin could point to production, and seeded phone values caused E.164 browser warnings.
- Code-remediable gaps in this branch:
  - `/support` and `/en/support` are missing public routes.
  - Admin support content exists, but public read surfaces do not.
  - Public sitemap does not include support routes.
  - Footer support CTA is a `mailto:` link instead of a support page link.
  - Search pagination aria labels are hardcoded Korean.
  - Launch copy manifest does not include the support namespace.
  - Public `StatusBadge` renders `오픈` / `On sale` from performance status even when runtime `bookingEnabled` is false.
  - Public performance list/search/detail queries do not consistently require `publishState = 'published'`.
  - QR URL generation falls back from local HTTP to `https://heygrabit.com` unless the current origin is HTTPS.
  - Local Docker compose starts Postgres only; no Valkey/Redis service is available for local queue/seat-lock parity rehearsals.
  - Seed/browser mock phone values include `010-0000-0000` style strings that are not safe `react-phone-number-input` controlled values.
- Evidence-only gates that cannot be truthfully completed by code alone:
  - Toss sandbox/live-key smoke under approved payment runbook.
  - Real SMS OTP happy path with a controlled provider-mode number.
  - Valkey cluster-parity rehearsal against real Redis/Valkey.
  - 10K baseline / 20K stress result evidence.
  - Cloud Run rollback, Cloud SQL PITR, Valkey reconnect, WAF, on-call, first-24h watch, and cleanup-isolation drills.

## Task Order

1. Public support page, public support-content read API, and support/i18n launch surfaces.
2. Public performance publish filtering and runtime booking gate display status.
3. QR rehearsal origin override, local Valkey option, and E.164 fixture cleanup.
4. Readiness evidence documentation update for remaining live gates.
5. Whole-branch verification and final review.

---

### Task 1: Public Support Page, Published Content, And I18n Launch Surfaces

**Files:**
- Create: `apps/web/app/support/page.tsx`
- Create: `apps/web/app/support/__tests__/support-page.test.tsx`
- Create: `apps/web/hooks/use-support-content.ts`
- Create: `apps/api/src/modules/admin/public-support-content.controller.ts`
- Modify: `apps/api/src/modules/admin/admin-support-content.service.ts`
- Modify: `apps/api/src/modules/admin/admin-support-content.service.spec.ts`
- Modify: `apps/api/src/modules/admin/admin.module.ts`
- Modify: `apps/web/components/layout/footer.tsx`
- Modify: `apps/web/components/layout/__tests__/footer.test.tsx`
- Modify: `apps/web/components/performance/pagination-nav.tsx`
- Modify: `apps/web/components/performance/__tests__/pagination-nav.test.tsx`
- Modify: `apps/web/app/sitemap.ts`
- Modify: `apps/web/app/__tests__/sitemap.test.ts`
- Modify: `apps/web/e2e/i18n-smoke.spec.ts`
- Modify: `apps/web/lib/i18n/visible-copy.ts`
- Modify: `packages/shared/src/i18n/launch-copy-keys.ts`
- Modify: `packages/shared/src/i18n/launch-copy-keys.test.ts`
- Modify: `apps/web/messages/ko.json`
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/th.json`
- Modify: `apps/web/messages/zh-CN.json`

- [ ] **Step 1: Research before editing**

  Confirm current route absence, locale routing, admin support content contract, footer behavior, sitemap coverage, launch-copy manifest, and hardcoded pagination labels:

  ```bash
  test ! -e apps/web/app/support/page.tsx
  sed -n '1,240p' apps/api/src/modules/admin/admin-support-content.service.ts
  sed -n '1,220p' apps/api/src/modules/admin/admin-support-content.controller.ts
  sed -n '1,220p' apps/web/components/layout/footer.tsx
  sed -n '1,200p' apps/web/components/performance/pagination-nav.tsx
  sed -n '1,180p' apps/web/app/sitemap.ts
  sed -n '1,180p' packages/shared/src/i18n/launch-copy-keys.ts
  rg -n 'support|Support|고객센터|Pagination|페이지' apps/web/messages apps/web/e2e apps/web/app apps/web/components
  ```

- [ ] **Step 2: Add failing API service test**

  In `apps/api/src/modules/admin/admin-support-content.service.spec.ts`, add a test that creates published and draft FAQ/notice rows, then expects `listPublished({ locale: 'en' })` to return only published English rows sorted with pinned FAQs first and no archived/draft content.

  Run:

  ```bash
  pnpm --filter @grabit/api exec vitest run src/modules/admin/admin-support-content.service.spec.ts
  ```

  Expected: FAIL because `listPublished` is not implemented.

- [ ] **Step 3: Implement published support-content read model**

  Add public DTO types and `listPublished({ locale })` to `AdminSupportContentService`. It must:

  - Return only FAQ rows with `reviewState === 'published'`.
  - Return only notice rows with `status === 'published'` and `reviewState === 'published'`.
  - Filter by requested locale.
  - Sort FAQs by `isPinned DESC`, `sortOrder ASC`, then `updatedAt DESC`.
  - Sort notices by priority (`urgent`, `high`, `normal`, `low`), then `publishedAt DESC`.
  - Expose only public fields; no actor IDs or review metadata.

- [ ] **Step 4: Add public API controller**

  Create `PublicSupportContentController` under the admin module:

  - `@Public()`
  - `@SkipThrottle()`
  - `@Controller('support-content')`
  - `GET /api/v1/support-content?locale=en`
  - Validate locale with `SUPPORT_CONTENT_LOCALES`.
  - Return `service.listPublished({ locale })`.

- [ ] **Step 5: Add public web hook and fallback copy**

  Create `useSupportContent(locale)` with TanStack Query against `/api/v1/support-content?locale=${locale}`.

  Add `support` messages per launch locale containing:

  - Page title.
  - Notice heading.
  - FAQ heading.
  - Empty/fallback notice.
  - Contact email label.
  - Static launch FAQ fallback for booking opening, payment/QR entry, refund/support contact.

- [ ] **Step 6: Add `/support` page**

  The page must:

  - Use existing locale resolution.
  - Render published API content if present.
  - Render static launch fallback content if API returns empty or errors.
  - Keep support email visible.
  - Avoid marketing/landing hero styling.

- [ ] **Step 7: Update public support/i18n surfaces**

  - Change footer support link from `mailto:` to localized `/support`; keep support email visible in business info.
  - Add support paths to sitemap and sitemap tests.
  - Add support namespace to launch copy keys and visible-copy tests.
  - Add `/support` and `/en/support` to the i18n smoke coverage.
  - Localize search pagination aria labels instead of hardcoded Korean.

- [ ] **Step 8: Verify task**

  ```bash
  pnpm --filter @grabit/api exec vitest run src/modules/admin/admin-support-content.service.spec.ts
  pnpm --filter @grabit/web exec vitest run app/support/__tests__/support-page.test.tsx components/layout/__tests__/footer.test.tsx components/performance/__tests__/pagination-nav.test.tsx app/__tests__/sitemap.test.ts
  pnpm --filter @grabit/web exec playwright test e2e/i18n-smoke.spec.ts
  pnpm --filter @grabit/shared exec vitest run src/i18n/launch-copy-keys.test.ts
  ```

- [ ] **Step 9: Commit**

  ```bash
  git add apps/api/src/modules/admin apps/web/app/support apps/web/hooks/use-support-content.ts apps/web/components/layout apps/web/components/performance apps/web/app/sitemap.ts apps/web/app/__tests__/sitemap.test.ts apps/web/e2e/i18n-smoke.spec.ts apps/web/lib/i18n/visible-copy.ts apps/web/messages packages/shared/src/i18n
  git commit -m "feat: add public support readiness surface"
  ```

---

### Task 2: Public Performance Publish Filtering And Runtime Booking Gate Display Status

**Files:**
- Modify: `apps/web/components/performance/status-badge.tsx`
- Modify: `apps/web/components/performance/performance-card.tsx`
- Modify: `apps/web/app/performance/[id]/page.tsx`
- Modify: `apps/web/components/performance/__tests__/status-badge.test.tsx`
- Modify: `apps/web/app/performance/[id]/__tests__/performance-detail-formatting.test.tsx`
- Modify: `apps/web/app/__tests__/home-i18n.test.tsx`
- Modify: `packages/shared/src/types/performance.types.ts`
- Modify: `apps/api/src/modules/performance/performance.service.ts`
- Modify: `apps/api/src/modules/performance/performance.service.spec.ts`
- Modify: `apps/api/src/modules/search/search.service.ts`
- Modify: `apps/api/src/modules/search/search.service.spec.ts`

- [ ] **Step 1: Research before editing**

  ```bash
  sed -n '1,180p' apps/web/components/performance/status-badge.tsx
  sed -n '1,180p' apps/web/components/performance/performance-card.tsx
  rg -n "StatusBadge" apps/web/app apps/web/components
  rg -n "publishState|published" apps/api/src/modules/performance apps/api/src/modules/search packages/shared/src/types/performance.types.ts
  ```

- [ ] **Step 2: Add failing tests**

  Add tests proving:

  - `PerformanceService.findByGenre`, `getHotPerformances`, `getNewPerformances`, `findById`, and `SearchService.search` include `performances.publishState = 'published'` for public reads.
  - `PerformanceService.findById` returns `null` for non-published rows unless `includeHiddenCopy` is explicitly used by admin.
  - `getDisplayPerformanceStatus('selling', false)` returns `upcoming`.
  - `getDisplayPerformanceStatus('closing_soon', false)` returns `upcoming`.
  - `ended` remains `ended`.
  - Home card and detail page do not render `On sale` / `오픈` when runtime booking is disabled.

- [ ] **Step 3: Implement public publish filters**

  Add `eq(performances.publishState, 'published')` to public list/search/home/detail queries.

  Preserve admin hidden-copy reads by allowing `findById(id, locale, { includeHiddenCopy: true })` to bypass the public publish-state filter.

- [ ] **Step 4: Implement display status resolver**

  Export `getDisplayPerformanceStatus(status, bookingEnabled)` from `status-badge.tsx`.

  Use it in:

  - `PerformanceCard`, via `useRuntimeFlags()`.
  - `PerformanceDetailPage`, via existing `useBookingAvailability()` result or runtime flag data.

  Do not change underlying API status or booking enablement logic.

- [ ] **Step 5: Verify task**

  ```bash
  pnpm --filter @grabit/api exec vitest run src/modules/performance/performance.service.spec.ts src/modules/search/search.service.spec.ts
  pnpm --filter @grabit/web exec vitest run components/performance/__tests__/status-badge.test.tsx app/performance/[id]/__tests__/performance-detail-formatting.test.tsx app/__tests__/home-i18n.test.tsx
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add apps/api/src/modules/performance apps/api/src/modules/search packages/shared/src/types/performance.types.ts apps/web/components/performance apps/web/app/performance/[id] apps/web/app/__tests__/home-i18n.test.tsx
  git commit -m "fix: hide sale badges while booking gate is closed"
  ```

---

### Task 3: QR Origin Override, Local Valkey Option, And E.164 Fixture Cleanup

**Files:**
- Modify: `apps/web/components/field/qr-ticket-image.tsx`
- Modify: `apps/web/components/field/__tests__/qr-ticket-image.test.tsx`
- Modify: `.env.example`
- Modify: `docker-compose.yml`
- Modify: `apps/api/src/database/seed.mjs`
- Modify: `apps/web/e2e/helpers/mock-admin.ts`
- Modify: browser mock fixtures containing user `phone: '010-...'` where the value is rendered into React phone input state.

- [ ] **Step 1: Research before editing**

  ```bash
  sed -n '1,140p' apps/web/components/field/qr-ticket-image.tsx
  sed -n '1,180p' docker-compose.yml
  sed -n '1,160p' .env.example
  rg -n "phone: '010-|010-0000-0000|010-0000-2727|010-1234-5678" apps/web/e2e apps/api/src/database/seed.mjs
  ```

- [ ] **Step 2: Add failing QR origin test**

  In `qr-ticket-image.test.tsx`, dynamically import the module after stubbing:

  ```ts
  vi.stubEnv('NEXT_PUBLIC_QR_PUBLIC_WEB_ORIGIN', 'https://field-rehearsal.example.com');
  ```

  Assert `buildQrCheckInUrl('token')` returns `https://field-rehearsal.example.com/field/check-in?ticket=token`.

- [ ] **Step 3: Implement origin resolver**

  `buildQrCheckInUrl()` must choose origin in this order:

  1. Valid configured `process.env.NEXT_PUBLIC_QR_PUBLIC_WEB_ORIGIN`.
  2. Current browser `window.location.origin` when HTTPS.
  3. `https://heygrabit.com`.

  Production must accept configured HTTPS origins only. Non-production may accept explicitly configured `http://localhost`, `http://127.0.0.1`, or private/LAN HTTP origins for phone-camera rehearsal. Invalid or path-containing configured values must be ignored.

- [ ] **Step 4: Add local Valkey compose option**

  Add a `valkey` service to `docker-compose.yml`:

  - Image: `valkey/valkey:8-alpine`
  - Port: `6379:6379`
  - Healthcheck: `valkey-cli ping`

  Add `.env.example` entries for:

  - `VALKEY_MODE=redis`
  - `REDIS_URL=redis://localhost:6379`
  - `NEXT_PUBLIC_QR_PUBLIC_WEB_ORIGIN=http://localhost:3000`

- [ ] **Step 5: Clean unsafe phone fixtures**

  Replace seeded or browser-mock user phone values that are rendered into controlled phone inputs with E.164 values such as `+821000000000` or `+821000002727`.

  Do not change:

  - User input strings in signup/booking tests that intentionally type local Korean phone numbers.
  - Toss widget placeholder/metadata tests that intentionally verify `010-0000-0000`.
  - SMS parsing utility tests.

- [ ] **Step 6: Verify task**

  ```bash
  pnpm --filter @grabit/web exec vitest run components/field/__tests__/qr-ticket-image.test.tsx
  pnpm --filter @grabit/api exec node --check src/database/seed.mjs
  docker compose config >/tmp/grabit-compose-config.txt
  ```

- [ ] **Step 7: Commit**

  ```bash
  git add apps/web/components/field .env.example docker-compose.yml apps/api/src/database/seed.mjs apps/web/e2e
  git commit -m "chore: support local readiness rehearsal config"
  ```

---

### Task 4: Readiness Evidence Documentation Update

**Files:**
- Create or modify: `docs/uat/ticketing-open-readiness-remediation-2026-06-03.md`
- Modify if present and tracked: `docs/uat/ticketing-open-readiness-uat-2026-05-29.md`

- [ ] **Step 1: Research before editing**

  ```bash
  git ls-files docs/uat
  test -f docs/uat/ticketing-open-readiness-uat-2026-05-29.md && sed -n '1,240p' docs/uat/ticketing-open-readiness-uat-2026-05-29.md || true
  git log --oneline -- docs/uat | head
  ```

- [ ] **Step 2: Document code-remediated gates**

  Create/update a remediation note that maps each UAT blocker to:

  - Branch commit or changed surface.
  - Verification command.
  - Remaining risk.
  - Whether the gate is code-remediated or still evidence-only.

- [ ] **Step 3: Keep external write gates explicit**

  Do not claim completion for:

  - Toss real payment.
  - Real SMS OTP.
  - Production Cloud Run, Cloud SQL, Valkey, WAF, on-call, load/stress, DR, cleanup drills.

  Instead, list the exact evidence required and mark them `BLOCKED: requires approved live/provider/ops runbook`.

- [ ] **Step 4: Verify task**

  ```bash
  git diff --check -- docs/uat
  rg -n "sk_live|secret|Authorization|Bearer|COOKIE|password" docs/uat || true
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add docs/uat
  git commit -m "docs: record ticketing readiness remediation gates"
  ```

---

### Task 5: Whole-Branch Verification And Final Review

- [ ] **Step 1: Research changed scope**

  ```bash
  git status --short --branch
  git log --oneline origin/main..HEAD
  git diff --stat origin/main...HEAD
  ```

- [ ] **Step 2: Run scoped verification**

  ```bash
  pnpm --filter @grabit/api exec vitest run src/modules/admin/admin-support-content.service.spec.ts src/modules/performance/performance.service.spec.ts src/modules/search/search.service.spec.ts
  pnpm --filter @grabit/web exec vitest run app/support/__tests__/support-page.test.tsx components/layout/__tests__/footer.test.tsx components/performance/__tests__/pagination-nav.test.tsx components/performance/__tests__/status-badge.test.tsx components/field/__tests__/qr-ticket-image.test.tsx app/__tests__/sitemap.test.ts app/__tests__/home-i18n.test.tsx app/performance/[id]/__tests__/performance-detail-formatting.test.tsx
  pnpm --filter @grabit/shared exec vitest run src/i18n/launch-copy-keys.test.ts
  pnpm lint
  pnpm typecheck
  pnpm test
  docker compose config >/tmp/grabit-compose-config.txt
  git diff --check
  ```

- [ ] **Step 3: Browser smoke if local server can start**

  Start local web/api only if no conflicting owner process exists. Smoke:

  - `/support`
  - `/en/support`
  - home card with booking gate disabled
  - QR rendering page/component path if available

- [ ] **Step 4: Final code review**

  Dispatch a fresh reviewer over `origin/main...HEAD` for spec compliance and quality. Fix Critical/Important findings before reporting completion.

- [ ] **Step 5: Final report**

  Report:

  - Commits created.
  - Verification commands and pass/fail status.
  - Code-remediated UAT blockers.
  - Evidence-only gates still requiring live/provider/ops approval.
