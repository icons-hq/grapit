---
phase: 27
slug: event-operations-settlement
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-22
---

# Phase 27 - Validation Strategy

Per-phase validation contract for Phase 27 planning and execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | API: Vitest node; Web unit: Vitest/jsdom; E2E: Playwright Chromium. |
| **Config file** | `apps/api/vitest.config.ts`, `apps/api/vitest.integration.config.ts`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`. |
| **Quick run command** | `pnpm --filter @grabit/api test -- src/modules/ticket/qr-ticket.service.spec.ts`; replace with Phase 27 targeted specs as Wave 0 creates them. |
| **Full suite command** | `pnpm test` plus `pnpm --filter @grabit/web test:e2e` for scanner, offline, monitor, and settlement browser flows. |
| **Estimated runtime** | Targeted API/Web tests: minutes; full suite and Playwright: repo-dependent; phone-camera/offline rehearsal requires human device evidence. |

---

## Sampling Rate

- **After every task commit:** Run the touched package's targeted Vitest or Playwright command.
- **After every plan wave:** Run relevant API module tests, web component tests, and at least one Phase 27 happy-path scanner Playwright flow once it exists.
- **Before `$gsd-verify-work`:** `pnpm test`, targeted Phase 27 Playwright suites, export artifact checks, and human UAT evidence for real phone-camera QR open plus offline stale/recovered rehearsal must be recorded.
- **Max feedback latency:** Code-only tasks should get automated feedback in minutes; phone-camera/offline human evidence must record exact actor, device, event/showtime, and timestamp.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 27-W0-QR | TBD | 0 | QR-02 | T-27-QR-REPLAY / T-27-TOKEN-LEAK / T-27-AUTHZ | Buyer QR image encodes HTTPS check-in URL, raw token/JTI is not visible text, normal users are denied scanner actions, and server verification handles normal, duplicate, tampered, refunded/cancelled, expired, wrong-showtime, and already-used outcomes. | API unit/integration + Web unit + Playwright | `pnpm --filter @grabit/api test -- src/modules/field-operations/field-check-in.service.spec.ts`<br>`pnpm --filter @grabit/web test -- components/field/__tests__/qr-ticket-image.test.tsx components/field/__tests__/scanner-check-in.test.tsx`<br>`pnpm --filter @grabit/web test:e2e -- e2e/phase27-qr-check-in.spec.ts` | no - Wave 0 | pending |
| 27-W0-OFFLINE | TBD | 0 | QR-02, FIELD-01 | T-27-OFFLINE-TAMPER / T-27-OFFLINE-FALSE-PASS | Offline local attempts remain pending until server sync resolves them as synced or rejected; queue avoids raw PII and every synced attempt is server-reverified. | API unit + Web unit + Playwright | `pnpm --filter @grabit/api test -- src/modules/field-operations/offline-sync.service.spec.ts`<br>`pnpm --filter @grabit/web test -- components/field/__tests__/scanner-check-in.test.tsx`<br>`pnpm --filter @grabit/web test:e2e -- e2e/phase27-offline-sync.spec.ts` | no - Wave 0 | pending |
| 27-W0-MONITOR | TBD | 0 | FIELD-01 | T-27-ALERT-BLINDSPOT / T-27-LOG-LEAK | Field monitor shows KPI-first entered/not-entered/rate/duplicate/rejected/offline counts and abnormal alerts without exposing raw QR tokens or raw PII rows. | API unit + Web component + Playwright smoke | `pnpm --filter @grabit/api test -- src/modules/field-operations/field-monitor.service.spec.ts`<br>`pnpm --filter @grabit/web test -- components/field/__tests__/field-monitor.test.tsx` | no - Wave 0 | pending |
| 27-W0-PLAYBOOK | TBD | 0 | OPS-03 | T-27-OPS-GAP | Event-day playbook covers forced refund, weather/facility/cast issue, on-site refund, exchange, required console actions, external contact placeholders, and evidence capture fields. | Artifact validation + manual review | `test -f docs/runbooks/phase27-event-day-playbooks.md && rg "forced refund|weather|facility|cast|on-site refund|exchange" docs/runbooks/phase27-event-day-playbooks.md` | no - Wave 0 | pending |
| 27-W0-SETTLEMENT | TBD | 0 | POST-01 | T-27-CSV-INJECTION / T-27-EXPORT-LEAK / T-27-SCANNER-PRIVILEGE | Settlement dashboard and CSV exports include entry status, no-show, reservation/payment/refund summary, and accounting input data; exports use `safeCsvRows`, are audited, and are unavailable to scanner-only accounts. | API unit + Web component + export smoke | `pnpm --filter @grabit/api test -- src/modules/admin/settlement-export.service.spec.ts`<br>`pnpm --filter @grabit/web test -- components/admin/__tests__/settlement-dashboard.test.tsx` | no - Wave 0 | pending |
| 27-W0-RETRO | TBD | 0 | POST-02 | T-27-EVIDENCE-GAP | `27-RETROSPECTIVE.md` records incidents, non-incidents, improvements, carry-forward items, field scan/offline/settlement evidence, and v2.0 completion evidence. | Artifact validation | `test -f .planning/phases/27-event-operations-settlement/27-RETROSPECTIVE.md && rg "Incidents|Non-incidents|Improvements|Carry-forward|v2.0" .planning/phases/27-event-operations-settlement/27-RETROSPECTIVE.md` | no - execution artifact | pending |

*Status values: `pending`, `green`, `red`, `manual-blocked`, `accepted-risk`.*

---

## Wave 0 Requirements

- [ ] `packages/shared/src/schemas/field-operations.schema.ts` and matching tests for verify, consume, offline sync, monitor, and export contracts.
- [ ] `apps/api/src/modules/field-operations/field-check-in.service.spec.ts` for normal, duplicate, tampered, refunded/cancelled, expired, wrong-showtime, and already-used outcomes.
- [ ] `apps/api/src/modules/field-operations/offline-sync.service.spec.ts` for stale/recovered connectivity conflict resolution.
- [ ] `apps/api/src/modules/field-operations/field-monitor.service.spec.ts` for KPI and abnormal-alert aggregation.
- [ ] `apps/api/src/modules/admin/settlement-export.service.spec.ts` for CSV datasets, audit, capability denial, and formula escaping.
- [ ] `apps/web/components/field/__tests__/qr-ticket-image.test.tsx` for a real QR element and no visible raw token/JTI.
- [ ] `apps/web/components/field/__tests__/scanner-check-in.test.tsx` for verify, consume, duplicate, rejection, and offline pending/sync state UI.
- [ ] `apps/web/components/field/__tests__/field-monitor.test.tsx` for KPI-first layout, alerts, and offline counts.
- [ ] `apps/web/components/admin/__tests__/settlement-dashboard.test.tsx` for dashboard tabs, filters, export actions, and scanner-only denial.
- [ ] `apps/web/e2e/phase27-qr-check-in.spec.ts` for buyer QR -> protected route -> scanner-only entry -> duplicate rejection.
- [ ] `apps/web/e2e/phase27-offline-sync.spec.ts` for pending queue, reconnect sync, and rejected conflict.
- [ ] `docs/runbooks/phase27-event-day-playbooks.md` or equivalent OPS-03 artifact.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real phone-camera QR open | QR-02 | Browser tests can inspect the QR URL, but a real phone camera proves the physical event-day scan path. | On a real phone, scan a buyer QR from payment complete or My Page, verify it opens the HTTPS Grabit check-in URL, logs in if needed, and returns to the intended ticket page. Record device, browser, account, event/showtime, and timestamp. |
| Scanner-only permission rehearsal | QR-02, FIELD-01 | Final confidence requires exercising a lower-privilege staff account outside the full admin shell. | With a scanner-only account, verify the check-in page/API works and full admin/sidebar, refund, reservation management, user management, content, security, settlement, and raw export routes are denied. |
| Venue-like offline stale/recovered connectivity | QR-02, FIELD-01 | Local browser network simulation is useful but does not prove field network behavior. | While authenticated as scanner staff, simulate or use unreliable connectivity, create a pending scan, restore connectivity, sync it, and capture pending/synced/rejected evidence. |
| External operational contacts | OPS-03 | Weather/facility/cast/refund/exchange contacts are business/operator-owned and may not live in repo. | Fill or explicitly mark placeholders in `docs/runbooks/phase27-event-day-playbooks.md` with owner/date before launch rehearsal. |
| Settlement operator review | POST-01 | Accounting input usefulness depends on operator acceptance, while formal external accounting integration is out of scope. | Export entry, no-show, reservation/payment/refund, and accounting input CSVs; confirm the dashboard totals match source reservations/payments/refunds and record reviewer/timestamp. |

---

## Security Validation Notes

| Threat Ref | Required Evidence |
|------------|-------------------|
| T-27-QR-REPLAY | Duplicate scan test proves second consume returns already-used with prior scan/check-in context where safe. |
| T-27-TOKEN-LEAK | Web tests and E2E assert raw token, raw JTI, raw JWT/HMAC payload, and full QR URL text are absent from visible UI and logs/errors are redacted. |
| T-27-AUTHZ | API and browser tests prove regular members are denied, scanner-only can verify/consume/sync only, and scanner-only cannot access settlement/refund/user/security/raw export surfaces. |
| T-27-OFFLINE-TAMPER | Offline sync tests prove the server re-verifies every pending attempt and rejects tampered, refunded/cancelled, duplicate, expired, and wrong-showtime cases. |
| T-27-CSV-INJECTION | Settlement export tests prove `safeCsvRows` or equivalent formula escaping is used for every CSV dataset. |
| T-27-EVIDENCE-GAP | Retrospective validation proves scan/offline/settlement evidence exists before v2.0 completion is claimed. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies.
- [ ] Sampling continuity: no 3 consecutive implementation tasks without automated or evidence-producing verification.
- [ ] Wave 0 covers all missing references above.
- [ ] No watch-mode flags in verification commands.
- [ ] Manual-only phone-camera/offline/operator checks have explicit owner, device/environment, timestamp, and result.
- [ ] `nyquist_compliant: true` set in frontmatter after the planner maps validation rows to concrete tasks and Wave 0 files exist.

**Approval:** pending
