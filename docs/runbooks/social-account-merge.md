# Social Account Merge Runbook

## Purpose

Use this runbook to dry-run, apply, and verify duplicate Buyer Account merges after the social account merge code is deployed.

## Safety Requirements

- Confirm the target environment before every command.
- Confirm a current Cloud SQL backup or snapshot reference.
- Keep generated JSON reports in a protected operator location.
- Do not paste raw report contents into chat, GitHub comments, public logs, or customer-facing surfaces.
- Apply mode is limited to Safe Merge Groups plus Manual Merge Allowlist entries.
- Apply mode requires the reviewed `dryRunHash` from the immediately preceding dry-run.

## Dry Run

```bash
corepack pnpm@10.28.1 --filter @grabit/api build
corepack pnpm@10.28.1 --filter @grabit/api account-merge -- dry-run --report /secure/account-merge-dry-run.json
```

Record the printed `dryRunHash`. Do not continue to apply if the dry-run report was not reviewed.

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

## Apply

```bash
corepack pnpm@10.28.1 --filter @grabit/api account-merge -- apply \
  --report /secure/account-merge-apply.json \
  --allowlist /secure/account-merge-allowlist.json \
  --backup-reference cloudsql-backup-20260629 \
  --operator-user-id 00000000-0000-4000-8000-000000000099 \
  --reason "approved duplicate buyer account merge after dry-run review" \
  --dry-run-hash <reviewed-dry-run-hash>
```

If the current database state no longer matches the reviewed dry-run hash, apply fails. Run a new dry-run and review again before retrying.

## Verify

```bash
corepack pnpm@10.28.1 --filter @grabit/api account-merge -- verify \
  --batch-id 00000000-0000-4000-8000-000000000123 \
  --report /secure/account-merge-verify.json
```

## Success Criteria

- Source accounts own no reservations.
- Source accounts own no social login links.
- Source accounts have no active refresh tokens.
- Target accounts own the moved reservations.
- Kakao, Naver, Google, or other moved provider links resolve to the target account.
- Source accounts are marked `merged`, not `withdrawn` and not deleted.
- DB ledger contains the batch and row changes.
- Protected JSON reports are preserved in the operator evidence location.
