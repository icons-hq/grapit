# Research Summary: v2.0 Fanmeet Launch

**Domain:** Global live-event ticketing launch on existing Grabit MVP  
**Researched:** 2026-05-04  
**Overall confidence:** HIGH for roadmap shape, MEDIUM for PG/payment-method availability until Toss review returns.

## Executive Summary

v2.0 should stay on the existing modular monolith and focus on launch-grade execution rather than platform reinvention. The main additions are `next-intl`, env-based feature flags, a translation review workflow, LINE OAuth, queue/load/DR/on-call gates, pgBouncer/Cloud SQL hardening, refund/QR jobs, and a much broader admin/field-operations console.

The most important planning constraint is temporal: M1 opens the event detail and signup surface on 2026-05-15 with booking disabled, while payment cutover at the end of May is blocked by load, DR, and on-call evidence. QR issuance belongs before payment cutover; QR verification and field operations can complete before the 2026-07-04 event.

## Stack Additions

- `next-intl` for 5-locale App Router support with Korean root URLs preserved.
- Shared feature flag helper for booking and language/provider flags.
- DeepL + LLM post-processing behind an admin review queue.
- LINE OAuth strategy added beside existing auth providers.
- pg-boss delayed jobs for refund holding and QR email workflows.
- k6, pgBouncer, Cloud Scheduler prewarm, Cloudflare WAF rules, and Sentry alert gates as explicit milestone artifacts.

## Feature Table Stakes

- Preflight closure of v1.1 operator, validation, and hardening caveats.
- 5-language public surface and localized transactional copy.
- Multinational consent and audit logging.
- Queue, WAF, prewarm, and load gates before payment.
- Four payment paths, refund state machine, cancelled-seat random holding, QR issuance.
- Admin event registration, content review, CS/Q&A/FAQ, audit, CSV, seat operations.
- QR scan console, offline fallback, duplicate/tamper detection, event-day playbooks, post-event exports.

## Watch Out For

- Do not implement booking-disabled as a visual-only state.
- Do not allow queue bypass at booking APIs.
- Do not contract DB schema before the event.
- Do not auto-translate legal notices.
- Do not cut over payment without k6, DR, and on-call PASS evidence.
- Do not assume every Toss payment method is live until merchant review confirms it.

## Roadmap Implication

Continue numbering from Phase 22. Use 22-24 for deferred launch-readiness gates, 25-36 for M1 advertising open, 37-40 for M2 cutover gates and live payment, 41-42 for event-day operations, and 43 for settlement/retrospective.
