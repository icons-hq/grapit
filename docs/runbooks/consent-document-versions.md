# Consent Document Versions Runbook

## Purpose

Use this runbook when a legal document behind a consent row changes (terms of service, privacy policy, marketing consent), and when reading historical `consent_audit_logs` rows during an audit or dispute.

## Contract

- A consent version is the effective date printed in the document the buyer can open. `CONSENT_DOCUMENT_VERSIONS` in `packages/shared/src/schemas/consent.schema.ts` is the single source used by signup, social completion, and booking:
  - `terms`: `terms-of-service(.en).md`, `2026-04-28`
  - `privacy`, `pipa_required`: `privacy-policy(.en).md` v1.2, `2026-05-11`
  - `marketing`: `marketing-consent(.en).md`, `2026-04-28`
- Versions are per key. Several keys can share the same date: `2026-04-28` is still the current `terms` and `marketing` version while it is the superseded `privacy` and `pipa_required` version. Every statement that changes `consent_items` must filter by `key` as well as `version`.
- The recorded `language` is the document language actually rendered. Legal documents exist only in Korean and English, so `ko` records `ko` and every other locale records `en` (`resolveConsentDocumentLanguage`).
- Booking checkout shows and records only `terms` and `privacy` (`BOOKING_CONSENT_ITEM_KEYS`). `pipa_required` is captured at signup, whose wording already covers booking processing. The API ignores a `pipa_required` row submitted with `sourceFlow=booking`.
- The API accepts a row only when `consent_items` has an active row for the same key, version, and language. A required row that names an inactive or unknown version is rejected with HTTP 400 `동의 문서가 갱신되었습니다. 페이지를 새로고침한 뒤 다시 동의해주세요.` This check runs before reservation prepare extends seat locks and before signup uses the phone verification token.
- Guard tests:
  - `apps/web/content/legal/__tests__/consent-document-version.test.ts` fails when a document's effective date and the shared version differ, and when a document's text changes without a version bump (text fingerprint per version).
  - `apps/api/src/modules/consent/consent-document-seed.spec.ts` replays every journal migration's `consent_items` writes and fails when a current shared version has no active row for a supported locale. It also replays the retirement SQL below.

### Accounts Without Signup PIPA Evidence

Booking no longer records `pipa_required`, so an account whose signup or social completion predates consent capture has no `pipa_required` evidence at all. Before this change such accounts got an inaccurate booking `pipa_required` row instead. This is a product and legal decision, not a code default. To size it (read-only):

```sql
SELECT count(*)
FROM "users" AS "u"
WHERE "u"."account_status" = 'active'
  AND NOT EXISTS (
    SELECT 1
    FROM "consent_audit_logs" AS "c"
    WHERE "c"."user_id" = "u"."id"
      AND "c"."item_key" = 'pipa_required'
      AND "c"."agreed" = true
      AND "c"."source_flow" IN ('signup', 'social_completion')
  );
```

If the count matters, the follow-up is to show the `pipa_required` checkbox at checkout only for those accounts and record it with `sourceFlow=booking` (this needs an API change, since booking currently ignores that row).

## Bumping A Document Version

Deploy order is migrate, then API, then web, and buyers keep already-open pages after the web release. Retiring a version in the same release as the bump makes every signup, social completion, and reservation prepare from an old page fail with 400 until the buyer reloads.

1. Update the document and its effective date, then update the text fingerprint in `consent-document-version.test.ts`.
2. In the same change, bump `CONSENT_DOCUMENT_VERSIONS` for every key that opens that document, and add a migration that inserts the new version for every supported locale with `ON CONFLICT ("key", "version", "locale") DO NOTHING`. Do not update or deactivate the previous version in this migration.
3. Ship outside a ticket-opening window. Confirm the web release is live.
4. After a grace period of at least 24 hours, optionally retire the previous version with a separate migration in a later release, also outside a ticket-opening window. Filter by the bumped keys and the old version together:

   ```sql
   UPDATE "consent_items"
   SET "is_active" = false, "updated_at" = now()
   WHERE "key" IN ('<bumped key>', '<bumped key>')
     AND "version" = '<old version>';
   ```

   Never filter by `version` alone: another key can still use that date as its current version, and retiring it fails every signup and reservation prepare. Never delete `consent_items` rows: audit rows reference them with `ON DELETE RESTRICT`.

For the privacy policy v1.2 transition, the retirement statement is exactly this (the seed guard test replays it):

```sql
-- consent-version-retire: privacy policy v1.2 transition (privacy, pipa_required 2026-04-28)
UPDATE "consent_items"
SET "is_active" = false, "updated_at" = now()
WHERE "key" IN ('privacy', 'pipa_required')
  AND "version" = '2026-04-28';
```

`terms` and `marketing` stay on `2026-04-28` and must remain active.

## Rollback

- The release that introduced `CONSENT_DOCUMENT_VERSIONS` changed the booking payload: the new web sends only `terms` and `privacy`. An API revision from before that release requires `pipa_required` for booking too, so rolling back only the API while the new web is live fails every reservation prepare with 400. Roll back the web first, or both together.
- Rolling back only the web (or the web first) is safe only while the `privacy` and `pipa_required` `2026-04-28` rows are still active, that is, before the retirement migration above. A web build from before `CONSENT_DOCUMENT_VERSIONS` sends `2026-04-28` for those keys, so after the retirement every signup, social completion and reservation prepare from it fails with 400. After the retirement, do not roll the web back past the release that introduced `CONSENT_DOCUMENT_VERSIONS`; if that is unavoidable, first reactivate exactly those rows (key and version together), then roll back:

  ```sql
  UPDATE "consent_items"
  SET "is_active" = true, "updated_at" = now()
  WHERE "key" IN ('privacy', 'pipa_required')
    AND "version" = '2026-04-28';
  ```

- These conditions assume the booking payload of the current web: `consentItems` with exactly `terms` and `privacy`, each at its `CONSENT_DOCUMENT_VERSIONS` value, in the document language of the page (`ko`, otherwise `en`). `apps/web/e2e/booking-checkout-consent.spec.ts` checks it in a browser (ko and en, desktop and 375px): the documents the checkout opens show those versions, and `POST /reservations/prepare` carries them. Run it against the build before relying on these conditions.
- Seat selection does not block a web rollback: it stays safe through the seat-update compatibility event from booking-web-4.
- Do not roll back a consent seed migration. Its rows are additive, the previous version stays active, and audit rows may already reference the new rows.

## Reading Historical Rows

Existing audit rows are never rewritten. Interpret them as follows:

- `privacy` and `pipa_required` rows with `item_version = '2026-04-28'` written after the web release that published privacy policy v1.2 (commit `dddfc637`, 2026-05-11 KST) were presented a v1.2 text. The web kept recording the stale label until the release that introduced `CONSENT_DOCUMENT_VERSIONS`. For rows on 2026-05-11 itself, compare `agreed_at` with that release's deploy time.
- Privacy policy v1.2 has two texts under the same `2026-05-11` effective date. Commit `37b23f2a` (2026-05-12 KST) changed the SMS processor from Infobip to Twilio, the transfer country from Germany to the United States, and the overseas and mainland China user notices without changing the version. To tell which text a `privacy` or `pipa_required` row (labelled `2026-04-28` or `2026-05-11`) was shown, compare `agreed_at` with that release's deploy time.
- Rows with `source_flow = 'booking'` and `item_key = 'pipa_required'` written before that release were not shown at checkout; the buyer's signup or social completion `pipa_required` row is the evidence for that consent.
- Rows with `source_flow = 'booking'` and `language` in `th` or `zh-CN` written before that release were presented the English documents.
- `privacy` or `pipa_required` rows with `2026-04-28` written after that release come from pages opened before it, which also showed v1.2. They stop once the `2026-04-28` rows are retired.

## Admin Consent Audit Query

- `GET /api/v1/admin/consent-audit` requires the admin role and the `audit.read` capability. The field scanner account (`field.scan.*` only) is denied.
- The `email` filter is case-insensitive: the query is lower-cased and compared with `lower(users.email)`, so `Fan@Example.com` finds the account stored as `fan@example.com` (and legacy rows kept as typed).
- Responses are pages of at most `limit` rows (default 100, maximum 500) ordered by `agreed_at` and `id` descending, with an opaque `nextCursor` for the next older page.
- A query with no `from` and no user, email, or IP filter is limited to the 7 days ending at `to`, or at the current time when `to` is not set. The response returns that start as `defaultWindowFrom`, and the cursor carries it, so every page of one query uses the same window. Set `from`, or search by user, email, or IP, to read older rows.
