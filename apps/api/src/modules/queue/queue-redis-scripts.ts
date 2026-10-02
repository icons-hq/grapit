/**
 * Queue session Lua scripts.
 *
 * Every script touches keys that share one Redis Cluster hash tag:
 * `{queue:<performanceId>}` for queue sessions and `{<showtimeId>}` for the
 * locked-seat count. Keys in other slots (`{queue:session-ref}`,
 * `{queue:admission}`) are always written with separate single-key commands.
 *
 * Session records stay JSON strings so instances running the previous release
 * keep reading them during a rolling deploy. The scripts decode the record that
 * is stored at execution time, so a concurrent writer can never replace a newer
 * state (for example ADMITTED) with a stale copy it read earlier.
 */

/**
 * KEYS[1] = {queue:<performanceId>}:session:<queueSessionId>
 * KEYS[2] = {queue:<performanceId>}:waiting
 * KEYS[3] = {queue:<performanceId>}:active
 * KEYS[4] = {queue:<performanceId>}:identity:<userId>:<familyId>:<deviceSlotId>
 * ARGV[1] = queueSessionId
 * ARGV[2] = op: admit | touch | recovery | expire | release
 *
 * admit    ARGV[3..7] = admittedAt, activeUntilAt, reentryGraceUntilAt, expiresAt, ttlMs
 *          ARGV[8]    = admission capacity ('' = admit unconditionally). With a
 *                       capacity the session is admitted only when every waiting
 *                       session ahead of it also fits into the free active slots.
 * touch    ARGV[3]    = replacement admission token hash ('' = keep)
 *          ARGV[4..5] = sliding WAITING expiresAt, ttlMs ('' = keep the current TTL)
 *          ARGV[6]    = original enteredAt score used to restore a WAITING
 *                       session that lost its waiting-line membership
 * recovery ARGV[3..6] = expected admittedAt, paymentRecoveryUntilAt, expiresAt, ttlMs
 * expire   ARGV[3]    = expected "state|activeUntilAt|paymentRecoveryUntilAt" ('' = any)
 *          ARGV[4..5] = expiresAt, ttlMs
 * release  ARGV[3..5] = unused, expiresAt, ttlMs (returns a slot after a purchase)
 *
 * Returns {applied, status, recordJson, tokenHashBeforeTransition, ttlMs}.
 */
export const QUEUE_SESSION_TRANSITION_LUA = `
-- QUEUE_SESSION_TRANSITION_LUA
local sessionKey = KEYS[1]
local waitingKey = KEYS[2]
local activeKey = KEYS[3]
local identityKey = KEYS[4]
local id = ARGV[1]
local op = ARGV[2]

local raw = redis.call('GET', sessionKey)
if not raw then
  redis.call('ZREM', waitingKey, id)
  redis.call('SREM', activeKey, id)
  return {0, 'MISSING', '', '', 0}
end

local record = cjson.decode(raw)

local function text(value)
  if value == nil or value == cjson.null then
    return ''
  end
  return tostring(value)
end

local function currentTtlMs()
  local pttl = redis.call('PTTL', sessionKey)
  if pttl < 1 then
    return 1000
  end
  return pttl
end

local function save(ttlMs)
  local ttl = math.max(1, math.floor(tonumber(ttlMs) or 1000))
  local encoded = cjson.encode(record)
  redis.call('SET', sessionKey, encoded, 'PX', ttl)
  local owner = redis.call('GET', identityKey)
  if (not owner) or owner == id then
    redis.call('SET', identityKey, id, 'PX', ttl)
  end
  return encoded, ttl
end

local tokenHash = text(record.admissionTokenHash)

if op == 'admit' then
  if record.state ~= 'WAITING' then
    redis.call('ZREM', waitingKey, id)
    return {0, text(record.state), raw, tokenHash, 0}
  end
  if ARGV[8] ~= '' then
    local rank = redis.call('ZRANK', waitingKey, id)
    if not rank then
      return {0, 'NOT_QUEUED', raw, tokenHash, 0}
    end
    local available = tonumber(ARGV[8]) - redis.call('SCARD', activeKey)
    if rank >= available then
      return {0, 'NO_CAPACITY', raw, tokenHash, 0}
    end
  end
  record.state = 'ADMITTED'
  record.admittedAt = ARGV[3]
  record.activeUntilAt = ARGV[4]
  record.reentryGraceUntilAt = ARGV[5]
  record.paymentRecoveryUntilAt = cjson.null
  record.expiresAt = ARGV[6]
  local encoded, ttl = save(ARGV[7])
  redis.call('ZREM', waitingKey, id)
  redis.call('SADD', activeKey, id)
  return {1, 'ADMITTED', encoded, tokenHash, ttl}
end

if op == 'touch' then
  if record.state == 'EXPIRED' then
    return {0, 'EXPIRED', raw, tokenHash, 0}
  end
  if ARGV[3] ~= '' then
    record.admissionTokenHash = ARGV[3]
  end
  local ttlMs = nil
  if record.state == 'WAITING' then
    if ARGV[4] ~= '' then
      record.expiresAt = ARGV[4]
      ttlMs = ARGV[5]
    end
    redis.call('SREM', activeKey, id)
    redis.call('ZADD', waitingKey, 'NX', ARGV[6], id)
  end
  if ttlMs == nil then
    ttlMs = currentTtlMs()
  end
  local encoded, ttl = save(ttlMs)
  return {1, text(record.state), encoded, tokenHash, ttl}
end

if op == 'recovery' then
  if record.state ~= 'ADMITTED' or text(record.admittedAt) ~= ARGV[3] then
    return {0, text(record.state), raw, tokenHash, 0}
  end
  if text(record.paymentRecoveryUntilAt) >= ARGV[4] then
    return {0, 'UNCHANGED', raw, tokenHash, 0}
  end
  record.paymentRecoveryUntilAt = ARGV[4]
  record.expiresAt = ARGV[5]
  local encoded, ttl = save(ARGV[6])
  return {1, 'ADMITTED', encoded, tokenHash, ttl}
end

if op == 'expire' or op == 'release' then
  if record.state == 'EXPIRED' then
    redis.call('ZREM', waitingKey, id)
    redis.call('SREM', activeKey, id)
    return {0, 'EXPIRED', raw, tokenHash, 0}
  end
  if op == 'release' and record.state == 'WAITING' then
    return {0, 'WAITING', raw, tokenHash, 0}
  end
  if op == 'expire' and ARGV[3] ~= '' then
    local fingerprint = text(record.state) .. '|' .. text(record.activeUntilAt) .. '|' .. text(record.paymentRecoveryUntilAt)
    if fingerprint ~= ARGV[3] then
      return {0, 'CHANGED', raw, tokenHash, 0}
    end
  end
  record.state = 'EXPIRED'
  record.expiresAt = ARGV[4]
  local encoded, ttl = save(ARGV[5])
  redis.call('ZREM', waitingKey, id)
  redis.call('SREM', activeKey, id)
  return {1, 'EXPIRED', encoded, tokenHash, ttl}
end

return redis.error_reply('UNKNOWN_QUEUE_SESSION_TRANSITION')
`;

/**
 * Creates a WAITING session only when the identity has no session yet (SET NX
 * semantics on the identity key), so concurrent tabs share one queue position.
 *
 * KEYS[1] = identity key, KEYS[2] = session key, KEYS[3] = waiting zset
 * ARGV[1] = queueSessionId, ARGV[2] = record JSON, ARGV[3] = ttlMs, ARGV[4] = score
 * Returns {1, queueSessionId} or {0, existingQueueSessionId}.
 */
export const CREATE_QUEUE_SESSION_LUA = `
-- CREATE_QUEUE_SESSION_LUA
local owner = redis.call('GET', KEYS[1])
if owner then
  return {0, owner}
end
local ttl = math.max(1, math.floor(tonumber(ARGV[3]) or 1000))
redis.call('SET', KEYS[2], ARGV[2], 'PX', ttl)
redis.call('SET', KEYS[1], ARGV[1], 'PX', ttl)
redis.call('ZADD', KEYS[3], ARGV[4], ARGV[1])
return {1, ARGV[1]}
`;

/**
 * Removes a session that is missing, EXPIRED, or past expiresAt. A live session
 * is left untouched (returns 0) so a concurrent admission is never discarded.
 * The identity key is deleted only while it still points at this session.
 *
 * KEYS[1] = session key, KEYS[2] = waiting zset, KEYS[3] = active set, KEYS[4] = identity key
 * ARGV[1] = queueSessionId, ARGV[2] = now (ISO-8601)
 */
export const PURGE_QUEUE_SESSION_LUA = `
-- PURGE_QUEUE_SESSION_LUA
local raw = redis.call('GET', KEYS[1])
if raw then
  local record = cjson.decode(raw)
  local expiresAt = record.expiresAt
  if record.state ~= 'EXPIRED' and type(expiresAt) == 'string' and expiresAt > ARGV[2] then
    return 0
  end
  redis.call('DEL', KEYS[1])
end
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('SREM', KEYS[3], ARGV[1])
if redis.call('GET', KEYS[4]) == ARGV[1] then
  redis.call('DEL', KEYS[4])
end
return 1
`;

/**
 * Counts live seat locks for one showtime and removes members whose lock key
 * already expired. The locked-seats set has no TTL, so SCARD alone would keep
 * counting abandoned locks forever.
 *
 * KEYS[1] = {showtimeId}:locked-seats
 * ARGV[1] = lock key prefix "{showtimeId}:seat:"
 */
export const COUNT_VALID_LOCKED_SEATS_LUA = `
-- COUNT_VALID_LOCKED_SEATS_LUA
local members = redis.call('SMEMBERS', KEYS[1])
local alive = 0
for _, seatId in ipairs(members) do
  if redis.call('EXISTS', ARGV[1] .. seatId) == 1 then
    alive = alive + 1
  else
    redis.call('SREM', KEYS[1], seatId)
  end
end
return alive
`;

const QUEUE_SCRIPT_MARKERS = [
  'QUEUE_SESSION_TRANSITION_LUA',
  'CREATE_QUEUE_SESSION_LUA',
  'PURGE_QUEUE_SESSION_LUA',
  'COUNT_VALID_LOCKED_SEATS_LUA',
] as const;

/** Minimal command surface used by the local-development emulation below. */
export interface QueueScriptStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
  pttl(key: string): Promise<number>;
  zadd(key: string, score: number | string, member: string): Promise<number>;
  zrem(key: string, ...members: string[]): Promise<number>;
  zrank(key: string, member: string): Promise<number | null>;
  sadd(key: string, ...members: string[]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  scard(key: string): Promise<number>;
}

export function isQueueScript(script: string): boolean {
  return QUEUE_SCRIPT_MARKERS.some((marker) => script.includes(marker));
}

type JsonRecord = Record<string, unknown>;

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

const inMemoryScriptQueues = new WeakMap<QueueScriptStore, Promise<unknown>>();

/**
 * JavaScript mirror of the queue Lua scripts for the local-development
 * InMemoryRedis and unit tests. Production always runs the Lua above; the
 * Valkey integration spec checks that both behave the same way.
 *
 * Emulated scripts run one at a time per store, matching the atomicity of a
 * Lua script (each store command awaits, which would otherwise interleave).
 */
export function evalQueueScriptInMemory(
  store: QueueScriptStore,
  script: string,
  keys: string[],
  args: string[],
): Promise<unknown> {
  const previous = inMemoryScriptQueues.get(store) ?? Promise.resolve();
  const run = previous.then(() => runQueueScriptInMemory(store, script, keys, args));
  inMemoryScriptQueues.set(store, run.catch(() => undefined));
  return run;
}

async function runQueueScriptInMemory(
  store: QueueScriptStore,
  script: string,
  keys: string[],
  args: string[],
): Promise<unknown> {
  if (script.includes('COUNT_VALID_LOCKED_SEATS_LUA')) {
    const [lockedSeatsKey] = keys as [string];
    const [lockPrefix] = args as [string];
    let alive = 0;
    for (const seatId of await store.smembers(lockedSeatsKey)) {
      if ((await store.get(`${lockPrefix}${seatId}`)) !== null) {
        alive += 1;
      } else {
        await store.srem(lockedSeatsKey, seatId);
      }
    }
    return alive;
  }

  if (script.includes('CREATE_QUEUE_SESSION_LUA')) {
    const [identityKey, sessionKey, waitingKey] = keys as [string, string, string];
    const [queueSessionId, recordJson, ttlMs, score] = args as [string, string, string, string];
    const owner = await store.get(identityKey);
    if (owner) {
      return [0, owner];
    }
    const ttl = Math.max(1, Math.floor(Number(ttlMs) || 1000));
    await store.set(sessionKey, recordJson, 'PX', ttl);
    await store.set(identityKey, queueSessionId, 'PX', ttl);
    await store.zadd(waitingKey, score, queueSessionId);
    return [1, queueSessionId];
  }

  if (script.includes('PURGE_QUEUE_SESSION_LUA')) {
    const [sessionKey, waitingKey, activeKey, identityKey] = keys as [string, string, string, string];
    const [queueSessionId, nowIso] = args as [string, string];
    const raw = await store.get(sessionKey);
    if (raw) {
      const record = JSON.parse(raw) as JsonRecord;
      if (
        record['state'] !== 'EXPIRED'
        && typeof record['expiresAt'] === 'string'
        && record['expiresAt'] > nowIso
      ) {
        return 0;
      }
      await store.del(sessionKey);
    }
    await store.zrem(waitingKey, queueSessionId);
    await store.srem(activeKey, queueSessionId);
    if ((await store.get(identityKey)) === queueSessionId) {
      await store.del(identityKey);
    }
    return 1;
  }

  if (script.includes('QUEUE_SESSION_TRANSITION_LUA')) {
    return evalTransitionInMemory(store, keys, args);
  }

  throw new Error('evalQueueScriptInMemory: unknown queue script');
}

async function evalTransitionInMemory(
  store: QueueScriptStore,
  keys: string[],
  args: string[],
): Promise<unknown> {
  const [sessionKey, waitingKey, activeKey, identityKey] = keys as [string, string, string, string];
  const [id, op] = args as [string, string];
  const arg = (index: number): string => args[index - 1] ?? '';

  const raw = await store.get(sessionKey);
  if (!raw) {
    await store.zrem(waitingKey, id);
    await store.srem(activeKey, id);
    return [0, 'MISSING', '', '', 0];
  }

  const record = JSON.parse(raw) as JsonRecord;
  const tokenHash = text(record['admissionTokenHash']);

  const save = async (ttlMs: unknown): Promise<[string, number]> => {
    const ttl = Math.max(1, Math.floor(Number(ttlMs) || 1000));
    const encoded = JSON.stringify(record);
    await store.set(sessionKey, encoded, 'PX', ttl);
    const owner = await store.get(identityKey);
    if (!owner || owner === id) {
      await store.set(identityKey, id, 'PX', ttl);
    }
    return [encoded, ttl];
  };

  if (op === 'admit') {
    if (record['state'] !== 'WAITING') {
      await store.zrem(waitingKey, id);
      return [0, text(record['state']), raw, tokenHash, 0];
    }
    if (arg(8) !== '') {
      const rank = await store.zrank(waitingKey, id);
      if (rank === null) {
        return [0, 'NOT_QUEUED', raw, tokenHash, 0];
      }
      const available = Number(arg(8)) - await store.scard(activeKey);
      if (rank >= available) {
        return [0, 'NO_CAPACITY', raw, tokenHash, 0];
      }
    }
    record['state'] = 'ADMITTED';
    record['admittedAt'] = arg(3);
    record['activeUntilAt'] = arg(4);
    record['reentryGraceUntilAt'] = arg(5);
    record['paymentRecoveryUntilAt'] = null;
    record['expiresAt'] = arg(6);
    const [encoded, ttl] = await save(arg(7));
    await store.zrem(waitingKey, id);
    await store.sadd(activeKey, id);
    return [1, 'ADMITTED', encoded, tokenHash, ttl];
  }

  if (op === 'touch') {
    if (record['state'] === 'EXPIRED') {
      return [0, 'EXPIRED', raw, tokenHash, 0];
    }
    if (arg(3) !== '') {
      record['admissionTokenHash'] = arg(3);
    }
    let ttlMs: number | string | null = null;
    if (record['state'] === 'WAITING') {
      if (arg(4) !== '') {
        record['expiresAt'] = arg(4);
        ttlMs = arg(5);
      }
      await store.srem(activeKey, id);
      if ((await store.zrank(waitingKey, id)) === null) {
        await store.zadd(waitingKey, arg(6), id);
      }
    }
    if (ttlMs === null) {
      const pttl = await store.pttl(sessionKey);
      ttlMs = pttl < 1 ? 1000 : pttl;
    }
    const [encoded, ttl] = await save(ttlMs);
    return [1, text(record['state']), encoded, tokenHash, ttl];
  }

  if (op === 'recovery') {
    if (record['state'] !== 'ADMITTED' || text(record['admittedAt']) !== arg(3)) {
      return [0, text(record['state']), raw, tokenHash, 0];
    }
    if (text(record['paymentRecoveryUntilAt']) >= arg(4)) {
      return [0, 'UNCHANGED', raw, tokenHash, 0];
    }
    record['paymentRecoveryUntilAt'] = arg(4);
    record['expiresAt'] = arg(5);
    const [encoded, ttl] = await save(arg(6));
    return [1, 'ADMITTED', encoded, tokenHash, ttl];
  }

  if (op === 'expire' || op === 'release') {
    if (record['state'] === 'EXPIRED') {
      await store.zrem(waitingKey, id);
      await store.srem(activeKey, id);
      return [0, 'EXPIRED', raw, tokenHash, 0];
    }
    if (op === 'release' && record['state'] === 'WAITING') {
      return [0, 'WAITING', raw, tokenHash, 0];
    }
    if (op === 'expire' && arg(3) !== '') {
      const fingerprint = [
        text(record['state']),
        text(record['activeUntilAt']),
        text(record['paymentRecoveryUntilAt']),
      ].join('|');
      if (fingerprint !== arg(3)) {
        return [0, 'CHANGED', raw, tokenHash, 0];
      }
    }
    record['state'] = 'EXPIRED';
    record['expiresAt'] = arg(4);
    const [encoded, ttl] = await save(arg(5));
    await store.zrem(waitingKey, id);
    await store.srem(activeKey, id);
    return [1, 'EXPIRED', encoded, tokenHash, ttl];
  }

  throw new Error('UNKNOWN_QUEUE_SESSION_TRANSITION');
}
