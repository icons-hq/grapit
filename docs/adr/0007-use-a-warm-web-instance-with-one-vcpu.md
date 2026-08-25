# Use a warm web instance with one vCPU

**Status:** Superseded for the no-sale managed-demo period by ADR 0009. Restore this decision before a ticketing opening when cold-start tolerance is removed.

Grabit keeps one warm Cloud Run instance for the production Web service while reducing each Web instance from two vCPUs to one vCPU. This accepts a small fixed Web hosting cost to avoid buyer-facing cold starts, while relying on Cloud Run horizontal autoscaling for later traffic growth instead of paying for larger idle instances.

**Consequences**

- The first Web instance stays warm instead of scaling to zero.
- Additional traffic scales by adding more one-vCPU Web instances up to the configured maximum, not by automatically increasing the CPU of an existing instance.
- A Cloud Run instance-count alert and monthly billing budget guard should stay attached because a higher Web maximum can turn unexpected traffic or reload loops into real spend.
- New performance launches still require a capacity review because Cloud Run scaling protects Web request capacity but does not automatically resize Cloud SQL or Valkey.
