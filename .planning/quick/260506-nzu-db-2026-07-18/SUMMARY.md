---
status: complete
completed: 2026-05-06
---

# Summary

Updated production `performances.description` and `performances.sales_info` for `Girl Rules FAN MEETING IN SEOUL` (`18a3bcc6-5e75-463d-abfd-634601328754`).

Verification:
- Direct Cloud SQL query confirmed non-empty detail and sales text.
- Production API `GET /api/v1/performances/18a3bcc6-5e75-463d-abfd-634601328754` returned the updated text.

Note:
- Direct Redis cache invalidation from local machine timed out, but the production API already returned the updated payload.
