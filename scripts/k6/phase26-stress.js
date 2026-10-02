// Phase 26 LOAD_20K_STRESS gate: 20,000 concurrent synthetic buyers by default.
// Shared logic lives in ./lib/phase26-load.js, so run with the directory mounted:
//   docker run --rm -v "$PWD/scripts/k6:/scripts:ro" -v "$PRIVATE_DIR:/private:ro" -v "$OUT_DIR:/out" \
//     grafana/k6 run -e GRABIT_API_URL=... -e PHASE26_USER_POOL_FILE=/private/users.json \
//     -e PHASE26_SEAT_POOL_FILE=/private/seats.json ... \
//     --summary-export /out/phase26-stress-summary.json /scripts/phase26-stress.js
// Variables and evidence rules: docs/runbooks/phase26-cutover-ops.md ("Dedicated test-event load gate").
import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import { SharedArray } from 'k6/data';
import { Counter } from 'k6/metrics';
import {
  buildOptions,
  createPhase26Load,
  parseConfig,
  parseSeatPool,
  parseUserPool,
  runValidUntilMs,
} from './lib/phase26-load.js';

const config = parseConfig(__ENV, 'LOAD_20K_STRESS');
const validUntilMs = runValidUntilMs(config, Date.now());
// One distinct synthetic buyer per VU; tokens stay in memory and are never logged.
const users = new SharedArray('phase26-users', () =>
  parseUserPool(open(config.userPoolFile), { minUsers: config.targetVus, validUntilMs }));
const seats = config.seatPoolFile
  ? new SharedArray('phase26-seats', () => parseSeatPool(open(config.seatPoolFile)))
  : [];
const metrics = {
  queueAdmitted: new Counter('phase26_queue_admitted'),
  queueNotAdmitted: new Counter('phase26_queue_not_admitted'),
};

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }));

export const options = buildOptions(config);

const load = createPhase26Load({ http, check, sleep, exec, metrics, config, users, seats });

export function setup() {
  return load.setup();
}

export default function (setupData) {
  load.iteration(setupData);
}
