# Twilio Verify Setup

Grabit uses Twilio Verify for signup, social registration, and profile phone-change OTP.

## Local CLI Check

Twilio CLI is installed locally:

```bash
twilio --version
```

Confirm the active Twilio profile:

```bash
twilio profiles:list
```

Configure a profile before creating production resources:

```bash
twilio login
```

The current production setup uses the API key created by `twilio login`, not the account Auth Token.

## Create Verify Service

Create one Verify Service and reuse its `VA...` Service SID:

```bash
twilio api:verify:v2:services:create \
  --friendly-name "Grabit Phone Verification" \
  --code-length 6 \
  --lookup-enabled \
  --skip-sms-to-landlines \
  --do-not-share-warning-enabled \
  -o json
```

Store the returned `sid` as `TWILIO_VERIFY_SERVICE_SID`.

Current production service:

```bash
TWILIO_VERIFY_SERVICE_SID=VA653128d3890a3536e1348db98beeb180
```

The service was created with code length 6, Lookup enabled, SMS-to-landline skipping enabled, and the SMS do-not-share warning enabled.

## Required Secrets

Local `.env` and Cloud Run Secret Manager must provide:

```bash
TWILIO_ACCOUNT_SID=AC...
TWILIO_API_KEY_SID=SK...
TWILIO_API_KEY_SECRET=...
TWILIO_VERIFY_SERVICE_SID=VA...
```

`TWILIO_AUTH_TOKEN` is supported as a fallback, but production should prefer API keys because they can be rotated independently.

Optional:

```bash
TWILIO_VERIFY_LOCALE=ko
```

Leave `TWILIO_VERIFY_LOCALE` empty to let Twilio choose the SMS language from the phone number country.

## Global Delivery Configuration

Grabit intends to accept valid E.164 mobile numbers globally, including mainland China `+86`, as long as Twilio Verify and the destination carrier can deliver the OTP.

Twilio settings that must be checked before production launch:

1. Upgrade the Twilio account out of Trial mode. Trial accounts can only send Verify OTPs to verified recipient numbers.
2. Open Twilio Console > Verify > Settings > Geo permissions.
3. For launch countries, set SMS to `Monitor all traffic for blocking fraud` or `Allow all traffic`.
4. For a truly global launch, apply the same permission setting by continent/batch where available, then review high-risk country warnings in Console.
5. Keep Fraud Guard enabled unless a country-specific delivery incident proves it is blocking legitimate traffic.

Notes:

- Twilio documents Verify Geo Permissions as Console-managed settings. Geo Permission changes cannot be safely automated through this repository.
- Twilio's Verify deliverability documentation says Verify supports Twilio Messaging-supported countries plus China, but some countries require extra review, templates, or carrier-specific handling.
- For China, review Twilio's China template requirements before launch traffic. Code support alone does not guarantee China carrier delivery.
- When a country fails in production, check Twilio Verify Logs for `60605`/Geo Permission blocks, Fraud Guard blocks, carrier delivery failures, and template/compliance requirements.

## Production Secret Manager Names

GitHub Actions deploy expects these Secret Manager entries:

```bash
twilio-account-sid
twilio-api-key-sid
twilio-api-key-secret
twilio-verify-service-sid
```

Example:

```bash
printf '%s' "$TWILIO_ACCOUNT_SID" | gcloud secrets versions add twilio-account-sid --data-file=-
printf '%s' "$TWILIO_API_KEY_SID" | gcloud secrets versions add twilio-api-key-sid --data-file=-
printf '%s' "$TWILIO_API_KEY_SECRET" | gcloud secrets versions add twilio-api-key-secret --data-file=-
printf '%s' "$TWILIO_VERIFY_SERVICE_SID" | gcloud secrets versions add twilio-verify-service-sid --data-file=-
```

The four `twilio-*` Secret Manager entries above exist in project `grapit-491806`.

## Verification Contract

- `/api/v1/sms/send-code` starts a Twilio Verify SMS verification.
- `/api/v1/sms/verify-code` checks the submitted code through Twilio Verify.
- After Twilio returns `approved`, Grabit issues its own purpose-bound `phoneVerificationToken`.
- Local/test environments without Twilio credentials keep the `000000` dev mock.
- The UI timer follows Twilio Verify's default 10-minute verification window.
