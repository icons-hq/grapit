# Use zonal Cloud SQL while cost control dominates

Grabit uses ZONAL Cloud SQL for the production PostgreSQL instance while near-term traffic is low and server cost control is the dominant operating constraint. We accept the loss of automatic zone failover in exchange for lower fixed infrastructure cost, while keeping automatic backups, point-in-time recovery, storage auto-resize, and the current instance tier unchanged.

**Consequences**

- A single Google Cloud zone outage can make the database unavailable until the zone or instance recovers.
- Public sale, high-traffic launch, or venue-entry windows should explicitly reconsider REGIONAL availability before the event.
- CPU and memory do not autoscale automatically in either ZONAL or REGIONAL mode; planned traffic spikes still require separate capacity review.
