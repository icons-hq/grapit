#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="grapit-491806"
REGION="asia-northeast3"
WORKER_JOB="grabit-background-worker"
SCHEDULER_JOB="grabit-background-worker-every-5m"
SCHEDULER_SERVICE_ACCOUNT="scheduler-prewarm@${PROJECT_ID}.iam.gserviceaccount.com"
RUN_URI="https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT_ID}/jobs/${WORKER_JOB}:run"

if [[ "${1:-}" != "--apply" ]]; then
  printf 'Read-only by default. Re-run with --apply after the Cloud Run Job smoke test passes.\n'
  gcloud run jobs describe "${WORKER_JOB}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --format='table(metadata.name,status.conditions[0].status,status.latestCreatedExecution.name)' \
    2>/dev/null || printf 'Cloud Run Job: not found\n'
  gcloud scheduler jobs describe "${SCHEDULER_JOB}" \
    --project="${PROJECT_ID}" \
    --location="${REGION}" \
    --format='table(name,state,schedule,timeZone)' \
    2>/dev/null || printf 'Scheduler Job: not found\n'
  exit 0
fi

gcloud run jobs describe "${WORKER_JOB}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format='value(metadata.name)' >/dev/null

gcloud run jobs add-iam-policy-binding "${WORKER_JOB}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --member="serviceAccount:${SCHEDULER_SERVICE_ACCOUNT}" \
  --role='roles/run.invoker' \
  --quiet

if gcloud scheduler jobs describe "${SCHEDULER_JOB}" \
  --project="${PROJECT_ID}" \
  --location="${REGION}" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "${SCHEDULER_JOB}" \
    --project="${PROJECT_ID}" \
    --location="${REGION}" \
    --schedule='*/5 * * * *' \
    --time-zone='UTC' \
    --uri="${RUN_URI}" \
    --http-method=POST \
    --oauth-service-account-email="${SCHEDULER_SERVICE_ACCOUNT}" \
    --oauth-token-scope='https://www.googleapis.com/auth/cloud-platform' \
    --attempt-deadline=180s \
    --quiet
else
  gcloud scheduler jobs create http "${SCHEDULER_JOB}" \
    --project="${PROJECT_ID}" \
    --location="${REGION}" \
    --schedule='*/5 * * * *' \
    --time-zone='UTC' \
    --uri="${RUN_URI}" \
    --http-method=POST \
    --oauth-service-account-email="${SCHEDULER_SERVICE_ACCOUNT}" \
    --oauth-token-scope='https://www.googleapis.com/auth/cloud-platform' \
    --attempt-deadline=180s \
    --quiet
fi

gcloud scheduler jobs describe "${SCHEDULER_JOB}" \
  --project="${PROJECT_ID}" \
  --location="${REGION}" \
  --format='table(name,state,schedule,timeZone,httpTarget.uri)'
