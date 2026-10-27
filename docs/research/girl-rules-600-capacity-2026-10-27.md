# Bounded 600-seat release — 2026-10-27

This release contains queue capacity/FIFO correctness, the payment receipt and QR query optimizations, and bounded deployment settings. It does not include the separate storefront redesign or new schema migrations. Baseline: `b45352acafaf6902934a8f7e6fd0b237ece2de0f`.

## Configuration

Keep API 1 vCPU/512 MiB, Web 1 vCPU/1 GiB and the existing SQL tier. Use at most two API instances, application pool two, producer pg-boss pool one, and 200 active admissions per performance; other customers wait. Request concurrency is 1000 to allow waiting WebSockets alongside HTTP. Node old-space is capped at 256 MiB. A single bounded background worker retains its pool two plus pg-boss pool three. With reserve five, the steady-state connection budget is 16. Revision overlap and extra worker executions must be counted separately.

The queue scripts assign monotonic order atomically within each performance hash slot. Direct entry and reconciliation both enforce the configured active cap; ETA uses it too. Old and new writers must not coexist during an active queue. Perform the rollout behind the existing booking gate after queue/payment activity drains.

Payment confirmation keeps the per-order lease, per-user advisory limit lock, provider result validation and transactional seat/payment/ticket-item writes. The receipt read issues or heals QR credentials once; standalone finalization retains immediate QR issuance. Prepared parameterized reads reuse SQL structure without caching customer data. Missing QR credentials are re-read in a new statement after the reservation lock, preserving PostgreSQL READ COMMITTED visibility during competing issue/cancel operations.

## Synthetic local verification

[Raw local result](girl-rules-600-capacity-2026-10-27/local-capacity.json): two API processes, pool two, admission 200, 600 finite seats, 300 ms simulated provider, heap 256 MiB. This is synthetic data only.

| Arrivals | Confirm p95 | Maximum observed API RSS | Confirmed / sold / ticket items / QR |
| --- | ---: | ---: | --- |
| 600 | 937 ms | 283 MiB | 600 each |
| 1000 | 1000 ms | 305 MiB | 600 each |
| 1500 | 871 ms | 350 MiB | 600 each |

Every waiting actor holds a queue socket (400/800/1300 initially), with all 400 subsequent admission notifications delivered per wave. One hundred booking sockets receive all 60,000 expected seat notifications per wave with no duplicates. Duplicate confirmation retries converge on the same reservation. Active admission never exceeds 200. Disposable Postgres/Valkey interruption and recovery pass. Human selection/payment time is compressed, so the run duration is not a sellout-time forecast.

API unit tests: 2672 passed. API database/Valkey integration tests: 406 passed. Typecheck passed. The local test uses macOS/Node24 and does not certify Cloud Run CPU/cgroup, Cloud SQL micro performance or actual provider latency. The cloud rehearsal and cutover results will be recorded separately after execution; no production capacity is claimed from this file's local result alone.

## Operational validation

Before retiring a database, preserve a fresh export in two regions, verify object and downloaded checksums, restore into an isolated Postgres16 target with customer applications disabled, and compare every COPY table count, index validity and constraint validation. Keep customer backup files and detailed production aggregates out of this public repository.

Validate the HA Valkey replacement before binding production to it. Use at least one replica, multi-zone placement, `noeviction`, and an explicit weekly maintenance window outside the sale/entry periods. If a private cloud load rehearsal is used, give it a dedicated synthetic database and unused Valkey target, test-only credentials, private IAM invocation and bounded lifetime. Production must never load a payment stub. Apply the source release and configuration through CI/CD, then verify serving revisions, effective limits, worker schedule, live health, queue/seat behavior and logs. Keep the original API/Web sizes and database tier unchanged.

[Operating procedure](../runbooks/managed-demo-cost-floor.md#bounded-600-seat-opening-preparation).
