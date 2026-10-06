// Ticket-opening Valkey posture check.
//
// Usage (read-only, from an authenticated operator shell):
//
//   gcloud memorystore instances describe INSTANCE \
//     --project=PROJECT --location=REGION --format=json > valkey.json
//   node scripts/managed-demo/verify-valkey-sale-posture.mjs valkey.json \
//     --protect=2026-10-20T19:00:00+09:00/2026-10-20T23:00:00+09:00 \
//     --protect=2026-11-01T16:00:00+09:00/2026-11-01T22:00:00+09:00
//
// Each --protect window is a sale-opening or venue-entry period. The command
// exits non-zero unless the instance can survive a node failure or maintenance
// event during those windows without wiping seat locks, confirmation leases and
// queue state. See docs/runbooks/managed-demo-cost-floor.md.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Memorystore for Valkey: "The maintenance window lasts for one hour. In some
// cases, maintenance might extend beyond the window you select."
export const MAINTENANCE_WINDOW_MS = 60 * 60 * 1000;
// Margin around protected windows for maintenance overrun and warm-up.
export const DEFAULT_BUFFER_MS = 6 * 60 * 60 * 1000;

const DAY_INDEX = {
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
};
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
// shared-core-nano has no availability SLA and is a demo/legacy node type.
const NON_SALE_NODE_TYPES = new Set(['SHARED_CORE_NANO']);

export function parseProtectedWindow(spec) {
  const [rawStart, rawEnd] = String(spec).split('/');
  const start = Date.parse(rawStart ?? '');
  const end = Date.parse(rawEnd ?? '');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new Error(`Invalid --protect window: ${spec}. Use ISO_START/ISO_END with an offset.`);
  }
  return { start, end, label: String(spec) };
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/** Every weekly window occurrence (UTC) that could touch [from, to]. */
export function weeklyWindowOccurrences(window, from, to) {
  const dayIndex = DAY_INDEX[String(window?.day ?? '').toUpperCase()];
  if (dayIndex === undefined) {
    throw new Error(`Unsupported maintenance window day: ${String(window?.day)}`);
  }
  const startTime = window?.startTime ?? {};
  const offsetMs =
    (Number(startTime.hours ?? 0) * 60 + Number(startTime.minutes ?? 0)) * 60_000 +
    Number(startTime.seconds ?? 0) * 1_000;

  const occurrences = [];
  const first = new Date(from - WEEK_MS);
  first.setUTCHours(0, 0, 0, 0);
  for (let dayStart = first.getTime(); dayStart <= to + DAY_MS; dayStart += DAY_MS) {
    if (new Date(dayStart).getUTCDay() !== dayIndex) continue;
    const start = dayStart + offsetMs;
    occurrences.push({ start, end: start + MAINTENANCE_WINDOW_MS });
  }
  return occurrences;
}

export function evaluateValkeySalePosture(
  instance,
  { protectedWindows, expectedMode = 'CLUSTER', bufferMs = DEFAULT_BUFFER_MS },
) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  add('state', instance?.state === 'ACTIVE', `state=${String(instance?.state)}`);
  add(
    'mode',
    instance?.mode === expectedMode,
    `mode=${String(instance?.mode)} (expected ${expectedMode}; VALKEY_MODE must match)`,
  );

  const replicaCount = Number(instance?.replicaCount ?? 0);
  add(
    'replicas',
    Number.isInteger(replicaCount) && replicaCount >= 1,
    `replicaCount=${replicaCount} (>=1 required for automatic failover)`,
  );

  const zoneMode = instance?.zoneDistributionConfig?.mode;
  add(
    'zone-distribution',
    zoneMode === 'MULTI_ZONE',
    `zoneDistributionConfig.mode=${String(zoneMode)} (MULTI_ZONE required)`,
  );

  const nodeType = String(instance?.nodeType ?? 'NODE_TYPE_UNSPECIFIED');
  add(
    'node-type',
    nodeType !== 'NODE_TYPE_UNSPECIFIED' && !NON_SALE_NODE_TYPES.has(nodeType),
    `nodeType=${nodeType} (size from load evidence; shared-core-nano is demo only)`,
  );

  const maxmemoryPolicy = instance?.engineConfigs?.['maxmemory-policy'] ?? 'volatile-lru (default)';
  add(
    'maxmemory-policy',
    maxmemoryPolicy === 'noeviction',
    `maxmemory-policy=${maxmemoryPolicy} (noeviction required: seat locks, leases and queue keys carry TTLs and volatile-* policies evict them first)`,
  );

  const windows = Array.isArray(instance?.maintenancePolicy?.weeklyMaintenanceWindow)
    ? instance.maintenancePolicy.weeklyMaintenanceWindow
    : [];
  add(
    'maintenance-window-configured',
    windows.length > 0,
    windows.length > 0
      ? `weeklyMaintenanceWindow=${windows
          .map((w) => `${w.day} ${String(w.startTime?.hours ?? 0).padStart(2, '0')}:${String(w.startTime?.minutes ?? 0).padStart(2, '0')} UTC`)
          .join(', ')}`
      : 'no weeklyMaintenanceWindow; Memorystore may choose any time',
  );

  if (protectedWindows.length === 0) {
    add('protected-windows', false, 'at least one --protect window (opening/entry) is required');
  }

  for (const protectedWindow of protectedWindows) {
    const guardStart = protectedWindow.start - bufferMs;
    const guardEnd = protectedWindow.end + bufferMs;
    const collisions = windows.flatMap((window) =>
      weeklyWindowOccurrences(window, guardStart, guardEnd)
        .filter((occurrence) => overlaps(occurrence.start, occurrence.end, guardStart, guardEnd))
        .map((occurrence) => new Date(occurrence.start).toISOString()),
    );
    add(
      `weekly-window-vs-${protectedWindow.label}`,
      collisions.length === 0,
      collisions.length === 0
        ? 'weekly window does not touch the protected window (with buffer)'
        : `weekly window occurs at ${collisions.join(', ')}; move it away from the protected window`,
    );

    const scheduleStart = Date.parse(instance?.maintenanceSchedule?.startTime ?? '');
    const scheduleEnd = Date.parse(instance?.maintenanceSchedule?.endTime ?? '');
    if (Number.isFinite(scheduleStart)) {
      const end = Number.isFinite(scheduleEnd) ? scheduleEnd : scheduleStart + MAINTENANCE_WINDOW_MS;
      const collides = overlaps(scheduleStart, end, guardStart, guardEnd);
      add(
        `scheduled-maintenance-vs-${protectedWindow.label}`,
        !collides,
        collides
          ? `scheduled maintenance ${instance.maintenanceSchedule.startTime} collides; reschedule with gcloud memorystore instances reschedule-maintenance`
          : `scheduled maintenance ${instance.maintenanceSchedule.startTime} is outside the protected window`,
      );
    }
  }

  const persistenceMode = instance?.persistenceConfig?.mode ?? 'DISABLED';
  checks.push({
    name: 'persistence',
    ok: true,
    informational: true,
    detail: `persistenceConfig.mode=${persistenceMode} (optional; Valkey state is transient by design)`,
  });

  return { ok: checks.every((check) => check.ok), checks };
}

function parseArgs(args) {
  let file;
  let expectedMode = 'CLUSTER';
  let bufferMs = DEFAULT_BUFFER_MS;
  const protectedWindows = [];
  for (const arg of args) {
    if (arg.startsWith('--protect=')) {
      protectedWindows.push(parseProtectedWindow(arg.slice('--protect='.length)));
    } else if (arg.startsWith('--expect-mode=')) {
      expectedMode = arg.slice('--expect-mode='.length).toUpperCase().replace(/-/g, '_');
    } else if (arg.startsWith('--buffer-hours=')) {
      const hours = Number(arg.slice('--buffer-hours='.length));
      if (!Number.isFinite(hours) || hours < 0) throw new Error('--buffer-hours must be >= 0');
      bufferMs = hours * 60 * 60 * 1000;
    } else if (!arg.startsWith('--') && !file) {
      file = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!file) {
    throw new Error('Usage: verify-valkey-sale-posture.mjs DESCRIBE_JSON --protect=ISO_START/ISO_END [...]');
  }
  return { file, expectedMode, bufferMs, protectedWindows };
}

async function main() {
  const { file, ...options } = parseArgs(process.argv.slice(2));
  const instance = JSON.parse(await readFile(file, 'utf8'));
  const result = evaluateValkeySalePosture(instance, options);
  for (const check of result.checks) {
    const status = check.informational ? 'INFO' : check.ok ? 'PASS' : 'FAIL';
    console.log(`${status} ${check.name}: ${check.detail}`);
  }
  if (!result.ok) {
    throw new Error('Valkey instance is not in the ticket-opening posture.');
  }
  console.log('Valkey instance satisfies the ticket-opening posture.');
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
