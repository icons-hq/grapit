import http from 'k6/http';
import { check } from 'k6';

const DEFAULT_RATE = 34;
const DEFAULT_DURATION = '10m';
const DEFAULT_PREALLOCATED_VUS = 250;
const DEFAULT_MAX_VUS = 1500;
const APPROVAL_TOKEN = 'PHASE26_DEDICATED_TEST_EVENT_APPROVED';
const PHASE26_TEST = 'PHASE26_TEST';

const apiUrl = normalizeBaseUrl(__ENV.GRABIT_API_URL || 'https://api.heygrabit.com/api/v1');
const performanceId = requireEnv('PHASE26_TEST_PERFORMANCE_ID');
const showtimeId = requireEnv('PHASE26_TEST_SHOWTIME_ID');
const marker = requireEnv('PHASE26_TEST_MARKER');
const loadApproval = requireEnv('PHASE26_LOAD_APPROVED');

assertDedicatedTarget({ marker, loadApproval });
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 401, 403, 404, 409, 429));

export const options = {
  discardResponseBodies: true,
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.01'],
  },
  scenarios: {
    phase26_20k_stress: {
      executor: 'constant-arrival-rate',
      rate: intEnv('PHASE26_STRESS_RATE', DEFAULT_RATE),
      timeUnit: __ENV.PHASE26_STRESS_TIME_UNIT || '1s',
      duration: __ENV.PHASE26_STRESS_DURATION || DEFAULT_DURATION,
      preAllocatedVUs: intEnv('PHASE26_STRESS_PREALLOCATED_VUS', DEFAULT_PREALLOCATED_VUS),
      maxVUs: intEnv('PHASE26_STRESS_MAX_VUS', DEFAULT_MAX_VUS),
      exec: 'stress',
      tags: {
        phase: '26',
        gate: 'LOAD_20K_STRESS',
        PHASE26_TEST,
      },
    },
  },
};

export function stress() {
  const route = chooseRoute({
    readWeight: intEnv('PHASE26_READ_WEIGHT', 80),
    queueWeight: intEnv('PHASE26_QUEUE_WEIGHT', 18),
    mutationWeight: intEnv('PHASE26_MUTATION_WEIGHT', 2),
  });

  if (route === 'mutation') {
    sampledMutation();
    return;
  }

  if (route === 'queue') {
    queuePath();
    return;
  }

  readPath();
}

function readPath() {
  const responses = http.batch([
    ['GET', `${apiUrl}/health`, null, requestOptions('read:health')],
    ['GET', `${apiUrl}/performances/${encodeURIComponent(performanceId)}`, null, requestOptions('read:performance')],
    [
      'GET',
      `${apiUrl}/booking/schedules/${encodeURIComponent(showtimeId)}/seats`,
      null,
      requestOptions('read:seats'),
    ],
  ]);

  check(responses[0], {
    'health does not return 5xx': (res) => res.status < 500,
  });
  check(responses[1], {
    'performance detail does not return 5xx': (res) => res.status < 500,
  });
  check(responses[2], {
    'seat read does not return 5xx': (res) => res.status < 500,
  });
}

function queuePath() {
  const sessionId = __ENV.PHASE26_QUEUE_SESSION_ID;
  const admissionToken = __ENV.PHASE26_QUEUE_ADMISSION_TOKEN;

  if (sessionId && admissionToken) {
    const res = http.get(`${apiUrl}/queue/sessions/${encodeURIComponent(sessionId)}`, {
      ...requestOptions('queue:status'),
      headers: {
        ...requestHeaders(),
        'x-queue-admission-token': admissionToken,
      },
    });
    check(res, {
      'queue status does not return 5xx': (response) => response.status < 500,
    });
    return;
  }

  const res = http.post(
    `${apiUrl}/queue/performances/${encodeURIComponent(performanceId)}/enter`,
    JSON.stringify({ marker }),
    requestOptions('queue:enter'),
  );
  check(res, {
    'queue enter remains controlled': (response) =>
      response.status < 500 || [401, 403, 409, 429].includes(response.status),
  });
}

function sampledMutation() {
  const seatId = requireEnv('PHASE26_TEST_SEAT_ID');
  const admissionToken = __ENV.PHASE26_QUEUE_ADMISSION_TOKEN || '';
  const headers = {
    ...requestHeaders(),
    'x-queue-admission-token': admissionToken,
  };

  const lock = http.post(
    `${apiUrl}/booking/seats/lock`,
    JSON.stringify({
      showtimeId,
      seatId,
      marker,
      source: PHASE26_TEST,
    }),
    requestOptions('mutation:lock-seat', headers),
  );

  check(lock, {
    'lock sample avoids 5xx': (response) => response.status < 500,
  });

  if (__ENV.PHASE26_PREPARE_SAMPLE === '1') {
    const prepare = http.post(
      `${apiUrl}/reservations/prepare`,
      JSON.stringify({
        performanceId,
        showtimeId,
        seats: [{ seatId }],
        marker,
        source: PHASE26_TEST,
      }),
      requestOptions('mutation:prepare-reservation', headers),
    );
    check(prepare, {
      'prepare sample avoids 5xx': (response) => response.status < 500,
    });
  }
}

function chooseRoute(weights) {
  const read = Math.max(weights.readWeight, 0);
  const queue = Math.max(weights.queueWeight, 0);
  const mutation = Math.max(weights.mutationWeight, 0);
  const total = read + queue + mutation;
  if (total <= 0) return 'read';

  const pick = Math.random() * total;
  if (pick < mutation) return 'mutation';
  if (pick < mutation + queue) return 'queue';
  return 'read';
}

function requestOptions(name, headers = requestHeaders()) {
  return {
    headers,
    tags: {
      phase: '26',
      gate: 'LOAD_20K_STRESS',
      path: name,
      PHASE26_TEST,
    },
    timeout: __ENV.PHASE26_HTTP_TIMEOUT || '10s',
  };
}

function requestHeaders() {
  const headers = {
    'content-type': 'application/json',
    'x-phase26-test': PHASE26_TEST,
    'x-phase26-marker': marker,
  };

  const authHeader = __ENV.PHASE26_AUTH_HEADER;
  if (authHeader) {
    const separator = authHeader.indexOf(':');
    if (separator <= 0) {
      throw new Error('PHASE26_AUTH_HEADER must use "Header-Name: value" format');
    }
    headers[authHeader.slice(0, separator).trim()] = authHeader.slice(separator + 1).trim();
  }

  return headers;
}

function requireEnv(name) {
  const value = (__ENV[name] || '').trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function assertDedicatedTarget({ marker: targetMarker, loadApproval: approval }) {
  if (approval !== APPROVAL_TOKEN) {
    throw new Error(`PHASE26_LOAD_APPROVED must equal ${APPROVAL_TOKEN}`);
  }
  if (!targetMarker.startsWith(PHASE26_TEST)) {
    throw new Error('PHASE26_TEST_MARKER must start with PHASE26_TEST');
  }
  if (performanceId === showtimeId) {
    throw new Error('PHASE26_TEST_PERFORMANCE_ID and PHASE26_TEST_SHOWTIME_ID must differ');
  }
}

function intEnv(name, fallback) {
  const raw = __ENV[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function normalizeBaseUrl(value) {
  const trimmed = String(value).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(trimmed)) {
    throw new Error('GRABIT_API_URL must be an http(s) URL');
  }
  return trimmed;
}
