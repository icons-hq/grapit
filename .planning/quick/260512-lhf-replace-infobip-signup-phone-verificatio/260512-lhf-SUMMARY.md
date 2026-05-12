---
status: complete
quick_id: 260512-lhf
slug: replace-infobip-signup-phone-verificatio
completed: 2026-05-12
---

# Quick Task 260512-lhf Summary

Replaced Infobip runtime phone verification with Twilio Verify.

## Completed

- Added `twilio` SDK to `@grabit/api`.
- Added `TwilioVerifyClient` wrapper for `verifications.create` and `verificationChecks.create`.
- Updated `SmsService` to require `TWILIO_ACCOUNT_SID`, `TWILIO_VERIFY_SERVICE_SID`, and either `TWILIO_API_KEY_SID`/`TWILIO_API_KEY_SECRET` or fallback `TWILIO_AUTH_TOKEN` in production.
- Preserved local/test dev mock with universal `000000` code when Twilio credentials are absent outside production.
- Switched production send/check flow to Twilio Verify while keeping Grabit local cooldown/rate-limit guards and purpose-bound `phoneVerificationToken`.
- Removed Infobip client, specs, and fixtures.
- Updated deploy secrets, `.env.example`, legal privacy copy, fanmeet planning docs, web OTP timer/copy, and SMS tests.
- Added `docs/runbooks/twilio-verify-setup.md`.
- Created the Twilio Verify Service `VA653128d3890a3536e1348db98beeb180` with code length 6, Lookup enabled, SMS-to-landline skipping enabled, and SMS do-not-share warning enabled.
- Added production GCP Secret Manager versions in project `grapit-491806` for `twilio-account-sid`, `twilio-api-key-sid`, `twilio-api-key-secret`, and `twilio-verify-service-sid`.
- Updated local `.env` SMS block from Infobip keys to Twilio API key credentials without printing secret values.

## Twilio CLI Result

- `twilio --version`: `twilio-cli/6.2.4 darwin-arm64 node-v20.20.2`
- `twilio profiles:use sangwopark19@gmail.com`: active profile configured.
- `twilio api:verify:v2:services:create --friendly-name "Grabit Phone Verification" --code-length 6 --lookup-enabled --skip-sms-to-landlines --do-not-share-warning-enabled -o json`: created `VA653128d3890a3536e1348db98beeb180`.
- `twilio api:verify:v2:services:list ... -o json`: confirmed the service exists with the expected settings.
- `pnpm --filter @grabit/api exec node ...verify.v2.services(...).fetch()`: confirmed local `.env` API key credentials can fetch the production Verify Service without sending SMS.

Live OTP send/check was not executed because no user-owned test phone number was provided in this workflow.

## Real Number UAT Attempt

- Requested test recipient: user-owned Korean mobile, masked as `+82********49`.
- `verifications.create({ channel: 'sms' })` reached Twilio but failed with Twilio error `21608`: the recipient number is unverified and the current Twilio account is a Trial account.
- `outgoing-caller-ids:create --phone-number +82********49` initially returned Twilio error `10002`; a later debug-level retry created a verification call with validation code `360511`.
- After the validation code was entered on the verification call, Twilio created exact verified caller ID `PN670a044f922ebd3d3957c8ca8f97246a` for `+82********49`.
- `verifications.create({ channel: 'sms' })` then succeeded for `+82********49`, returning `VEbd701148a731a414e723fd7e7f03f925` with status `pending`.
- `verificationChecks.create(...)` with the user-provided OTP returned status `approved` and `valid: true` for `VEbd701148a731a414e723fd7e7f03f925`.
- Result: Twilio Verify real-device send/check UAT passed for the masked Korean mobile number.

## Global Delivery Update

- Removed the Grabit-side mainland China `+86` hard block from `SmsService`.
- Replaced the former China-blocking test with a regression test that proves `+8613912345678` reaches `TwilioVerifyClient.sendVerification(...)`.
- Removed the now-unused `isChinaMainland` helper and its tests.
- Updated legal privacy copy and v2.0 fanmeet planning docs from "mainland China unsupported" to "global/China users supported subject to Twilio Verify, carrier, regulatory, and fraud-prevention controls."
- Updated `docs/runbooks/twilio-verify-setup.md` with the production Geo Permissions checklist. Twilio documents these settings as Console-managed, not repository-automated.

## Verification

- `pnpm --filter @grabit/api test -- src/modules/sms/sms.service.spec.ts src/modules/sms/twilio-verify-client.spec.ts src/modules/sms/sms.controller.spec.ts src/modules/sms/sms-copy.spec.ts src/modules/sms/phone.util.spec.ts` passed.
- `pnpm --filter @grabit/web test -- legal-content phone-verification phone-input-i18n` passed.
- `pnpm --filter @grabit/api typecheck` passed.
- `pnpm --filter @grabit/web typecheck` passed.
- `pnpm --filter @grabit/api build` passed.
- `pnpm --filter @grabit/web build` passed.
- `pnpm --filter @grabit/api lint` passed with existing warnings only.
- `pnpm --filter @grabit/web lint` passed with existing warnings only.
