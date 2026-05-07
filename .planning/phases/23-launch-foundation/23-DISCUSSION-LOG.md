# Phase 23: Launch Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-05-06T10:46:34+09:00
**Phase:** 23-Launch Foundation
**Areas discussed:** Prod compatibility + flags, Locale routing + formatting, Translation workflow + legal lock, Auth/session expansion, Consent/audit foundation

---

## Prod Compatibility + Flags

| Question | Options | Selected |
|---|---|---|
| `BOOKING_ENABLED=false` 차단 기준 | API-first hard gate; Module-local API checks; UI-first + smoke evidence; You decide | API-first hard gate |
| Canary deploy 실패 기준 | Strict blocker rollback; Core-only rollback; Manual operator call; You decide | Strict blocker rollback |
| Feature flag helper ownership | Shared package helper; API-owned helper + web mirror; Runtime env per app; You decide | Shared package helper |
| DB migration compatibility | Expand-only until event stabilization; Expand + safe backfill; Planner discretion; You decide | Expand + safe backfill |

**User's choice:** API hard gate, strict rollback, shared helper, expand plus safe backfill.
**Notes:** User entered `11` for canary; interpreted as `1` because it was outside option range and context clearly matched option 1.

---

## Locale Routing + Formatting

| Question | Options | Selected |
|---|---|---|
| Locale detection and switch UX | Suggest, never redirect; First-visit soft redirect; Manual only; You decide | Suggest, never redirect |
| Locale preference storage | Cookie + user profile; User profile only; Cookie only; You decide | Cookie + user profile |
| Time/currency display | Local-friendly + KST anchor; KST/KRW only; Fully localized primary; You decide | Local-friendly + KST anchor |
| PhoneInput country/language scope | Five launch markets first; All countries fully localized; Restrict to verified countries; You decide | Five launch markets first |

**User's choice:** Option 1 for all four questions.
**Notes:** Korean root URL preservation and no auto redirect remain hard constraints.

---

## Translation Workflow + Legal Lock

| Question | Options | Selected |
|---|---|---|
| General translation state model | Draft -> review -> publish; Auto-publish with label; Manual-only translation; You decide | Draft -> review -> publish |
| Automatic-translation label | All AI-assisted public content; Only low-risk descriptions; No visible label after review; You decide | All AI-assisted public content |
| Legal copy auto-translation block | Schema-level legal content type; Path/name blocklist; Manual reviewer warning only; You decide | Schema-level legal content type |
| Thai/Chinese legal-sensitive copy | English legal canonical fallback; Machine-translated with warning; Korean only fallback; You decide | English legal canonical fallback |

**User's choice:** Option 1 for all four questions.
**Notes:** Legal-sensitive copy is `ko`/`en` manual only for launch.

---

## Auth/Session Expansion

| Question | Options | Selected |
|---|---|---|
| LINE login approach | Same social-registration contract; LINE-only fast path; Separate LINE module; You decide | Remove LINE login |
| Email verification policy | 30-minute token + immediate resend; 30-minute token + cooldown resend; Reuse password-reset style; You decide | 30-minute token + immediate resend |
| Three-device policy device definition | Refresh token family as device slot; Browser fingerprinted device; Session count only; You decide | Refresh token family as device slot |
| Refresh token reuse handling | Family-wide revoke + user-visible re-login; All-user-session revoke; Current token only; You decide | Family-wide revoke + user-visible re-login |

**User's choice:** Remove LINE login from the plan; option 1 for the remaining three questions.
**Notes:** LINE removal conflicts with current `AUTH-01` and roadmap success criteria. Planning must resolve the mismatch before execution.

---

## Consent/Audit Foundation

| Question | Options | Selected |
|---|---|---|
| Consent item/version model | Itemized immutable versions; Snapshot per signup; Current terms agreement extension; You decide | Itemized immutable versions |
| Cross-border transfer gate | Required gate for signup/booking; Required only at booking; Optional with warning; You decide | Required gate for signup/booking |
| Under-14 restriction | Block under 14; Allow with guardian checkbox; Collect birthdate only; You decide | Block under 14 |
| Consent audit query level | Operator-queryable by item/version/language/user/time/IP; DB-only evidence; Append logs only; You decide | Operator-queryable by item/version/language/user/time/IP |

**User's choice:** Option 1 for all four questions.
**Notes:** Operator-queryable evidence is required in Phase 23, not deferred to a later admin phase.

---

## the agent's Discretion

None.

## Deferred Ideas

- LINE login removed from Phase 23 unless explicitly re-added.
- Legal guardian consent flow for under-14 users deferred.
- Full all-country PhoneInput/SMS localization deferred beyond launch-market-first scope.
