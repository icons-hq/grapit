# Social Account Merge Design

## Context

A buyer reported that a June 5 ticket disappeared from My Page. Production inspection showed that the reservation, payment, and active ticket item still existed, but they belonged to one social-login Buyer Account while the buyer had recently logged in through another social-login Buyer Account with the same real-world identity. My Page reads reservations by `reservations.user_id = current user.id`, so split Buyer Accounts naturally produce an empty ticket wallet.

The design has two goals:

1. Prevent new duplicate Buyer Accounts when a buyer completes social registration with identity evidence that matches exactly one active account.
2. Repair existing safe duplicate accounts with durable recovery evidence and an operator-controlled path for manually approved complex merges.

## Domain Decisions

- A Buyer Account is not the same thing as a social provider account.
- A Social Login Link proves a login route for a Buyer Account; it is not a profile replacement mechanism.
- Provider email is supporting evidence only. It is not the automatic identity match rule.
- Future social-login linking uses newly verified phone number plus birth date when exactly one active Buyer Account matches.
- Historical merge uses stricter evidence: verified phone number, birth date, and normalized name.
- Identity conflicts must not force a buyer-facing login failure at a venue. If multiple active Buyer Accounts match during future login, Grabit creates a new account instead of blocking the flow or guessing a target.
- Historical merges keep source accounts as `merged` placeholders, not as `withdrawn` accounts and not as deleted rows.
- Every production merge must preserve recovery evidence.

## Future Social Login Linking

When `completeSocialRegistration()` receives a valid social registration token and a purpose-bound verified phone token:

1. Validate the registration token, age rule, and required consents.
2. Search active Buyer Accounts by the newly verified phone number and submitted birth date.
3. If exactly one active Buyer Account matches, attach the new social provider account to that Buyer Account.
4. If zero active Buyer Accounts match, keep the current create-new-user behavior.
5. If multiple active Buyer Accounts match, do not link automatically. Continue with create-new-user behavior so the buyer is not blocked from logging in.

When linking to an existing Buyer Account:

- Do not overwrite existing `email`, `name`, `phone`, `birthDate`, `gender`, or `country`.
- Store provider email only on the Social Login Link.
- Capture the submitted terms and consent rows against the existing Buyer Account.
- Update the existing Buyer Account's marketing consent to the latest explicit selection.
- Return auth tokens for the existing Buyer Account.

Provider email conflicts must not block this path. `users.email` remains unchanged for existing accounts, so the unique email constraint is not involved in automatic social linking.

## Historical Merge Eligibility

Historical duplicate groups are detected by normalized phone digits, birth date, and normalized name. The dry-run report classifies groups into automatic safe groups and manual review groups.

Automatic Safe Merge Group eligibility:

- Every account in the group has matching verified identity evidence.
- The Merge Target Buyer Account is unambiguous.
- Exactly one account owns confirmed reservations, or if no confirmed reservations exist, exactly one account owns any reservation.
- Groups where no account owns reservations are not automatically merged because they do not address the ticket visibility incident.
- Groups where multiple accounts own reservations are not automatically merged.

Manual review groups:

- Multiple accounts own reservations.
- Multiple accounts own confirmed reservations.
- Identity evidence is incomplete or inconsistent.
- The target account cannot be determined by the automatic rule.

Manual review groups may still be merged by adding them to a Manual Merge Allowlist after operator confirmation.

## Merge Target Selection

For automatic safe groups:

1. If exactly one account owns confirmed reservations, that account is the Merge Target Buyer Account.
2. Else if exactly one account owns any reservation, that account is the Merge Target Buyer Account.
3. Else the group is not automatically merged.

For Manual Merge Allowlist entries, the operator must provide the explicit target Buyer Account and source Buyer Account list.

## Data Movement

The merge moves customer-facing ownership records to the target account and preserves historical/operator audit context where changing the actor would distort history.

Move to target:

- `reservations.user_id`
- `social_accounts.user_id`
- `terms_agreements.user_id`
- `consent_audit_logs.user_id`
- Other buyer-owned rows found during implementation that directly affect buyer access or account state

Revoke or invalidate:

- Source account `refresh_tokens`
- Source account temporary auth or verification tokens where they could re-open the source account path

Do not rewrite:

- Payment rows that are already reachable through reservation ownership
- Ticket item rows that are already reachable through reservation ownership
- Provider or webhook event rows
- Admin audit logs and operator history rows
- Field scan, seat operation, and booking operation audit rows where the user id is the historical actor

Each implementation pass must enumerate the actual current schema foreign keys before shipping the merge command. Unknown `user_id` references are blockers until classified as moved, revoked, preserved, or irrelevant.

## Source Account State

After a successful merge:

- Source Buyer Accounts remain in `users`.
- Source Buyer Accounts become `accountStatus = 'merged'`.
- Source refresh tokens are revoked.
- Source Social Login Links point to the target account, so Kakao, Naver, Google, or other linked providers all authenticate into the same target Buyer Account.
- Source accounts do not own reservations after merge.
- Source accounts are visible to operations as merged placeholders, not withdrawn users.

The implementation must update auth checks that currently reject only `withdrawn` accounts so `merged` source accounts cannot be used as active login accounts if any stale path remains.

## Operator Command

The first implementation should provide a protected operator command rather than an admin UI button.

Command modes:

- `dry-run`: scans duplicate groups and writes a report.
- `apply`: applies automatic safe groups plus any Manual Merge Allowlist entries.
- `verify`: re-checks a completed batch.

Apply mode requirements:

- Require an explicit production DB backup or snapshot reference.
- Require an allowlist file for manual groups.
- Require an operator reason.
- Print masked summaries by default.
- Avoid raw PII in normal logs.
- Write a protected JSON report containing internal IDs and row-level details for operator storage.
- Run each merge batch in a transaction.
- Assert expected row counts for every table update.
- Roll back the transaction if any expected count does not match.

The command must not merge every duplicate group by default. It may automatically apply only Safe Merge Groups and explicit Manual Merge Allowlist entries.

## Recovery Evidence

The merge stores recovery evidence in both database ledger tables and a protected JSON report.

Database ledger:

- `account_merge_batches`: batch id, operator, reason, executed at, dry-run hash, backup reference, allowlist reference, status, aggregate counts, verification summary.
- `account_merge_row_changes`: batch id, merge group id, table name, row id, source user id, target user id, before snapshot, after snapshot, row count assertion metadata.

Protected JSON report:

- Duplicate group summary.
- Source and target internal IDs.
- Table-by-table row changes.
- Verification result.
- Masked buyer-facing identity summary.
- File permissions or storage location appropriate for sensitive operational evidence.

This design is intended to support both investigation and targeted logical rollback. It does not replace a Cloud SQL backup, which remains the last-resort recovery mechanism.

## Verification

Automated tests should cover:

- Social registration links to exactly one existing active account by verified phone plus birth date.
- Social registration creates a new account when there is no match.
- Social registration creates a new account when there are multiple matches.
- Provider email conflict does not block a verified single-account match.
- Existing account profile fields are not overwritten during linking.
- Marketing consent is updated during linking.
- Dry-run classifies safe groups and manual review groups correctly.
- Apply moves allowed ownership rows to the target account.
- Apply revokes source refresh tokens.
- Apply marks source accounts as `merged`.
- Apply writes DB ledger rows and JSON report output.
- Apply rolls back on row count mismatch.
- Verification proves target My Page can see moved reservations.
- Verification proves multiple Social Login Links authenticate into the same target account.

Production verification after deploy:

1. Run production dry-run and review counts.
2. Confirm backup or snapshot reference.
3. Apply Safe Merge Groups and approved Manual Merge Allowlist.
4. Verify target account reservation visibility for sampled and incident accounts.
5. Verify provider login routes resolve to the target account.
6. Verify source accounts have no usable active refresh sessions.
7. Preserve the JSON report and DB ledger batch id in the operational record.

## Out of Scope

- Admin UI for account merge.
- Fully automatic merge of groups with multiple reservation-owning accounts.
- Ticket transfer.
- Changing provider account ownership at the external Kakao, Naver, or Google provider.
- User-facing conflict resolution UI.
- Rewriting historical admin/operator actor audit rows.
