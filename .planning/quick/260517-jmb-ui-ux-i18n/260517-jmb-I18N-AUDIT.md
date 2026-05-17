# 260517-jmb I18N Audit

## Scope

Quick task 260517-jmb targeted active public/user-facing locale cleanup and high-confidence Korean UI/client error cleanup. Admin was explicitly excluded from final Browser QA. The initial code fix removed `zh-TW`, kept `zh-CN`, and localized the known signup step 1 duplicate-email error; follow-up Browser QA also converted public footer labels, social login button/error copy, logout toast copy, locale suggestion dismiss copy, public performance-card upcoming date labels, and public performance-detail labels.

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
| `apps/web/components/layout/footer.tsx` | Footer legal links and business labels stayed Korean on `/en`, `/th`, and `/zh-CN`. | Added `footer.*` message keys and locale-aware legal links. |
| `apps/web/components/auth/social-login-button.tsx` / `apps/web/components/auth/login-form.tsx` | Social login buttons and social callback error messages were Korean literals. | Added `auth.social.*` and `auth.socialErrors.*` message keys and passed localized labels into buttons. |
| `apps/web/components/layout/gnb.tsx` | Logout success toast was a Korean literal. | Reused `nav.logoutSuccess` from active locale messages. |
| `apps/web/components/performance/performance-card.tsx` | Upcoming public performance cards showed `오픈예정` on non-Korean routes. | Added locale-specific upcoming date labels for ko/en/th/zh-CN. |
| `apps/web/app/performance/[id]/page.tsx` | Public performance detail labels such as venue, schedule, runtime, age, price, upcoming status, and detail image alt copy were Korean literals. | Reused `performance.*` and `genres.*` message keys from the active locale. |
| `apps/web/components/i18n/locale-suggestion.tsx` | Locale suggestion dismiss button was hardcoded as `나중에` and storage access assumed `sessionStorage` always exists. | Added `locale.dismiss` to all active message files, reused `getVisibleCopy(locale).locale`, and guarded missing `sessionStorage`. |

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
| Auth pages and auth client errors | `apps/web/app/auth/callback/page.tsx`, `apps/web/app/auth/reset-password/page.tsx`, `apps/web/app/auth/verify-email/page.tsx`, `apps/web/components/auth/profile-form.tsx`, `apps/web/components/auth/password-input.tsx`, `apps/web/components/auth/step-indicator.tsx` | Extend existing `auth.*` message coverage beyond launch-copy canaries. Signup duplicate email and login social buttons/errors are fixed in this task. |
| Client error/toast helpers | `apps/web/lib/api-client.ts`, `apps/web/lib/error-messages.ts`, `apps/web/hooks/use-socket.ts`, `apps/web/hooks/use-reservations.ts`, `apps/web/hooks/use-queue.ts`, `apps/web/hooks/use-booking.ts` | Introduce locale-aware client error mapper/toast copy. Avoid displaying API/internal Korean messages directly in non-Korean locales. |
| Booking flow and payment | `apps/web/components/booking/booking-page.tsx`, `apps/web/app/booking/[performanceId]/confirm/page.tsx`, `apps/web/app/booking/[performanceId]/complete/page.tsx`, `apps/web/components/booking/booking-complete.tsx`, `apps/web/components/booking/order-summary.tsx`, `apps/web/components/booking/seat-selection-panel.tsx`, `apps/web/components/booking/seat-selection-sheet.tsx`, `apps/web/components/booking/queue-waiting.tsx`, `apps/web/components/booking/timer-expired-modal.tsx`, `apps/web/components/booking/toss-payment-widget.tsx`, `apps/web/components/booking/booker-info-section.tsx`, `apps/web/components/booking/terms-agreement.tsx` | Add booking/payment message namespace with formatting helpers for currency, seat labels, timer labels, queue states, and legal/payment consent text. |
| Seat map viewer labels and fallback UI | `apps/web/components/booking/seat-map-viewer.tsx`, `apps/web/components/booking/floor-selector.tsx`, `apps/web/components/booking/seat-map-controls.tsx`, `apps/web/components/booking/seat-legend.tsx`, `apps/web/components/booking/seat-row.tsx` | Add seat-map copy namespace and decide how to localize source SVG/category labels such as `사석`. |
| Admin shell and admin tools | `apps/web/app/admin/**`, `apps/web/components/admin/**`, `apps/web/hooks/use-admin.ts`, `apps/web/hooks/use-admin-support-content.ts` | Admin has extensive Korean operational copy. Needs a deliberate admin i18n shell decision before converting, especially for forms, audit tables, operations inbox, dashboard charts, and publish/seat operation workflows. |

## Verification Notes

- `zh-TW` active-code residue scan returned no matches in the active public/user-facing paths requested by the plan.
- The duplicate email production literal scan returned no matches after the fix.
- Browser QA on local `pnpm dev` verified desktop and mobile locale switchers only expose `ko`, `en`, `th`, and `zh-CN`; `zh-TW` routes render 404.
- Browser QA verified `/en`, `/th`, and `/zh-CN` home/auth pages no longer show the Korean footer labels, `오픈예정`, `繁體中文`, or the Korean duplicate-email error on non-Korean routes.
- Browser QA verified signup duplicate-email availability errors render as `This email is already in use`, `อีเมลนี้ถูกใช้งานแล้ว`, and `该邮箱已被使用`.
- Browser QA verified performance detail labels render as `Venue/Schedule/Price`, `สถานที่/กำหนดการ/ราคา`, and `场馆/日程/价格` on `/en`, `/th`, and `/zh-CN` respectively, with no `장소`, `일정`, `가격`, `오픈예정`, `繁體中文`, or `번체` UI label leakage.
- Browser QA verified the locale suggestion prompt renders localized dismiss copy (`Later`) for an English browser preference and does not leak the previous Korean dismiss literal.
- The broad Korean scans intentionally still return matches; this audit classifies them as excluded developer-only text or remaining user-visible copy requiring a broader i18n architecture.
