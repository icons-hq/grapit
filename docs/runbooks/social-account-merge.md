# Social Account Merge Runbook

## Purpose

Use this runbook to dry-run, apply, and verify duplicate Buyer Account merges after the social account merge code is deployed.

## Safety Requirements

- Confirm the target environment before every command. Every mode prints the `DATABASE_URL` target to stderr as `databaseTarget` (`host:port/database`, user, no password). Apply refuses to run unless `--expected-db` equals that `host:port/database` value.
- Confirm a current Cloud SQL backup or snapshot reference.
- Keep generated JSON reports in a protected operator location.
- Do not paste raw report contents into chat, GitHub comments, public logs, or customer-facing surfaces.
- Apply mode is limited to Safe Merge Groups plus Manual Merge Allowlist entries.
- Apply mode requires the reviewed `dryRunHash` from the immediately preceding dry-run.
- The reviewed `dryRunHash` covers the duplicate classification only. Manual allowlist contents are checked against the reviewed `allowlistHash`, which apply requires as `--allowlist-hash`. Editing the allowlist after review (for example changing `targetUserId`) makes apply fail.
- Do not apply during a ticket opening or while a sale is about to open. Merging moves Reservation ownership and signs the source accounts out, so a buyer in the middle of seat selection loses that session; their seat holds expire with the hold TTL.
- Apply checks recent checkouts (`PENDING_PAYMENT`) and published showtimes that are on sale or open within 24 hours. If any exist, apply stops with `ACCOUNT_MERGE_ACTIVE_SALES_CONFIRMATION_REQUIRED` unless `--allow-active-sales` is passed. Pass it only after confirming that no opening is in progress and traffic is low.
- Inside the apply transaction, any group whose source or target still owns a `PENDING_PAYMENT` reservation aborts the whole batch with `ACCOUNT_MERGE_GROUP_REVALIDATION_FAILED:pending_payment`. Wait for that payment to be confirmed or expire, then run a new dry-run.
- Manual allowlist entries cannot merge groups classified `identity_evidence_incomplete` (an account without a verified phone) or `source_pending_payment_reservation`. Dry-run with `--allowlist` and apply reject them with `ACCOUNT_MERGE_ALLOWLIST_IDENTITY_EVIDENCE_INCOMPLETE` or `ACCOUNT_MERGE_ALLOWLIST_PENDING_PAYMENT` before any write. Remove the entry and record the new allowlist hash; the dry-run hash stays valid.

## Dry Run

```bash
corepack pnpm@10.28.1 --filter @grabit/api build
corepack pnpm@10.28.1 --filter @grabit/api account-merge -- dry-run --report /secure/account-merge-dry-run.json
```

Record the printed `dryRunHash` and `databaseTarget`. The hash is stable across report generation time and allowlist file changes, but it changes when the current duplicate classification changes. Do not continue to apply if the dry-run report was not reviewed.

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
  --backup-reference cloudsql-backup-20260629 \
  --operator-user-id 00000000-0000-4000-8000-000000000099 \
  --reason "approved duplicate buyer account merge after dry-run review" \
  --dry-run-hash <reviewed-dry-run-hash>
```

Apply checks that the report path is writable before the merge transaction starts. If the current database state no longer matches the reviewed dry-run hash, apply fails. Run a new dry-run and review again before retrying.

After the transaction commits, apply prints the `batchId` to stderr, then runs verify and saves the result to the ledger batch (`verified` or `failed`). The protected apply report contains the database target, sales-activity snapshot, reviewed dry-run, allowlist hash, apply result, minimized row-change snapshots, ticket-limit warnings, and verification summary. Apply exits non-zero when verification fails. In that case the merge is committed: investigate with the report and the ledger, and do not re-run apply.

`ticketLimitWarnings` lists merge targets that now hold more active tickets for a performance than its per-buyer limit. The merge keeps every purchase. Decide follow-up (for example, contacting the buyer) under the sales policy.

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
