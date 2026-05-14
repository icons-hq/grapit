# Quick Summary: signup step 3 i18n and phone input polish

## Completed
- Added `auth.signup` launch copy keys and expanded `auth.otp` keys across `ko`, `en`, `th`, `zh-CN`, and `ja`.
- Localized signup progress labels, signup step 3 form copy, validation copy, social completion step labels, and OTP button/status copy.
- Removed phone and OTP placeholders from the signup SMS surface and switched selectors/accessibility to localized `aria-label` copy.
- Updated phone input display behavior so users see raw national digits without hyphen formatting while form values remain E.164 for existing SMS APIs and validation.
- Moved the SMS send/resend button below the phone input as a full-width action.
- Kept signup country payloads canonical with locale-specific display labels.

## Verification
- `pnpm --filter @grabit/shared test`
- `pnpm --filter @grabit/web exec vitest run components/auth/__tests__/phone-verification.test.tsx components/ui/__tests__/phone-input-i18n.test.tsx components/auth/__tests__/signup-step3-i18n.test.tsx`
- `pnpm --filter @grabit/web test`
- `pnpm --filter @grabit/shared build`
- `pnpm --filter @grabit/web typecheck`
- Browser route smoke for `/auth`, `/en/auth`, `/th/auth`, `/zh-CN/auth`, and `/ja/auth`: expected localized signup copy rendered, no runtime overlay, no browser warning/error logs.

## Notes
- The in-app Browser fill helper could not fill the email input because of a Browser plugin limitation on `input[type=email]`; interaction-level coverage is handled by the updated unit tests and E2E selectors.
