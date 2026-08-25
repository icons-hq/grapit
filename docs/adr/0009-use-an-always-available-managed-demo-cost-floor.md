# Use an always-available managed-demo cost floor between ticketing windows

When no ticket opening is scheduled, Grabit runs in a managed-demo posture with an operating target of USD 45–55 per month. Public pages and every real product flow remain enabled, but idle compute and over-provisioned managed data services are reduced.

The managed-demo posture uses:

- Cloud Run Web and API with minimum instances `0`, request-based CPU, and a low autoscaling ceiling;
- a bounded Cloud Run Job every five minutes for pg-boss retries, QR reminder email delivery, cancelled-seat release, and pending-payment expiration;
- a small ZONAL Cloud SQL PostgreSQL instance with backups and point-in-time recovery;
- a managed `custom-pico`, Cluster Mode Disabled Valkey instance with `VALKEY_MODE=standalone`;
- a Cloudflare Worker Route that streams public HTTP and WebSocket traffic to the stable Cloud Run service origins, allowing the idle GCP external load balancer to be retired.

The original resources, secret version identifiers, Cloud Run revisions, and exact restoration commands must be recorded before cutover. Database export, checksum, import, and read-only reconciliation are mandatory before the original database is stopped. The original database remains stopped for seven days and the original Valkey remains for at least 24 hours after cutover before either can be deleted.

**Consequences**

- Random visitors can use the site without an operator wake-up, but a scale-from-zero request can have a noticeable cold start. A roughly 12-second API cold start was observed on 2026-08-25.
- Background work can be delayed by up to about five minutes while no API instance is active. Synchronous signup, login, payment confirmation, refunds, seat locking, QR display/check-in, and admin writes still execute on the request path.
- `db-f1-micro`, one Valkey node without a replica, and low Cloud Run maxima are managed-demo capacity, not ticket-opening capacity.
- ADR 0007 is suspended during this posture. Before a public sale, restore warm instances and continuous workers, re-create Cluster Mode Enabled Valkey capacity, load-test the database tier, and reconsider REGIONAL Cloud SQL availability under ADR 0006.
- The GCP load balancer can only be deleted after the Worker Route has passed HTTP, auth callback, payment webhook, Socket.IO, and rollback smoke tests.
