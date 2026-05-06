# Phase 23: Launch Foundation - Context

**Gathered:** 2026-05-06T10:46:34+09:00
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 23 builds the launch foundation that later fanmeet phases depend on: production compatibility, shared feature flags, five-locale routing and formatting, translation workflow, legal copy lock, email verification, refresh-token device policy, and multinational consent/audit foundations.

This phase must preserve existing production users, reservations, sessions, and Korean root URLs. It does not add booking/payment core, queue/WAF/load-test execution, admin operations console, QR/event-day operations, WeChat login, PASS identity verification, a separate landing page, or a mobile app.

**Important scope correction from discussion:** The user removed LINE login from the plan. Current `.planning/ROADMAP.md` and `.planning/REQUIREMENTS.md` still mention LINE in Phase 23/AUTH-01, so planning must resolve that documentation mismatch before execution. Do not implement LINE login unless the user explicitly re-adds it.

</domain>

<decisions>
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

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v2.0 Scope and Phase Contract
- `.planning/ROADMAP.md` - Phase 23 goal, requirements, success criteria, and current LINE mention that now conflicts with user instruction.
- `.planning/REQUIREMENTS.md` - `FLAG-01`, `FLAG-02`, `I18N-01`, `I18N-02`, `TRANS-01`, `TRANS-02`, `AUTH-01`, `AUTH-02`, `COMP-01`, `COMP-02`.
- `.planning/PROJECT.md` - Current milestone constraints, existing prod compatibility constraints, v2.0 cutover gates, and excluded capabilities.
- `.planning/STATE.md` - Current state after Phase 22 and deferred evidence caveats.
- `docs/v2.0-fanmeet-milestone-spec.md` - Source milestone spec for SP-0/SP-1/SP-2, i18n URL policy, translation/legal decisions, compliance decisions, and feature flag approach.
- `.planning/phases/22-preflight-closure/22-CONTEXT.md` - Carry-forward evidence policy: `ACCEPTED_RISK` is not PASS; missing direct evidence must stay visible.

### Existing Auth, SMS, Legal, and Booking Code
- `apps/api/src/modules/auth/auth.service.ts` - Current refresh token rotation, social registration, password reset, and token family behavior.
- `apps/api/src/database/schema/refresh-tokens.ts` - Existing refresh token family schema and indexes.
- `apps/api/src/modules/auth/auth.controller.ts` - Current auth endpoints, social callback pattern, refresh cookie behavior, and throttled reset endpoints.
- `apps/api/src/modules/auth/strategies/kakao.strategy.ts` - Existing social auth strategy pattern.
- `apps/api/src/modules/auth/strategies/naver.strategy.ts` - Existing social auth strategy pattern.
- `apps/api/src/modules/auth/strategies/google.strategy.ts` - Existing social auth strategy pattern.
- `apps/api/src/modules/sms/sms.service.ts` - Current SMS OTP, Valkey hash-tag, verified-flag, logging, and provider behavior.
- `apps/web/components/ui/phone-input.tsx` - Current Korean-only PhoneInput labels and country selector.
- `apps/web/components/auth/signup-step2.tsx` - Current terms/privacy/marketing consent UI and markdown dialog contract.
- `apps/web/content/legal/terms-of-service.md` - Existing Korean legal markdown source.
- `apps/web/content/legal/privacy-policy.md` - Existing Korean legal markdown source.
- `apps/web/content/legal/marketing-consent.md` - Existing Korean legal markdown source.
- `apps/web/components/layout/footer.tsx` - Current footer legal/support surface.
- `apps/api/src/modules/booking/booking.service.ts` - Current seat lock and ownership paths that must respect `BOOKING_ENABLED=false`.
- `apps/api/src/modules/payment/payment.service.ts` - Current payment read surface; downstream planner must locate payment creation/confirm paths before flag gating.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/api/src/modules/auth/auth.service.ts`: already creates refresh token families and revokes a family on revoked-token reuse. Phase 23 can extend this into the three-device cap.
- `apps/api/src/database/schema/refresh-tokens.ts`: has `family`, `userId`, `expiresAt`, and `revokedAt`; likely needs expand/backfill-safe additions or queries rather than a destructive redesign.
- `apps/api/src/modules/auth/auth.controller.ts`: has `register`, `login`, `refresh`, `logout`, password reset, and social callback endpoints; email verification should follow existing throttling/cookie/security patterns.
- `apps/api/src/modules/sms/sms.service.ts`: already handles E.164 SMS OTP and Valkey-safe keys; Phase 23 should preserve Phase 14/22 evidence caveats while adding launch-country validation.
- `apps/web/components/ui/phone-input.tsx`: current labels are Korean-only via `react-phone-number-input/locale/ko.json`; this is the main UI reuse point for localized labels.
- `apps/web/components/auth/signup-step2.tsx` and `apps/web/content/legal/*.md`: current consent UI is simple boolean terms/privacy/marketing; Phase 23 will need itemized versioned consent rather than only extending booleans.
- `apps/api/src/modules/booking/booking.service.ts`: seat lock methods are the core backend path for `BOOKING_ENABLED=false` hard gating.

### Established Patterns
- Keep `ACCEPTED_RISK` separate from PASS; do not convert Phase 22 caveats into evidence without direct proof.
- Preserve Korean root URLs and existing production sessions/users/reservations through backward-compatible migrations.
- Prefer shared code contracts over duplicated app-local env parsing when behavior must match web and API.
- Use redacted evidence for auth/SMS/email/legal operations; do not store raw OTPs, tokens, reset links, API keys, or PII in planning docs.
- Social auth currently uses a shared `social_accounts` and `needs_registration` pattern, but LINE is now out of Phase 23 scope.

### Integration Points
- Shared feature flags need to connect to web disabled copy, booking API seat locks, reservation prepare, payment confirm/request, tests, and canary smoke evidence.
- next-intl or equivalent i18n setup must integrate with `apps/web/app/layout.tsx`, route structure, sitemap/hreflang generation, locale switch UI, and user profile persistence.
- Translation workflow likely needs admin/content models, background generation/review state, stale detection, and public label rendering.
- Legal lock likely needs a separate content schema from general translated event content.
- Consent audit needs API write points during signup/booking and operator/admin/internal read query paths.

</code_context>

<specifics>
## Specific Ideas

- The user explicitly removed LINE login from Phase 23. Treat this as stronger than older roadmap/spec text until the planning docs are updated.
- `BOOKING_ENABLED=false` must be proven at backend creation paths, not only by disabled UI buttons.
- Locale detection should help overseas users without changing canonical Korean URLs or SEO behavior.
- Legal-sensitive copy for Thai/Chinese users should prefer English canonical fallback over machine-translated legal text.

</specifics>

<deferred>
## Deferred Ideas

- LINE login is removed from this phase unless the user re-adds it and updates roadmap/requirements.
- Legal guardian consent flow for under-14 users is deferred; launch behavior is block under 14.
- Full all-country phone/SMS localization is deferred beyond the five launch-market-first approach.

</deferred>

---

*Phase: 23-Launch Foundation*
*Context gathered: 2026-05-06T10:46:34+09:00*
