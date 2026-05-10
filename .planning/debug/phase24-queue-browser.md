---
status: investigating
trigger: "Phase 24 UAT gap diagnosis only. Do not edit source code. Diagnose Playwright strict locator collision around `현재 순번` in queue waiting-state test."
created: 2026-05-10T00:00:00+09:00
updated: 2026-05-10T00:10:00+09:00
---

## Current Focus

hypothesis: Confirmed. The waiting-state Playwright test uses non-scoped `page.getByText(...)` assertions for queue metric labels, and the rendered helper/safety copy repeats those same metric substrings, producing strict-mode collisions.
test: Compare test selectors with actual rendered queue copy and Playwright failure snapshot.
expecting: The same Korean substrings appear in both the metric tile labels and the right-side helper paragraphs.
next_action: Return root cause report only. No source edits requested.

## Symptoms

expected: Queue browser waiting-state test should pass while verifying queue position, ETA, and remaining-seat copy.
actual: Playwright strict locator for `현재 순번` matches both the metric label and the helper sentence, producing one test failure despite the UI snapshot showing the expected queue waiting state.
errors: "Playwright strict locator for `현재 순번` resolves to multiple elements"
reproduction: Run the Phase 24 queue browser waiting-state Playwright test for entering the booking screen and assert the waiting UI copy.
started: Phase 24 UAT gap review

## Eliminated

- hypothesis: The waiting UI failed to render or the queue data was wrong.
  evidence: Error snapshot shows the expected waiting title, position `12`, ETA `2m 45s`, and remaining seats `24`, so the UI state is correct and the failure occurs at locator resolution.
  timestamp: 2026-05-10T00:10:00+09:00

## Evidence

- timestamp: 2026-05-10T00:06:00+09:00
  checked: .planning/phases/24-traffic-booking-payment-core/24-UAT.md
  found: Phase 24 UAT test 9 records only one browser failure and explicitly says the page snapshot shows the expected waiting surface with position, ETA, and remaining seats rendered.
  implication: This is a test-selector issue, not a broken waiting-state UI.
- timestamp: 2026-05-10T00:07:00+09:00
  checked: apps/web/e2e/booking-queue.spec.ts
  found: The test asserts `page.getByText(koMessages.booking.queue.metrics.position)` at lines 90-92 without scoping or `exact: true`.
  implication: Playwright strict mode requires that text locator resolve to one element, so any repeated substring will fail.
- timestamp: 2026-05-10T00:08:00+09:00
  checked: apps/web/components/booking/queue-waiting.tsx
  found: The metric tile label renders `queueCopy.metrics.position` and the helper panel separately renders `copy.helper` and `queueCopy.safetyInfo`.
  implication: The component intentionally exposes both metric labels and explanatory text on the same waiting screen.
- timestamp: 2026-05-10T00:09:00+09:00
  checked: apps/web/messages/ko.json
  found: `booking.queue.metrics.position` is `현재 순번`, while `booking.queue.status.waiting.helper` is `새로고침하지 않아도 현재 순번과 예상 대기 시간이 계속 갱신됩니다.`
  implication: The helper sentence contains the exact metric substring, so `getByText('현재 순번')` matches both elements.
- timestamp: 2026-05-10T00:10:00+09:00
  checked: apps/web/test-results/booking-queue-booking-queu-59c97-entering-the-booking-screen-chromium/error-context.md
  found: Playwright reports strict mode violation with exactly two matches for `getByText('현재 순번')`: the metric label paragraph and the helper paragraph.
  implication: The failure mechanism is directly observed and confirmed.

## Resolution

root_cause: Queue waiting test uses broad `getByText` assertions for localized metric labels, but the waiting helper copy repeats those metric substrings, so Playwright strict mode sees multiple visible matches and fails even though the UI is correct.
fix: Scope queue metric assertions to the metric card/section or use exact/semantic locators that target the label-value tiles rather than free-text substring matches.
verification: Diagnosis only. No source edits or reruns requested.
files_changed: []
