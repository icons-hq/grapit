---
quick_id: 260515-cicd-recovery
slug: cicd-recovery
status: complete
completed: 2026-05-15
---

# Summary

Updated GitHub Actions CI/CD wiring:

- `CI` now runs for PRs and manual dispatch only. It no longer creates a separate `main` push workflow run just to unlock deployment.
- `Deploy` now runs directly on `main` push and can also be started manually with `workflow_dispatch`.
- `Deploy` uses the pushed commit SHA as `DEPLOY_SHA`, removing dependency on a separate `workflow_run` payload.
- Cloud Run API deployment now includes live production secret mappings that were missing from the workflow: `INFOBIP_*`, `TOSS_WEBHOOK_SECRET`, and `QR_TICKET_*`.

Reason:

- Run `25906669766` was stuck in `queued` with `jobs=[]`, and GitHub cancel/force-cancel returned `HTTP 500`.
- Depending on a separate `main` CI workflow object made CD fragile when GitHub failed to materialize that object.

Verification:

- `ruby -e 'require "yaml"; ARGV.each { |f| YAML.load_file(f); puts "ok #{f}" }' .github/workflows/ci.yml .github/workflows/deploy.yml`
- `git diff --check`
