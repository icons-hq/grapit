# Social Account Merge Runbook

## Purpose

Use this runbook to dry-run, apply, and verify duplicate Buyer Account merges after the social account merge code is deployed.

## Safety Requirements

- Confirm the target environment before every command. Every mode prints the `DATABASE_URL` target to stderr as `databaseTarget` (`host:port/database`, user, no password) and the server-side identity as `databaseServer`. The `databaseServer.fingerprint` is `sysid:<cluster system identifier>/<database>` (or `addr:<server address>:<port>/<database>` when the role cannot read `pg_control_system()`). Behind a local `cloud-sql-proxy` the `databaseTarget` is always `127.0.0.1:<port>/...` whichever instance the proxy forwards to, so check the fingerprint against the value recorded for that environment in the protected operator notes. Apply refuses to run unless `--expected-db` equals the `host:port/database` value and `--expected-server` equals the fingerprint.
- Confirm a current Cloud SQL backup or snapshot reference.
- Keep generated JSON reports in a protected operator location.
- Do not paste raw report contents into chat, GitHub comments, public logs, or customer-facing surfaces.
- Apply mode is limited to Safe Merge Groups plus Manual Merge Allowlist entries.
- Apply mode requires the reviewed `dryRunHash` from the immediately preceding dry-run.
- The reviewed `dryRunHash` covers the duplicate classification only. Manual allowlist contents are checked against the reviewed `allowlistHash`, which apply requires as `--allowlist-hash`. Editing the allowlist after review (for example changing `targetUserId`) makes apply fail.
- Do not apply during a ticket opening or while a sale is about to open. Merging moves Reservation ownership and signs the source accounts out, so a buyer in the middle of seat selection loses that session; their seat holds expire with the hold TTL.
- Apply checks live checkouts (`PENDING_PAYMENT` inside its payment window, plus Alipay-family payments that failed within the last hour) and published upcoming showtimes whose booking opened within the last 2 hours or opens within 24 hours. Performances that are simply on sale do not count. If any of these exist, apply stops with `ACCOUNT_MERGE_ACTIVE_SALES_CONFIRMATION_REQUIRED` unless `--allow-active-sales` is passed. Pass it only after confirming that no opening is in progress and traffic is low.
- Groups with a payment in flight are not merged. Dry-run classifies a group `payment_in_flight` when any account in it, source or target, owns a reservation whose payment can still change state (see below). The group stays in the manual review list, outside the batch, and the other groups merge normally. Re-run the dry-run later to pick it up.
- Inside the apply transaction the same check runs again under row locks as a race guard. If a checkout starts for a batch group after its dry-run, apply normally fails earlier with `ACCOUNT_MERGE_DRY_RUN_HASH_MISMATCH`; in the narrow window after that check it fails with `ACCOUNT_MERGE_GROUP_REVALIDATION_FAILED:payment_in_flight:target=<targetUserId>`. Either way nothing is written. Run a new dry-run; the group then shows as `payment_in_flight`.
- Manual allowlist entries cannot merge groups classified `identity_evidence_incomplete` (an account without a verified phone) or `payment_in_flight`. Dry-run with `--allowlist` and apply reject them with `ACCOUNT_MERGE_ALLOWLIST_IDENTITY_EVIDENCE_INCOMPLETE:target=<id>` or `ACCOUNT_MERGE_ALLOWLIST_PAYMENT_IN_FLIGHT:target=<id>` before any write. Remove the entry and record the new allowlist hash; the dry-run hash stays valid.

## Payment In Flight

A reservation counts as a payment in flight when it is:

- `PENDING_PAYMENT` and still inside its payment deadline, or changed within the last 24 hours. This covers checkouts the expiration sweeper never expires: rows without a deadline, and checkouts whose provider outcome is unknown.
- `PENDING_PAYMENT` with a provider payment in `READY`, `IN_PROGRESS`, `DONE` or `PARTIAL_CANCELED`, at any age. The buyer was or will be charged, so the reservation has to be confirmed or compensated before its owner changes.
- `FAILED` with an Alipay-family payment (checkout provider or payment provider `ALIPAY`/`ALIPAY_PLUS`) changed within the last 24 hours. A late `DONE` webhook can still revive it to `CONFIRMED`.

Any other `PENDING_PAYMENT` or `FAILED` row is stale. It does not block its group and moves to the target like any other unconfirmed reservation. Because these rules depend on the current time, a group can change classification between a dry-run and apply; apply then fails with `ACCOUNT_MERGE_DRY_RUN_HASH_MISMATCH` and needs a new dry-run.

If a group stays `payment_in_flight` across several dry-runs, look up the account's reservations in the admin booking tools. A paid-but-unconfirmed reservation needs the payment confirmed or refunded through the normal payment operations first. A late Alipay `DONE` that arrives more than 24 hours after the failure, after the merge, is processed against the target account and its ticket limit.

## Dry Run

```bash
corepack pnpm@10.28.1 --filter @grabit/api build
corepack pnpm@10.28.1 --filter @grabit/api account-merge -- dry-run --report /secure/account-merge-dry-run.json
```

Record the printed `dryRunHash`, `databaseTarget` and `databaseServer` fingerprint, and confirm the fingerprint is the intended environment. The hash is stable across report generation time and allowlist file changes, but it changes when the current duplicate classification changes. Do not continue to apply if the dry-run report was not reviewed.

## Manual Allowlist

Create a JSON array:

```json
[
  {
    "groupKey": "821012345678|1995-05-15|hong",
    "targetUserId": "00000000-0000-4000-8000-000000000001",
    "sourceUserIds": ["00000000-0000-4000-8000-000000000002"],
    "reason": "operator verified both reservation owners belong to the same buyer"
  }
]
```

Use an empty array when no manual groups are approved:

```json
[]
```

Validate the reviewed allowlist and record its hash:

```bash
corepack pnpm@10.28.1 --filter @grabit/api account-merge -- dry-run \
  --report /secure/account-merge-dry-run.json \
  --allowlist /secure/account-merge-allowlist.json
```

The output adds `allowlistHash`. Record it with the review. The command exits non-zero if an entry can never be applied.

## Apply

```bash
corepack pnpm@10.28.1 --filter @grabit/api account-merge -- apply \
  --report /secure/account-merge-apply.json \
  --allowlist /secure/account-merge-allowlist.json \
  --allowlist-hash <reviewed-allowlist-hash> \
  --expected-db <databaseTarget host:port/database from dry-run> \
  --expected-server <databaseServer fingerprint from dry-run> \
  --backup-reference cloudsql-backup-20260629 \
  --operator-user-id 00000000-0000-4000-8000-000000000099 \
  --reason "approved duplicate buyer account merge after dry-run review" \
  --dry-run-hash <reviewed-dry-run-hash>
```

Apply checks that the report path is writable before the merge transaction starts. If the current database state no longer matches the reviewed dry-run hash, apply fails. Run a new dry-run and review again before retrying.

After the transaction commits, apply prints the `batchId` to stderr, then runs verify and saves the result to the ledger batch (`verified` or `failed`). The protected apply report contains the database target and server fingerprint, sales-activity snapshot, reviewed dry-run, allowlist hash, apply result, minimized row-change snapshots, ticket-limit warnings, and verification summary. Apply exits non-zero when verification fails. In that case the merge is committed: investigate with the report and the ledger, and do not re-run apply. If verify itself errors after the commit (for example a dropped connection), apply still writes the report with `verification: null` and `verifyError`, prints `stage: verify_failed`, and exits non-zero; the batch stays `applied` until `verify --batch-id` succeeds.

`ticketLimitWarnings` lists merge targets whose own account now holds more active tickets for a performance than its per-buyer limit. The warning counts one account. The purchase limit itself is enforced per verified phone number: it already adds up every account that verified the same number (`database/ticket-limit.ts`), so merging those accounts does not change what the buyer may still buy. The merge keeps every purchase. Decide follow-up (for example, contacting the buyer) under the sales policy.

## Verify

```bash
corepack pnpm@10.28.1 --filter @grabit/api account-merge -- verify \
  --batch-id 00000000-0000-4000-8000-000000000123 \
  --report /secure/account-merge-verify.json
```

Verify writes the verification summary back to the ledger batch. If any check fails, the command still writes the protected report but exits non-zero. Use it to re-check a batch later or when apply stopped after the commit.

## Success Criteria

- Source accounts own no reservations.
- Source accounts own no social login links.
- Source accounts have no active refresh tokens.
- Source accounts have no pending email verification tokens.
- Target accounts own the moved reservations.
- Kakao, Naver, Google, or other moved provider links resolve to the target account.
- Source accounts are marked `merged`, not `withdrawn` and not deleted.
- DB ledger contains the batch and row changes, and the batch status is `verified`.
- DB ledger row snapshots contain only fields needed for verification, not raw token hashes or unneeded contact/provider values.
- Protected JSON reports are preserved in the operator evidence location.
