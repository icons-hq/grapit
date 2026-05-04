# Phase 22: Preflight Closure - Research

**Researched:** 2026-05-04 [VERIFIED: environment_context.current_date]
**Domain:** launch-readiness evidence closure, validation backfill, operational hardening [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md]
**Confidence:** HIGH [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md; VERIFIED: .planning/REQUIREMENTS.md; VERIFIED: git ls-tree -r --name-only bd8220e -- .planning/phases]

<user_constraints>
## User Constraints (from CONTEXT.md)

Source for all copied user constraints in this section: [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md]

### Locked Decisions

## Phase Boundary

Phase 22 is now the merged v2.0 preflight phase. It closes the launch-facing operator/human gates inherited from Phase 14 SMS OTP, Phase 15 email cutover, and Phase 16 legal launch; backfills v1.1 validation artifacts into a launch-readiness baseline; and resolves or classifies Valkey/R2/SMS/email/legal fragility as launch blockers.

This phase does not add new fanmeet product functionality, global SMS expansion, multinational consent, admin console scope, or booking/payment features. It may plan direct fixes when a failed gate or hardening finding is on an already-shipped surface that must be stable before Phase 23 Launch Foundation expands the launch surface.

**Merged former phases:** 22 Operator UAT gates, 23 Nyquist validation backfill, 24 Operational hardening sweep.

## Implementation Decisions

### Evidence Acceptance Policy
- **D-01:** Use a gate matrix. `PASS` requires direct evidence, `ACCEPTED_RISK` requires explicit risk acceptance, and `BLOCKER` means a launch path can break and evidence is missing or failing.
- **D-02:** `ACCEPTED_RISK` requires both maintainer and operator approval. The maintainer records the technical risk; the operator accepts the business launch risk.
- **D-03:** Phase 22 writes a v2.0-only evidence ledger and launch-readiness baseline. Do not rewrite historical Phase 14/15/16 artifacts as if they had new evidence; reference them as canonical context and supplement traceability only where the backfill task explicitly owns it.
- **D-04:** Use the status terms `PASS`, `ACCEPTED_RISK`, and `BLOCKER` consistently across the Phase 22 gate ledger, UAT, and verification docs.

### SMS Real-Device Gate
- **D-05:** SMS `PASS` requires a real-device signup OTP happy path and failure-copy verification. The happy path is `send-code -> SMS received -> verify-code success -> signup step3 verified`.
- **D-06:** Failure-copy verification must show that wrong code, expired/resend, and system-error messages are not collapsed into the same "wrong OTP" copy. This closes the Phase 14 server-message-priority intent.
- **D-07:** Run a short targeted observation window immediately after real-device UAT. Check the last 1 hour for `sms.verify_failed`, `CROSSSLOT`, and Sentry `provider=valkey` errors.
- **D-08:** SMS evidence should be screenshots plus sanitized logs. Mask test phone numbers and do not include raw OTPs.
- **D-09:** If SMS fails on the same Phase 14 SMS path, Phase 22 may include the fix plan. Global SMS expansion, provider-cost monitoring, and 5-country SMS policy belong to Phase 23 Launch Foundation unless an existing SMS fragility blocks preflight closure.

### Email Inbox Gate
- **D-10:** Email `PASS` requires Resend accepted evidence plus one inbox observation. The chosen inbox is Gmail.
- **D-11:** Naver/Daum untested or unconfirmed status defaults to `ACCEPTED_RISK`, not `BLOCKER`, as long as D-02 maintainer/operator approval is recorded.
- **D-12:** The user flow to verify is password reset email -> reset confirm -> login with the new password. Do not stop at email receipt only.
- **D-13:** Email evidence must be a redacted bundle: Resend email id, Cloud Run/Sentry result, and Gmail screenshot. Redact email address, reset token, reset link, and any secret values.

### Legal Public/Sign-Off Gate
- **D-14:** Legal technical `PASS` requires public URL checks, Footer link checks, signup/booking dialog content checks, and production robots/canonical checks.
- **D-15:** Legal sign-off is factual sign-off only. The operator confirms business identity, representative, business registration number, mail-order registration number, address, customer support contact, privacy/support mailbox, and effective date. External legal counsel review is not required in this phase.
- **D-16:** Include `support@heygrabit.com` and `privacy@heygrabit.com` mailbox receipt checks in the legal gate.
- **D-17:** If legal gate fails on direct Phase 16 launch surface gaps such as route, link, robots/canonical, placeholder gate, mailbox receipt, or sign-off document gaps, Phase 22 may include fix plans. Multinational consent, legal schema lock, and PIPA/PDPA/PIPL expansion belong to Phase 23 Launch Foundation.

### Validation Backfill Gate
- **D-18:** Validation backfill should classify each v1.1 gap as `COMPLETE`, `ACCEPTED_CAVEAT`, or `BLOCKER`, with an evidence path or explicit reason.
- **D-19:** Do not mark human-needed or operator-needed evidence as automated proof. If evidence still needs a person, keep it visible as a gate or accepted caveat.
- **D-20:** Traceability updates are allowed when they point to existing evidence or the new Phase 22 baseline; they must not imply prior work was newly executed.

### Operational Hardening Gate
- **D-21:** Valkey/R2/SMS/email/legal fragile points should close as one of: concrete fix, accepted risk with owner/date, or launch blocker.
- **D-22:** Pre-existing debug sessions should be closed, converted into explicit v2.0 risks, or linked to a Phase 22 fix task.
- **D-23:** Any direct code fix in this phase must stay on already-shipped operational surfaces. New fanmeet functionality starts in Phase 23+.

### the agent's Discretion
No discretionary implementation choices were delegated to the agent. Downstream agents should follow the locked decisions above.

### Deferred Ideas (OUT OF SCOPE)

- Five-country SMS policy, provider cost monitoring, and global SMS launch behavior belong to Phase 23 Launch Foundation unless an existing blocker must be closed in Phase 22.
- Multinational consent, legal schema lock, PIPA/PDPA/PIPL expansion, and audit log behavior belong to Phase 23 Launch Foundation.
- Naver/Daum mailbox behavior can be rechecked in Phase 26 M1 Canary + Cutover Gates if left as `ACCEPTED_RISK` in Phase 22.
</user_constraints>

## Summary

Phase 22 should be planned as an evidence-closure and blocker-classification phase, not as a feature phase. The phase owns launch-facing proof for SMS real-device signup OTP, Gmail-backed password reset-to-login, public legal/sign-off readiness, v1.1 validation backfill, and Valkey/R2/SMS/email/legal fragility classification. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md; VERIFIED: .planning/REQUIREMENTS.md]

The strongest planning pattern is a small set of v2.0-owned artifacts: one gate ledger, one human UAT/evidence artifact, one validation baseline, one hardening register, and one verification summary. These artifacts should reference historical v1.1 evidence without rewriting it, because Phase 22 decisions explicitly prohibit rewriting Phase 14/15/16 artifacts as if new evidence had been gathered. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md; VERIFIED: git show bd8220e:.planning/phases/14-sms-otp-crossslot-fix-sms-valkey-cluster-hash-tag/14-VERIFICATION.md; VERIFIED: git show bd8220e:.planning/phases/15-resend-heygrabit-com-cutover-transactional-email-secret-mana/15-VERIFICATION.md; VERIFIED: git show bd8220e:.planning/phases/16-legal-pages-launch-url/16-VERIFICATION.md]

**Primary recommendation:** Plan Phase 22 around a traceable gate matrix with exact statuses `PASS`, `ACCEPTED_RISK`, `BLOCKER`, plus a separate v1.1 validation baseline using `COMPLETE`, `ACCEPTED_CAVEAT`, `BLOCKER`; do not add fanmeet product scope or new admin UI. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md; VERIFIED: .planning/phases/22-preflight-closure/22-UI-SPEC.md]

## Project Constraints (from AGENTS.md)

- User-facing responses must be written in Korean while technical terms and code identifiers remain in English. [VERIFIED: AGENTS.md]
- Claude and `~/.claude` configuration, files, and workflows must not be modified for Codex GSD subagent handling. [VERIFIED: AGENTS.md]
- GSD subagent timeout or empty status is not itself failure; artifact contracts such as `PLAN.md`, `RESEARCH.md`, `PATTERNS.md`, `SUMMARY.md`, verification markers, or commits are the completion signal. [VERIFIED: AGENTS.md]
- The project is a one-person monolith-first ticketing platform, so Phase 22 planning should minimize operational complexity and avoid new platform surfaces. [VERIFIED: AGENTS.md; VERIFIED: .planning/PROJECT.md]
- The project stack should follow the documented stack in project architecture docs and existing monorepo packages. [VERIFIED: AGENTS.md; VERIFIED: package.json; VERIFIED: apps/api/package.json; VERIFIED: apps/web/package.json]
- The root `.env` file is the local environment source; separate `apps/api/.env` or `apps/web/.env` files should not be planned. [VERIFIED: AGENTS.md]
- `drizzle-kit` commands through `pnpm --filter @grabit/api` require `DOTENV_CONFIG_PATH=../../.env` because the filtered command changes cwd to `apps/api/`. [VERIFIED: AGENTS.md]
- Cloud Run production config uses GCP Secret Manager or Cloud Run environment variables, not `.env` files. [VERIFIED: AGENTS.md]
- Direct repo edits should happen inside the GSD workflow; this research artifact is being written as the requested Phase 22 research artifact. [VERIFIED: AGENTS.md; VERIFIED: user objective]

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PREF-01 | Operator can complete launch-facing SMS, legal, email real-device/sign-off gates with evidence before fanmeet implementation starts. [VERIFIED: .planning/REQUIREMENTS.md] | Gate matrix, human evidence rules, SMS/email/legal evidence patterns, redaction rules, and environment audit below define what the planner must schedule. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md; VERIFIED: apps/api/src/modules/sms/sms.service.ts; VERIFIED: apps/api/src/modules/auth/email/email.service.ts; VERIFIED: apps/web/app/legal/terms/page.tsx] |
| PREF-02 | Maintainer can backfill v1.1 validation artifacts into clear v2.0 launch-readiness baseline. [VERIFIED: .planning/REQUIREMENTS.md] | Historical Phase 14/15/16/18/20/21 verification artifacts were found in git history, and Phase 22 must classify gaps without rewriting those artifacts. [VERIFIED: git ls-tree -r --name-only bd8220e -- .planning/phases; VERIFIED: git show bd8220e:.planning/phases/21-verification-artifact-backfill/21-VERIFICATION.md; VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md] |
| PREF-03 | Maintainer can close/mitigate Valkey, R2, SMS, email, legal operational fragility as explicit launch blockers. [VERIFIED: .planning/REQUIREMENTS.md] | Runtime state inventory, hardening register pattern, Valkey/R2/email/SMS/legal source inspection, and common pitfalls below identify concrete fix versus accepted risk versus blocker planning paths. [VERIFIED: apps/api/src/modules/sms/sms.service.ts; VERIFIED: apps/api/src/modules/admin/upload.service.ts; VERIFIED: apps/api/src/modules/auth/email/email.service.ts; VERIFIED: scripts/smoke-valkey-production.mjs; VERIFIED: .planning/STATE.md] |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| SMS real-device signup OTP gate | API / Backend | Browser / Client, Valkey, SMS provider, Observability | `SmsService` owns OTP send/verify, Valkey keying, failure handling, logging, and Sentry tags; the browser owns the signup UI evidence path and server message display. [VERIFIED: apps/api/src/modules/sms/sms.service.ts; VERIFIED: apps/web/components/auth/phone-verification.tsx; VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md] |
| Email reset-to-login gate | API / Backend | Browser / Client, Resend, Cloud Run/Sentry | `EmailService` owns Resend send and error capture, while the reset page owns request/confirm UX and production API-origin flow; evidence requires Gmail receipt plus reset confirm and login. [VERIFIED: apps/api/src/modules/auth/email/email.service.ts; VERIFIED: apps/web/app/auth/reset-password/page.tsx; VERIFIED: apps/web/app/auth/reset-password/__tests__/reset-password.test.tsx; VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md] |
| Legal public/sign-off gate | Frontend Server / Static | Operator / Business, Mailbox | Legal pages, metadata, robots, canonical tags, and Footer links are frontend/static launch surfaces; factual business sign-off and mailbox receipt are operator-owned evidence. [VERIFIED: apps/web/app/legal/terms/page.tsx; VERIFIED: apps/web/app/legal/privacy/page.tsx; VERIFIED: apps/web/app/legal/marketing/page.tsx; VERIFIED: apps/web/components/layout/footer.tsx; VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md] |
| v1.1 validation baseline | Planning / Docs | Test Runner, Git history | Phase 22 owns a v2.0 baseline that references archived v1.1 artifacts, and existing tests/verification artifacts support evidence classification. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md; VERIFIED: git show bd8220e:.planning/phases/21-verification-artifact-backfill/21-VERIFICATION.md] |
| Valkey/R2/SMS/email/legal hardening closure | API / Backend and Infra | Planning / Docs | Fragility findings live in code paths, Cloud Run/runtime config, R2/Resend/Sentry external systems, and planning debug state; Phase 22 must close each as fix, accepted risk, or blocker. [VERIFIED: apps/api/src/modules/sms/sms.service.ts; VERIFIED: apps/api/src/modules/admin/upload.service.ts; VERIFIED: apps/api/src/modules/auth/email/email.service.ts; VERIFIED: scripts/smoke-valkey-production.mjs; VERIFIED: .planning/STATE.md] |

## Standard Stack

### Core

| Library / Tool | Project Version | Latest Verified | Purpose | Why Standard |
|----------------|-----------------|-----------------|---------|--------------|
| Node.js | engines `>=22`; local `v25.9.0` | local `v25.9.0` | Runs monorepo tooling and tests. | Project package declares Node `>=22`, but local shell is newer than the documented Node 22 LTS target, so planner should prefer CI/project engines for final proof. [VERIFIED: package.json; VERIFIED: node --version] |
| pnpm | `10.28.1` | local `10.28.1` | Monorepo package manager and script runner. | Root `packageManager` pins pnpm, and local shell matches it. [VERIFIED: package.json; VERIFIED: pnpm --version] |
| Vitest | project `^3.2.0` | npm latest `4.1.5`, modified 2026-04-23 | Existing unit and integration test runner. | API and web apps already use Vitest configs; Phase 22 should run focused existing tests rather than migrate test runners. [VERIFIED: apps/api/package.json; VERIFIED: apps/web/package.json; VERIFIED: apps/api/vitest.config.ts; VERIFIED: apps/web/vitest.config.ts; VERIFIED: npm view vitest version time.modified] |
| @playwright/test | project `^1.59.1` | npm latest `1.59.1`, modified 2026-05-04 | Optional browser E2E evidence for shipped web flows. | Web app already has Playwright config and e2e specs; use it only where automated browser proof is needed. [VERIFIED: apps/web/package.json; VERIFIED: apps/web/playwright.config.ts; VERIFIED: npm view @playwright/test version time.modified] |
| ioredis | project `^5.10.1` | npm latest `5.10.1`, modified 2026-03-19 | TCP Redis/Valkey client used by Socket.IO/cluster paths. | Existing backend uses ioredis for Valkey/Redis behavior; do not introduce another Redis client for Phase 22 proof. [VERIFIED: apps/api/package.json; VERIFIED: apps/api/src/modules/booking/redis-io.adapter.ts; VERIFIED: npm view ioredis version time.modified] |
| resend | project `^6.11.0` | npm latest `6.12.2`, modified 2026-04-20 | Transactional email provider SDK. | Existing `EmailService` uses Resend and returns a provider email id on accepted sends. [VERIFIED: apps/api/package.json; VERIFIED: apps/api/src/modules/auth/email/email.service.ts; VERIFIED: npm view resend version time.modified] |
| @aws-sdk/client-s3 | project `^3.1020.0` | npm latest `3.1041.0`, modified 2026-05-01 | Cloudflare R2 S3-compatible upload integration. | Existing admin upload service uses the AWS S3 client against an R2 endpoint. [VERIFIED: apps/api/package.json; VERIFIED: apps/api/src/modules/admin/upload.service.ts; VERIFIED: npm view @aws-sdk/client-s3 version time.modified] |
| @sentry/nestjs / @sentry/nextjs | project `^10` | npm latest `10.51.0`, modified 2026-04-29 | Error and event observation evidence. | Existing SMS and email paths set Sentry context/tags, and Phase 22 evidence requires Sentry/Cloud Run observation. [VERIFIED: apps/api/package.json; VERIFIED: apps/web/package.json; VERIFIED: apps/api/src/modules/sms/sms.service.ts; VERIFIED: apps/api/src/modules/auth/email/email.service.ts; VERIFIED: npm view @sentry/nestjs version time.modified; VERIFIED: npm view @sentry/nextjs version time.modified] |

### Supporting

| Tool | Available | Version | Purpose | Fallback |
|------|-----------|---------|---------|----------|
| gcloud | YES | `564.0.0` | Cloud Run revision, environment, and log evidence collection. | Use GCP console screenshots if CLI auth or project context is unavailable. [VERIFIED: gcloud --version] |
| Docker | YES | `29.1.3` | Testcontainers-backed integration tests. | Mark integration tests human-needed or run in CI if local daemon access fails. [VERIFIED: docker --version; VERIFIED: apps/api/vitest.integration.config.ts] |
| gh | YES | `2.89.0` | GitHub Actions/PR evidence lookup. | Use GitHub web UI screenshots if CLI auth is unavailable. [VERIFIED: gh --version] |
| curl | YES | `8.7.1` | Public URL, robots/canonical, API smoke checks. | Browser screenshots can supplement, but curl is preferred for exact HTTP evidence. [VERIFIED: curl --version] |
| dig | YES | `9.10.6` | DNS/domain evidence for Resend/R2/legal public host checks. | Provider dashboard screenshots can supplement DNS proof. [VERIFIED: dig -v] |
| wrangler | NO in PATH | package `^4.81.1`, npm latest `4.87.0` | R2/CORS inspection if Cloudflare CLI is needed. | Use `pnpm exec wrangler` or `pnpm dlx wrangler` instead of global `wrangler`. [VERIFIED: command -v wrangler; VERIFIED: package.json; VERIFIED: npm view wrangler version time.modified] |
| redis-cli | NO in PATH | n/a | Optional direct `CLUSTER KEYSLOT` or Redis probe. | Use existing integration tests, application smoke script, or install only if direct slot proof is required. [VERIFIED: command -v redis-cli; VERIFIED: apps/api/test/sms-cluster-crossslot.integration.spec.ts; VERIFIED: scripts/smoke-valkey-production.mjs] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Markdown evidence ledger | New admin evidence UI | User decisions exclude admin console scope, and UI spec defaults to no new user-facing UI. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md; VERIFIED: .planning/phases/22-preflight-closure/22-UI-SPEC.md] |
| Existing Vitest/Playwright tests | New test framework | Existing configs and specs already cover SMS, email, legal, R2, and Valkey seams; introducing a new framework adds planning risk without Phase 22 benefit. [VERIFIED: apps/api/vitest.config.ts; VERIFIED: apps/web/vitest.config.ts; VERIFIED: apps/web/playwright.config.ts] |
| Existing Resend/Gmail evidence path | Naver/Daum full deliverability matrix | User decision D-11 says untested Naver/Daum defaults to `ACCEPTED_RISK` with approvals, so full mailbox expansion is not required for Phase 22 unless accepted risk is refused. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md] |
| Existing Valkey smoke/tests | Raw manual Redis cluster commands only | Redis hash slots can be verified with `CLUSTER KEYSLOT`, but the repo already has SMS CROSSSLOT integration tests and a production Valkey smoke script. [CITED: https://redis.io/docs/latest/develop/using-commands/keyspace/#hash-tags; VERIFIED: apps/api/test/sms-cluster-crossslot.integration.spec.ts; VERIFIED: scripts/smoke-valkey-production.mjs] |

**Installation:**

```bash
# No new package install is recommended for Phase 22 evidence closure.
pnpm install
```

The install recommendation uses existing package manifests rather than adding dependencies. [VERIFIED: package.json; VERIFIED: apps/api/package.json; VERIFIED: apps/web/package.json]

**Version verification:** Recommended versions above were checked with `npm view <package> version time.modified`, and local CLI availability was checked with each tool's version command. [VERIFIED: npm view vitest version time.modified; VERIFIED: npm view @playwright/test version time.modified; VERIFIED: npm view ioredis version time.modified; VERIFIED: npm view resend version time.modified; VERIFIED: npm view @aws-sdk/client-s3 version time.modified; VERIFIED: npm view @sentry/nestjs version time.modified; VERIFIED: npm view @sentry/nextjs version time.modified]

## Architecture Patterns

### System Architecture Diagram

```text
Operator / Maintainer
  -> execute gate check on shipped surface
    -> SMS signup OTP path
       -> Browser signup UI -> API SmsService -> Valkey hash-tagged keys -> SMS provider
       -> Cloud Run logs + Sentry provider=valkey observation
       -> classify PASS / ACCEPTED_RISK / BLOCKER
    -> Email reset-to-login path
       -> Browser reset request -> API EmailService -> Resend -> Gmail inbox
       -> reset confirm -> login with new password -> Cloud Run/Sentry observation
       -> classify PASS / ACCEPTED_RISK / BLOCKER
    -> Legal public/sign-off path
       -> public legal URLs + Footer + signup/booking dialogs + robots/canonical
       -> operator factual sign-off + support/privacy mailbox receipt
       -> classify PASS / ACCEPTED_RISK / BLOCKER
    -> v1.1 validation backfill
       -> git-history verification/UAT artifacts + .planning/STATE.md gaps
       -> classify COMPLETE / ACCEPTED_CAVEAT / BLOCKER
    -> hardening sweep
       -> Valkey/R2/SMS/email/legal fragile point
       -> concrete fix OR accepted risk with owner/date OR launch blocker
  -> Phase 22 evidence ledger and verification summary
  -> Phase 23 Launch Foundation starts only if no unresolved v1.1 launch-readiness blocker remains
```

The diagram reflects the user-locked Phase 22 gate groups and Phase 23 entry condition. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md; VERIFIED: .planning/ROADMAP.md]

### Recommended Project Structure

```text
.planning/phases/22-preflight-closure/
├── 22-CONTEXT.md                 # existing locked decisions
├── 22-UI-SPEC.md                 # existing no-new-UI/evidence-table contract
├── 22-RESEARCH.md                # this research artifact
├── 22-HUMAN-UAT.md               # operator-run evidence checklist and sanitized links
├── 22-EVIDENCE-LEDGER.md         # gate matrix: SMS, Email, Legal, Validation Backfill, Hardening
├── 22-VALIDATION-BASELINE.md     # v1.1 gap classification: COMPLETE / ACCEPTED_CAVEAT / BLOCKER
├── 22-HARDENING-REGISTER.md      # Valkey/R2/SMS/email/legal fragile point closure
└── 22-VERIFICATION.md            # final phase verification and Phase 23 blocker statement
```

This structure uses the existing phase directory and adds only planning/evidence artifacts needed by PREF-01 through PREF-03. [VERIFIED: .planning/phases/22-preflight-closure; VERIFIED: .planning/REQUIREMENTS.md; VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md]

### Pattern 1: Gate Matrix as Source of Truth

**What:** Use one evidence ledger with the UI-spec table columns `Gate`, `Requirement`, `Status`, `Evidence`, `Checked At`, `Owner`, `Risk/Caveat`, and `Next Action`. [VERIFIED: .planning/phases/22-preflight-closure/22-UI-SPEC.md]

**When to use:** Use it for every SMS, Email, Legal, Validation Backfill, and Hardening row; accepted risk rows must carry owner/date and maintainer/operator approval. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md; VERIFIED: .planning/phases/22-preflight-closure/22-UI-SPEC.md]

**Example:**

```markdown
| Gate | Requirement | Status | Evidence | Checked At | Owner | Risk/Caveat | Next Action |
|------|-------------|--------|----------|------------|-------|-------------|-------------|
| SMS | PREF-01 / D-05 | BLOCKER | pending real-device signup OTP | 2026-05-04T00:00:00+09:00 | maintainer | No phone evidence yet | Run SMS UAT and 1h observation |
```

The example follows the required table shape and exact status vocabulary. [VERIFIED: .planning/phases/22-preflight-closure/22-UI-SPEC.md; VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md]

### Pattern 2: Evidence Boundary, Not Historical Rewrite

**What:** Reference historical v1.1 artifacts by path and commit, then add Phase 22-only evidence rows. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md; VERIFIED: git ls-tree -r --name-only bd8220e -- .planning/phases]

**When to use:** Use it when classifying Phase 14 SMS, Phase 15 email, Phase 16 legal, Phase 18 password reset, Phase 20 Valkey, and Phase 21 validation backfill status. [VERIFIED: git show bd8220e:.planning/phases/14-sms-otp-crossslot-fix-sms-valkey-cluster-hash-tag/14-VERIFICATION.md; VERIFIED: git show bd8220e:.planning/phases/15-resend-heygrabit-com-cutover-transactional-email-secret-mana/15-VERIFICATION.md; VERIFIED: git show bd8220e:.planning/phases/16-legal-pages-launch-url/16-VERIFICATION.md; VERIFIED: git show bd8220e:.planning/phases/18-password-reset-production-api-origin-fix/18-VERIFICATION.md; VERIFIED: git show bd8220e:.planning/phases/20-valkey-production-connectivity-contract/20-VERIFICATION.md; VERIFIED: git show bd8220e:.planning/phases/21-verification-artifact-backfill/21-VERIFICATION.md]

**Example:**

```markdown
- Historical context: `git show bd8220e:.planning/phases/15-resend-heygrabit-com-cutover-transactional-email-secret-mana/15-VERIFICATION.md`
- Phase 22 classification: Email Gmail reset-to-login = PASS / ACCEPTED_RISK / BLOCKER
- Evidence added in Phase 22: redacted Resend id, Gmail screenshot, reset confirm result, login result
```

The example separates historical context from new Phase 22 evidence. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md]

### Pattern 3: Runtime Observation Window

**What:** After a human gate run, gather a timestamped observation bundle from application logs, Sentry, and provider dashboards. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md; VERIFIED: apps/api/src/modules/sms/sms.service.ts; VERIFIED: apps/api/src/modules/auth/email/email.service.ts]

**When to use:** Use it for SMS `sms.verify_failed`, `CROSSSLOT`, Sentry `provider=valkey`, email-service errors, and Valkey production smoke evidence. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md; VERIFIED: scripts/smoke-valkey-production.mjs]

**Example:**

```bash
# Use the exact UAT timestamp window in the final command.
gcloud logging read 'textPayload:"sms.verify_failed" OR textPayload:"CROSSSLOT"' \
  --freshness=1h \
  --format=json
```

The command shape uses the installed `gcloud` CLI and the locked SMS observation terms. [VERIFIED: gcloud --version; VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md; VERIFIED: apps/api/src/modules/sms/sms.service.ts]

### Pattern 4: Redacted Evidence Bundle

**What:** Store screenshots/log extracts only after masking phone numbers, email addresses, raw OTPs, reset links, tokens, cookies, and secret values. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md]

**When to use:** Use it for SMS screenshots/logs, email Gmail screenshot, Resend id bundle, Cloud Run/Sentry logs, and mailbox receipts. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md]

**Example:**

```text
phone: +82-10-****-1234
email: t***@gmail.com
otp: [REDACTED]
reset_link: [REDACTED]
resend_email_id: email_***
```

The example follows Phase 22 redaction rules and avoids storing raw credentials or one-time secrets. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md]

### Anti-Patterns to Avoid

- **Marking accepted risk as pass:** `ACCEPTED_RISK` is a visible launch risk and requires maintainer/operator approval. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md]
- **Rewriting v1.1 artifacts:** Phase 22 must reference historical Phase 14/15/16 evidence and write a v2.0-only baseline. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md]
- **Stopping email proof at inbox receipt:** Email gate requires password reset email, reset confirm, and login with the new password. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md]
- **Treating `isPhoneVerified` as a standalone auth proof:** The code comment says it is for signup idempotency only and not a public standalone auth primitive. [VERIFIED: apps/api/src/modules/sms/sms.service.ts]
- **Adding fanmeet or admin-console scope:** Phase 22 excludes new fanmeet product functionality and admin console scope. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Gate status taxonomy | New labels such as `DONE`, `WARN`, `TODO` | Exact labels `PASS`, `ACCEPTED_RISK`, `BLOCKER`; validation labels `COMPLETE`, `ACCEPTED_CAVEAT`, `BLOCKER` | Status vocabulary is a locked decision and downstream traceability depends on exact terms. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md] |
| Evidence UI | New admin console or custom app UI | Markdown ledger following `22-UI-SPEC.md` table shape | Phase 22 has no admin console scope and UI spec defaults to no new user-facing UI. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md; VERIFIED: .planning/phases/22-preflight-closure/22-UI-SPEC.md] |
| Redis/Valkey cluster correctness | Ad hoc key naming or manual slot math | Existing hash-tagged SMS keys, integration tests, and Redis hash-tag semantics | Redis Cluster requires multi-key operations to use keys in the same hash slot, and hash tags force same-slot behavior. [VERIFIED: apps/api/src/modules/sms/sms.service.ts; VERIFIED: apps/api/test/sms-cluster-crossslot.integration.spec.ts; CITED: https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/#hash-tags] |
| Email deliverability proof | Guessing based on API success only | Resend accepted id, Gmail inbox observation, reset confirm, login, Cloud Run/Sentry result | Resend accepted id is necessary but Phase 22 explicitly requires inbox observation and reset-to-login completion. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md; CITED: https://resend.com/docs/webhooks/emails/failed] |
| R2 browser upload CORS | Custom proxy or permissive CORS guess | Cloudflare R2 CORS policy and S3-compatible SDK behavior | R2 browser uploads require bucket CORS for allowed origins, methods, and headers; existing code already uses the S3 SDK for R2. [CITED: https://developers.cloudflare.com/r2/buckets/cors/; VERIFIED: apps/api/src/modules/admin/upload.service.ts] |
| Legal review | In-agent legal advice or external counsel substitute | Factual operator sign-off for locked business identity fields | Phase 22 requires factual sign-off only and excludes external counsel review in this phase. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md] |
| Secret redaction | Raw logs/screenshots copied into planning docs | Sanitized excerpts and masked screenshots | Phase 22 requires masking phone numbers and excluding raw OTPs, reset tokens, reset links, and secret values. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md] |

**Key insight:** Phase 22 complexity is not algorithmic; it is traceability, evidence hygiene, and honest launch-risk classification across shipped surfaces and external systems. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md; VERIFIED: .planning/STATE.md]

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | SMS OTP, attempts, verified, resend, send-count, and verify-count states are Valkey keys built with `{sms:<e164>}` hash tags; old non-hash-tag keys are intentionally left to TTL-drain. [VERIFIED: apps/api/src/modules/sms/sms.service.ts] | Do not migrate old SMS keys unless evidence shows active production failure; classify any same-path SMS failure as Phase 22 fix or blocker. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md] |
| Stored data | Password reset flow uses API endpoints and email delivery evidence; Phase 18 historical verification recorded reset email, confirm, and login success, with Sentry observation caveat remaining. [VERIFIED: apps/web/app/auth/reset-password/page.tsx; VERIFIED: git show bd8220e:.planning/phases/18-password-reset-production-api-origin-fix/18-VERIFICATION.md] | Re-run the locked Phase 22 Gmail reset-to-login gate and classify any remaining provider observation gap. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md] |
| Live service config | Cloud Run environment/secrets, Resend domain/API key/from address, R2 bucket/CORS/env, Sentry dashboards, support/privacy mailboxes, and GCP logs are external or runtime-backed evidence sources. [VERIFIED: AGENTS.md; VERIFIED: apps/api/src/modules/auth/email/email.service.ts; VERIFIED: apps/api/src/modules/admin/upload.service.ts; VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md] | Planner must include operator collection steps and accepted-risk/blocker classification when dashboard or mailbox access is unavailable. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md] |
| OS-registered state | No pm2, launchd, systemd, or scheduler registration relevant to Phase 22 was found in repo-scoped searches. [VERIFIED: rg "pm2|launchd|systemd|Task Scheduler|plist" .] | No OS re-registration task is required unless the operator reports a live host outside Cloud Run. [VERIFIED: AGENTS.md; ASSUMED] |
| Secrets/env vars | Required/fragile names include `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, R2 config envs, and SMS provider config envs; secret values must not be written into artifacts. [VERIFIED: AGENTS.md; VERIFIED: apps/api/src/modules/auth/email/email.service.ts; VERIFIED: apps/api/src/modules/admin/upload.service.ts; VERIFIED: apps/api/src/modules/sms/sms.service.ts] | Record variable presence/status only; redact values and classify missing production config as concrete fix, accepted risk, or blocker. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md] |
| Build artifacts | Historical v1.1 phase artifacts are not current files under `.planning/phases`, but are available in git commit `bd8220e`; current Phase 22 folder contains `22-CONTEXT.md`, `22-DISCUSSION-LOG.md`, and `22-UI-SPEC.md`. [VERIFIED: ls .planning/phases/22-preflight-closure; VERIFIED: git ls-tree -r --name-only bd8220e -- .planning/phases] | Use git-history references for v1.1 artifacts and write new v2.0 Phase 22 artifacts in the current phase directory. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md] |

## Common Pitfalls

### Pitfall 1: Accepted Risk Disappears Into PASS

**What goes wrong:** Naver/Daum, Sentry observation, mailbox receipt, or R2 caveats get summarized as complete without maintainer/operator approval. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md; VERIFIED: git show bd8220e:.planning/phases/15-resend-heygrabit-com-cutover-transactional-email-secret-mana/15-VERIFICATION.md]

**Why it happens:** Human evidence and provider observation are easy to blur with automated tests. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md; VERIFIED: git show bd8220e:.planning/phases/21-verification-artifact-backfill/21-VERIFICATION.md]

**How to avoid:** Require a ledger row for every caveat with status, owner, approval, evidence path, and next action. [VERIFIED: .planning/phases/22-preflight-closure/22-UI-SPEC.md]

**Warning signs:** A row says `PASS` but evidence says "not tested", "human_needed", "operator_needed", or "pending dashboard observation". [VERIFIED: .planning/STATE.md; VERIFIED: git show bd8220e:.planning/phases/14-sms-otp-crossslot-fix-sms-valkey-cluster-hash-tag/14-VERIFICATION.md; VERIFIED: git show bd8220e:.planning/phases/15-resend-heygrabit-com-cutover-transactional-email-secret-mana/15-VERIFICATION.md; VERIFIED: git show bd8220e:.planning/phases/16-legal-pages-launch-url/16-VERIFICATION.md]

### Pitfall 2: Historical Artifact Rewrite

**What goes wrong:** Planner edits or restates Phase 14/15/16 artifacts as if Phase 22 executed the old work. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md]

**Why it happens:** The original v1.1 phase folders are no longer current working-tree phase folders and must be referenced from git history. [VERIFIED: ls .planning/phases; VERIFIED: git ls-tree -r --name-only bd8220e -- .planning/phases]

**How to avoid:** Record historical source as `git show bd8220e:<path>` and write only Phase 22 evidence/classification in current artifacts. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md]

**Warning signs:** A Phase 22 file claims "Phase 15 Gmail UAT passed today" using only historical Phase 15 text. [VERIFIED: git show bd8220e:.planning/phases/15-resend-heygrabit-com-cutover-transactional-email-secret-mana/15-HUMAN-UAT.md; VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md]

### Pitfall 3: SMS Failure Copy Masking

**What goes wrong:** Wrong code, expired/resend, and system-error paths collapse into the same user-facing message. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md]

**Why it happens:** Frontend fallback copy can mask server messages if response priority is wrong. [VERIFIED: .planning/debug/signup-sms-otp-verify-wrong.md; VERIFIED: apps/web/components/auth/phone-verification.tsx]

**How to avoid:** Verify the UI still prefers server `message` on `verified: false`, and collect separate screenshots for wrong code, expired/resend, and system-error paths. [VERIFIED: apps/web/components/auth/phone-verification.tsx; VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md]

**Warning signs:** All failure screenshots show only "인증번호가 일치하지 않습니다" regardless of backend failure cause. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md]

### Pitfall 4: Valkey Smoke Writes to Archived Phase Path

**What goes wrong:** `scripts/smoke-valkey-production.mjs` appends evidence to the archived Phase 20 path that no longer exists in the current phase tree. [VERIFIED: scripts/smoke-valkey-production.mjs; VERIFIED: ls .planning/phases]

**Why it happens:** The script default artifact path still targets `.planning/phases/20-valkey-production-connectivity-contract/20-HUMAN-UAT.md`. [VERIFIED: scripts/smoke-valkey-production.mjs]

**How to avoid:** Set `GRABIT_SMOKE_ARTIFACT=.planning/phases/22-preflight-closure/22-HUMAN-UAT.md` or plan a small script default update before running production smoke evidence. [VERIFIED: scripts/smoke-valkey-production.mjs; VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md]

**Warning signs:** Smoke output references Phase 20 artifact path, or evidence file is created outside Phase 22. [VERIFIED: scripts/smoke-valkey-production.mjs]

### Pitfall 5: R2 Local Fallback Hides Production Misconfiguration

**What goes wrong:** Upload code silently returns local upload URLs when R2 account config is missing, which can make production R2 evidence look present when it is not. [VERIFIED: apps/api/src/modules/admin/upload.service.ts]

**Why it happens:** `UploadService` uses local mode when `R2_ACCOUNT_ID` is not configured. [VERIFIED: apps/api/src/modules/admin/upload.service.ts]

**How to avoid:** Planner should include a production environment/config evidence row for R2 and classify any local fallback in production as concrete fix, accepted risk, or launch blocker. [VERIFIED: apps/api/src/modules/admin/upload.service.ts; VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md]

**Warning signs:** Evidence shows `/uploads/` or local signing behavior on a production path. [VERIFIED: apps/api/src/modules/admin/upload.service.ts]

### Pitfall 6: Node Version Drift Changes Local Proof Quality

**What goes wrong:** Local green tests run on Node 25, while project guidance targets Node 22 LTS/runtime compatibility. [VERIFIED: node --version; VERIFIED: package.json; VERIFIED: AGENTS.md]

**Why it happens:** The local shell reports `v25.9.0` while project engines only require `>=22` and project stack guidance recommends Node 22 LTS. [VERIFIED: node --version; VERIFIED: package.json; VERIFIED: AGENTS.md]

**How to avoid:** Treat local Node 25 test results as useful smoke evidence, and prefer CI/Cloud Run/runtime evidence for launch-readiness claims. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md; VERIFIED: AGENTS.md]

**Warning signs:** Phase 22 verification says "production-ready" based only on local Node 25 execution. [VERIFIED: node --version; VERIFIED: .planning/ROADMAP.md]

## Code Examples

Verified patterns from project and official sources:

### SMS Gate Evidence Command Pattern

```bash
pnpm --filter @grabit/api test:integration -- sms-cluster-crossslot

GRABIT_SMOKE_ARTIFACT=.planning/phases/22-preflight-closure/22-HUMAN-UAT.md \
GRABIT_API_URL=<production-api-url> \
GRABIT_SMOKE_AUTH_HEADER_FILE=/path/to/redacted-auth-header \
GRABIT_SMOKE_SHOWTIME_ID=<showtime-id> \
GRABIT_SMOKE_SEAT_ID=<seat-id> \
node scripts/smoke-valkey-production.mjs --checks=health,lua,socketio,logs
```

The first command targets existing SMS cluster integration coverage, and the second redirects the existing production smoke script to Phase 22 evidence. [VERIFIED: apps/api/test/sms-cluster-crossslot.integration.spec.ts; VERIFIED: scripts/smoke-valkey-production.mjs]

### Email Reset-to-Login Evidence Checklist

```text
1. Request password reset from public web UI.
2. Record redacted Resend accepted id.
3. Confirm Gmail inbox receipt with address and token/link redacted.
4. Complete reset confirm.
5. Log in with the new password.
6. Attach Cloud Run/Sentry observation result.
```

The sequence matches the locked Phase 22 email gate and existing reset page/API path. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md; VERIFIED: apps/web/app/auth/reset-password/page.tsx; VERIFIED: apps/api/src/modules/auth/email/email.service.ts]

### Legal Public Evidence Command Pattern

```bash
curl -I https://heygrabit.com/legal/terms
curl -I https://heygrabit.com/legal/privacy
curl -I https://heygrabit.com/legal/marketing
curl -s https://heygrabit.com/legal/privacy | rg 'canonical|robots|privacy@heygrabit.com|support@heygrabit.com'
```

The checked paths and mailbox addresses are Phase 22 legal gate requirements, and current legal pages expose production canonical metadata. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md; VERIFIED: apps/web/app/legal/privacy/page.tsx; VERIFIED: apps/web/app/legal/terms/page.tsx; VERIFIED: apps/web/app/legal/marketing/page.tsx]

### R2 CORS Evidence Pattern

```text
R2 bucket:
  AllowedOrigins: https://heygrabit.com
  AllowedMethods: PUT
  AllowedHeaders: Content-Type
  ExposeHeaders: ETag
```

Cloudflare R2 documents CORS policy fields for browser uploads, and existing upload code uses an S3-compatible R2 endpoint. [CITED: https://developers.cloudflare.com/r2/buckets/cors/; CITED: https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js/; VERIFIED: apps/api/src/modules/admin/upload.service.ts]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Scattered v1.1 `human_needed` and phase-specific verification notes | v2.0 Phase 22 evidence ledger and validation baseline | Phase 22 merged Operator UAT, Nyquist backfill, and hardening sweep on 2026-05-04 | Planner should consolidate evidence in Phase 22 without rewriting old artifacts. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md; VERIFIED: .planning/ROADMAP.md] |
| Phase 14 SMS 72h CROSSSLOT observation framing | Phase 22 targeted 1h post-UAT observation for `sms.verify_failed`, `CROSSSLOT`, and Sentry `provider=valkey` | Phase 22 context gathered 2026-05-04 | Planner should avoid a slow open-ended observation gate unless failures require it. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md; VERIFIED: git show bd8220e:.planning/phases/14-sms-otp-crossslot-fix-sms-valkey-cluster-hash-tag/14-HUMAN-UAT.md] |
| Email proof could focus on Resend/domain and Gmail smoke | Phase 22 requires full password reset email -> reset confirm -> login with new password | Phase 22 context gathered 2026-05-04 | Planner must schedule end-to-end user flow evidence, not provider receipt only. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md; VERIFIED: git show bd8220e:.planning/phases/15-resend-heygrabit-com-cutover-transactional-email-secret-mana/15-HUMAN-UAT.md] |
| Legal Phase 16 code/test readiness plus pending sign-off | Phase 22 requires public URL, Footer, dialog, robots/canonical, mailbox receipt, and factual sign-off classification | Phase 22 context gathered 2026-05-04 | Planner should split technical legal evidence from operator factual sign-off. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md; VERIFIED: git show bd8220e:.planning/phases/16-legal-pages-launch-url/16-HUMAN-UAT.md] |

**Deprecated/outdated:**

- `@tosspayments/sdk` and `@tosspayments/payment-sdk` are documented in project stack as not-to-use packages; Phase 22 does not touch payment scope. [VERIFIED: AGENTS.md; VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md]
- Any new fanmeet, global SMS, multinational legal schema, or admin console design is outside Phase 22. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | No OS-level registration task is required unless the operator reports a live host outside Cloud Run. [ASSUMED] | Runtime State Inventory | If production has non-repo OS registrations, Phase 22 could miss a runtime hardening artifact. |
| A2 | Live dashboard/account access for Resend, Sentry, Gmail, GCP Cloud Run/Logging, Cloudflare R2, and support/privacy mailboxes is unknown until the operator confirms it. [ASSUMED] | Open Questions, Environment Availability, Sources, Metadata | If access is unavailable, some evidence rows must become accepted risk or blocker. |
| A3 | Naver/Daum formal acceptance is not recorded yet and needs explicit Phase 22 approval if left untested. [ASSUMED] | Open Questions | If approval is denied, the email gate may become a blocker or require more mailbox testing. |
| A4 | The planner may choose either a script default patch or an execution-time `GRABIT_SMOKE_ARTIFACT` override for Valkey smoke evidence. [ASSUMED] | Open Questions | If neither is done, evidence could be written to the wrong phase path. |
| A5 | External dashboard authentication was not performed during this research session. [ASSUMED] | Sources, Metadata | If a dashboard is unavailable during execution, the plan needs fallback evidence or blocker classification. |
| A6 | The research validity window is 30 days for repo/code structure and 7 days for npm/provider details. [ASSUMED] | Metadata | Fast-moving package/provider behavior could change before implementation. |

## Open Questions (RESOLVED)

1. **Which human/operator accounts have access to Resend, Sentry, Gmail, GCP Cloud Run/Logging, Cloudflare R2, and support/privacy mailboxes?** [ASSUMED]
   - What we know: These systems are required or implied by Phase 22 evidence. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md; VERIFIED: apps/api/src/modules/auth/email/email.service.ts; VERIFIED: apps/api/src/modules/admin/upload.service.ts]
   - Resolution: Live dashboard/account access remains operator-gated in Plan 04. The resulting evidence can become `PASS`, `ACCEPTED_RISK`, or `BLOCKER` in `22-HUMAN-UAT.md` and the final ledger, so no pre-execution decision checkpoint is required. [VERIFIED: .planning/phases/22-preflight-closure/22-04-PLAN.md; VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md]

2. **Will Naver/Daum be formally accepted as risk in Phase 22?** [ASSUMED]
   - What we know: D-11 allows Naver/Daum untested status to default to `ACCEPTED_RISK` with D-02 approval. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md]
   - Resolution: Naver/Daum defaults to `ACCEPTED_RISK` only when D-02 maintainer and operator approvals are recorded. Plan 04 records the gate outcome in `22-HUMAN-UAT.md`; Plan 05 carries it into final verification and Phase 23 readiness. [VERIFIED: .planning/phases/22-preflight-closure/22-04-PLAN.md; VERIFIED: .planning/phases/22-preflight-closure/22-05-PLAN.md; VERIFIED: .planning/phases/22-preflight-closure/22-UI-SPEC.md]

3. **Should `scripts/smoke-valkey-production.mjs` default artifact path be patched, or should Phase 22 always pass `GRABIT_SMOKE_ARTIFACT`?** [ASSUMED]
   - What we know: The script default points at a Phase 20 path that is not present in current `.planning/phases`. [VERIFIED: scripts/smoke-valkey-production.mjs; VERIFIED: ls .planning/phases]
   - Resolution: Plan 03 makes this a concrete fix by changing the default artifact path to `.planning/phases/22-preflight-closure/artifacts/valkey-smoke.md` while preserving `GRABIT_SMOKE_ARTIFACT` override behavior. [VERIFIED: .planning/phases/22-preflight-closure/22-03-PLAN.md; VERIFIED: scripts/smoke-valkey-production.mjs; VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Monorepo commands/tests | YES | `v25.9.0` local | Use CI or Node 22-compatible environment for final launch-readiness proof. [VERIFIED: node --version; VERIFIED: package.json; VERIFIED: AGENTS.md] |
| pnpm | Package scripts | YES | `10.28.1` | None needed. [VERIFIED: pnpm --version; VERIFIED: package.json] |
| Docker | API integration tests/testcontainers | YES | `29.1.3` | Run integration tests in CI if local daemon/config fails. [VERIFIED: docker --version; VERIFIED: apps/api/vitest.integration.config.ts] |
| gcloud | Cloud Run/log evidence | YES | `564.0.0` | GCP console screenshots if CLI auth/project is unavailable. [VERIFIED: gcloud --version] |
| gh | GitHub Actions evidence | YES | `2.89.0` | GitHub web UI screenshots. [VERIFIED: gh --version] |
| curl | Public URL/API checks | YES | `8.7.1` | Browser screenshots for visual supplemental evidence. [VERIFIED: curl --version] |
| dig | DNS/provider checks | YES | `9.10.6` | Provider dashboard screenshots. [VERIFIED: dig -v] |
| gsd-sdk | GSD artifact/commit workflow | YES | `1.39.1` | Manual artifact writing if SDK command fails. [VERIFIED: gsd-sdk --version] |
| wrangler | Optional R2 inspection | NO in PATH | package `^4.81.1` | Use `pnpm exec wrangler` or `pnpm dlx wrangler`. [VERIFIED: command -v wrangler; VERIFIED: package.json] |
| redis-cli | Optional direct Redis slot checks | NO in PATH | n/a | Use existing tests and smoke script; install only if direct CLI proof is required. [VERIFIED: command -v redis-cli; VERIFIED: apps/api/test/sms-cluster-crossslot.integration.spec.ts] |
| Resend dashboard/API access | Email evidence | UNKNOWN | n/a | Operator screenshots or accepted-risk/blocker classification if unavailable. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md; ASSUMED] |
| Sentry dashboard/API access | SMS/email/Valkey observation | UNKNOWN | n/a | Cloud Run logs plus accepted-risk/blocker classification if Sentry access is unavailable. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md; ASSUMED] |
| GCP project auth | Cloud Run/log evidence | UNKNOWN | n/a | Operator-run command output or console screenshots. [VERIFIED: gcloud --version; ASSUMED] |
| Cloudflare R2 dashboard/auth | R2 hardening evidence | UNKNOWN | n/a | `pnpm exec wrangler` with authenticated account or dashboard screenshot. [VERIFIED: package.json; CITED: https://developers.cloudflare.com/r2/buckets/cors/; ASSUMED] |

**Missing dependencies with no fallback:**

- None found at the local CLI layer; live dashboard authentication remains operator-dependent and should be classified per gate if unavailable. [VERIFIED: environment audit; VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md]

**Missing dependencies with fallback:**

- Global `wrangler` is missing; use local package execution with `pnpm exec wrangler` or `pnpm dlx wrangler`. [VERIFIED: command -v wrangler; VERIFIED: package.json]
- `redis-cli` is missing; use existing Vitest integration tests and `scripts/smoke-valkey-production.mjs` unless direct Redis CLI proof is required. [VERIFIED: command -v redis-cli; VERIFIED: apps/api/test/sms-cluster-crossslot.integration.spec.ts; VERIFIED: scripts/smoke-valkey-production.mjs]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest for API/web unit tests, Vitest integration config for API integration tests, Playwright for web E2E. [VERIFIED: apps/api/vitest.config.ts; VERIFIED: apps/api/vitest.integration.config.ts; VERIFIED: apps/web/vitest.config.ts; VERIFIED: apps/web/playwright.config.ts] |
| Config file | `apps/api/vitest.config.ts`, `apps/api/vitest.integration.config.ts`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`. [VERIFIED: file list] |
| Quick run command | `pnpm --filter @grabit/api test -- src/modules/auth/email/email.service.spec.ts` and `pnpm --filter @grabit/web test -- app/auth/reset-password/__tests__/reset-password.test.tsx`. [VERIFIED: apps/api/src/modules/auth/email/email.service.spec.ts; VERIFIED: apps/web/app/auth/reset-password/__tests__/reset-password.test.tsx] |
| Full suite command | `pnpm test` plus `pnpm build`; API integration tests use `pnpm --filter @grabit/api test:integration` and Docker/testcontainers. [VERIFIED: package.json; VERIFIED: apps/api/package.json; VERIFIED: apps/api/vitest.integration.config.ts] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| PREF-01 | SMS real-device signup OTP happy path plus distinct failure-copy evidence. [VERIFIED: .planning/REQUIREMENTS.md; VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md] | unit + integration + manual UAT | `pnpm --filter @grabit/api test -- src/modules/sms/sms.service.spec.ts`; `pnpm --filter @grabit/api test:integration -- sms-cluster-crossslot`; manual real-device evidence required. [VERIFIED: apps/api/src/modules/sms/sms.service.spec.ts; VERIFIED: apps/api/test/sms-cluster-crossslot.integration.spec.ts] | YES for automated files; manual evidence file missing. [VERIFIED: file list] |
| PREF-01 | Email reset email -> reset confirm -> login with new password. [VERIFIED: .planning/REQUIREMENTS.md; VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md] | unit + component + manual UAT | `pnpm --filter @grabit/api test -- src/modules/auth/email/email.service.spec.ts`; `pnpm --filter @grabit/web test -- app/auth/reset-password/__tests__/reset-password.test.tsx`; manual Gmail/Resend evidence required. [VERIFIED: apps/api/src/modules/auth/email/email.service.spec.ts; VERIFIED: apps/web/app/auth/reset-password/__tests__/reset-password.test.tsx] | YES for automated files; manual evidence file missing. [VERIFIED: file list] |
| PREF-01 | Legal public URL, Footer, dialogs, robots/canonical, mailbox receipt, factual sign-off. [VERIFIED: .planning/REQUIREMENTS.md; VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md] | unit/static + manual UAT | `pnpm --filter @grabit/web test -- content/legal/__tests__/legal-content.test.ts app/legal/__tests__/metadata.test.ts components/layout/__tests__/footer.test.tsx`; manual public URL/mailbox/sign-off evidence required. [VERIFIED: apps/web/content/legal/__tests__/legal-content.test.ts; VERIFIED: apps/web/app/legal/__tests__/metadata.test.ts; VERIFIED: apps/web/components/layout/__tests__/footer.test.tsx] | YES for automated files; manual evidence file missing. [VERIFIED: file list] |
| PREF-02 | v1.1 validation gaps classified into v2.0 baseline. [VERIFIED: .planning/REQUIREMENTS.md; VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md] | docs verification | `git show bd8220e:<artifact>` plus manual baseline review; no app test substitutes for human/operator evidence. [VERIFIED: git ls-tree -r --name-only bd8220e -- .planning/phases; VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md] | Phase 22 baseline file missing. [VERIFIED: ls .planning/phases/22-preflight-closure] |
| PREF-03 | Valkey fragile points classified or fixed. [VERIFIED: .planning/REQUIREMENTS.md] | integration + smoke + manual evidence | `pnpm --filter @grabit/api test:integration -- booking-cluster-lua`; `node scripts/smoke-valkey-production.mjs --checks=health,lua,socketio,logs` with Phase 22 artifact env. [VERIFIED: apps/api/test/booking-cluster-lua.integration.spec.ts; VERIFIED: scripts/smoke-valkey-production.mjs] | YES for automated files; production smoke evidence missing. [VERIFIED: file list; VERIFIED: git show bd8220e:.planning/phases/20-valkey-production-connectivity-contract/20-VERIFICATION.md] |
| PREF-03 | R2 fragile points classified or fixed. [VERIFIED: .planning/REQUIREMENTS.md] | unit + config evidence | `pnpm --filter @grabit/api test -- src/modules/admin/upload.service.spec.ts`; R2 live CORS/config evidence required if launch path depends on R2. [VERIFIED: apps/api/src/modules/admin/upload.service.spec.ts; CITED: https://developers.cloudflare.com/r2/buckets/cors/] | YES for automated file; live evidence missing. [VERIFIED: file list] |

### Sampling Rate

- **Per task commit:** Run the focused test for the touched surface and update the corresponding ledger row. [VERIFIED: apps/api/vitest.config.ts; VERIFIED: apps/web/vitest.config.ts; VERIFIED: .planning/phases/22-preflight-closure/22-UI-SPEC.md]
- **Per wave merge:** Run `pnpm test`, plus API integration tests when Docker/testcontainers are available. [VERIFIED: package.json; VERIFIED: apps/api/vitest.integration.config.ts; VERIFIED: docker --version]
- **Phase gate:** Full suite and relevant manual evidence rows must be green or explicitly classified before `$gsd-verify-work`. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md; VERIFIED: AGENTS.md]

### Wave 0 Gaps

- [ ] `.planning/phases/22-preflight-closure/22-HUMAN-UAT.md` - captures PREF-01 operator evidence. [VERIFIED: ls .planning/phases/22-preflight-closure; VERIFIED: .planning/REQUIREMENTS.md]
- [ ] `.planning/phases/22-preflight-closure/22-EVIDENCE-LEDGER.md` - gate matrix with UI-spec columns and status labels. [VERIFIED: .planning/phases/22-preflight-closure/22-UI-SPEC.md]
- [ ] `.planning/phases/22-preflight-closure/22-VALIDATION-BASELINE.md` - captures PREF-02 classification. [VERIFIED: .planning/REQUIREMENTS.md; VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md]
- [ ] `.planning/phases/22-preflight-closure/22-HARDENING-REGISTER.md` - captures PREF-03 fragile point closure. [VERIFIED: .planning/REQUIREMENTS.md; VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md]
- [ ] `.planning/phases/22-preflight-closure/22-VERIFICATION.md` - final Phase 22 verification and Phase 23 blocker statement. [VERIFIED: .planning/ROADMAP.md; VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md]
- [ ] Production smoke command must set `GRABIT_SMOKE_ARTIFACT` or patch the script default before generating evidence. [VERIFIED: scripts/smoke-valkey-production.mjs]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | yes | OTP and password reset evidence must verify authentication outcomes without exposing raw OTPs or reset tokens. [VERIFIED: apps/api/src/modules/sms/sms.service.ts; VERIFIED: apps/web/app/auth/reset-password/page.tsx; VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md] |
| V3 Session Management | yes | Reset-to-login evidence should confirm login success without storing cookies, session tokens, or bearer headers in artifacts. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md; VERIFIED: apps/web/app/auth/reset-password/page.tsx] |
| V4 Access Control | yes | Any evidence/admin view touched in Phase 22 must stay inside existing shipped surfaces and not introduce new admin-console scope. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md; VERIFIED: .planning/phases/22-preflight-closure/22-UI-SPEC.md] |
| V5 Input Validation | yes | Existing SMS E.164 key builders and legal/content tests should remain the validation guard for shipped surfaces; direct fixes should reuse existing validators/tests. [VERIFIED: apps/api/src/modules/sms/sms.service.ts; VERIFIED: apps/web/content/legal/__tests__/legal-content.test.ts] |
| V6 Cryptography | yes | OTP/reset-token evidence must never include secrets; this phase should not hand-roll cryptographic primitives. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md; VERIFIED: apps/api/src/modules/sms/sms.service.ts; VERIFIED: apps/web/app/auth/reset-password/page.tsx] |

### Known Threat Patterns for Phase 22

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Raw OTP, phone number, reset link, email address, cookies, or secret values copied into evidence artifacts | Information Disclosure | Redact evidence before committing or linking it; store only masked identifiers and provider ids. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md] |
| SMS `isPhoneVerified` reused as public standalone auth proof | Spoofing / Elevation of Privilege | Treat `isPhoneVerified` as signup idempotency support only, matching the code comment. [VERIFIED: apps/api/src/modules/sms/sms.service.ts] |
| Redis Cluster multi-key operations using different hash slots | Tampering / Availability | Keep `{sms:<e164>}` hash tags and verify with integration tests or `CLUSTER KEYSLOT` where needed. [VERIFIED: apps/api/src/modules/sms/sms.service.ts; VERIFIED: apps/api/test/sms-cluster-crossslot.integration.spec.ts; CITED: https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/#hash-tags] |
| R2 local fallback in production | Availability / Information Disclosure | Require production R2 config evidence or classify as concrete fix, accepted risk, or blocker. [VERIFIED: apps/api/src/modules/admin/upload.service.ts; VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md] |
| Provider observation omitted from launch-readiness proof | Repudiation | Keep timestamped ledger rows with evidence path, owner, and next action. [VERIFIED: .planning/phases/22-preflight-closure/22-UI-SPEC.md; VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md] |

## Sources

### Primary (HIGH confidence)

- `.planning/phases/22-preflight-closure/22-CONTEXT.md` - locked Phase 22 decisions, gate scope, deferred items. [VERIFIED: local file]
- `.planning/phases/22-preflight-closure/22-UI-SPEC.md` - evidence ledger columns, grouping, labels, redaction rules, no-new-UI default. [VERIFIED: local file]
- `.planning/REQUIREMENTS.md` - PREF-01, PREF-02, PREF-03 and traceability. [VERIFIED: local file]
- `.planning/ROADMAP.md` - Phase 22 success criteria and Phase 23 dependency. [VERIFIED: local file]
- `.planning/STATE.md` - current v2.0 UAT/verification/debug gap inventory. [VERIFIED: local file]
- `apps/api/src/modules/sms/sms.service.ts` - SMS Valkey keying, `sms.verify_failed`, Sentry `provider=valkey`, idempotency comment. [VERIFIED: local file]
- `apps/web/components/auth/phone-verification.tsx` - server-message-priority behavior for SMS failure copy. [VERIFIED: local file]
- `apps/api/src/modules/auth/email/email.service.ts` - Resend accepted id path, production hard-fail, Sentry email-service capture. [VERIFIED: local file]
- `apps/web/app/auth/reset-password/page.tsx` - password reset request and confirm public API flow. [VERIFIED: local file]
- `apps/api/src/modules/admin/upload.service.ts` - R2 S3 client and local fallback behavior. [VERIFIED: local file]
- `scripts/smoke-valkey-production.mjs` - production Valkey smoke checks and artifact path behavior. [VERIFIED: local file]
- `git show bd8220e:.planning/phases/...` - archived v1.1 Phase 14/15/16/18/20/21 UAT and verification artifacts. [VERIFIED: git history]
- Context7 CLI `/redis/docs` - Redis Cluster hash tag semantics. [CITED: https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/#hash-tags]
- Context7 CLI `/websites/developers_cloudflare_r2` - R2 CORS and S3-compatible SDK docs. [CITED: https://developers.cloudflare.com/r2/buckets/cors/]
- Context7 CLI `/websites/resend` - Resend send/failure/domain docs. [CITED: https://resend.com/docs/webhooks/emails/failed]

### Secondary (MEDIUM confidence)

- npm registry `npm view` checks for package current versions and publish metadata. [VERIFIED: npm registry]
- Local CLI version checks for Node, pnpm, Docker, gcloud, gh, curl, dig, gsd-sdk, wrangler, and redis-cli. [VERIFIED: local shell]

### Tertiary (LOW confidence)

- Live dashboard/account access for Resend, Sentry, GCP, Cloudflare R2, Gmail, `support@heygrabit.com`, and `privacy@heygrabit.com` was not authenticated in this research session. [ASSUMED]

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - based on local package manifests, npm registry checks, and installed CLI probes. [VERIFIED: package.json; VERIFIED: apps/api/package.json; VERIFIED: apps/web/package.json; VERIFIED: npm registry; VERIFIED: local shell]
- Architecture: HIGH - based on locked Phase 22 decisions and inspected code paths for SMS, email, legal, R2, and Valkey smoke. [VERIFIED: .planning/phases/22-preflight-closure/22-CONTEXT.md; VERIFIED: apps/api/src/modules/sms/sms.service.ts; VERIFIED: apps/api/src/modules/auth/email/email.service.ts; VERIFIED: apps/api/src/modules/admin/upload.service.ts; VERIFIED: scripts/smoke-valkey-production.mjs]
- Pitfalls: HIGH - based on historical v1.1 verification gaps, current debug/STATE records, and current code behavior. [VERIFIED: .planning/STATE.md; VERIFIED: git show bd8220e:.planning/phases/14-sms-otp-crossslot-fix-sms-valkey-cluster-hash-tag/14-VERIFICATION.md; VERIFIED: git show bd8220e:.planning/phases/15-resend-heygrabit-com-cutover-transactional-email-secret-mana/15-VERIFICATION.md; VERIFIED: git show bd8220e:.planning/phases/16-legal-pages-launch-url/16-VERIFICATION.md; VERIFIED: local code inspection]
- Runtime/dashboard access: LOW - external dashboard authentication was not performed and must be collected by operator or classified in Phase 22. [ASSUMED]

**Research date:** 2026-05-04 [VERIFIED: environment_context.current_date]
**Valid until:** 2026-06-03 for repo/code structure and 2026-05-11 for npm/current external provider details. [ASSUMED]
