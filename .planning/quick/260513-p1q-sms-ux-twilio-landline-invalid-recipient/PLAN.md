---
quick_id: 260513-p1q
slug: sms-ux-twilio-landline-invalid-recipient
status: complete
created: 2026-05-13
---

# SMS UX and Twilio Recipient Error Mapping

## Goal

Fix signup phone verification so send-code failures are shown as send failures, not OTP mismatch, and map Twilio landline/invalid recipient errors to actionable user-facing messages while preserving global SMS-capable mobile support.

## Implementation

- Split frontend send-code and verify-code error mapping in `PhoneVerification`.
- Suppress global `apiClient` toast for SMS send/verify calls and rely on inline field feedback.
- Map Twilio Verify `60205` to a mobile-number message and `60200` invalid `To` to the existing invalid phone message.
- Preserve existing transient rollback and rate-limit behavior.

## Verification

- `pnpm --filter @grabit/web exec vitest run components/auth/__tests__/phone-verification.test.tsx`
- `pnpm --filter @grabit/api exec vitest run src/modules/sms/sms.service.spec.ts src/modules/sms/twilio-verify-client.spec.ts src/modules/sms/phone.util.spec.ts`
