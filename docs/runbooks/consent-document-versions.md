# Consent Document Versions Runbook

## Purpose

Use this runbook when a legal document behind a consent row changes (terms of service, privacy policy, marketing consent), and when reading historical `consent_audit_logs` rows during an audit or dispute.

## Contract

- A consent version is the effective date printed in the document the buyer can open. `CONSENT_DOCUMENT_VERSIONS` in `packages/shared/src/schemas/consent.schema.ts` is the single source used by signup, social completion, and booking:
  - `terms`: `terms-of-service(.en).md`, `2026-04-28`
  - `privacy`, `pipa_required`: `privacy-policy(.en).md` v1.2, `2026-05-11`
  - `marketing`: `marketing-consent(.en).md`, `2026-04-28`
- The recorded `language` is the document language actually rendered. Legal documents exist only in Korean and English, so `ko` records `ko` and every other locale records `en` (`resolveConsentDocumentLanguage`).
- Booking checkout shows and records only `terms` and `privacy` (`BOOKING_CONSENT_ITEM_KEYS`). `pipa_required` is captured at signup, whose wording already covers booking processing. The API ignores a `pipa_required` row submitted with `sourceFlow=booking`.
- The API accepts a row only when `consent_items` has an active row for the same key, version, and language. A required row that names an inactive or unknown version is rejected with HTTP 400 `동의 문서가 갱신되었습니다. 페이지를 새로고침한 뒤 다시 동의해주세요.` This check runs before reservation prepare extends seat locks and before signup uses the phone verification token.
- Guard tests: `apps/web/content/legal/__tests__/consent-document-version.test.ts` fails when a document's effective date and the shared version differ; `apps/api/src/modules/consent/consent-document-seed.spec.ts` fails when a shared version has no seeded row for a supported locale.

## Bumping A Document Version

Deploy order is migrate, then API, then web, and buyers keep already-open pages after the web release. Retiring a version in the same release as the bump makes every signup, social completion, and reservation prepare from an old page fail with 400 until the buyer reloads.

1. Update the document and its effective date.
2. In the same change, bump `CONSENT_DOCUMENT_VERSIONS` for every key that opens that document, and add a migration that inserts the new version for every supported locale with `ON CONFLICT ("key", "version", "locale") DO NOTHING`. Do not update or deactivate the previous version in this migration.
3. Ship outside a ticket-opening window. Confirm the web release is live.
4. After a grace period of at least 24 hours, optionally retire the previous version with a separate migration (`UPDATE "consent_items" SET "is_active" = false ... WHERE "version" = '<old>'`) in a later release. Never delete `consent_items` rows: audit rows reference them with `ON DELETE RESTRICT`.

## Reading Historical Rows

Existing audit rows are never rewritten. Interpret them as follows:

- `privacy` and `pipa_required` rows with `item_version = '2026-04-28'` written after the web release that published privacy policy v1.2 (commit `dddfc637`, 2026-05-11 KST) were presented the v1.2 text. The web kept recording the stale label until the release that introduced `CONSENT_DOCUMENT_VERSIONS`. For rows on 2026-05-11 itself, compare `agreed_at` with that release's deploy time.
- Rows with `source_flow = 'booking'` and `item_key = 'pipa_required'` written before that release were not shown at checkout; the buyer's signup or social completion `pipa_required` row is the evidence for that consent.
- Rows with `source_flow = 'booking'` and `language` in `th` or `zh-CN` written before that release were presented the English documents.
- `privacy` or `pipa_required` rows with `2026-04-28` written after that release come from pages opened before it, which also showed v1.2. They stop once the `2026-04-28` rows are retired.

## Admin Consent Audit Query

- `GET /api/v1/admin/consent-audit` requires the admin role and the `audit.read` capability. The field scanner account (`field.scan.*` only) is denied.
- Responses are pages of at most `limit` rows (default 100, maximum 500) ordered by `agreed_at` and `id` descending, with an opaque `nextCursor` for the next older page.
- A query with no `from` and no user, email, or IP filter is limited to the last 7 days, and the response returns that start as `defaultWindowFrom`. Set `from`, or search by user, email, or IP, to read older rows.
