---
status: planned
quick_id: 260512-lhf
slug: replace-infobip-signup-phone-verificatio
created: 2026-05-12
---

# Quick Task 260512-lhf: Replace Infobip Signup Phone Verification with Twilio Verify

## Goal

Completely replace the runtime SMS/phone verification provider from Infobip to Twilio Verify while preserving Grabit signup/profile verification contracts.

## Must Haves

- Add Twilio Verify backend client and SDK dependency.
- Update `SmsService` production credential gate from `INFOBIP_*` to `TWILIO_ACCOUNT_SID`, `TWILIO_VERIFY_SERVICE_SID`, and either `TWILIO_API_KEY_SID`/`TWILIO_API_KEY_SECRET` or fallback `TWILIO_AUTH_TOKEN`.
- Use Twilio Verify for production send/check flows; keep dev mock `000000` behavior for local/test without Twilio credentials.
- Preserve existing API response contract: `/sms/send-code` returns `SendResult`; `/sms/verify-code` returns `VerifyResult` with `verificationToken`.
- Preserve existing internal rate limits/cooldowns and phone validation behavior, while allowing mainland China `+86` numbers through to Twilio Verify.
- Remove or replace Infobip client/tests/fixtures and update remaining comments/docs/tests/legal copy/deploy secrets to Twilio.
- Use Twilio CLI for local readiness inspection, Verify Service provisioning, and production secret setup.
- Run focused backend/web tests and typecheck/build checks where feasible.

## Notes

- Current branch: `replace-infobip-with-twilio`.
- Existing dirty changes in phone country detection and phone input display are preserved and treated as user work.
- Twilio CLI is installed (`twilio-cli/6.2.4`).
- Twilio profile `sangwopark19@gmail.com` is active and uses CLI-created API key credentials.
- Production Verify Service SID: `VA653128d3890a3536e1348db98beeb180`.
