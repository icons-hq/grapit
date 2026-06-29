# Use ledgered social account merges for duplicate buyer accounts

Grabit will repair duplicate social-login Buyer Accounts with a protected operator command, an explicit `merged` source-account state, and batch/row-level recovery records instead of deleting source accounts or treating them as withdrawn users. This keeps future venue-facing login flows from failing on ambiguous identity matches while still allowing safe historical cleanup: automatic merges are limited to Safe Merge Groups, complex groups require a Manual Merge Allowlist, and every production apply must record enough before-and-after evidence to investigate or roll back the ownership changes.

**Consequences**

- `merged` is a distinct account state from `withdrawn`.
- Source accounts remain as traceable placeholders after merge.
- Social Login Links move to the target Buyer Account so different providers authenticate into the same account.
- Reservation ownership moves to the target Buyer Account so My Page shows merged reservations.
- Production merge apply requires backup reference, row count assertions, DB ledger rows, and a protected JSON report.
- Groups with multiple reservation-owning accounts are not automatically merged unless they are explicitly allowlisted after operator review.
