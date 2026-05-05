
<!-- GRABIT_SMOKE_ARTIFACT -->
### Production Smoke Run - 2026-05-05T06:30:26.660Z

- Command shape: `pnpm --filter @grabit/web exec node ../../scripts/smoke-valkey-production.mjs --check health`
- Timestamp UTC: 2026-05-05T06:30:26.660Z
- Timestamp KST: 2026-05-05 15:30:26 KST
- Completed UTC: 2026-05-05T06:30:28.424Z
- Cloud Run service: grabit-api
- latestReadyRevisionName: grabit-api-00025-4j4
- Traffic split: grabit-api-00025-4j4:100%
- latestReadyRevisionName serving 100% traffic: PASS
- Target URL host: api.heygrabit.com
- Valkey instance: grabit-valkey
- Live Memorystore mode: unknown
- Expected live mode: CLUSTER
- VALKEY_MODE=cluster observed: PASS
- REDIS_URL binding: secret-bound
- VPC egress: private-ranges-only
- Network interfaces: [{"network":"default","subnetwork":"default"}]
- min-instances evidence: 0
- Runtime contract failures: Memorystore mode=unknown; Memorystore evidence=gcloud failed for gcloud memorystore instances describe grabit-valkey --location=asia-northeast3 --project=grapit-491806 --format=json: ERROR: (gcloud.memorystore.instances.describe) NOT_FOUND: Resource 'projects/grapit-491806/locations/asia-northeast3/instances/grabit-valkey' was not found. This command is authenticated as sangwopark19icons@gmail.com which is the active account specified by the [core/account] property
- '@type': type.googleapis.com/google.rpc.ResourceInfo
  resourceName: projects/grapit-491806/locations/asia-northeast3/instances/grabit-valkey

- Auth input: Authorization header from GRABIT_SMOKE_AUTH_HEADER_FILE, value redacted
- Redactions applied: [redacted redis url] [redacted redis url] Authorization, Cookie, JWT, phone numbers, paymentKey, orderId, <customer-data:redacted>

| Check | Result | Summary |
|-------|--------|---------|
| Production Runtime Contract | FAIL | failures=Memorystore mode=unknown; Memorystore evidence=gcloud failed for gcloud memorystore instances describe grabit-valkey --location=asia-northeast3 --project=grapit-491806 --format=json: ERROR: (gcloud.memorystore.instances.describe) NOT_FOUND: Resource 'projects/grapit-491806/locations/asia-northeast3/instances/grabit-valkey' was not found. This command is authenticated as sangwopark19icons@gmail.com which is the active account specified by the [core/account] property
- '@type': type.googleapis.com/google.rpc.ResourceInfo
  resourceName: projects/grapit-491806/locations/asia-northeast3/instances/grabit-valkey
 |
| Health Ping Smoke | PASS | health=ok, redis=up, mode=cluster, client=ioredis-cluster, configured=true |
| Final automated smoke result | FAIL | Sentry dashboard/API observation must still be recorded by the operator before final phase approval. |

<!-- GRABIT_SMOKE_ARTIFACT -->
### Production Smoke Run - 2026-05-05T06:30:26.684Z

- Command shape: `pnpm --filter @grabit/web exec node ../../scripts/smoke-valkey-production.mjs --check lua`
- Timestamp UTC: 2026-05-05T06:30:26.684Z
- Timestamp KST: 2026-05-05 15:30:26 KST
- Completed UTC: 2026-05-05T06:30:28.783Z
- Cloud Run service: grabit-api
- latestReadyRevisionName: grabit-api-00025-4j4
- Traffic split: grabit-api-00025-4j4:100%
- latestReadyRevisionName serving 100% traffic: PASS
- Target URL host: api.heygrabit.com
- Valkey instance: grabit-valkey
- Live Memorystore mode: unknown
- Expected live mode: CLUSTER
- VALKEY_MODE=cluster observed: PASS
- REDIS_URL binding: secret-bound
- VPC egress: private-ranges-only
- Network interfaces: [{"network":"default","subnetwork":"default"}]
- min-instances evidence: 0
- Runtime contract failures: Memorystore mode=unknown; Memorystore evidence=gcloud failed for gcloud memorystore instances describe grabit-valkey --location=asia-northeast3 --project=grapit-491806 --format=json: ERROR: (gcloud.memorystore.instances.describe) NOT_FOUND: Resource 'projects/grapit-491806/locations/asia-northeast3/instances/grabit-valkey' was not found. This command is authenticated as sangwopark19icons@gmail.com which is the active account specified by the [core/account] property
- '@type': type.googleapis.com/google.rpc.ResourceInfo
  resourceName: projects/grapit-491806/locations/asia-northeast3/instances/grabit-valkey

- Auth input: Authorization header from GRABIT_SMOKE_AUTH_HEADER_FILE, value redacted
- Redactions applied: [redacted redis url] [redacted redis url] Authorization, Cookie, JWT, phone numbers, paymentKey, orderId, <customer-data:redacted>

| Check | Result | Summary |
|-------|--------|---------|
| Production Runtime Contract | FAIL | failures=Memorystore mode=unknown; Memorystore evidence=gcloud failed for gcloud memorystore instances describe grabit-valkey --location=asia-northeast3 --project=grapit-491806 --format=json: ERROR: (gcloud.memorystore.instances.describe) NOT_FOUND: Resource 'projects/grapit-491806/locations/asia-northeast3/instances/grabit-valkey' was not found. This command is authenticated as sangwopark19icons@gmail.com which is the active account specified by the [core/account] property
- '@type': type.googleapis.com/google.rpc.ResourceInfo
  resourceName: projects/grapit-491806/locations/asia-northeast3/instances/grabit-valkey
 |
| Lua Lock Status Unlock Smoke | PASS | lock=PASS, status=seat=A-1, state=locked, unlock=PASS (status=204, afterState=available) |
| Final automated smoke result | FAIL | Sentry dashboard/API observation must still be recorded by the operator before final phase approval. |

<!-- GRABIT_SMOKE_ARTIFACT -->
### Production Smoke Run - 2026-05-05T06:31:58.511Z

- Command shape: `pnpm --filter @grabit/web exec node ../../scripts/smoke-valkey-production.mjs --check lua`
- Timestamp UTC: 2026-05-05T06:31:58.511Z
- Timestamp KST: 2026-05-05 15:31:58 KST
- Completed UTC: 2026-05-05T06:32:00.440Z
- Cloud Run service: grabit-api
- latestReadyRevisionName: grabit-api-00025-4j4
- Traffic split: grabit-api-00025-4j4:100%
- latestReadyRevisionName serving 100% traffic: PASS
- Target URL host: api.heygrabit.com
- Valkey instance: grapit-valkey
- Live Memorystore mode: CLUSTER
- Expected live mode: CLUSTER
- VALKEY_MODE=cluster observed: PASS
- REDIS_URL binding: secret-bound
- VPC egress: private-ranges-only
- Network interfaces: [{"network":"default","subnetwork":"default"}]
- min-instances evidence: 0
- Runtime contract failures: none
- Auth input: Authorization header from GRABIT_SMOKE_AUTH_HEADER_FILE, value redacted
- Redactions applied: [redacted redis url] [redacted redis url] Authorization, Cookie, JWT, phone numbers, paymentKey, orderId, <customer-data:redacted>

| Check | Result | Summary |
|-------|--------|---------|
| Production Runtime Contract | PASS | live=CLUSTER, declared=cluster, REDIS_URL=secret-bound, VPC=private-ranges-only |
| Lua Lock Status Unlock Smoke | PASS | lock=PASS, status=seat=A-1, state=locked, unlock=PASS (status=204, afterState=available) |
| Final automated smoke result | PASS | Sentry dashboard/API observation must still be recorded by the operator before final phase approval. |

<!-- GRABIT_SMOKE_ARTIFACT -->
### Production Smoke Run - 2026-05-05T06:31:58.511Z

- Command shape: `pnpm --filter @grabit/web exec node ../../scripts/smoke-valkey-production.mjs --check health`
- Timestamp UTC: 2026-05-05T06:31:58.511Z
- Timestamp KST: 2026-05-05 15:31:58 KST
- Completed UTC: 2026-05-05T06:32:00.543Z
- Cloud Run service: grabit-api
- latestReadyRevisionName: grabit-api-00025-4j4
- Traffic split: grabit-api-00025-4j4:100%
- latestReadyRevisionName serving 100% traffic: PASS
- Target URL host: api.heygrabit.com
- Valkey instance: grapit-valkey
- Live Memorystore mode: CLUSTER
- Expected live mode: CLUSTER
- VALKEY_MODE=cluster observed: PASS
- REDIS_URL binding: secret-bound
- VPC egress: private-ranges-only
- Network interfaces: [{"network":"default","subnetwork":"default"}]
- min-instances evidence: 0
- Runtime contract failures: none
- Auth input: Authorization header from GRABIT_SMOKE_AUTH_HEADER_FILE, value redacted
- Redactions applied: [redacted redis url] [redacted redis url] Authorization, Cookie, JWT, phone numbers, paymentKey, orderId, <customer-data:redacted>

| Check | Result | Summary |
|-------|--------|---------|
| Production Runtime Contract | PASS | live=CLUSTER, declared=cluster, REDIS_URL=secret-bound, VPC=private-ranges-only |
| Health Ping Smoke | PASS | health=ok, redis=up, mode=cluster, client=ioredis-cluster, configured=true |
| Final automated smoke result | PASS | Sentry dashboard/API observation must still be recorded by the operator before final phase approval. |

<!-- GRABIT_SMOKE_ARTIFACT -->
### Production Smoke Run - 2026-05-05T06:33:00.670Z

- Command shape: `pnpm --filter @grabit/web exec node ../../scripts/smoke-valkey-production.mjs --check socketio`
- Timestamp UTC: 2026-05-05T06:33:00.670Z
- Timestamp KST: 2026-05-05 15:33:00 KST
- Completed UTC: 2026-05-05T06:33:40.556Z
- Cloud Run service: grabit-api
- latestReadyRevisionName: grabit-api-00026-54w
- Traffic split: grabit-api-00026-54w:100%
- latestReadyRevisionName serving 100% traffic: PASS
- Target URL host: api.heygrabit.com
- Valkey instance: grapit-valkey
- Live Memorystore mode: CLUSTER
- Expected live mode: CLUSTER
- VALKEY_MODE=cluster observed: PASS
- REDIS_URL binding: secret-bound
- VPC egress: private-ranges-only
- Network interfaces: [{"network":"default","subnetwork":"default"}]
- min-instances evidence: 2
- Runtime contract failures: none
- Auth input: Authorization header from GRABIT_SMOKE_AUTH_HEADER_FILE, value redacted
- Redactions applied: [redacted redis url] [redacted redis url] Authorization, Cookie, JWT, phone numbers, paymentKey, orderId, <customer-data:redacted>

| Check | Result | Summary |
|-------|--------|---------|
| Production Runtime Contract | PASS | live=CLUSTER, declared=cluster, REDIS_URL=secret-bound, VPC=private-ranges-only |
| Socket.IO Two-Instance Propagation | PASS | selected clients=2YpPfeYzHmiyPvN2AAAB@0007b734d9c7039f84ba7148d8c84de8c649be5e99b23d30ceb4479a0576a2cdc8a9bd77a910dab58b1bdf2bd018a5c527be78920974e66df8103c75c3b1c62c9bde916a0f84c65452e475a190e154680af6560be2b61420f96e5bb1c1ed8c0be9,pG5EIRNVXMYWBv3hAAAB@0007b734d9f0181c7000de9b0c121e4c8600b7f446ebd7dbc0f676940aeebc2b776a210db341c822595a2b47dcda7a7ace6d4347a1d6cda72fa37de74972ec764c2cd5ae1707f2113f7b3c9f122fe5aaac4c6eeecf9856eaf91a478bd4e5a277ce; opened clients=2; received seat-update=PASS; min-instances=2; distinct Cloud Run instance IDs=2; cleanup=PASS afterState=available; D-10=PASS; D-13=PASS |
| Final automated smoke result | PASS | Sentry dashboard/API observation must still be recorded by the operator before final phase approval. |

<!-- GRABIT_SMOKE_ARTIFACT -->
### Production Smoke Run - 2026-05-05T06:34:04.827Z

- Command shape: `pnpm --filter @grabit/web exec node ../../scripts/smoke-valkey-production.mjs --check idle`
- Timestamp UTC: 2026-05-05T06:34:04.827Z
- Timestamp KST: 2026-05-05 15:34:04 KST
- Completed UTC: 2026-05-05T06:35:20.684Z
- Cloud Run service: grabit-api
- latestReadyRevisionName: grabit-api-00026-54w
- Traffic split: grabit-api-00026-54w:100%
- latestReadyRevisionName serving 100% traffic: PASS
- Target URL host: api.heygrabit.com
- Valkey instance: grapit-valkey
- Live Memorystore mode: CLUSTER
- Expected live mode: CLUSTER
- VALKEY_MODE=cluster observed: PASS
- REDIS_URL binding: secret-bound
- VPC egress: private-ranges-only
- Network interfaces: [{"network":"default","subnetwork":"default"}]
- min-instances evidence: 2
- Runtime contract failures: none
- Auth input: Authorization header from GRABIT_SMOKE_AUTH_HEADER_FILE, value redacted
- Redactions applied: [redacted redis url] [redacted redis url] Authorization, Cookie, JWT, phone numbers, paymentKey, orderId, <customer-data:redacted>

| Check | Result | Summary |
|-------|--------|---------|
| Production Runtime Contract | PASS | live=CLUSTER, declared=cluster, REDIS_URL=secret-bound, VPC=private-ranges-only |
| Idle Reconnect Window | PASS | wait=60s; health=PASS; lua=PASS; socketio=PASS |
| Final automated smoke result | PASS | Sentry dashboard/API observation must still be recorded by the operator before final phase approval. |
