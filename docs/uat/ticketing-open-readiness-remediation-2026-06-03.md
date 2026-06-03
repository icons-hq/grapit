# Ticketing Open Readiness Remediation Gates - 2026-06-03

Scope: Task 4 documentation-only evidence map for branch `ps/ticketing-open-readiness-remediation`.

This note does not claim final public ticketing open readiness. The branch reduces code-remediable blockers found during the 2026-05-29 local UAT, but public opening remains gated by live/provider/ops evidence that is outside this branch.

## Research Summary

- The original readiness UAT note, `docs/uat/ticketing-open-readiness-uat-2026-05-29.md`, is not tracked in this worktree. It exists as an untracked file in the main checkout, so this tracked note summarizes blockers instead of copying that document.
- `git ls-files docs/uat` in this worktree lists only `docs/uat/seat-level-ticket-items-uat.md` before this Task 4 note.
- Original UAT blockers summarized here: `/support` and `/en/support` were 404, public support content was not launch-ready, sale-facing copy could appear while booking was gated, local QR links fell back to the production origin, local Valkey behavior used the in-memory fallback, browser phone fixtures produced E.164 warnings, and real payment/SMS/load/DR/ops gates lacked approved evidence.

## Status Terms

- `CODE-REMEDIATED`: the branch includes code, config, or test changes that address the local code-level blocker. Re-run the listed commands for current local evidence.
- `EVIDENCE-ONLY / BLOCKED`: no local code change can close this gate. It requires an approved live/provider/ops runbook and sanitized evidence.

## Code-Remediated Gates

| UAT blocker | Branch commit or changed surface | Verification command | Remaining risk | Gate status |
| --- | --- | --- | --- | --- |
| Public support page/API, footer, sitemap, i18n smoke, and pagination labels were missing or incomplete. | `6dee0f5e feat: add public support readiness surface`; surfaces: `apps/api/src/modules/admin/public-support-content.controller.ts`, `apps/api/src/modules/admin/admin-support-content.service.ts`, `apps/web/app/support/page.tsx`, `apps/web/hooks/use-support-content.ts`, `apps/web/components/layout/footer.tsx`, `apps/web/components/performance/pagination-nav.tsx`, `apps/web/app/sitemap.ts`, `apps/web/e2e/i18n-smoke.spec.ts`, `apps/web/messages/*`, `packages/shared/src/i18n/*`. | `pnpm --filter @grabit/api exec vitest run src/modules/admin/admin-support-content.service.spec.ts`; `pnpm --filter @grabit/web exec vitest run app/support/__tests__/support-page.test.tsx components/layout/__tests__/footer.test.tsx components/performance/__tests__/pagination-nav.test.tsx app/__tests__/sitemap.test.ts`; `pnpm --filter @grabit/web exec playwright test e2e/i18n-smoke.spec.ts`; `pnpm --filter @grabit/shared exec vitest run src/i18n/launch-copy-keys.test.ts`. | Live support FAQ/notice records and final launch copy still need approved content review and deployed smoke evidence. | CODE-REMEDIATED |
| Support controller needed hardening around public locale handling and public-only response shape. | `22d38344 test: harden support readiness surface`; surfaces: `apps/api/src/modules/admin/public-support-content.controller.ts`, `apps/api/src/modules/admin/public-support-content.controller.spec.ts`. | `pnpm --filter @grabit/api exec vitest run src/modules/admin/public-support-content.controller.spec.ts`. | Live route behavior still depends on deployed API config and available published content rows. | CODE-REMEDIATED |
| Public performance reads could include non-published rows, and public UI could show sale badges while the booking gate was closed. | `0738957a fix: hide sale badges while booking gate is closed`; surfaces: `apps/api/src/modules/performance/performance.service.ts`, `apps/api/src/modules/search/search.service.ts`, `apps/web/components/performance/status-badge.tsx`, `apps/web/components/performance/performance-card.tsx`, `apps/web/app/performance/[id]/page.tsx`. | `pnpm --filter @grabit/api exec vitest run src/modules/performance/performance.service.spec.ts src/modules/search/search.service.spec.ts`; `pnpm --filter @grabit/web exec vitest run components/performance/__tests__/status-badge.test.tsx app/performance/[id]/__tests__/performance-detail-formatting.test.tsx app/__tests__/home-i18n.test.tsx`. | Deployed runtime flags, CDN/cache behavior, and production data must still be smoke-tested before public opening. | CODE-REMEDIATED |
| Local browser QR URLs pointed to the production origin, and QR E2E helpers needed compatibility with configured rehearsal origins. | `c3cd3468 chore: support local readiness rehearsal config`; `93e75b6e test: harden QR readiness rehearsal config`; surfaces: `apps/web/components/field/qr-ticket-image.tsx`, `apps/web/e2e/helpers/qr-origin.ts`, QR E2E specs, `.env.example`. | `pnpm --filter @grabit/web exec vitest run components/field/__tests__/qr-ticket-image.test.tsx`; `pnpm --filter @grabit/web exec playwright test e2e/booking-complete-qr.spec.ts e2e/phase26-qr-visibility.spec.ts e2e/phase27-qr-check-in.spec.ts`. | Real phone-camera field rehearsal still needs an approved reachable origin and device evidence. | CODE-REMEDIATED |
| Local queue/seat-lock rehearsal lacked an easy Valkey option and defaulted to the in-memory fallback. | `c3cd3468 chore: support local readiness rehearsal config`; surfaces: `docker-compose.yml`, `.env.example`. | `docker compose config >/tmp/grabit-compose-config.txt`. | Local standalone Valkey is not production/cluster evidence. Production or cluster-parity rehearsal remains blocked below. | CODE-REMEDIATED |
| Seeded/browser mock phone fixtures produced E.164 warnings in controlled phone input state. | `c3cd3468 chore: support local readiness rehearsal config`; surfaces: `apps/api/src/database/seed.mjs`, `apps/web/e2e/helpers/mock-admin.ts`, affected browser mock fixtures. | `pnpm --filter @grabit/api exec node --check src/database/seed.mjs`; `rg -n "010-" apps/web/e2e apps/api/src/database/seed.mjs`. | Real SMS OTP remains separate provider evidence and is not proven by fixture cleanup. | CODE-REMEDIATED |

## Evidence-Only / Blocked Gates

These gates must stay blocked until an approved live/provider/ops runbook produces sanitized evidence. This branch must not be treated as final public-open approval.

| Gate | Required evidence | Branch evidence | Gate status |
| --- | --- | --- | --- |
| Toss real gateway happy path and live-key smoke. | Approved payment runbook showing a real happy path through request, provider approval, confirm, webhook/finalization, and reconciliation-safe non-sensitive identifiers. | None. Code paths have local/unit/E2E coverage only. | BLOCKED: requires approved live/provider/ops runbook |
| Real SMS OTP happy path with controlled provider-mode number. | Approved controlled-number send and verify evidence in provider mode, with redacted logs and no customer impact. | None. Fixture cleanup only removes local warning noise. | BLOCKED: requires approved live/provider/ops runbook |
| Production/cluster Valkey rehearsal and health evidence. | Deployed or cluster-parity evidence for queue, seat locks, ranking/cache, throttling, and Socket.IO pub/sub health. | Local compose option only. | BLOCKED: requires approved live/provider/ops runbook |
| Load baseline and stress evidence for 10K/20K traffic. | Approved load report covering arrival profile, API/web error rates, queue behavior, latency, resource saturation, and rollback criteria. | None. | BLOCKED: requires approved live/provider/ops runbook |
| Cloud Run rollback drill. | Approved rollback drill evidence with revision selection, traffic shift, smoke result, and restore criteria. | None. | BLOCKED: requires approved live/provider/ops runbook |
| Cloud SQL PITR drill. | Approved point-in-time restore drill evidence with restore target, validation query class, and recovery timing. | None. | BLOCKED: requires approved live/provider/ops runbook |
| Valkey reconnect/failure drill. | Approved reconnect or failover drill evidence showing app recovery behavior and queue/lock consistency checks. | None. | BLOCKED: requires approved live/provider/ops runbook |
| WAF readiness. | Approved WAF rule/config review and launch-mode smoke evidence. | None. | BLOCKED: requires approved live/provider/ops runbook |
| On-call and first-24h watch. | Named owner schedule, alert routing, dashboards, escalation path, and first-24h monitoring checklist. | None. | BLOCKED: requires approved live/provider/ops runbook |
| Cleanup isolation drills. | Approved rehearsal proving cleanup jobs or manual cleanup actions do not remove unrelated active reservations, locks, tickets, or support records. | None. | BLOCKED: requires approved live/provider/ops runbook |

## Public Open Conclusion

Current branch status: code-remediable blockers are reduced and documented, but final public ticketing open readiness is not approved.

Public opening remains gated by the evidence-only items above, especially real payment, real SMS OTP, production/cluster Valkey behavior, load/stress capacity, rollback/restore drills, WAF/on-call readiness, first-24h watch, and cleanup isolation.
