#!/usr/bin/env bash
set -euo pipefail

# Grabit - Google Memorystore for Valkey provisioning script
# Usage: ./scripts/provision-valkey.sh <GCP_PROJECT_ID> --legacy-demo
#
# LEGACY / DEMO ONLY - NOT A TICKET-SALE SPECIFICATION.
# This creates one shared-core-nano node with ZERO replicas, no maintenance
# window and the default volatile-lru eviction policy. A node restart or
# Memorystore maintenance wipes every seat lock, confirmation lease and queue
# position. For a ticket opening follow
# docs/runbooks/managed-demo-cost-floor.md#restore-for-an-actual-ticket-opening
# (replicas >= 1, multi-zone, explicit maintenance window, noeviction) and
# verify with scripts/managed-demo/verify-valkey-sale-posture.mjs.
#
# NOTE (Phase 13 rename): 이미 provision된 (구-브랜드) Valkey 인스턴스는 이름 immutable
# 이므로 그대로 사용 중. 본 스크립트 변수는 `grabit-*`로 갱신했지만 **재실행 금지**
# (Valkey 데이터 재생성 = 좌석 잠금 유실). 신규 프로젝트에서만 rerun.
#
# Prerequisites:
#   - gcloud CLI installed and authenticated (gcloud auth login)
#   - Billing enabled on the GCP project
#   - Owner or Editor role on the project
#
# What this script does:
#   1. Enables required GCP APIs (networkconnectivity, compute, memorystore, ...)
#   2. Creates a PSC (Private Service Connect) service-connection-policy
#      so that Memorystore can auto-attach a PSC endpoint in the default VPC.
#   3. Creates a Memorystore for Valkey instance (shared-core-nano, single node).
#   4. Prints the discoveryEndpoints output so you can build REDIS_URL.
#
# After running, you must MANUALLY:
#   1. Note the discoveryEndpoints address and port from the output
#   2. Create the GCP Secret Manager secret:
#      echo -n "redis://<IP>:<PORT>" | gcloud secrets create redis-url \
#        --data-file=- --project=<PROJECT_ID>
#   3. Grant Cloud Run service account access to the secret:
#      gcloud secrets add-iam-policy-binding redis-url \
#        --member="serviceAccount:grapit-cloudrun@<PROJECT_ID>.iam.gserviceaccount.com" \   # D-05: SA 유지
#        --role="roles/secretmanager.secretAccessor" \
#        --project=<PROJECT_ID>

PROJECT_ID="${1:?Usage: $0 <GCP_PROJECT_ID> --legacy-demo}"
if [ "${2:-}" != "--legacy-demo" ]; then
  echo "Refusing to run: this script provisions a single-node, zero-replica demo Valkey." >&2
  echo "It is not a ticket-sale posture. Re-run with --legacy-demo only for a demo/new project," >&2
  echo "or follow docs/runbooks/managed-demo-cost-floor.md#restore-for-an-actual-ticket-opening." >&2
  exit 64
fi
REGION="asia-northeast3"
INSTANCE_NAME="grabit-valkey"
NETWORK="default"
POLICY_NAME="grabit-valkey-policy"

echo "=== Step 1: Enable required APIs ==="
gcloud services enable \
  networkconnectivity.googleapis.com \
  compute.googleapis.com \
  serviceconsumermanagement.googleapis.com \
  memorystore.googleapis.com \
  --project="$PROJECT_ID"

echo ""
echo "=== Step 2: Create PSC service connection policy (idempotent) ==="
gcloud network-connectivity service-connection-policies create "$POLICY_NAME" \
  --network="$NETWORK" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --service-class=gcp-memorystore \
  --subnets="https://www.googleapis.com/compute/v1/projects/$PROJECT_ID/regions/$REGION/subnetworks/$NETWORK" \
  2>/dev/null || echo "Policy '$POLICY_NAME' already exists, skipping."

echo ""
echo "=== Step 3: Create Memorystore for Valkey instance ==="
echo "Instance: $INSTANCE_NAME"
echo "Region:   $REGION"
echo "Node:     shared-core-nano (1 shard, 0 replicas, VALKEY_8_0) - DEMO ONLY, no availability SLA"
echo ""
gcloud memorystore instances create "$INSTANCE_NAME" \
  --project="$PROJECT_ID" \
  --location="$REGION" \
  --node-type=shared-core-nano \
  --shard-count=1 \
  --replica-count=0 \
  --engine-version=VALKEY_8_0 \
  --endpoints="[{\"connections\": [{\"pscAutoConnection\": {\"network\": \"projects/$PROJECT_ID/global/networks/$NETWORK\", \"projectId\": \"$PROJECT_ID\"}}]}]"

echo ""
echo "=== Step 4: Describe instance (get discoveryEndpoints) ==="
gcloud memorystore instances describe "$INSTANCE_NAME" \
  --location="$REGION" \
  --project="$PROJECT_ID" \
  --format="yaml(discoveryEndpoints,state)"

echo ""
echo "=== Done ==="
echo ""
echo "Next steps (run manually):"
echo "  1. Copy the discoveryEndpoints address:port from above."
echo "  2. Register the Secret Manager secret:"
echo "       echo -n 'redis://<IP>:<PORT>' | \\"
echo "         gcloud secrets create redis-url --data-file=- --project=$PROJECT_ID"
echo "  3. Grant Cloud Run service account access:"
echo "       gcloud secrets add-iam-policy-binding redis-url \\"
echo "         --member='serviceAccount:grapit-cloudrun@$PROJECT_ID.iam.gserviceaccount.com' \\"   # D-05: SA 유지
echo "         --role='roles/secretmanager.secretAccessor' \\"
echo "         --project=$PROJECT_ID"
echo ""
echo "Cloud Run deploy.yml already includes --vpc-egress=private-ranges-only"
echo "and REDIS_URL=redis-url:latest, so the next deploy will wire everything up."
