# Phase 23: Launch Foundation - Research

**Researched:** 2026-05-06 KST [VERIFIED: system current_date]
**Domain:** Next.js App Router i18n, NestJS auth/session, Drizzle expand-only migrations, consent/audit, booking-disabled feature gates [VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md]
**Confidence:** HIGH for codebase/stack, MEDIUM for compliance copy sufficiency because external legal counsel is explicitly excluded [VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md; ASSUMED]

<user_constraints>
## User Constraints (from CONTEXT.md)

Source: `.planning/phases/23-launch-foundation/23-CONTEXT.md` [VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md]

### Locked Decisions
## Implementation Decisions

### Prod Compatibility and Flags
- **D-01:** `BOOKING_ENABLED=false` is an API-first hard gate. A shared flag helper must block web UI actions and backend creation paths including seat locks, reservation prepare, and payment confirm/request attempts.
- **D-02:** Canary rollback is strict. If auth/session, booking-disabled API behavior, Korean root URL preservation, or locale routing fails, rollback immediately and do not mark Phase 23 as PASS.
- **D-03:** Feature flags belong in a shared package/helper used by web and API so flag names and boolean parsing cannot drift between apps.
- **D-04:** Migrations default to expand-only, with safe backfill and verified constraint strengthening allowed. Existing prod users, reservations, sessions, and Korean root URLs must not be broken; destructive contract/drop/rename work waits until event stabilization.

### Locale Routing and Formatting
- **D-05:** Use suggest-never-redirect locale detection. Keep Korean on `/`; `Accept-Language`/GeoIP may show a language suggestion, but automatic redirect is forbidden.
- **D-06:** Store locale preference in both cookie and user profile. Anonymous users use cookie; logged-in users use `users.preferred_locale`. Planner must define conflict precedence.
- **D-07:** Time and currency are local-friendly with a KST/KRW anchor. Show localized time where useful, but event/booking-critical times must also show KST. Show KRW source price plus estimated conversion and disclaimer.
- **D-08:** PhoneInput scope is five launch markets first. Prioritize `ko`, `en`, `th`, `zh-CN`, `zh-TW` UI and launch-country SMS validation, while keeping unsupported country search/selection available unless provider evidence says otherwise.

### Translation Workflow and Legal Lock
- **D-09:** General content follows `draft -> review -> publish`. Korean source is canonical; AI translations cannot publish before operator review; source edits make translations stale and require regeneration/review.
- **D-10:** All AI-assisted public fanmeet/event content keeps an automatic-translation label even after operator review.
- **D-11:** Legal-sensitive copy must use a schema-level legal content type. Legal, notice, refund, and booking-guide copy use manual `ko`/`en` fields only and are structurally excluded from AI translation jobs.
- **D-12:** Thai and Chinese locale users see the English legal canonical fallback for legal-sensitive copy. `ko` and `en` are the only manual legal canonical languages for this launch.

### Auth and Session Expansion
- **D-13:** LINE login is removed from Phase 23 planning per user instruction. This conflicts with current AUTH-01/roadmap text and must be called out before plan execution.
- **D-14:** Email verification uses a 30-minute token with immediate resend. Resend must still be protected by rate limits and latest-token-wins semantics.
- **D-15:** The three-device policy treats refresh token family as the device slot. Each login creates a family; keep three active families per user and revoke the oldest on the fourth login.
- **D-16:** Refresh token reuse/theft handling remains family-wide revoke plus user-visible re-login. Do not revoke all user sessions by default.

### Consent and Audit Foundation
- **D-17:** Consent uses itemized immutable versions. Terms, privacy, PIPA required items, cross-border transfer, PDPA/PIPL notices, and marketing consent are versioned by item and recorded as immutable audit rows with item, version, language, timestamp, user, and IP.
- **D-18:** Cross-border transfer consent for GMMTV/iQIYI data sharing is a required gate for signup/booking. If the user refuses, signup or fanmeet booking cannot proceed.
- **D-19:** Under-14 users are blocked. This launch does not build legal guardian consent flow.
- **D-20:** `COMP-02` requires operator-queryable audit evidence by item, version, language, timestamp, IP, and user. Phase 23 must include at least an admin/internal query surface plus tests/evidence.

### the agent's Discretion
No implementation choices were delegated to the agent. The only user-directed correction is LINE login removal, which downstream agents must reconcile with roadmap/requirements before execution.

### Deferred Ideas (OUT OF SCOPE)
## Deferred Ideas

- LINE login is removed from this phase unless the user re-adds it and updates roadmap/requirements.
- Legal guardian consent flow for under-14 users is deferred; launch behavior is block under 14.
- Full all-country phone/SMS localization is deferred beyond the five launch-market-first approach.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FLAG-01 | Existing production users, reservations, sessions, and Korean SEO URLs remain valid through expand-only migrations and canary deploys. [VERIFIED: .planning/REQUIREMENTS.md] | Use Drizzle generated migrations, expand-only DB changes, Korean root URL tests, and canary rollback gates. [VERIFIED: apps/api/drizzle.config.ts; CITED: https://github.com/drizzle-team/drizzle-orm-docs/blob/main/src/content/docs/drizzle-kit-migrate.mdx; VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md] |
| FLAG-02 | User sees booking disabled copy and booking APIs do not create seat locks or payment attempts while `BOOKING_ENABLED=false`. [VERIFIED: .planning/REQUIREMENTS.md] | Gate `BookingService.lockSeat`, `ReservationService.prepareReservation`, and `ReservationService.confirmAndCreateReservation`; avoid UI-only proof. [VERIFIED: apps/api/src/modules/booking/booking.service.ts; VERIFIED: apps/api/src/modules/reservation/reservation.service.ts; VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md] |
| I18N-01 | Public fanmeet pages support `ko`, `en`, `th`, `zh-CN`, `zh-TW`, with Korean prefixless and foreign prefixed routes. [VERIFIED: .planning/REQUIREMENTS.md] | Use `next-intl` routing with `localePrefix: 'as-needed'`; keep auto redirect off and expose explicit switcher. [CITED: https://github.com/amannn/next-intl/blob/main/docs/src/pages/docs/routing/configuration.mdx; VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md] |
| I18N-02 | Locale-sensitive flows cover PhoneInput labels, auth/OTP copy, email/SMS templates, time/currency, hreflang, and sitemap. [VERIFIED: .planning/REQUIREMENTS.md] | Reuse `react-phone-number-input` labels and Next.js localized sitemap alternates; add KST/KRW formatting helpers. [VERIFIED: apps/web/components/ui/phone-input.tsx; CITED: https://github.com/catamphetamine/react-phone-number-input/blob/master/README.md; CITED: https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap] |
| TRANS-01 | Operator creates Korean source, generates four translated drafts, reviews/publishes, and displays automatic-translation label. [VERIFIED: .planning/REQUIREMENTS.md] | Model content as source + per-locale draft/review/publish rows; DeepL is the standard translation client if real machine generation is in scope. [VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md; VERIFIED: npm view deepl-node version; CITED: https://github.com/deeplcom/deepl-node/blob/main/README.md] |
| TRANS-02 | Legal notices are schema-locked Korean/English manual fields, and automatic translation is blocked for legal copy. [VERIFIED: .planning/REQUIREMENTS.md] | Separate legal-sensitive content type from translatable fanmeet/event content; add tests that legal rows cannot enqueue translation jobs. [VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md] |
| AUTH-01 | Signup/login uses Kakao, Naver, Google, or email; email verification expires after 30 minutes and immediate resend is available. LINE is excluded despite stale docs. [VERIFIED: .planning/REQUIREMENTS.md; VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md] | Preserve current social strategy pattern but do not add LINE; add DB-backed opaque verification token with resend throttle and latest-token-wins. [VERIFIED: apps/api/src/modules/auth/auth.controller.ts; VERIFIED: apps/api/src/modules/auth/auth.service.ts; ASSUMED] |
| AUTH-02 | Account sessions enforce the three-device policy through refresh token family tracking. [VERIFIED: .planning/REQUIREMENTS.md] | Existing `refresh_tokens.family` already models token family; add active-family cap logic without changing reuse/theft family-wide revoke semantics. [VERIFIED: apps/api/src/database/schema/refresh-tokens.ts; VERIFIED: apps/api/src/modules/auth/auth.service.ts; VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md] |
| COMP-01 | User completes PIPA, cross-border transfer, PDPA/PIPL notice, under-14 block, and marketing consent flows. [VERIFIED: .planning/REQUIREMENTS.md] | Replace simple boolean terms rows with immutable item/version/language consent audit rows and UI gates. [VERIFIED: apps/api/src/database/schema/terms-agreements.ts; VERIFIED: apps/web/components/auth/signup-step2.tsx; VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md] |
| COMP-02 | Operator can query consent audit logs by item, version, language, timestamp, IP, and user. [VERIFIED: .planning/REQUIREMENTS.md] | Add internal/admin query endpoint and table-first UI with masked PII by default. [VERIFIED: .planning/phases/23-launch-foundation/23-UI-SPEC.md; VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md] |
</phase_requirements>

## Summary

Phase 23 should be planned as a foundation phase that changes shared contracts first, then applies them consistently in web, API, database, and validation artifacts. [VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md] The highest-risk planning hazards are stale LINE scope in `ROADMAP.md`/`REQUIREMENTS.md`, UI-only booking disabling, `NEXT_PUBLIC_` build-time flag freezing, and treating Phase 22 accepted risks as PASS evidence. [VERIFIED: .planning/ROADMAP.md; VERIFIED: .planning/REQUIREMENTS.md; VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md; CITED: https://nextjs.org/docs/pages/guides/environment-variables; VERIFIED: .planning/STATE.md]

The implementation should use existing monorepo patterns: `packages/shared` for flag/locale constants and schemas, `apps/web` App Router surfaces for locale UI and admin review/audit, `apps/api` Nest modules for authoritative gates and audit writes, and Drizzle migrations for additive schema expansion. [VERIFIED: packages/shared/package.json; VERIFIED: apps/web/package.json; VERIFIED: apps/api/package.json; VERIFIED: apps/api/drizzle.config.ts]

**Primary recommendation:** Plan Wave 0 as contract/schema/test scaffolding, then split work by capability: shared flags + booking gates, i18n route shell, translation/legal workflow, auth/session/email verification, and consent/audit. [VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md; VERIFIED: codebase rg]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Shared feature flags | API / Backend | Browser / Client, Shared package | API must be the source of enforcement for seat locks/reservation/payment creation; shared package only prevents name/parser drift. [VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md; VERIFIED: apps/api/src/modules/booking/booking.service.ts; VERIFIED: apps/api/src/modules/reservation/reservation.service.ts] |
| Booking-disabled copy | Browser / Client | API / Backend | UI shows localized disabled/opening copy, but backend blocks mutation paths. [VERIFIED: .planning/phases/23-launch-foundation/23-UI-SPEC.md; VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md] |
| Locale routing | Frontend Server (SSR) | Browser / Client | Next.js App Router and `next-intl` middleware own route locale resolution; client only switches explicit user choice. [CITED: https://github.com/amannn/next-intl/blob/main/docs/src/pages/docs/routing/configuration.mdx; VERIFIED: apps/web/app/layout.tsx] |
| Locale preference persistence | API / Backend | Frontend Server (SSR), Database / Storage | Logged-in preference belongs on `users.preferred_locale`; anonymous preference belongs in cookie. [VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md; VERIFIED: apps/api/src/database/schema/users.ts] |
| Translation review workflow | API / Backend | Browser / Client, Database / Storage, external translation provider | API owns state transitions and stale detection; admin UI edits/reviews; DB stores immutable source and reviewed locale rows; DeepL can generate drafts. [VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md; CITED: https://github.com/deeplcom/deepl-node/blob/main/README.md] |
| Legal copy lock | Database / Storage | API / Backend, Browser / Client | Schema must exclude legal content from translation jobs; API enforces; UI shows manual `ko`/`en` fallback labels. [VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md; VERIFIED: .planning/phases/23-launch-foundation/23-UI-SPEC.md] |
| Email verification | API / Backend | Resend, Browser / Client, Database / Storage | API issues, hashes, expires, throttles, and consumes tokens; UI exposes sent/resend/expired states. [VERIFIED: apps/api/src/modules/auth/auth.controller.ts; VERIFIED: apps/api/src/modules/auth/email/email.service.ts; VERIFIED: .planning/phases/23-launch-foundation/23-UI-SPEC.md] |
| Three-device policy | API / Backend | Database / Storage | Refresh token family is already persisted in `refresh_tokens.family`; API login/refresh logic owns cap and theft handling. [VERIFIED: apps/api/src/database/schema/refresh-tokens.ts; VERIFIED: apps/api/src/modules/auth/auth.service.ts] |
| 5-country SMS validation | API / Backend | Browser / Client, Infobip | `SmsService` already normalizes E.164 and owns provider send/rate limits; PhoneInput owns labels/selection. [VERIFIED: apps/api/src/modules/sms/sms.service.ts; VERIFIED: apps/web/components/ui/phone-input.tsx] |
| Consent capture and audit query | API / Backend | Database / Storage, Browser / Client | API must write immutable evidence rows at signup/booking gates; admin UI queries masked evidence. [VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md; VERIFIED: .planning/phases/23-launch-foundation/23-UI-SPEC.md] |

## Project Constraints (from AGENTS.md)

- User-facing responses must be Korean, while technical terms and code identifiers stay in English. [VERIFIED: AGENTS.md]
- Do not modify Claude/`~/.claude` settings, files, or workflows. [VERIFIED: AGENTS.md]
- GSD subagent timeout or empty status is not automatically failure; artifact contracts must be checked before closing agents. [VERIFIED: AGENTS.md]
- Project stack must follow `docs/03-ARCHITECTURE.md` and existing codebase patterns. [VERIFIED: AGENTS.md; VERIFIED: docs/03-ARCHITECTURE.md]
- Monolith-first complexity control matters because this is a one-person project. [VERIFIED: AGENTS.md]
- Root `.env` is the only local env file location; do not add app-local `.env` files. [VERIFIED: AGENTS.md; VERIFIED: .env.example]
- Production uses Cloud Run env vars or GCP Secret Manager, not `.env` files. [VERIFIED: AGENTS.md; VERIFIED: docs/03-ARCHITECTURE.md]
- Drizzle commands run from root with `DOTENV_CONFIG_PATH=../../.env` when using `pnpm --filter @grabit/api`. [VERIFIED: AGENTS.md; VERIFIED: apps/api/drizzle.config.ts]
- Phase work should start through GSD workflow artifacts; this research writes only the requested research artifact. [VERIFIED: AGENTS.md]

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next-intl` | npm latest `4.11.0`, modified 2026-05-05 | Next.js App Router i18n routing, messages, formatting | Official docs support `defineRouting`, `localePrefix: 'as-needed'`, and formatting configuration needed for Korean root + prefixed foreign routes. [VERIFIED: npm view next-intl version time.modified; CITED: https://github.com/amannn/next-intl/blob/main/docs/src/pages/docs/routing/configuration.mdx] |
| `react-phone-number-input` | project `^3.4.16`, npm latest `3.4.16`, modified 2026-02-23 | Localized phone input and country labels | Existing component already uses it; docs support `labels` locale JSON and custom country select. [VERIFIED: apps/web/package.json; VERIFIED: npm view react-phone-number-input version time.modified; CITED: https://github.com/catamphetamine/react-phone-number-input/blob/master/README.md] |
| `libphonenumber-js` | project `^1.12.41`, npm latest `1.12.42`, modified 2026-04-23 | Server and client phone parsing/validation | Existing SMS service uses it through `parseE164`; docs expose strict parse and `isValidPhoneNumber`. [VERIFIED: apps/api/package.json; VERIFIED: apps/web/package.json; VERIFIED: npm view libphonenumber-js version time.modified; CITED: https://github.com/catamphetamine/libphonenumber-js/blob/master/README.md] |
| `drizzle-orm` | project `^0.45.0`, npm latest `0.45.2`, modified 2026-05-05 | Type-safe PostgreSQL schema and queries | Existing DB layer uses Drizzle schema files and migrations; docs support generated migration files via `drizzle-kit generate`. [VERIFIED: apps/api/package.json; VERIFIED: apps/api/src/database/schema/index.ts; VERIFIED: npm view drizzle-orm version time.modified; CITED: https://github.com/drizzle-team/drizzle-orm-docs/blob/main/src/content/docs/drizzle-kit-migrate.mdx] |
| `drizzle-kit` | project `^0.31.0`, npm latest `0.31.10`, modified 2026-05-05 | Migration generation and execution | Existing `apps/api/drizzle.config.ts` points at schema and migration directory. [VERIFIED: apps/api/package.json; VERIFIED: apps/api/drizzle.config.ts; VERIFIED: npm view drizzle-kit version time.modified] |
| `@nestjs/throttler` | project `^6.4.0`, npm latest `6.5.0`, modified 2025-12-02 | Resend/rate-limit sensitive auth endpoints | Existing password reset endpoints already use v5+ object signature; docs confirm object-based `@Throttle`. [VERIFIED: apps/api/package.json; VERIFIED: apps/api/src/modules/auth/auth.controller.ts; VERIFIED: npm view @nestjs/throttler version time.modified; CITED: https://github.com/nestjs/throttler/blob/master/README.md] |
| `@nestjs/jwt` | project/latest `11.0.2`, modified 2025-12-05 | Access token and existing reset/social token signing | Existing auth service uses it; keep for compatibility unless opaque DB tokens are used for email verification. [VERIFIED: apps/api/package.json; VERIFIED: apps/api/src/modules/auth/auth.service.ts; VERIFIED: npm view @nestjs/jwt version time.modified] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@formatjs/intl-localematcher` | npm latest `0.8.6`, modified 2026-05-05 | Match `Accept-Language` to supported launch locales | Use only for suggestion logic; never redirect automatically. [VERIFIED: npm view @formatjs/intl-localematcher version time.modified; VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md] |
| `negotiator` + `@types/negotiator` | npm latest `1.0.0`, types `0.6.4` | Parse `Accept-Language` headers | Use in server/middleware helper for locale suggestion candidates. [VERIFIED: npm view negotiator version time.modified; VERIFIED: npm view @types/negotiator version time.modified] |
| `deepl-node` | npm latest `1.27.0`, modified 2026-04-28 | Generate machine translation drafts | Use behind an adapter/job only for non-legal event/fanmeet content; map `zh-CN` to DeepL `ZH-HANS` and `zh-TW` to `ZH-HANT`. [VERIFIED: npm view deepl-node version time.modified; CITED: https://github.com/deeplcom/deepl-node/blob/main/README.md; CITED: https://developers.deepl.com/docs/resources/supported-languages] |
| `resend` | project `^6.11.0`, npm latest `6.12.2`, modified 2026-04-20 | Send verification email | Existing email service uses Resend; docs support React Email component sending. [VERIFIED: apps/api/package.json; VERIFIED: apps/api/src/modules/auth/email/email.service.ts; VERIFIED: npm view resend version time.modified; CITED: https://resend.com/docs/send-with-nodejs] |
| `@react-email/components` | project/latest `1.0.12`, modified 2026-04-17 | Email template rendering | Use for localized verification templates alongside existing password reset template pattern. [VERIFIED: apps/api/package.json; VERIFIED: apps/api/src/modules/auth/email/templates/password-reset.tsx; VERIFIED: npm view @react-email/components version time.modified] |
| `date-fns` | npm latest `4.1.0`, modified 2025-08-03 | Optional date utility | Use only if native `Intl.DateTimeFormat` cannot cover KST anchor formatting; current project does not install it. [VERIFIED: npm view date-fns version time.modified; VERIFIED: apps/web/package.json] |
| `zod` | project API `^3.25.76`, shared `^3.24.0`, npm latest `4.4.3` | DTO/schema validation | Keep project on existing Zod 3 for Phase 23; upgrading to Zod 4 is a separate migration because existing schemas use Zod 3 APIs. [VERIFIED: apps/api/package.json; VERIFIED: packages/shared/package.json; VERIFIED: packages/shared/src/schemas/auth.schema.ts; VERIFIED: npm view zod version time.modified] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `next-intl` | Hand-rolled route parsing + JSON loader | Hand-rolling risks route prefix drift, locale fallback bugs, and metadata duplication. [CITED: https://github.com/amannn/next-intl/blob/main/docs/src/pages/docs/routing/configuration.mdx; ASSUMED] |
| Shared env flag helper | LaunchDarkly or external flag platform | Requirements explicitly exclude external flag platform; env/helper flags are sufficient. [VERIFIED: .planning/REQUIREMENTS.md] |
| DB-backed email verification token | JWT-only verification link | JWT-only links make latest-token-wins and resend invalidation harder without additional state. [VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md; ASSUMED] |
| `deepl-node` adapter | Direct fetch to DeepL API | Official client reduces request/response shape drift and exposes supported language APIs. [CITED: https://github.com/deeplcom/deepl-node/blob/main/README.md] |
| Existing `react-phone-number-input` | New phone input package | Existing component, tests, and styling already depend on current package. [VERIFIED: apps/web/components/ui/phone-input.tsx; VERIFIED: apps/web/package.json] |

**Installation:**

```bash
pnpm --filter @grabit/web add next-intl @formatjs/intl-localematcher negotiator
pnpm --filter @grabit/web add -D @types/negotiator
pnpm --filter @grabit/api add deepl-node
```

Installation commands are package-manager aligned with root `packageManager: pnpm@10.28.1`. [VERIFIED: package.json]

**Version verification:** Each recommended package version above was checked with `npm view <package> version time.modified` on 2026-05-06 KST. [VERIFIED: npm view commands]

## Architecture Patterns

### System Architecture Diagram

```text
Browser request
  -> Next.js proxy / next-intl routing
    -> locale resolved from URL first
    -> if URL is "/" and Accept-Language suggests non-ko: show suggestion only
    -> Server Components load messages + runtime flags
      -> public UI renders disabled booking / locale / consent states
      -> mutation attempts go to NestJS API
        -> shared flag helper parses BOOKING_ENABLED
        -> booking false?
             yes -> block lock / prepare / confirm with localized-safe error code
             no  -> existing booking/reservation/payment path
        -> auth/signup writes email verification + consent audit rows
        -> translation admin writes source/review/publish state
          -> DeepL draft job only for non-legal content
          -> legal content excluded by schema and service guard
        -> Drizzle/PostgreSQL stores users, sessions, translations, legal content, consent audit
        -> Resend/Infobip external services send verification email/SMS
```

This diagram follows the primary Phase 23 request paths from browser input to backend enforcement and persistence. [VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md; VERIFIED: apps/api/src/modules/booking/booking.service.ts; VERIFIED: apps/api/src/modules/reservation/reservation.service.ts]

### Recommended Project Structure

```text
packages/shared/src/
├── constants/locales.ts       # launch locales, route prefixes, locale labels
├── flags.ts                   # flag names, boolean parser, defaults
├── schemas/consent.schema.ts  # itemized consent DTOs
└── types/i18n.types.ts        # Locale, legal fallback, translation state types

apps/web/
├── i18n/routing.ts            # next-intl defineRouting
├── i18n/request.ts            # request locale/messages config
├── messages/{ko,en,th,zh-CN,zh-TW}.json
├── app/[locale]/...           # foreign locale route shell if needed by next-intl
├── app/sitemap.ts             # localized sitemap alternates
└── components/admin/...       # translation queue and consent audit table

apps/api/src/
├── modules/feature-flags/     # API runtime flag provider
├── modules/translation/       # source/draft/review/publish workflow
├── modules/consent/           # immutable consent capture and audit query
└── database/schema/...        # additive tables/columns only
```

The structure keeps contracts in `packages/shared`, runtime enforcement in `apps/api`, and UI in `apps/web`. [VERIFIED: packages/shared/package.json; VERIFIED: apps/api/package.json; VERIFIED: apps/web/package.json]

### Pattern 1: Runtime Feature Flags Without Client Bundle Freezing

**What:** Parse `BOOKING_ENABLED` in shared code, but expose web UI flags through SSR/API data rather than `NEXT_PUBLIC_BOOKING_ENABLED`. [CITED: https://nextjs.org/docs/pages/guides/environment-variables; VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md]

**When to use:** Use this for any flag that must flip on Cloud Run without rebuilding a Docker image. [CITED: https://nextjs.org/docs/pages/guides/environment-variables; VERIFIED: docs/v2.0-fanmeet-milestone-spec.md]

**Example:**

```typescript
// Source: Next.js env docs + Phase 23 D-01/D-03
export const FLAG_NAMES = {
  bookingEnabled: 'BOOKING_ENABLED',
} as const;

export function parseBooleanFlag(value: string | undefined, fallback = false): boolean {
  if (value == null || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

export function readFeatureFlags(env: Record<string, string | undefined>) {
  return {
    bookingEnabled: parseBooleanFlag(env[FLAG_NAMES.bookingEnabled], false),
  };
}
```

### Pattern 2: Suggest-Never-Redirect Locale Detection

**What:** Resolve content locale from the URL/cookie/profile; use `Accept-Language` only to show a suggestion. [VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md]

**When to use:** Use on Korean root `/` and existing Korean URLs so SEO/root behavior remains stable. [VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md; VERIFIED: .planning/ROADMAP.md]

**Example:**

```typescript
// Source: next-intl defineRouting docs + Phase 23 D-05
import {defineRouting} from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['ko', 'en', 'th', 'zh-CN', 'zh-TW'],
  defaultLocale: 'ko',
  localePrefix: 'as-needed',
});
```

### Pattern 3: Immutable Consent Items

**What:** Store each consent item/version/language as its own immutable audit row rather than extending `terms_agreements` booleans. [VERIFIED: apps/api/src/database/schema/terms-agreements.ts; VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md]

**When to use:** Use during signup, social completion, and booking-specific cross-border consent gates. [VERIFIED: apps/api/src/modules/auth/auth.service.ts; VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md]

**Example:**

```typescript
// Source: Phase 23 D-17/D-20
export type ConsentItem =
  | 'terms'
  | 'privacy'
  | 'pipa_required'
  | 'cross_border_transfer'
  | 'pdpa_notice'
  | 'pipl_notice'
  | 'marketing';

export type ConsentAuditRow = {
  item: ConsentItem;
  version: string;
  language: 'ko' | 'en' | 'th' | 'zh-CN' | 'zh-TW';
  userId: string;
  ipAddress: string;
  acceptedAt: Date;
};
```

### Pattern 4: Refresh Token Family as Device Slot

**What:** Treat each new login family as one device slot, and count active families rather than raw token rows. [VERIFIED: apps/api/src/database/schema/refresh-tokens.ts; VERIFIED: apps/api/src/modules/auth/auth.service.ts; VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md]

**When to use:** Apply immediately after new login/social login token family creation; keep refresh rotation in the same family. [VERIFIED: apps/api/src/modules/auth/auth.service.ts]

**Example:**

```typescript
// Source: existing AuthService token family model + D-15
// Pseudocode for planner: implement with Drizzle query helpers, not raw string SQL.
async function enforceMaxActiveRefreshFamilies(userId: string, newestFamily: string) {
  const families = await listActiveFamiliesByMostRecentToken(userId);
  const overflow = families.filter((f) => f.family !== newestFamily).slice(2);

  for (const family of overflow) {
    await revokeRefreshTokenFamily(family.family, 'device_limit');
  }
}
```

### Anti-Patterns to Avoid

- **UI-only booking disabled:** Bots can still call lock/prepare/confirm APIs, so API gates are mandatory. [VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md; VERIFIED: apps/api/src/modules/booking/booking.service.ts; VERIFIED: apps/api/src/modules/reservation/reservation.service.ts]
- **`NEXT_PUBLIC_BOOKING_ENABLED` as cutover flag:** Next.js public env vars are inlined at build time and can freeze after Docker build. [CITED: https://nextjs.org/docs/pages/guides/environment-variables]
- **Auto redirect on locale detection:** D-05 forbids automatic redirect and preserves Korean root URLs. [VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md]
- **Adding LINE because stale docs mention it:** D-13 removes LINE from Phase 23, and UI spec blocks LINE buttons/copy. [VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md; VERIFIED: .planning/phases/23-launch-foundation/23-UI-SPEC.md]
- **Machine-translating legal copy:** D-11/D-12 require manual `ko`/`en` legal content and English fallback for Thai/Chinese legal-sensitive copy. [VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md]
- **Replacing consent booleans without audit rows:** Existing `terms_agreements` cannot answer `COMP-02` by item/version/language/IP. [VERIFIED: apps/api/src/database/schema/terms-agreements.ts; VERIFIED: .planning/REQUIREMENTS.md]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| i18n route matching and message loading | Custom route parser/message loader | `next-intl` | Official library covers `defineRouting`, `localePrefix: 'as-needed'`, App Router messages, and formatting. [CITED: https://github.com/amannn/next-intl/blob/main/docs/src/pages/docs/routing/configuration.mdx] |
| Phone validation rules | Country-specific regexes | `libphonenumber-js` and existing `parseE164` | Phone validity depends on country-specific length and digit patterns. [CITED: https://github.com/catamphetamine/libphonenumber-js/blob/master/README.md; VERIFIED: apps/api/src/modules/sms/sms.service.ts] |
| Phone country UI | New custom phone selector | Existing `PhoneInput` wrapper | Existing shadcn/Radix wrapper already handles flags, popover, labels, and min-height. [VERIFIED: apps/web/components/ui/phone-input.tsx; VERIFIED: .planning/phases/23-launch-foundation/23-UI-SPEC.md] |
| Translation API client | Raw DeepL HTTP calls | `deepl-node` adapter | Official client exposes text translation and supported language helpers. [CITED: https://github.com/deeplcom/deepl-node/blob/main/README.md] |
| Feature flag platform | LaunchDarkly/custom remote flag service | Shared env parser + API runtime provider | Requirements exclude external flag platform, and the launch needs one low-risk runtime toggle. [VERIFIED: .planning/REQUIREMENTS.md; VERIFIED: docs/v2.0-fanmeet-milestone-spec.md] |
| Rate limiting | In-memory counters | Existing `@nestjs/throttler` + Redis storage pattern | Existing auth/SMS code already uses throttling and Valkey-safe counters. [VERIFIED: apps/api/src/modules/auth/auth.controller.ts; VERIFIED: apps/api/src/modules/sms/sms.service.ts; CITED: https://github.com/nestjs/throttler/blob/master/README.md] |
| Session cap tracking | Browser localStorage device ids | Refresh token family rows | D-15 defines family as the device slot, and existing schema already persists family. [VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md; VERIFIED: apps/api/src/database/schema/refresh-tokens.ts] |
| Legal/compliance sufficiency | AI-generated legal conclusions | User-approved manual `ko`/`en` legal copy plus explicit accepted legal risk | Milestone excludes external legal counsel, so implementation should capture consent evidence without claiming legal adequacy. [VERIFIED: docs/v2.0-fanmeet-milestone-spec.md; ASSUMED] |

**Key insight:** Phase 23 is not primarily a UI translation phase; it is a cross-tier contract phase where backend gates, database evidence, and locale routing must agree before launch. [VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md]

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Existing schema contains `users`, `refresh_tokens`, `reservations`, `payments`, `terms_agreements`, and Korean-only performance/legal fields. [VERIFIED: apps/api/src/database/schema/users.ts; VERIFIED: apps/api/src/database/schema/refresh-tokens.ts; VERIFIED: apps/api/src/database/schema/reservations.ts; VERIFIED: apps/api/src/database/schema/payments.ts; VERIFIED: apps/api/src/database/schema/terms-agreements.ts; VERIFIED: apps/api/src/database/schema/performances.ts] | Add nullable/defaulted columns/tables first; backfill `users.preferred_locale='ko'`; preserve existing refresh token families and reservation/payment rows. [VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md; ASSUMED] |
| Live service config | Cloud Run env/Secret Manager names include DB/auth/OAuth/Toss/SMS/Resend/Sentry values; `BOOKING_ENABLED` is not yet present in `.env.example`. [VERIFIED: .env.example; VERIFIED: docs/03-ARCHITECTURE.md; VERIFIED: rg BOOKING_ENABLED] | Add `BOOKING_ENABLED=false` to `.env.example`, Cloud Run env/runbook, and tests; do not store secret values in artifacts. [VERIFIED: .env.example; VERIFIED: .planning/phases/22-preflight-closure/22-HUMAN-UAT.md] |
| OS-registered state | None found in repo-scoped references for pm2/launchd/systemd task registration relevant to Phase 23. [VERIFIED: rg repo] | No OS re-registration task unless operator reports a non-Cloud Run host. [ASSUMED] |
| Secrets/env vars | Existing root `.env` exists but was not read; `.env.example` documents `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, OAuth provider keys, Toss keys, Infobip keys, Resend keys, and Sentry keys. [VERIFIED: rg --files -g '.env*'; VERIFIED: .env.example] | Do not change secret values in research/planning artifacts; add names only for new env vars. [VERIFIED: .planning/phases/22-preflight-closure/22-HUMAN-UAT.md] |
| Build artifacts | Existing monorepo uses pnpm, Turbo, Next standalone-capable stack, Nest build, and Drizzle migrations. [VERIFIED: package.json; VERIFIED: apps/web/package.json; VERIFIED: apps/api/package.json; VERIFIED: apps/api/drizzle.config.ts] | Rebuild shared package before app typechecks when adding shared exports. [VERIFIED: packages/shared/package.json; ASSUMED] |

**Nothing found in category:** No project-specific `.codex/skills` or `.agents/skills` directory exists, so no project skill rules need to be applied beyond AGENTS.md. [VERIFIED: find .codex/skills .agents/skills]

## Common Pitfalls

### Pitfall 1: Stale LINE Scope

**What goes wrong:** Planner adds LINE OAuth because `AUTH-01`, `ROADMAP.md`, and milestone spec still mention LINE. [VERIFIED: .planning/REQUIREMENTS.md; VERIFIED: .planning/ROADMAP.md; VERIFIED: docs/v2.0-fanmeet-milestone-spec.md]

**Why it happens:** `23-CONTEXT.md` is newer than consolidated roadmap/requirements and explicitly removed LINE. [VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md]

**How to avoid:** First plan task should update or annotate planning docs so `AUTH-01` scope excludes LINE for Phase 23. [VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md]

**Warning signs:** New `passport-line`, LINE button, LINE callback route, or `lineLogin` flag appears in a plan. [VERIFIED: .planning/phases/23-launch-foundation/23-UI-SPEC.md]

### Pitfall 2: Booking Flag Only Disables Buttons

**What goes wrong:** UI says booking opens later, but API still creates Redis locks or pending reservations. [VERIFIED: apps/api/src/modules/booking/booking.service.ts; VERIFIED: apps/api/src/modules/reservation/reservation.service.ts]

**Why it happens:** Existing booking flow has separate lock, prepare, and confirm creation points. [VERIFIED: apps/api/src/modules/booking/booking.service.ts; VERIFIED: apps/api/src/modules/reservation/reservation.controller.ts]

**How to avoid:** Gate `lockSeat`, `prepareReservation`, and `confirmAndCreateReservation`, and test all three. [VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md]

**Warning signs:** Tests only assert disabled button copy or Playwright intercepts without direct API unit tests. [VERIFIED: apps/web/e2e/toss-payment.spec.ts; ASSUMED]

### Pitfall 3: Runtime Flag Frozen into Next.js Client Bundle

**What goes wrong:** `BOOKING_ENABLED` changes in Cloud Run but web UI remains stale because a `NEXT_PUBLIC_` flag was inlined during `next build`. [CITED: https://nextjs.org/docs/pages/guides/environment-variables]

**Why it happens:** Next.js public env vars are build-time bundled for browser code. [CITED: https://nextjs.org/docs/pages/guides/environment-variables]

**How to avoid:** Read runtime flag on server/API and pass the resolved value to client components. [CITED: https://nextjs.org/docs/pages/guides/environment-variables; ASSUMED]

**Warning signs:** `NEXT_PUBLIC_BOOKING_ENABLED` appears in client components. [CITED: https://nextjs.org/docs/pages/guides/environment-variables]

### Pitfall 4: Consent Model Cannot Answer Audit Queries

**What goes wrong:** `COMP-02` cannot filter by item/version/language/IP because existing `terms_agreements` stores only three booleans and timestamp. [VERIFIED: apps/api/src/database/schema/terms-agreements.ts; VERIFIED: .planning/REQUIREMENTS.md]

**Why it happens:** Previous Korean MVP consent was not itemized/versioned. [VERIFIED: apps/api/src/database/schema/terms-agreements.ts; VERIFIED: apps/web/components/auth/signup-step2.tsx]

**How to avoid:** Add immutable `consent_items`/`consent_versions`/`consent_audit_logs` or equivalent schema and write rows per item. [VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md; ASSUMED]

**Warning signs:** Plan only adds columns to `terms_agreements` and no admin/internal query endpoint. [VERIFIED: .planning/REQUIREMENTS.md]

### Pitfall 5: Translation Workflow Publishes Legal Copy

**What goes wrong:** Legal, notice, refund, or booking-guide text enters machine translation workflow. [VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md]

**Why it happens:** General event content and legal-sensitive content are modeled together. [ASSUMED]

**How to avoid:** Use schema-level `contentType` or separate tables and make translation job creation reject legal-sensitive types. [VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md]

**Warning signs:** Thai/Chinese legal pages show machine-translated legal copy instead of English canonical fallback. [VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md; VERIFIED: .planning/phases/23-launch-foundation/23-UI-SPEC.md]

### Pitfall 6: Refresh Token Cap Counts Token Rows Instead of Families

**What goes wrong:** Normal refresh rotation creates multiple rows in one family and a row-count policy incorrectly revokes active devices. [VERIFIED: apps/api/src/modules/auth/auth.service.ts; VERIFIED: apps/api/src/database/schema/refresh-tokens.ts]

**Why it happens:** Existing refresh path revokes the old token and inserts a new row with the same family. [VERIFIED: apps/api/src/modules/auth/auth.service.ts]

**How to avoid:** Count distinct active families with at least one unrevoked, unexpired token. [VERIFIED: apps/api/src/database/schema/refresh-tokens.ts; ASSUMED]

**Warning signs:** SQL limits active rows instead of active `family` groups. [VERIFIED: apps/api/src/database/schema/refresh-tokens.ts]

## Code Examples

Verified patterns from official sources and codebase:

### Localized Sitemap Alternates

```typescript
// Source: https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap
import type {MetadataRoute} from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  return [{
    url: 'https://heygrabit.com/performance/example',
    lastModified: new Date(),
    alternates: {
      languages: {
        ko: 'https://heygrabit.com/performance/example',
        en: 'https://heygrabit.com/en/performance/example',
        th: 'https://heygrabit.com/th/performance/example',
        'zh-CN': 'https://heygrabit.com/zh-CN/performance/example',
        'zh-TW': 'https://heygrabit.com/zh-TW/performance/example',
      },
    },
  }];
}
```

### Phone Label Localization

```tsx
// Source: https://github.com/catamphetamine/react-phone-number-input/blob/master/README.md
import PhoneInput from 'react-phone-number-input';
import en from 'react-phone-number-input/locale/en.json';

<PhoneInput labels={en} defaultCountry="KR" value={value} onChange={setValue} />;
```

### DeepL Draft Translation Adapter

```typescript
// Source: https://github.com/deeplcom/deepl-node/blob/main/README.md
import * as deepl from 'deepl-node';

const translator = new deepl.Translator(process.env['DEEPL_AUTH_KEY']!);

const result = await translator.translateText(
  koreanSource,
  'KO',
  'ZH-HANT',
  {preserveFormatting: true, context: eventContext},
);
```

### NestJS Throttle Object Signature

```typescript
// Source: https://github.com/nestjs/throttler/blob/master/README.md
@Throttle({default: {limit: 3, ttl: 900000}})
@Post('email-verification/resend')
async resendVerification() {
  // latest-token-wins resend
}
```

### Drizzle Migration Generation

```bash
# Source: https://github.com/drizzle-team/drizzle-orm-docs/blob/main/src/content/docs/drizzle-kit-migrate.mdx
DOTENV_CONFIG_PATH=../../.env pnpm --filter @grabit/api exec drizzle-kit generate --name=phase23_launch_foundation
DOTENV_CONFIG_PATH=../../.env pnpm --filter @grabit/api exec drizzle-kit migrate
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Default locale redirect/prefix | `localePrefix: 'as-needed'` with Korean prefixless root | Current next-intl docs | Preserves `/` for `ko` while foreign locales use prefixes. [CITED: https://github.com/amannn/next-intl/blob/main/docs/src/pages/docs/routing/configuration.mdx] |
| Public env flag in client bundle | Runtime API/SSR flag exposure | Current Next.js env docs | Avoids stale flags when one Docker image is promoted across environments. [CITED: https://nextjs.org/docs/pages/guides/environment-variables] |
| Boolean terms agreement row | Itemized immutable consent evidence | Phase 23 D-17/D-20 | Required for operator audit query by item/version/language/IP/user. [VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md] |
| Token row count session cap | Refresh token family count | Phase 23 D-15 | Matches existing rotation model where a family has multiple token rows. [VERIFIED: apps/api/src/modules/auth/auth.service.ts; VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md] |
| ASVS 4.x category numbering | ASVS 5.0 category numbering | OWASP ASVS 5.0 release track | Security section should map legacy template labels to ASVS 5 current categories. [CITED: https://github.com/OWASP/ASVS; CITED: https://devguide.owasp.org/en/11-security-gap-analysis/01-guides/02-asvs/] |

**Deprecated/outdated:**
- `@tosspayments/sdk` remains excluded; current project already uses `@tosspayments/tosspayments-sdk`. [VERIFIED: apps/web/package.json; VERIFIED: AGENTS.md]
- LINE login in Phase 23 is outdated scope text and must not be implemented. [VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md; VERIFIED: .planning/ROADMAP.md; VERIFIED: .planning/REQUIREMENTS.md]
- Zod 4 is current on npm, but this project should not upgrade during Phase 23 because current schemas and dependencies are on Zod 3. [VERIFIED: npm view zod version time.modified; VERIFIED: apps/api/package.json; VERIFIED: packages/shared/package.json]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | External legal counsel is excluded, so implementation can capture user-approved legal/consent evidence but cannot prove legal sufficiency. [ASSUMED] | Summary, Don't Hand-Roll, Security Domain | If legal sufficiency is required, Phase 23 needs legal review tasks before launch copy lock. |
| A2 | DB-backed opaque email verification tokens are preferable to JWT-only links for latest-token-wins semantics. [ASSUMED] | Phase Requirements, Standard Stack | If JWT-only is chosen, planner must add state to invalidate older resend links. |
| A3 | No OS re-registration task is required unless production has non-Cloud Run hosts. [ASSUMED] | Runtime State Inventory | If pm2/systemd/launchd exists outside repo, env/config changes may miss live state. |
| A4 | DeepL draft generation is acceptable for non-legal content when an API key is available. [ASSUMED] | Standard Stack, Code Examples | If no DeepL account/key exists, planner must provide mock/manual draft fallback or choose another provider after user confirmation. |
| A5 | Rebuilding `packages/shared` before dependent app typechecks is required after shared export changes. [ASSUMED] | Runtime State Inventory | If omitted, app typechecks may read stale shared `dist` output. |

## Open Questions

1. **RESOLVED: How should locale precedence resolve conflicts between URL, cookie, and `users.preferred_locale`?** [VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md]
   - What we know: Anonymous users use cookie; logged-in users store profile preference. [VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md]
   - Resolution: Plan 23-01 defines the shared `LocaleResolution` contract; Plan 23-04 implements route-level suggest-never-redirect behavior; Plan 23-10 implements user profile persistence with precedence `url > explicit-switch > user-profile > cookie > ko`. [RESOLVED: .planning/phases/23-launch-foundation/23-01-PLAN.md; .planning/phases/23-launch-foundation/23-04-PLAN.md; .planning/phases/23-launch-foundation/23-10-PLAN.md]
   - Recommendation carried into plan: Use URL > explicit switch action > logged-in profile > cookie > default `ko`; never auto redirect. [VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md; RESOLVED]

2. **RESOLVED: Will the operator provide DeepL credentials for draft generation in Phase 23?** [ASSUMED]
   - What we know: Milestone spec mentions DeepL API + LLM post-processing; no env var exists in `.env.example`. [VERIFIED: docs/v2.0-fanmeet-milestone-spec.md; VERIFIED: .env.example]
   - Resolution: Plan 23-05 declares `DEEPL_AUTH_KEY` in `user_setup`, adds `DeepLClient`, and requires missing-key fallback to deterministic unavailable/manual-review state without publishing. Live provider evidence remains dependent on user-provided credentials and is not hidden. [RESOLVED: .planning/phases/23-launch-foundation/23-05-PLAN.md]
   - Recommendation carried into plan: Plan adapter + mock/manual fallback, and make live provider evidence optional until credentials are confirmed. [RESOLVED]

3. **RESOLVED: What exact legal copy versions are launch canonical for `ko` and `en`?** [ASSUMED]
   - What we know: Current legal markdown is Korean, and Thai/Chinese legal fallback must be English. [VERIFIED: apps/web/content/legal/terms-of-service.md; VERIFIED: apps/web/content/legal/privacy-policy.md; VERIFIED: apps/web/content/legal/marketing-consent.md; VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md]
   - Resolution: Plan 23-05 Task 3 creates manual English legal canonical fallback markdown files and tests that legal canonical languages are exactly `ko,en`; Plan 23-09 Task 3 wires Thai/Chinese fallback labels to the English canonical content. [RESOLVED: .planning/phases/23-launch-foundation/23-05-PLAN.md; .planning/phases/23-launch-foundation/23-09-PLAN.md]
   - Recommendation carried into plan: Legal copy creation/lock is a first-class task before public fallback UI. [RESOLVED]

4. **RESOLVED: How should Phase 22 accepted risks be carried into Phase 23 evidence?** [VERIFIED: .planning/STATE.md]
   - What we know: Accepted risk is not PASS evidence. [VERIFIED: .planning/STATE.md]
   - Resolution: Plan 23-03 Task 3 creates the strict canary rollback runbook and explicitly preserves Phase 22 `ACCEPTED_RISK` caveats as not-PASS evidence. Plan 23-06 covers email/SMS local implementation tests; production provider evidence remains a later canary/UAT evidence gate rather than fabricated PASS. [RESOLVED: .planning/phases/23-launch-foundation/23-03-PLAN.md; .planning/phases/23-launch-foundation/23-06-PLAN.md]
   - Recommendation carried into plan: Keep evidence classified as PASS/BLOCKER/ACCEPTED_RISK explicitly. [RESOLVED]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | pnpm/Turbo/Next/Nest local development | yes | `v24.13.0` | Project engine permits `>=22.0.0`, but stack docs prefer Node 22 LTS for production. [VERIFIED: node --version; VERIFIED: package.json; VERIFIED: AGENTS.md] |
| pnpm | Monorepo install/test/build | yes | `10.28.1` | none needed. [VERIFIED: pnpm --version; VERIFIED: package.json] |
| npm/npx | npm registry/version checks and Context7 CLI fallback | yes | `11.6.2` | none needed. [VERIFIED: npm --version; VERIFIED: npx --version] |
| gcloud | Cloud Run canary/runbook verification | yes | `564.0.0` | GCP console/operator screenshots if CLI auth is unavailable. [VERIFIED: gcloud --version; ASSUMED] |
| Docker | Cloud Run image build parity | yes | `29.1.3` | GitHub Actions build if local Docker is unavailable. [VERIFIED: docker --version; ASSUMED] |
| psql | Manual DB inspection | no global CLI detected | n/a | Drizzle migrations/tests via `DATABASE_URL`; production row counts require operator DB access. [VERIFIED: command -v psql; VERIFIED: apps/api/drizzle.config.ts] |
| redis-cli | Manual Valkey inspection | no global CLI detected | n/a | Existing tests use ioredis/testcontainers; production evidence requires app smoke/operator access. [VERIFIED: command -v redis-cli; VERIFIED: apps/api/src/modules/sms/sms.service.ts] |
| DeepL credentials | Live translation draft generation | unknown | n/a | Mock/manual draft generation until `DEEPL_AUTH_KEY` is provided. [VERIFIED: .env.example; ASSUMED] |

**Missing dependencies with no fallback:**
- None for local research/planning. [VERIFIED: tool audit]

**Missing dependencies with fallback:**
- `psql`, `redis-cli`, and DeepL credentials have viable fallbacks for planning and local implementation, but production evidence may still require operator access. [VERIFIED: tool audit; ASSUMED]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest `^3.2.0` for API/web unit tests; Playwright `^1.59.1` for web E2E. [VERIFIED: apps/api/package.json; VERIFIED: apps/web/package.json] |
| Config file | `apps/api/vitest.config.ts`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`. [VERIFIED: rg --files] |
| Quick run command | `pnpm --filter @grabit/shared typecheck && pnpm --filter @grabit/api test -- auth.service.spec.ts booking.service.spec.ts reservation.service.spec.ts && pnpm --filter @grabit/web test -- phone-verification.test.tsx footer.test.tsx` [VERIFIED: package scripts; VERIFIED: existing test files] |
| Full suite command | `pnpm test` plus targeted `pnpm --filter @grabit/web test:e2e` when web flows change. [VERIFIED: package.json; VERIFIED: apps/web/package.json] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FLAG-01 | Expand-only migrations preserve existing users/reservations/sessions and Korean URLs. [VERIFIED: .planning/REQUIREMENTS.md] | migration/unit/smoke | `DOTENV_CONFIG_PATH=../../.env pnpm --filter @grabit/api exec drizzle-kit generate --name=phase23_launch_foundation --custom` plus migration review; URL tests via web Vitest. [VERIFIED: apps/api/drizzle.config.ts] | partial; Wave 0 migration tests needed. |
| FLAG-02 | `BOOKING_ENABLED=false` blocks lock, prepare, confirm. [VERIFIED: .planning/REQUIREMENTS.md] | unit/e2e | `pnpm --filter @grabit/api test -- booking.service.spec.ts reservation.service.spec.ts` [VERIFIED: existing test files] | yes, extend existing files. |
| I18N-01 | Locale routes preserve `/` for `ko` and prefix foreign locales. [VERIFIED: .planning/REQUIREMENTS.md] | unit/e2e | `pnpm --filter @grabit/web test -- i18n-routing.test.ts` [ASSUMED] | no; Wave 0. |
| I18N-02 | PhoneInput/auth/OTP/email/time/currency/hreflang/sitemap localize. [VERIFIED: .planning/REQUIREMENTS.md] | unit/e2e | `pnpm --filter @grabit/web test -- phone-input-i18n.test.tsx sitemap.test.ts` [ASSUMED] | no; Wave 0. |
| TRANS-01 | Translation source -> draft -> review -> publish and label. [VERIFIED: .planning/REQUIREMENTS.md] | API unit + admin UI unit | `pnpm --filter @grabit/api test -- translation.service.spec.ts && pnpm --filter @grabit/web test -- translation-review.test.tsx` [ASSUMED] | no; Wave 0. |
| TRANS-02 | Legal copy cannot enter translation queue. [VERIFIED: .planning/REQUIREMENTS.md] | API unit + content test | `pnpm --filter @grabit/api test -- translation.service.spec.ts && pnpm --filter @grabit/web test -- legal-content.test.ts` [VERIFIED: apps/web/content/legal/__tests__/legal-content.test.ts] | partial; API file needed. |
| AUTH-01 | Existing providers/email login stay; LINE absent; email verification 30m/resend. [VERIFIED: .planning/REQUIREMENTS.md; VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md] | API/web unit + E2E | `pnpm --filter @grabit/api test -- auth.service.spec.ts auth.controller.spec.ts && pnpm --filter @grabit/web test -- auth-email-verification.test.tsx` [VERIFIED: existing API test files] | partial; web/API email verification tests needed. |
| AUTH-02 | Three active refresh-token families per user. [VERIFIED: .planning/REQUIREMENTS.md] | API unit | `pnpm --filter @grabit/api test -- auth.service.spec.ts` [VERIFIED: apps/api/src/modules/auth/auth.service.spec.ts] | yes, extend existing file. |
| COMP-01 | Itemized required/optional consent gates and under-14 block. [VERIFIED: .planning/REQUIREMENTS.md] | API/web unit | `pnpm --filter @grabit/api test -- consent.service.spec.ts && pnpm --filter @grabit/web test -- signup-consent.test.tsx` [ASSUMED] | no; Wave 0. |
| COMP-02 | Operator query by item/version/language/timestamp/IP/user. [VERIFIED: .planning/REQUIREMENTS.md] | API/admin UI unit | `pnpm --filter @grabit/api test -- consent-audit.controller.spec.ts && pnpm --filter @grabit/web test -- consent-audit-table.test.tsx` [ASSUMED] | no; Wave 0. |

### Sampling Rate

- **Per task commit:** Run the targeted tests for touched capability plus `pnpm --filter @grabit/shared typecheck` if shared exports changed. [VERIFIED: package scripts; ASSUMED]
- **Per wave merge:** Run API/web unit suites for changed apps and `pnpm --filter @grabit/api typecheck && pnpm --filter @grabit/web typecheck`. [VERIFIED: package scripts]
- **Phase gate:** Run `pnpm test`, targeted Playwright locale/auth/booking-disabled E2E, and migration review before `$gsd-verify-work`. [VERIFIED: package.json; VERIFIED: apps/web/package.json]

### Wave 0 Gaps

- [ ] `packages/shared/src/constants/locales.ts` test coverage for locale list/prefixes. [ASSUMED]
- [ ] `packages/shared/src/flags.ts` test coverage for boolean parsing. [ASSUMED]
- [ ] `apps/web/i18n/routing.test.ts` for `ko` root and foreign prefixes. [ASSUMED]
- [ ] `apps/api/src/modules/feature-flags/feature-flags.service.spec.ts` for runtime env parsing. [ASSUMED]
- [ ] `apps/api/src/modules/translation/translation.service.spec.ts` for legal exclusion and stale/publish workflow. [ASSUMED]
- [ ] `apps/api/src/modules/consent/consent.service.spec.ts` and `consent-audit.controller.spec.ts`. [ASSUMED]
- [ ] `apps/web/components/admin/__tests__/translation-review.test.tsx` and `consent-audit-table.test.tsx`. [ASSUMED]

## Security Domain

Security enforcement is enabled because `.planning/config.json` does not explicitly set `security_enforcement: false`. [VERIFIED: .planning/config.json]

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| Authentication (template V2; ASVS 5 uses V6 Authentication) | yes | Existing NestJS auth, `argon2id`, `@nestjs/jwt`, opaque email verification token hashes, throttled resend. [VERIFIED: apps/api/src/modules/auth/auth.service.ts; CITED: https://github.com/OWASP/ASVS] |
| Session Management (template V3; ASVS 5 uses V7 Session Management) | yes | httpOnly refresh cookie, family rotation, family-wide reuse revoke, three-family cap. [VERIFIED: apps/api/src/modules/auth/auth.controller.ts; VERIFIED: apps/api/src/modules/auth/auth.service.ts; VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md] |
| Access Control (template V4; ASVS 5 uses multiple access/control chapters) | yes | Admin/internal consent audit query must reuse existing auth/role guard patterns and mask PII by default. [VERIFIED: apps/api/src/common/guards/roles.guard.spec.ts; VERIFIED: .planning/phases/23-launch-foundation/23-UI-SPEC.md] |
| Input Validation (template V5; ASVS 5 separates validation/business logic) | yes | Zod DTOs, libphonenumber strict parsing, server-side booking flag enforcement. [VERIFIED: packages/shared/src/schemas/*.ts; VERIFIED: apps/api/src/modules/sms/sms.service.ts; CITED: https://github.com/catamphetamine/libphonenumber-js/blob/master/README.md] |
| Cryptography (template V6; ASVS 5 uses cryptography/secrets chapters) | yes | Node CSPRNG for tokens/OTP, hash refresh/email verification tokens, do not store raw OTP/token/reset links in artifacts. [VERIFIED: apps/api/src/modules/auth/auth.service.ts; VERIFIED: apps/api/src/modules/sms/sms.service.ts; VERIFIED: .planning/phases/22-preflight-closure/22-HUMAN-UAT.md] |

### Known Threat Patterns for Phase 23 Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Direct API booking while UI is disabled | Elevation of privilege / Tampering | Backend flag gate on lock/prepare/confirm with tests. [VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md] |
| Replay of old email verification link after resend | Spoofing | Latest-token-wins DB token hash and consumed/expired state. [VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md; ASSUMED] |
| Refresh token reuse/theft | Spoofing | Existing family-wide revoke on reused revoked token; do not revoke all user sessions by default. [VERIFIED: apps/api/src/modules/auth/auth.service.ts; VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md] |
| Consent evidence tampering | Repudiation | Immutable append-only audit rows with user/IP/timestamp/item/version/language. [VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md] |
| Legal copy machine translation | Compliance / Repudiation | Schema-level legal content type and service guard excluding legal content from translation jobs. [VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md] |
| PII leakage in audit/admin evidence | Information disclosure | Mask email/phone/IP by default in UI and redact artifacts. [VERIFIED: .planning/phases/23-launch-foundation/23-UI-SPEC.md; VERIFIED: .planning/phases/22-preflight-closure/22-HUMAN-UAT.md] |

## Sources

### Primary (HIGH confidence)

- `.planning/phases/23-launch-foundation/23-CONTEXT.md` - locked Phase 23 decisions D-01 through D-20, LINE exclusion, deferred scope. [VERIFIED: file read]
- `.planning/phases/23-launch-foundation/23-UI-SPEC.md` - UI boundary, copy, components, accessibility, LINE exclusion. [VERIFIED: file read]
- `.planning/REQUIREMENTS.md` - Phase requirement IDs and stale LINE mention in AUTH-01. [VERIFIED: file read]
- `.planning/ROADMAP.md` - Phase 23 goals/success criteria and stale LINE mention. [VERIFIED: file read]
- `.planning/STATE.md` - Phase 22 accepted-risk carry-forward policy. [VERIFIED: file read]
- `docs/v2.0-fanmeet-milestone-spec.md` - source milestone constraints and stale LINE/DeepL/BOOKING_ENABLED details. [VERIFIED: file read]
- `apps/api/src/modules/auth/auth.service.ts`, `auth.controller.ts`, `refresh-tokens.ts` - existing auth/session implementation. [VERIFIED: file read]
- `apps/api/src/modules/booking/booking.service.ts`, `reservation.service.ts`, `reservation.controller.ts` - booking/payment creation gates. [VERIFIED: file read]
- `apps/api/src/modules/sms/sms.service.ts`, `apps/web/components/ui/phone-input.tsx` - SMS/phone validation and UI baseline. [VERIFIED: file read]
- Context7 `/amannn/next-intl` - `defineRouting`, `localePrefix: 'as-needed'`, formatting config. [VERIFIED: Context7 CLI]
- Context7 `/catamphetamine/react-phone-number-input` and `/catamphetamine/libphonenumber-js` - labels and validation APIs. [VERIFIED: Context7 CLI]
- Context7 `/drizzle-team/drizzle-orm-docs` - migration generation workflow. [VERIFIED: Context7 CLI]
- Context7 `/deeplcom/deepl-node` - text translation client APIs. [VERIFIED: Context7 CLI]
- Next.js official docs for env var inlining and sitemap alternates. [CITED: https://nextjs.org/docs/pages/guides/environment-variables; CITED: https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap]
- OWASP ASVS official GitHub/developer guide. [CITED: https://github.com/OWASP/ASVS; CITED: https://devguide.owasp.org/en/11-security-gap-analysis/01-guides/02-asvs/]

### Secondary (MEDIUM confidence)

- 개인정보 포털/PIPC search result for Korean cross-border transfer notice and consent disclosure expectations. [CITED: https://www.privacy.go.kr/front/contents/cntntsView.do?contsNo=367]
- DeepL supported languages docs for `KO`, `TH`, `ZH-HANS`, `ZH-HANT`. [CITED: https://developers.deepl.com/docs/resources/supported-languages]

### Tertiary (LOW confidence)

- Legal sufficiency of PDPA/PIPL/PIPA copy without counsel is not verified; user accepted no external legal review in milestone spec. [VERIFIED: docs/v2.0-fanmeet-milestone-spec.md; ASSUMED]
- Production database row counts and live Cloud Run env values were not inspected. [ASSUMED]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - package versions, existing package.json, Context7, and official docs were checked. [VERIFIED: npm view commands; VERIFIED: package files; VERIFIED: Context7 CLI]
- Architecture: HIGH - tier boundaries follow existing `apps/web`, `apps/api`, `packages/shared`, and Phase 23 decisions. [VERIFIED: codebase rg; VERIFIED: .planning/phases/23-launch-foundation/23-CONTEXT.md]
- Pitfalls: HIGH for LINE/booking/env/session/consent pitfalls; MEDIUM for legal sufficiency. [VERIFIED: .planning/ROADMAP.md; VERIFIED: .planning/REQUIREMENTS.md; CITED: https://nextjs.org/docs/pages/guides/environment-variables; ASSUMED]

**Research date:** 2026-05-06 KST [VERIFIED: system current_date]
**Valid until:** 2026-06-05 for library/package guidance; legal/compliance source assumptions should be rechecked within 7 days of launch copy lock. [ASSUMED]
