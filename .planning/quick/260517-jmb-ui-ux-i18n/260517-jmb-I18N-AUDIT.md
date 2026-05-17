# 260517-jmb I18N Audit

## Scope

Quick task 260517-jmb targeted active public/user-facing locale cleanup and high-confidence Korean UI/client error cleanup. The code fix in this task was intentionally narrow: remove `zh-TW` from active surfaces, keep `zh-CN`, and localize the known signup step 1 duplicate-email error. Broader auth, booking, and admin Korean copy remains documented here because those areas need a shared i18n shell/message contract rather than one-off local maps.

## Commands

```bash
rg -n "zh-TW|繁體中文|Traditional Chinese|ZH-HANT|zhTW|zhTWMessages|/zh-TW" packages/shared/src apps/web apps/api/src/modules apps/api/src/database/seed.mjs -g '!**/*.md' -g '!**/node_modules/**'
```

Result: no output (`rg_exit=1`, expected for no matches).

```bash
rg -n "이미 사용 중인 이메일입니다" apps/web/components/auth apps/web/app/auth -g '!**/*.test.*'
```

Result: no output (`rg_exit=1`, expected for no matches).

```bash
rg -n "[가-힣]" apps/web/components/auth apps/web/app/auth apps/web/components/booking apps/web/app/booking apps/web/hooks apps/web/lib apps/web/app/error.tsx apps/web/app/global-error.tsx -g '*.tsx' -g '*.ts' -g '!**/*.test.*'
```

Result: 418 lines across 46 files.

```bash
rg -n "[가-힣]" apps/web/app/admin apps/web/components/admin apps/web/hooks/use-admin.ts apps/web/hooks/use-admin-support-content.ts -g '*.tsx' -g '*.ts' -g '!**/*.test.*'
```

Result: 823 lines across 45 files.

## Fixed Findings

| File | Finding | Resolution |
| --- | --- | --- |
| `apps/web/components/auth/signup-step1.tsx` | `EMAIL_AVAILABILITY_ERROR = '이미 사용 중인 이메일입니다'` was rendered for duplicate email availability in every locale. | Removed the constant and now uses `authCopy.form.emailUnavailable` for cached and fresh duplicate-email checks. |
| `apps/web/messages/ko.json` | Missing localized duplicate-email key. | Added `auth.form.emailUnavailable`: `이미 사용 중인 이메일입니다`. |
| `apps/web/messages/en.json` | Missing localized duplicate-email key. | Added `auth.form.emailUnavailable`: `This email is already in use`. |
| `apps/web/messages/th.json` | Missing localized duplicate-email key. | Added `auth.form.emailUnavailable`: `อีเมลนี้ถูกใช้งานแล้ว`. |
| `apps/web/messages/zh-CN.json` | Missing localized duplicate-email key. | Added `auth.form.emailUnavailable`: `该邮箱已被使用`. |
| `packages/shared/src/i18n/launch-copy-keys.ts` | Launch copy manifest did not require the new canary-visible key. | Added `emailUnavailable` to `auth.form`. |

## Excluded Findings

These findings were intentionally not converted because they are not direct user-visible UI copy, or because the plan explicitly excluded test/history text:

| Category | Examples | Reason |
| --- | --- | --- |
| Source comments and implementation notes | `apps/web/hooks/use-is-mobile.ts`, `apps/web/components/booking/__utils__/prefix-svg-defs-ids.ts`, comments inside `apps/web/components/booking/seat-map-viewer.tsx`, `apps/web/components/auth/signup-step2.tsx`, `apps/web/hooks/use-admin-dashboard.ts` | Developer-facing comments do not render to users. |
| Test fixture prose | `**/*.test.*` | The scan commands excluded tests by design. |
| Historical migration/backfill text | `apps/api/src/database/migrations/**`, `apps/api/src/database/migrations/meta/**` | Historical migration/meta files were out of scope and intentionally untouched. |
| Diagnostic console prefixes | `console.error('Toss Payments SDK 초기화 실패:', err)` style entries | Not rendered in the app UI. User-facing fallback strings near them are tracked below where applicable. |

## Remaining User-Visible Korean Copy

The remaining strings are real user-visible copy, but converting them correctly needs a broader message namespace design for auth pages, booking flow, and admin shell. They should not be converted with ad hoc local objects because that would create parallel i18n systems and make locale coverage weaker.

| Surface | Representative files | Required follow-up |
| --- | --- | --- |
| Global/public error pages | `apps/web/app/error.tsx`, `apps/web/app/global-error.tsx`, `apps/web/app/auth/error.tsx` | Add app-level error copy namespace and wire locale-aware fallback rendering. |
| Auth pages and auth client errors | `apps/web/components/auth/login-form.tsx`, `apps/web/app/auth/callback/page.tsx`, `apps/web/app/auth/reset-password/page.tsx`, `apps/web/app/auth/verify-email/page.tsx`, `apps/web/components/auth/profile-form.tsx`, `apps/web/components/auth/password-input.tsx`, `apps/web/components/auth/social-login-button.tsx`, `apps/web/components/auth/step-indicator.tsx` | Extend existing `auth.*` message coverage beyond launch-copy canaries. |
| Client error/toast helpers | `apps/web/lib/api-client.ts`, `apps/web/lib/error-messages.ts`, `apps/web/hooks/use-socket.ts`, `apps/web/hooks/use-reservations.ts`, `apps/web/hooks/use-queue.ts`, `apps/web/hooks/use-booking.ts` | Introduce locale-aware client error mapper/toast copy. Avoid displaying API/internal Korean messages directly in non-Korean locales. |
| Booking flow and payment | `apps/web/components/booking/booking-page.tsx`, `apps/web/app/booking/[performanceId]/confirm/page.tsx`, `apps/web/app/booking/[performanceId]/complete/page.tsx`, `apps/web/components/booking/booking-complete.tsx`, `apps/web/components/booking/order-summary.tsx`, `apps/web/components/booking/seat-selection-panel.tsx`, `apps/web/components/booking/seat-selection-sheet.tsx`, `apps/web/components/booking/queue-waiting.tsx`, `apps/web/components/booking/timer-expired-modal.tsx`, `apps/web/components/booking/toss-payment-widget.tsx`, `apps/web/components/booking/booker-info-section.tsx`, `apps/web/components/booking/terms-agreement.tsx` | Add booking/payment message namespace with formatting helpers for currency, seat labels, timer labels, queue states, and legal/payment consent text. |
| Seat map viewer labels and fallback UI | `apps/web/components/booking/seat-map-viewer.tsx`, `apps/web/components/booking/floor-selector.tsx`, `apps/web/components/booking/seat-map-controls.tsx`, `apps/web/components/booking/seat-legend.tsx`, `apps/web/components/booking/seat-row.tsx` | Add seat-map copy namespace and decide how to localize source SVG/category labels such as `사석`. |
| Admin shell and admin tools | `apps/web/app/admin/**`, `apps/web/components/admin/**`, `apps/web/hooks/use-admin.ts`, `apps/web/hooks/use-admin-support-content.ts` | Admin has extensive Korean operational copy. Needs a deliberate admin i18n shell decision before converting, especially for forms, audit tables, operations inbox, dashboard charts, and publish/seat operation workflows. |

## Verification Notes

- `zh-TW` active-code residue scan returned no matches in the active public/user-facing paths requested by the plan.
- The duplicate email production literal scan returned no matches after the fix.
- The broad Korean scans intentionally still return matches; this audit classifies them as excluded developer-only text or remaining user-visible copy requiring a broader i18n architecture.
