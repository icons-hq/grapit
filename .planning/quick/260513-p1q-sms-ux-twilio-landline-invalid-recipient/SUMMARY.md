---
status: complete
quick_id: 260513-p1q
slug: sms-ux-twilio-landline-invalid-recipient
completed: 2026-05-13T09:09:00Z
---

# Summary

Fixed signup SMS verification error handling for international phone numbers that Twilio Verify rejects before delivery.

## Changes

- Split `PhoneVerification` send-code and verify-code error mapping so send failures no longer render the OTP mismatch message.
- Suppressed global API error toasts for SMS send/verify calls and kept feedback inline in the phone verification form.
- Mapped Twilio Verify `60205` to "SMS를 받을 수 있는 휴대폰 번호를 입력해주세요".
- Mapped Twilio Verify `60200` invalid recipient errors to "올바른 휴대폰 번호를 입력해주세요".
- Added structured `sms.send_failed` log fields for country, provider HTTP status/code, and masked phone context.

## Verification

- RED confirmed before implementation:
  - `pnpm --filter @grabit/web exec vitest run components/auth/__tests__/phone-verification.test.tsx` failed on send-code `400` showing "인증번호가 일치하지 않습니다".
  - `pnpm --filter @grabit/api exec vitest run src/modules/sms/sms.service.spec.ts` failed on Twilio `60205/60200` mapping.
- GREEN after implementation:
  - `pnpm --filter @grabit/web exec vitest run components/auth/__tests__/phone-verification.test.tsx` -> 24/24 passed after rebasing onto `origin/main`.
  - `pnpm --filter @grabit/api exec vitest run src/modules/sms/sms.service.spec.ts src/modules/sms/twilio-verify-client.spec.ts src/modules/sms/phone.util.spec.ts` -> 68/68 passed.
  - `pnpm --filter @grabit/shared build` -> passed.
  - `pnpm --filter @grabit/web typecheck` -> passed.
  - `pnpm --filter @grabit/api typecheck` -> passed.
  - `git diff --check` -> passed.

## Production Evidence

Read-only CLI investigation before the fix found Cloud Run `grabit-api` logs for `2026-05-13T08:48:45Z`:

- request: `POST /api/v1/sms/send-code` -> HTTP 400.
- provider error: `Twilio Verify API 403`, code `60205`, "SMS is not supported by landline phone number".
- destination: Thailand `+66600565418`, which Twilio Lookup classified as `type: landline`.

No production send smoke was performed because that requires a user-owned SMS-capable phone number.
