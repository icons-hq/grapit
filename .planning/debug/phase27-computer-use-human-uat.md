---
status: partial_human_uat_automated
phase: 27-event-operations-settlement
created: 2026-05-22
evidence_policy: redacted_local_mocks_only
---

# Phase 27 Computer Use Human UAT

This evidence log records the 2026-05-22 Computer Use pass for Phase 27 manual-gate flows after concurrent session changes to the web check-in surface. It uses local `localhost:3000` with Playwright-controlled redacted sessions and API responses. No raw QR token, JWT/JTI value, cookie, payment key, OTP, full email, full phone number, unmasked IP, raw customer row, or provider credential is recorded here.

## Environment

| Field | Value |
| --- | --- |
| Branch | `gsd/phase-27-event-operations-settlement` |
| Existing web server | `localhost:3000` reused |
| Browser | Google Chrome for Testing via Computer Use |
| Mobile viewport | 390 x 844 for scanner flows |
| Desktop viewport | 1280 x 900 for settlement flows |
| Test account classes | scanner-only, finance admin |

## Automated Commands

| Area | Command | Result |
| --- | --- | --- |
| Web targeted components | `pnpm --filter @grabit/web exec vitest run components/field/__tests__/scanner-check-in.test.tsx components/field/__tests__/qr-ticket-image.test.tsx components/admin/__tests__/settlement-dashboard.test.tsx` | 3 files, 19 tests passed |
| API targeted services | `pnpm --filter @grabit/api exec vitest run src/modules/field-operations/field-check-in.service.spec.ts src/modules/field-operations/offline-sync.service.spec.ts src/modules/admin/settlement-export.service.spec.ts` | 3 files, 23 tests passed |
| Browser E2E | `TZ=UTC PLAYWRIGHT_BASE_URL=http://localhost:3000 pnpm --filter @grabit/web test:e2e -- phase27-qr-check-in.spec.ts phase27-offline-sync.spec.ts booking-complete-qr.spec.ts phase26-qr-visibility.spec.ts` | 10 tests passed |

## Computer Use Evidence

| Flow | Result | Evidence notes |
| --- | --- | --- |
| Scanner-only check-in, mobile viewport | computer_use_verified | `Google Chrome for Testing` showed `입장 가능 티켓입니다`, reservation `GRP-27-CU-0001`, bottom action button `입장 처리`, then Computer Use clicked the action and observed `입장 처리가 완료되었습니다`. |
| Duplicate replay, mobile viewport | computer_use_verified | After reload of the same redacted ticket URL, Computer Use observed `이미 입장 처리된 티켓입니다` and no active entry-processing button. |
| Offline pending scan, mobile viewport | computer_use_verified | With browser context offline, Computer Use clicked `입장 처리` and observed `네트워크 문제로 보류 스캔에 저장했습니다`, `보류 1`, `동기화 0`, `거절 0`, and pending status copy. |
| Offline recovered sync, mobile viewport | computer_use_verified | After network restoration, Computer Use clicked `보류 스캔 동기화` and observed `동기화 1`, `synced`, and `보류 스캔 동기화 완료`. |
| Offline rejected conflict, mobile viewport | computer_use_verified | Computer Use opened a preseeded pending attempt, clicked `보류 스캔 동기화`, and observed `거절 1`, `rejected`, and `이미 입장 처리된 티켓입니다`. |
| Settlement finance review, desktop viewport | computer_use_verified | Finance admin saw summary totals: gross sales `₩12,800,000`, paid reservations `180건`, refunded amount `₩320,000`, entered `142건`, no-show `38건`, entry rate `79%`, and generated timestamp `2026. 7. 4. 오후 11:30`. |
| Settlement export confirmation, desktop viewport | computer_use_verified | Computer Use opened `정산 CSV 내보내기`, observed the privacy/payment warning, verified filters `phase27-event`, `phase27-showtime`, `2026-07-04 ~ 2026-07-04`, typed reason `Computer Use settlement reconciliation test`, clicked `CSV 내보내기`, and observed a completed CSV download. |
| Scanner-only settlement denial, desktop viewport | computer_use_verified | Scanner-only account opened `/admin/settlement` and saw `정산 데이터를 내보낼 권한이 없습니다` plus `scanner-only accounts cannot access settlement export`. |

## Remaining Non-Automatable Gates

| Gate | Status | Reason |
| --- | --- | --- |
| Real phone-camera QR scan | human_needed | Computer Use verified the URL-opening/browser check-in surface, but it cannot prove a physical phone camera scan from a buyer QR image. |
| External operational contacts | human_needed | Forced refund, weather, facility, cast issue, on-site refund, and exchange contact ownership must be supplied by the operator or marked with explicit blockers. |
| Production or venue device evidence | human_needed | This run used local mocked sessions. It does not replace venue device, production auth, real scanner account, or real settlement dataset evidence. |

## Conclusion

The automatable human-rehearsal surface is verified with Computer Use and targeted automated tests. Phase 27 remains blocked on the explicitly non-automatable evidence gates above.
