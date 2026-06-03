---
status: active_runbook
last_updated: 2026-06-03
scope: Remaining live/provider/ops evidence gates for ticketing public open
source: docs/uat/ticketing-open-readiness-remediation-2026-06-03.md
---

# Ticketing Open Evidence Gates Runbook

## Purpose

이 runbook은 `ticketing-open-readiness-remediation` branch가 코드로 닫지
못한 운영 evidence gate를 실제 작업 단위로 나누기 위한 문서다.

이 문서는 public ticketing open 승인이 아니다. 아래 gate가 모두
`EVIDENCE_ACCEPTED`이거나 명시적으로 `WAIVED`되기 전까지 public open
status는 `NO-GO`다.

## Status Terms

| Status | Meaning |
| --- | --- |
| `BLOCKED` | 승인된 실행 window, provider 준비, 권한, 또는 reviewer가 없어 아직 실행할 수 없다. |
| `READY_TO_RUN` | 사전 리서치, owner, 중단 기준, evidence 저장 위치가 정리되어 실행 가능하다. |
| `RUNNING` | 승인된 window에서 gate 작업이 진행 중이다. |
| `EVIDENCE_REVIEW` | 실행은 끝났고 sanitized evidence와 reviewer 확인이 남았다. |
| `EVIDENCE_ACCEPTED` | reviewer가 evidence를 승인했고 public-open ledger에 반영 가능하다. |
| `FAILED` | pass criteria를 만족하지 못했다. public open 전 재작업이 필요하다. |
| `WAIVED` | owner와 reviewer가 명시적으로 위험을 수용했다. waiver 사유와 만료일이 필요하다. |

## Operator Rules

1. Raw provider keys, payment keys, QR tokens, cookies, bearer tokens, OTP
   values, full IPs, e-mail addresses, phone numbers, and PII must never be
   pasted into docs, commits, screenshots, or evidence artifacts.
2. 결제, SMS, Cloud Run traffic shift, Cloud SQL restore, WAF rule change,
   cleanup 실행은 모두 외부 상태를 바꿀 수 있다. 명시 승인된 window 밖에서
   실행하지 않는다.
3. Existing Girl Rules buyer users, reservations, payments, tickets, seat state,
   and support records are not rehearsal or cleanup targets. Only approved admin
   smoke records created during this runbook may be cancelled, refunded,
   reopened, or otherwise cleaned up.
4. 각 gate는 실행 전에 `Research Packet`을 먼저 채운다. 오래된 문서보다 현재
   repo, deployed runtime, provider admin UI, logs, and dashboards를 우선한다.
5. Evidence는 재현 가능한 command, timestamp, environment, redacted artifact
   link, reviewer decision을 포함해야 한다.
6. 하나의 gate 실패가 booking, payment, QR, entry, support, or refund safety에
   영향을 주면 public open status는 즉시 `NO-GO`로 유지한다.

## Evidence Ledger

| Gate | Status | Owner | Evidence artifact | Reviewer | Decision date |
| --- | --- | --- | --- | --- | --- |
| Final booking enablement and cutover approval | `BLOCKED` | TBD | TBD | TBD | TBD |
| Toss sandbox gateway smoke | `BLOCKED` | TBD | TBD | TBD | TBD |
| Admin pre-open booking smoke across Production Payment Matrix | `BLOCKED` | TBD | `docs/uat/ticketing-open-admin-preopen-smoke-2026-06-03.md` | TBD | TBD |
| Real SMS OTP happy path with controlled provider-mode number | `BLOCKED` | TBD | TBD | TBD | TBD |
| Production/cluster Valkey rehearsal and health evidence | `BLOCKED` | TBD | TBD | TBD | TBD |
| Load baseline and stress evidence for 10K/20K traffic | `BLOCKED` | TBD | TBD | TBD | TBD |
| Cloud Run rollback drill | `BLOCKED` | TBD | TBD | TBD | TBD |
| Cloud SQL PITR drill | `BLOCKED` | TBD | TBD | TBD | TBD |
| Valkey reconnect/failure drill | `BLOCKED` | TBD | TBD | TBD | TBD |
| WAF readiness | `BLOCKED` | TBD | TBD | TBD | TBD |
| On-call and first-24h watch | `BLOCKED` | TBD | TBD | TBD | TBD |
| Cleanup isolation drills | `BLOCKED` | TBD | TBD | TBD | TBD |
| Support FAQ/notice content approval and deployed smoke | `BLOCKED` | TBD | TBD | TBD | TBD |
| English/i18n launch-copy review | `BLOCKED` | TBD | TBD | TBD | TBD |

## Shared Workflow

Use this workflow for every gate before changing runtime or provider state.

1. Create a gate-specific `Research Packet`.
2. Confirm owner, reviewer, execution window, rollback or stop criteria.
3. Run read-only discovery first.
4. Execute the smallest approved action that can prove the gate.
5. Capture sanitized evidence immediately.
6. Mark the gate `EVIDENCE_REVIEW`.
7. Reviewer either marks `EVIDENCE_ACCEPTED`, keeps it `FAILED`, or records a
   time-limited `WAIVED` decision.

### Research Packet Template

| Field | Value |
| --- | --- |
| Gate | TBD |
| Owner | TBD |
| Reviewer | TBD |
| Execution environment | TBD |
| Approved window | TBD |
| Current source/runtime truth checked | TBD |
| Provider/admin UI checked | TBD |
| Read-only commands or dashboards | TBD |
| Mutable actions planned | TBD |
| Stop criteria | TBD |
| Evidence artifact link | TBD |
| Reviewer decision | TBD |

### Admin Pre-Open Booking Smoke Evidence Template

Fill one Markdown row per payment method or provider path, then link redacted
screenshots, logs, provider artifacts, and admin artifacts from that row.
Screenshots alone are not accepted as the full evidence chain. Do not paste raw
payment keys, QR tokens, cookies, full phone numbers, full e-mail addresses, or
full seat/order identifiers into the artifact.

Default evidence artifact:
`docs/uat/ticketing-open-admin-preopen-smoke-2026-06-03.md`.

| Field | Value |
| --- | --- |
| Payment path | TBD |
| Provider path | TBD |
| Evidence row artifact | Markdown row link |
| Buyer-visible checkout/widget evidence | Redacted screenshot or artifact |
| API allowed-method cross-check | Redacted API response or internal artifact |
| Provider admin cross-check | Redacted provider/admin artifact |
| Target Performance | Girl Rules, masked internal reference |
| Performance Sale Status before smoke | `오픈예정` |
| Authorized admin account | Masked internal reference |
| Ordinary Buyer block before path | UI/CTA evidence + blocked seat-lock or earliest-safe mutation evidence |
| Selected test seat | Masked/internal seat reference |
| Order / reservation reference | Masked/internal reference |
| Provider approval evidence | Redacted provider/admin artifact |
| API confirm/finalization evidence | Redacted app/log/admin artifact |
| Reservation / payment / ticket state | Redacted internal state chain |
| QR visibility evidence | Redacted screenshot or internal artifact |
| Cleanup action | Cancel/refund, or cancel/refund plus controlled reopen |
| Cleanup result | Refunded/cancelled state + sellable inventory verification |
| Ordinary Buyer block after final cleanup | UI/CTA evidence + blocked seat-lock or earliest-safe mutation evidence |
| Stop/failure notes | TBD |
| Reviewer decision | TBD |

## Gate 1: Final Booking Enablement And Cutover Approval

### Objective

Prove that booking is enabled only after all required cutover gates have
accepted evidence, then capture post-enable smoke for the buyer path.

### Pre-Research

- [ ] Confirm every required evidence gate in this runbook is
      `EVIDENCE_ACCEPTED` or explicitly `WAIVED`.
- [ ] Capture current `bookingEnabled:false` runtime flag state.
- [ ] Capture `/admin/cutover/gates` state and confirm whether
      `finalEnableAllowed:true` is present.
- [ ] Confirm owner approval for the exact enablement window.
- [ ] Confirm close-booking command/path and rollback owner.

### Execution Checklist

- [ ] Run read-only health, runtime flag, and cutover gate probes.
- [ ] Enable booking only during the approved window.
- [ ] Re-check runtime flags after enablement.
- [ ] Run public performance detail, queue/booking entry, seat selection,
      support page, and health smoke.
- [ ] Record any decision to keep booking open, close booking, or rollback.

### Required Evidence

- [ ] Pre-enable `bookingEnabled:false` runtime flag evidence.
- [ ] `/admin/cutover/gates` evidence with `finalEnableAllowed:true`, or an
      explicit waiver explaining why this was bypassed.
- [ ] Owner approval and timestamp.
- [ ] Post-enable `bookingEnabled:true` runtime flag evidence.
- [ ] Post-enable smoke results.
- [ ] Close-booking or rollback decision record.

### Pass Criteria

- Enablement happens only after accepted gate evidence or explicit waivers.
- Runtime flag state matches the operator decision.
- Buyer-critical smoke passes after enablement.

### Fail / Stop Criteria

- Any required gate remains unresolved without waiver.
- `finalEnableAllowed` is false or unavailable and no explicit waiver exists.
- Post-enable smoke fails on health, queue, booking, payment, QR, or support.

## Gate 2: Toss Sandbox Gateway Smoke

### Objective

Prove the non-production Toss gateway path still works with approved sandbox
credentials and does not depend on live-only configuration.

### Pre-Research

- [ ] Confirm approved sandbox keys and widget/payment UI setting are active in
      the test environment without mixing into production deploy settings.
- [ ] Confirm sandbox test product/showtime and account are isolated.
- [ ] Confirm expected redirect, confirm, webhook/finalization, cancel, and QR
      behavior for sandbox mode.

### Execution Checklist

- [ ] Complete a sandbox card/widget happy path.
- [ ] Confirm internal payment confirm/finalization state.
- [ ] Confirm webhook or approved webhook simulator path.
- [ ] Confirm reservation/ticket/QR visibility.
- [ ] Cancel or clean up the sandbox transaction if the runbook requires it.

### Required Evidence

- [ ] Redacted sandbox configuration summary.
- [ ] Redacted sandbox provider approval.
- [ ] Internal reservation/payment/ticket state chain.
- [ ] QR/ticket visibility smoke.
- [ ] Cleanup or cancel evidence if performed.

### Pass Criteria

- Sandbox gateway path completes without manual DB edits.
- Internal status and sandbox provider status agree.
- Test credentials remain isolated from production deploy configuration.

### Fail / Stop Criteria

- Sandbox credentials or settings drift into production config.
- Provider approval succeeds but internal finalization fails.
- Internal booking succeeds without provider-approved payment.

## Gate 3: Admin Pre-Open Booking Smoke Across Production Payment Matrix

### Objective

Prove that an authorized admin can run the same production-visible booking,
payment, QR, inventory, and cleanup paths Buyers will use on the real Girl Rules
Performance while ordinary Buyers remain blocked until public sale opens.

### Pre-Research

- [ ] Confirm the Production Payment Matrix visible to Buyers for the Girl Rules
      Performance from the production checkout UI and provider widget.
- [ ] Cross-check the matrix against API `allowedPaymentMethods` and provider
      admin settings, but do not treat code-supported payment lists as the
      primary source.
- [ ] Confirm current Toss live configuration for every method/provider path in
      the matrix.
- [ ] Confirm deployed API/web revisions and environment flag state.
- [ ] Confirm the target Performance remains `오픈예정` and ordinary Buyers are
      blocked.
- [ ] Confirm the authorized admin account that can use Admin Booking Bypass.
- [ ] Select one low-risk test seat for each method/provider path, or document
      when the same seat will be reused after cleanup verification.
- [ ] Confirm final settlement, reconciliation, refund/cancel, and controlled
      reopen evidence fields that can be safely recorded with masked identifiers.

### Execution Checklist

- [ ] Capture ordinary Buyer block evidence before the first payment path:
      public UI/CTA state plus blocked seat-lock or earliest-safe booking
      mutation evidence.
- [ ] For each method/provider path, start from public performance detail as the
      authorized admin.
- [ ] Use one order and one low-risk seat for that path.
- [ ] Complete provider approval on the real gateway.
- [ ] Confirm API payment confirm/finalization reaches final accepted state.
- [ ] Confirm reservation, payment, ticket, and QR read paths are consistent.
- [ ] Complete Smoke Booking Cleanup for that path before starting the next path:
      cancel/refund, then verify the seat is sellable again.
- [ ] If normal cleanup does not restore the seat, use the admin controlled
      reopen path with an explicit reason and audit evidence.
- [ ] Capture ordinary Buyer block evidence again after the final cleanup.

### Required Evidence

- [ ] Timestamped runtime revision for web and API.
- [ ] Production Payment Matrix inventory.
- [ ] Buyer-visible checkout/widget evidence for the matrix.
- [ ] API allowed-method and provider admin cross-check evidence.
- [ ] Ordinary Buyer block evidence before the first payment path.
- [ ] One filled Markdown Admin Pre-Open Booking Smoke Evidence Template row per
      method/provider path, with links to redacted screenshots/logs/artifacts.
- [ ] Redacted provider dashboard confirmation per path.
- [ ] Redacted webhook or finalization log excerpt per path, when applicable.
- [ ] QR/ticket visibility smoke evidence per path.
- [ ] Cancel/refund evidence and sellable inventory verification per path.
- [ ] Controlled reopen reason and audit evidence for any path that requires
      manual reopen.
- [ ] Ordinary Buyer block evidence after final cleanup.

### Pass Criteria

- Every production-visible method/provider path completes without manual DB
  edits.
- Reservation, payment, ticket, QR, provider status, and internal status agree
  for every path.
- Every smoke booking is cancelled/refunded and the selected seat is verified as
  sellable again.
- Ordinary Buyers remain blocked before and after the admin smoke matrix.
- No sensitive value appears in evidence.

### Fail / Stop Criteria

- Provider approval succeeds but internal confirm/finalization fails.
- Internal booking succeeds without provider-approved payment.
- QR or ticket issuance is missing after accepted payment.
- Cleanup cannot cancel/refund, or inventory cannot be verified as sellable
  again.
- Ordinary Buyer block evidence fails before the first path or after final
  cleanup.
- Any customer-impacting or irreversible action exceeds the approved window.

## Gate 4: Real SMS OTP Happy Path

### Objective

Prove that the real SMS provider mode can send and verify an OTP for a
controlled number without customer impact.

### Pre-Research

- [ ] Confirm provider mode, sender identity, quota, and current incident state.
- [ ] Confirm the controlled phone number and owner consent.
- [ ] Confirm app route that performs the OTP request and verify flow.
- [ ] Confirm logs and provider dashboard can be captured with redaction.

### Execution Checklist

- [ ] Request OTP from the normal user flow or approved internal flow.
- [ ] Confirm provider accepted the send request.
- [ ] Confirm the controlled device receives the SMS.
- [ ] Complete verification with the received OTP.
- [ ] Confirm user/session state after verification.

### Required Evidence

- [ ] Timestamped send request success with redacted destination.
- [ ] Provider delivery state with redacted destination.
- [ ] App verification success state.
- [ ] No OTP value, full phone number, or PII in the artifact.

### Pass Criteria

- SMS is delivered to the controlled number.
- Verification succeeds through the normal app path.
- Logs and dashboards show no unexpected provider or app errors.

### Fail / Stop Criteria

- OTP is sent to an unapproved destination.
- Verification requires manual DB edits.
- Provider rate limit, sender rejection, or delivery failure appears.

## Gate 5: Production / Cluster Valkey Rehearsal

### Objective

Prove deployed or cluster-parity Valkey behavior for queue admission, seat
locks, ranking/cache, throttling, and Socket.IO pub/sub health.

### Pre-Research

- [ ] Confirm deployed Valkey/Redis endpoint class and app configuration.
- [ ] Confirm API health surface reports expected Valkey mode.
- [ ] Confirm no local in-memory fallback is being used for this evidence.
- [ ] Identify safe rehearsal showtime/session IDs.
- [ ] Identify dashboards or logs for queue, lock, cache, throttle, and Socket.IO.

### Execution Checklist

- [ ] Capture API health and runtime configuration evidence.
- [ ] Exercise queue admission with controlled clients.
- [ ] Exercise seat lock acquire, conflict, release, and expiry behavior.
- [ ] Exercise ranking/cache read path if launch-critical.
- [ ] Exercise throttling with low-volume controlled requests.
- [ ] Confirm Socket.IO pub/sub behavior across deployed instances or
      cluster-parity instances.

### Required Evidence

- [ ] Valkey mode and endpoint class, redacted as needed.
- [ ] Queue admission success and failure behavior.
- [ ] Seat lock conflict and expiry behavior.
- [ ] Socket.IO cross-instance event evidence.
- [ ] Relevant logs showing no reconnect loop or command errors.

### Pass Criteria

- No in-memory fallback is involved.
- Queue, lock, throttle, cache, and Socket.IO behaviors match launch needs.
- No duplicate booking or unsafe lock state appears.

### Fail / Stop Criteria

- App silently falls back to local memory.
- Lock conflict or expiry produces unsafe booking state.
- Socket.IO pub/sub fails across instances.

## Gate 6: Load Baseline And 10K / 20K Stress

### Objective

Prove expected launch traffic can be absorbed or safely queued without breaking
booking, payment, or QR issuance.

### Pre-Research

- [ ] Define traffic model: 10K baseline, 20K stress, ramp-up, think time,
      geography, browser/API mix, and authenticated/anonymous ratio.
- [ ] Confirm allowed test window and rate limits with infra/provider owners.
- [ ] Confirm test data is isolated from real customer data.
- [ ] Confirm dashboards for Cloud Run, Cloud SQL, Valkey, queue, payment,
      web errors, API latency, and Sentry.
- [ ] Define rollback and close-booking thresholds before running the test.

### Execution Checklist

- [ ] Run a low-volume smoke to validate scripts and test data.
- [ ] Run 10K baseline profile.
- [ ] Capture p50/p95/p99 latency, 4xx/5xx rate, queue behavior, DB
      connections, CPU/memory, and Valkey metrics.
- [ ] Run 20K stress profile only after baseline evidence is acceptable.
- [ ] Capture saturation point, error class, and recovery time.
- [ ] Verify booking/payment/QR smoke after each run.

### Required Evidence

- [ ] Load profile and command/config summary.
- [ ] Metrics export or screenshots with timestamps.
- [ ] Error log summary grouped by class.
- [ ] Queue admission and waiting-time evidence.
- [ ] Post-test booking/payment/QR smoke evidence.
- [ ] Decision on launch capacity limit and rollback threshold.

### Pass Criteria

- Baseline traffic stays within agreed latency and error thresholds.
- Stress traffic either succeeds or degrades through controlled queue behavior.
- System recovers without manual data repair.

### Fail / Stop Criteria

- 5xx, DB saturation, Valkey errors, or queue failure exceed thresholds.
- Payment/booking side effects become inconsistent.
- Recovery requires manual data mutation not covered by an approved runbook.

## Gate 7: Cloud Run Rollback Drill

### Objective

Prove the operator can identify a known-good revision, shift traffic back, and
verify API/web health after rollback.

### Pre-Research

- [ ] Identify current API and web revisions.
- [ ] Identify previous known-good API and web revisions.
- [ ] Confirm rollback command shape and required permissions.
- [ ] Confirm smoke checks after traffic shift.
- [ ] Confirm no migration incompatibility blocks rollback.

### Execution Checklist

- [ ] Capture current traffic split and revision evidence.
- [ ] Execute rollback during approved window.
- [ ] Confirm traffic is routed to the selected known-good revision.
- [ ] Run health, runtime flag, login/session, public performance detail, and
      booking-gate smoke checks.
- [ ] Restore forward if the drill requires returning to the newer revision.

### Required Evidence

- [ ] Before/after revision and traffic split.
- [ ] Smoke results after rollback.
- [ ] Restore-forward evidence if performed.
- [ ] Any observed migration or config compatibility risk.

### Pass Criteria

- Traffic moves to the intended revision.
- Health and critical public routes pass after rollback.
- Operator can restore the intended state.

### Fail / Stop Criteria

- Rollback target cannot serve current schema/config.
- Traffic split is ambiguous or does not converge.
- Critical routes fail after rollback.

## Gate 8: Cloud SQL PITR Drill

### Objective

Prove point-in-time restore can produce a usable recovery target and validation
queries can establish booking/payment/ticket consistency.

### Pre-Research

- [ ] Confirm PITR is enabled and retention is sufficient.
- [ ] Define restore timestamp and target instance/project.
- [ ] Confirm drill cannot overwrite production.
- [ ] Define read-only validation query classes.
- [ ] Confirm who can approve teardown of the restored target after evidence.

### Execution Checklist

- [ ] Capture current backup/PITR configuration evidence.
- [ ] Restore to isolated target.
- [ ] Run read-only validation query classes for reservations, payments,
      tickets, seat locks if persisted, and support/admin records.
- [ ] Record restore start/end time and validation result.
- [ ] Tear down or retain the target according to the approved plan.

### Required Evidence

- [ ] PITR setting and retention evidence.
- [ ] Restore target metadata.
- [ ] Recovery duration.
- [ ] Validation query class results, with no PII values.
- [ ] Teardown or retention decision.

### Pass Criteria

- Restore completes in the expected window.
- Validation queries prove data is queryable and internally consistent.
- Production is not modified.

### Fail / Stop Criteria

- Restore targets production or an ambiguous instance.
- Validation cannot prove reservation/payment/ticket consistency.
- Recovery timing exceeds the launch incident tolerance.

## Gate 9: Valkey Reconnect / Failure Drill

### Objective

Prove the app recovers from Valkey reconnect or failover behavior without
unsafe queue, lock, throttle, or Socket.IO state.

### Pre-Research

- [ ] Define whether the drill uses production, staging, or cluster-parity env.
- [ ] Identify approved failure injection method.
- [ ] Confirm stop criteria for live-user impact.
- [ ] Confirm logs/dashboards for reconnect, command errors, queue, locks, and
      Socket.IO.

### Execution Checklist

- [ ] Capture normal Valkey health before failure injection.
- [ ] Start controlled queue/lock/pub-sub activity.
- [ ] Inject approved reconnect/failure condition.
- [ ] Observe app reconnect and recovery behavior.
- [ ] Verify no duplicate booking, stuck queue admission, or unsafe lock state.
- [ ] Capture post-drill health.

### Required Evidence

- [ ] Before/failure/after health.
- [ ] Reconnect logs with sensitive fields redacted.
- [ ] Queue and seat-lock consistency checks.
- [ ] Socket.IO recovery evidence if applicable.

### Pass Criteria

- App reconnects without manual restart, or the approved restart path is proven.
- Queue and lock state remain safe.
- No customer-visible booking inconsistency is produced.

### Fail / Stop Criteria

- Reconnect loop persists.
- Queue admission or lock cleanup becomes unsafe.
- Manual data repair is required.

## Gate 10: WAF Readiness

### Objective

Prove launch-mode WAF rules protect booking-critical paths without blocking
normal buyers.

### Pre-Research

- [ ] Inventory active Cloudflare rules for normal pages, API health, queue
      entry, booking mutations, admin, and suspicious automation.
- [ ] Confirm rules are in the intended mode for launch.
- [ ] Define low-volume suspicious smoke that will not affect real users.
- [ ] Define normal-pass smoke from realistic buyer paths.

### Execution Checklist

- [ ] Capture active rule state.
- [ ] Run normal-pass smoke for web home, performance detail, support, API
      health, and booking entry.
- [ ] Run low-volume suspicious challenge/block/rate-limit smoke separately.
- [ ] Check Cloudflare events for false positives and expected suspicious hits.
- [ ] Confirm admin/operator access is not blocked.

### Required Evidence

- [ ] Active rule state and mode.
- [ ] Normal-pass smoke results.
- [ ] Suspicious smoke results as a separate row.
- [ ] False-positive review.
- [ ] Owner decision for launch mode.

### Pass Criteria

- Normal buyer paths pass.
- Suspicious behavior is challenged, blocked, or rate-limited as intended.
- No admin/operator access required for launch is blocked.

### Fail / Stop Criteria

- Normal users are challenged or blocked.
- Booking mutations can be abused without rule coverage.
- WAF evidence cannot distinguish normal-pass from suspicious smoke.

## Gate 11: On-Call And First-24h Watch

### Objective

Ensure one-person operations can detect, classify, and respond to launch issues
during the first 24 hours.

### Pre-Research

- [ ] Confirm named primary owner and backup contact.
- [ ] Confirm alert routing for Sentry, Cloud Run, Cloud SQL, Valkey,
      Cloudflare, payment provider, SMS provider, and business metrics.
- [ ] Confirm dashboard links and access.
- [ ] Confirm close-booking, rollback, provider incident, and customer support
      escalation paths.

### Watch Checklist

- [ ] 30 minutes before open: health, runtime flags, provider dashboards,
      Cloudflare, Sentry, queue, and booking-gate state.
- [ ] T+0 to T+15: watch Cloud Run 5xx, queue admission, seat lock, payment
      confirm, webhook/finalization, QR issuance, and support contact signals.
- [ ] T+15 to T+60: record metrics every 15 minutes or after each incident.
- [ ] T+1h to T+24h: record hourly checks, incident decisions, and customer
      support summaries.
- [ ] After T+24h: record go-forward decision and any follow-up fixes.

### Required Evidence

- [ ] Owner schedule and backup.
- [ ] Dashboard/access confirmation.
- [ ] Alert delivery test.
- [ ] First-24h checklist artifact.
- [ ] Incident decision log, even if no incidents occurred.

### Pass Criteria

- Owner can receive alerts and access dashboards.
- Each critical signal has an owner action.
- First-24h evidence can support go/no-go decisions.

### Fail / Stop Criteria

- Alerts cannot reach the owner.
- Critical dashboards are inaccessible.
- No documented close-booking or rollback decision path exists.

## Gate 12: Cleanup Isolation Drills

### Objective

Prove cleanup jobs or manual cleanup actions do not remove unrelated active
reservations, locks, tickets, payments, or support records.

### Pre-Research

- [ ] Inventory cleanup commands, jobs, scripts, and manual runbooks.
- [ ] Define preserve set: real users, active reservations, paid reservations,
      issued tickets, active locks, support content, and admin records.
- [ ] Define isolated rehearsal targets.
- [ ] Confirm dry-run or read-only inventory mode before any mutation.
- [ ] Confirm rollback or recovery path if a cleanup action is unsafe.

### Execution Checklist

- [ ] Run inventory query or dry-run mode.
- [ ] Capture preserve set and deletion candidate counts.
- [ ] Execute cleanup only against approved isolated targets.
- [ ] Run post-cleanup read-only verification.
- [ ] Confirm no unrelated active record was removed or changed.

### Required Evidence

- [ ] Cleanup target definition.
- [ ] Preserve set definition.
- [ ] Before/after counts.
- [ ] Post-cleanup verification query class.
- [ ] Reviewer approval that isolation held.

### Pass Criteria

- Cleanup affects only approved targets.
- Active reservations, locks, tickets, payments, and support records remain
  intact.
- Evidence is enough to repeat the drill safely.

### Fail / Stop Criteria

- Dry-run cannot distinguish preserve set from deletion targets.
- Cleanup would touch active customer or support records.
- Verification cannot prove isolation.

## Gate 13: Support FAQ / Notice Content Approval

### Objective

Prove the public support routes and deployed support-content records are ready
for launch, not merely that fallback code exists.

### Pre-Research

- [ ] Confirm approved launch FAQ and notice copy per supported locale.
- [ ] Confirm published support-content records in admin are not draft,
      archived, or review-only rows.
- [ ] Confirm deployed `/support` and localized support routes use the intended
      API environment.
- [ ] Confirm fallback static copy is acceptable only as degraded behavior, not
      as final content approval.

### Execution Checklist

- [ ] Publish or verify approved FAQ/notice records through admin.
- [ ] Smoke `/support`, `/en/support`, `/th/support`, and `/zh-CN/support`.
- [ ] Confirm API returns only public fields and published rows.
- [ ] Confirm footer support link reaches localized support page.
- [ ] Confirm support email is visible.

### Required Evidence

- [ ] Approved copy source or reviewer decision.
- [ ] Redacted support-content API response shape.
- [ ] Deployed route screenshots or browser smoke results.
- [ ] Footer navigation smoke.

### Pass Criteria

- Public support pages render approved launch content or an explicit accepted
  fallback decision.
- Draft, archived, review metadata, and actor fields are not exposed publicly.
- Supported locales have approved or explicitly accepted content.

### Fail / Stop Criteria

- Support routes rely on unreviewed fallback copy without owner acceptance.
- Public API exposes non-public support metadata.
- Any launch locale route returns 404 or wrong locale content.

## Gate 14: English / I18n Launch-Copy Review

### Objective

Prove English and other launch locales do not expose unexpected Korean copy on
public legal, detail, search, category, runtime, age, tier, support, auth, SMS,
booking, and QR-adjacent surfaces.

### Pre-Research

- [ ] Inventory public routes in the launch scope.
- [ ] Confirm legal page translation status for `/en/legal/privacy`,
      `/en/legal/terms`, and other supported locale variants.
- [ ] Confirm category, subcategory, runtime, age rating, tier names, venue, and
      operator-authored performance copy policy for non-Korean locales.
- [ ] Define which Korean proper nouns are acceptable and which are launch
      blockers.

### Execution Checklist

- [ ] Run automated i18n smoke.
- [ ] Perform browser review of legal, support, home, search, genre, performance
      detail, auth/signup, reset password, booking disabled, and QR/ticket
      visible surfaces for launch locales.
- [ ] Record accepted Korean proper nouns separately from accidental untranslated
      UI labels or body copy.
- [ ] Create follow-up fixes for any unaccepted mixed-copy surfaces.

### Required Evidence

- [ ] Automated i18n smoke result.
- [ ] Route-by-route manual review checklist.
- [ ] List of accepted proper nouns or data-originated Korean values.
- [ ] List of required copy fixes, if any.

### Pass Criteria

- No unaccepted Korean UI/body copy remains in public launch locales.
- Legal pages are either translated, blocked from launch, or explicitly waived.
- Data-originated Korean values are explained and accepted by reviewer.

### Fail / Stop Criteria

- Legal or buyer-critical pages show unaccepted Korean body copy.
- Mixed-copy findings are not classified by route and owner decision.
- Review scope excludes known UAT findings.

## Final Public Open Approval

Public open can move from `NO-GO` to `GO` only when every gate below is
`EVIDENCE_ACCEPTED` or has an explicit, time-limited `WAIVED` decision.

| Gate | Final status | Evidence artifact | Reviewer | Approved at |
| --- | --- | --- | --- | --- |
| Final booking enablement and cutover approval | TBD | TBD | TBD | TBD |
| Toss sandbox gateway smoke | TBD | TBD | TBD | TBD |
| Admin pre-open booking smoke across Production Payment Matrix | TBD | `docs/uat/ticketing-open-admin-preopen-smoke-2026-06-03.md` | TBD | TBD |
| Real SMS OTP happy path | TBD | TBD | TBD | TBD |
| Production/cluster Valkey rehearsal | TBD | TBD | TBD | TBD |
| Load baseline and stress | TBD | TBD | TBD | TBD |
| Cloud Run rollback drill | TBD | TBD | TBD | TBD |
| Cloud SQL PITR drill | TBD | TBD | TBD | TBD |
| Valkey reconnect/failure drill | TBD | TBD | TBD | TBD |
| WAF readiness | TBD | TBD | TBD | TBD |
| On-call and first-24h watch | TBD | TBD | TBD | TBD |
| Cleanup isolation drills | TBD | TBD | TBD | TBD |
| Support FAQ/notice content approval | TBD | TBD | TBD | TBD |
| English/i18n launch-copy review | TBD | TBD | TBD | TBD |

Final decision:

- Status: `NO-GO`
- Decision owner: TBD
- Decision timestamp: TBD
- Notes: TBD
