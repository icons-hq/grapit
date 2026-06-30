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
- The reviewed `dryRunHash` covers the duplicate classification only. Manual allowlist contents are checked separately during apply.

## Dry Run

```bash
corepack pnpm@10.28.1 --filter @grabit/api build
corepack pnpm@10.28.1 --filter @grabit/api account-merge -- dry-run --report /secure/account-merge-dry-run.json
```

Record the printed `dryRunHash`. It is stable across report generation time and allowlist file changes, but it changes when the current duplicate classification changes. Do not continue to apply if the dry-run report was not reviewed.

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

If the current database state no longer matches the reviewed dry-run hash, apply fails. Run a new dry-run and review again before retrying. The protected apply report contains the reviewed dry-run, allowlist hash, apply result, minimized row-change snapshots, and verification summary.

## Verify

```bash
corepack pnpm@10.28.1 --filter @grabit/api account-merge -- verify \
  --batch-id 00000000-0000-4000-8000-000000000123 \
  --report /secure/account-merge-verify.json
```

Verify writes the verification summary back to the ledger batch. If any check fails, the command still writes the protected report but exits non-zero.

## Success Criteria

- Source accounts own no reservations.
- Source accounts own no social login links.
- Source accounts have no active refresh tokens.
- Source accounts have no pending email verification tokens.
- Target accounts own the moved reservations.
- Kakao, Naver, Google, or other moved provider links resolve to the target account.
- Source accounts are marked `merged`, not `withdrawn` and not deleted.
- DB ledger contains the batch and row changes.
- DB ledger row snapshots contain only fields needed for verification, not raw token hashes or unneeded contact/provider values.
- Protected JSON reports are preserved in the operator evidence location.
