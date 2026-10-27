# Bounded 600-seat release — 2026-10-27

This release contains queue capacity/FIFO correctness, the payment receipt and QR query optimizations, and bounded deployment settings. It does not include the separate storefront redesign or new schema migrations. Baseline: `b45352acafaf6902934a8f7e6fd0b237ece2de0f`.

## Initial local configuration

Keep API 1 vCPU/512 MiB, Web 1 vCPU/1 GiB and the existing SQL tier. Use at most two API instances, application pool two, producer pg-boss pool one, and 200 active admissions per performance; other customers wait. Request concurrency is 1000 to allow waiting WebSockets alongside HTTP. Node old-space is capped at 256 MiB. A single bounded background worker retains its pool two plus pg-boss pool three. With reserve five, the steady-state connection budget is 16. Revision overlap and extra worker executions must be counted separately.

The queue scripts assign monotonic order atomically within each performance hash slot. Direct entry and reconciliation both enforce the configured active cap; ETA uses it too. Old and new writers must not coexist during an active queue. Perform the rollout behind the existing booking gate after queue/payment activity drains.

Socket.IO rejects unauthenticated Engine.IO handshakes before upgrading, even when the client never joins a namespace. Login/refresh issues a Secure, HttpOnly, SameSite=None access cookie scoped to `/socket.io/`; tooling may use a Bearer access token. Browser origins must match `FRONTEND_URL`. Each process allows four transports per signed account and 850 in total (including pending handshakes), leaving HTTP capacity within concurrency 1000. Slots are released on close; connections expire with the access token and reconnect using the refreshed cookie. Transactional HTTP authorization remains unchanged. This does not certify resistance to volumetric network attacks or possession of many valid accounts.

Payment confirmation keeps the per-order lease, per-user advisory limit lock, provider result validation and transactional seat/payment/ticket-item writes. The receipt read issues or heals QR credentials once; standalone finalization retains immediate QR issuance. Prepared parameterized reads reuse SQL structure without caching customer data. Missing QR credentials are re-read in a new statement after the reservation lock, preserving PostgreSQL READ COMMITTED visibility during competing issue/cancel operations.

## Cloud operating profile

The follow-up cloud profile retains API 1 vCPU/512 MiB, Web 1 vCPU/1 GiB, the micro DB tier and the 200-admission limit. It raises only the API application connection limit from two to five. `WORKER_DB_POOL_MAX=2` keeps the worker at two application connections plus three pg-boss connections; the API producer uses one pg-boss connection. With two API instances and reserve five, the budget is `2 × (5 + 1) + (2 + 3) + 5 = 22`, equal to the measured ordinary-connection ceiling. This is a steady-state budget and does not permit an overlapping full rehearsal or a second full revision.

Treat paced traffic and synchronized confirmation bursts as distinct workloads. The 200-admission cap is retained for seat-selection/checkout capacity; it does not certify a two-second response for 200 simultaneous confirmations. Cloud evidence below records target misses as well as completed purchases. Actual provider charges, refunds, customer login and cold-start performance are separate checks.

## Synthetic local verification

[Raw local result](girl-rules-600-capacity-2026-10-27/local-capacity.json): two API processes, pool two, admission 200, 600 finite seats, 300 ms simulated provider, heap 256 MiB. This is synthetic data only.

| Arrivals | Confirm p95 | Maximum observed API RSS | Confirmed / sold / ticket items / QR |
| --- | ---: | ---: | --- |
| 600 | 937 ms | 283 MiB | 600 each |
| 1000 | 1000 ms | 305 MiB | 600 each |
| 1500 | 871 ms | 350 MiB | 600 each |

Every waiting actor holds a queue socket (400/800/1300 initially), with all 400 subsequent admission notifications delivered per wave. One hundred booking sockets receive all 60,000 expected seat notifications per wave with no duplicates. Duplicate confirmation retries converge on the same reservation. Active admission never exceeds 200. Disposable Postgres/Valkey interruption and recovery pass. Human selection/payment time is compressed, so the run duration is not a sellout-time forecast.

API unit tests: 2672 passed. API database/Valkey integration tests: 406 passed. Typecheck passed. The local test uses macOS/Node24 and does not certify Cloud Run CPU/cgroup, Cloud SQL micro performance or actual provider latency. The actual-cloud rehearsal is recorded below; the local result alone makes no production capacity claim.

The local measurements above precede the transport-authentication follow-up. The harness now sends authenticated socket handshakes; the cloud measurements below use that final application source. The transport regression suite uses a real Engine.IO server to check anonymous/forged/expired access rejection, browser origin and cookie handling, concurrent account/total limits, and slot reuse after disconnect.

Queue and seat sockets share the existing deduplicated refresh path on connection failure, with a 20-second refresh cooldown. A later successful HTTP refresh also reconnects a stopped socket. Recovery preserves the session on transient failures and ignores late responses after logout, account replacement or screen disposal. This is necessary because public seat-status polling alone does not renew access tokens.

## Actual-cloud verification

[Cloud measurements](girl-rules-600-capacity-2026-10-27/cloud-verification.json) use the deployed API application image from `05a4f0a2dfc299883336a9c55ca4d2c2dc7c790e`, two private Cloud Run instances at 1 vCPU/512 MiB, the existing physical micro SQL instance with a separate synthetic database, and the unbound HA Valkey replacement. API pool is five, producer pool one, active admission 200, concurrency 1000 and heap 256 MiB. Final measurements disable profiling and give every synthetic actor a distinct verified-phone identity. Production never loads the provider stub.

The paced scenario sends confirmation requests one second apart within each 200-buyer cohort. Seat locks and reservation preparation still arrive as a synchronized cohort, so their burst latency remains visible. Warm-up, all waiting queue sockets and 100 booking observers are included. This is a defined synthetic traffic model, not an actual customer sale or a prediction of human checkout time.

| Visitors | Confirmation pattern | Confirm p95 | Confirmed / sold / items / QR | Interpretation |
| --- | --- | ---: | --- | --- |
| 1,000 | One request/second, all 600 seats | 574 ms | 600 each | Confirm target and integrity pass; other burst latency targets do not all pass. |
| 1,500 | One request/second, all 600 seats | 5,587 ms | 600 each | Confirm target and full finite-queue invariant fail; no oversell or unexpected request errors. |
| 1,000 | 200 simultaneous confirmations | 9,527 ms | 200 each | One-cohort diagnostic; the two-second burst target fails. |
| 1,500 | 200 simultaneous confirmations | 7,497 ms | 200 each | One-cohort diagnostic; the two-second burst target fails. |

The synchronized diagnostics had no unexpected request errors, stayed within 200 active admissions, and recorded two API processes. They intentionally stop after one cohort, so they do not satisfy the full 600-sale assertions. The 1,000-visitor paced run completed in 651.7 seconds with no unexpected request errors, 400 subsequent admission events and all 60,000 expected seat notifications, without duplicates. Its maximum observed API RSS was 217 MiB. Queue entry p95 was 6,391 ms, reservation preparation 4,050 ms and seat lock 2,357 ms. A fast paced confirmation result must not be described as an overall two-second API SLO.

The 1,500-visitor paced run completed in 668.1 seconds, with all 600 orders, sold seats, Ticket Items and QR credentials and no unexpected request errors. Its confirm median was 488 ms but p95 was 5,587 ms, so the two-second confirmation target fails at this workload. Peak admission stayed at 200 and maximum observed API RSS was 228 MiB. All 60,000 seat notifications arrived without duplicates. Queue entry p95 was 7,702 ms, preparation 4,733 ms and seat lock 2,362 ms.

This run received 401 subsequent admission events instead of 400. A separate read-only audit found one still-admitted visitor and 899 waiting visitors after the 600 seats sold. Therefore the full finite-queue assertion is **not passed**. Admission must not be represented as a guaranteed seat: the observed sellout boundary allowed one additional visitor into the booking stage without any oversell. The cap remains 200, and this limitation remains explicit rather than changing the measured result to a pass.

The available evidence supports a sub-two-second paced confirmation result for the stated 1,000-visitor model. It does not support that claim for 1,500 visitors or for synchronized groups of 200 confirmations. The warm-API resource profile was read back from GCP during the test: two instances at 1 vCPU/512 MiB, application pool five, admission 200, and the unchanged `db-f1-micro`/10 GiB SQL instance. This is a bounded operating profile with documented limits, not a general capacity certification.

### Sellout admission correction

The extra-admission observation above is the pre-fix baseline. A one-seat, two-buyer regression reproduced it on both one and two API instances: a completed purchase returned its active slot while the shared two-second remaining-seat cache still said one seat was available. Deleting that cache alone fixed the basic case but not two controlled interleavings: a SQL sold-count read followed by Redis lock removal could publish a mixed, stale count, and an admission batch could apply capacity calculated before the last purchase completed.

Completed purchases now change a performance-scoped capacity version and invalidate its cache before returning their active slot. Cache publication compares the version atomically; computations that overlapped a purchase are retried, with bounded retries that keep buyers waiting if no stable snapshot is available. Direct and reconciled admission scripts check that same version when applying the transition. All version/cache/session keys stay in the performance's Redis Cluster hash slot. The 200-admission limit, FIFO order, API/SQL sizes, payment transaction and QR issuance boundaries are unchanged.

The four deterministic regression cases, 81 queue unit tests, 19 real-Valkey Cluster tests and 2,682 API unit tests pass. A disposable local 1,500-visitor run with two API processes, pool five and 600 finite seats completed three 200-buyer cohorts: 600 confirmed reservations/sold seats/Ticket Items/QR credentials, 900 remaining waiting buyers, 400 subsequent admission events and 60,000 seat notifications without duplicates. This local result is correctness evidence; it does not replace the isolated GCP retest or alter the pre-fix cloud latency figures above.

### HA Valkey maintenance

The primary and one replica use multi-zone placement, standalone protocol and `noeviction`. Before production binding, a planned maintenance simulation was run while eight authenticated sockets observed real adapter pub/sub. A retained TTL key was acknowledged by the replica before the simulation. The operation completed, the key was retained, both API processes remained observable, final health succeeded and all eight sockets received the post-maintenance event. The maximum observed gap between successful probe cycles was 5,822 ms; three Redis probe attempts and three health attempts failed during the interruption. Pub/sub is not durable: recovery does not imply uninterrupted event delivery. Keep HTTP state reconciliation and the dependency-free liveness route.

The maintenance mechanism is the documented [Memorystore simulation](https://docs.cloud.google.com/memorystore/docs/valkey/simulate-maintenance). This verifies a planned failover of the unbound target; it does not certify every abrupt-failure or data-loss scenario. The micro SQL instance remains single-zone.

## Operational validation

Before retiring a database, preserve a fresh export in two regions, verify object and downloaded checksums, restore into an isolated Postgres16 target with customer applications disabled, and compare every COPY table count, index validity and constraint validation. Keep customer backup files and detailed production aggregates out of this public repository.

Validate the HA Valkey replacement before binding production to it. Use at least one replica, multi-zone placement, `noeviction`, and an explicit weekly maintenance window outside the sale/entry periods. If a private cloud load rehearsal is used, give it a dedicated synthetic database and unused Valkey target, test-only credentials, private IAM invocation and bounded lifetime. Production must never load a payment stub. Apply the source release and configuration through CI/CD, then verify serving revisions, effective limits, worker schedule, live health, queue/seat behavior and logs. Keep the original API/Web sizes and database tier unchanged.

[Operating procedure](../runbooks/managed-demo-cost-floor.md#bounded-600-seat-opening-preparation).
