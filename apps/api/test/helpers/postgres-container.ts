import { setTimeout as delay } from 'node:timers/promises';
import { Client } from 'pg';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

/**
 * The one way integration specs start PostgreSQL (enforced by
 * postgres-container-usage.integration.spec.ts).
 *
 * The official image's entrypoint runs initdb against a temporary server
 * (unix socket only) and stops it, then starts the final server. Each logs
 * "database system is ready to accept connections". The default wait strategy
 * only checks the mapped port, which is satisfied as soon as the final server
 * binds TCP: connections in the next moments still fail with 57P03 ("the
 * database system is starting up"), and a slow or busy CI runner widens that
 * window. So startup waits for both readiness log lines and then for a real
 * `SELECT 1` on a fresh connection before any Pool or migration uses it.
 */
export interface PostgresContainerOptions {
  database: string;
  /** Keep the image a spec already used (`postgres:16` or `postgres:16-alpine`). */
  image?: string;
  user?: string;
  password?: string;
  /** Files the container needs before it starts, e.g. SQL a spec runs through `container.exec`. */
  copyFilesToContainer?: Array<{ source: string; target: string }>;
}

export interface PostgresConnectionConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface StartedPostgres extends PostgresConnectionConfig {
  container: StartedTestContainer;
  connectionString: string;
}

export interface WaitForPostgresReadyOptions {
  timeoutMs?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  /** Called before each retry with the error that caused it. */
  onRetry?: (error: Error, attempt: number) => void;
}

const POSTGRES_PORT = 5432;
const READY_LOG_MESSAGE = /database system is ready to accept connections/;
const CONTAINER_STARTUP_TIMEOUT_MS = 120_000;
const READY_PROBE_TIMEOUT_MS = 60_000;
const PROBE_CONNECT_TIMEOUT_MS = 5_000;
const PROBE_END_TIMEOUT_MS = 1_000;

const RETRYABLE_ERROR_CODES = new Set(['57P03', 'ECONNREFUSED', 'ECONNRESET', 'EPIPE']);
const RETRYABLE_ERROR_MESSAGES = [
  'the database system is starting up',
  'Connection terminated unexpectedly',
  // node-postgres' own per-attempt connect timeout (connectionTimeoutMillis).
  'timeout expired',
];

export async function startPostgresContainer(options: PostgresContainerOptions): Promise<StartedPostgres> {
  const { database, image = 'postgres:16-alpine', user = 'postgres', password = 'test' } = options;
  let definition = new GenericContainer(image)
    .withEnvironment({ POSTGRES_PASSWORD: password, POSTGRES_USER: user, POSTGRES_DB: database })
    .withExposedPorts(POSTGRES_PORT)
    .withWaitStrategy(Wait.forAll([Wait.forListeningPorts(), Wait.forLogMessage(READY_LOG_MESSAGE, 2)]))
    .withStartupTimeout(CONTAINER_STARTUP_TIMEOUT_MS);
  if (options.copyFilesToContainer?.length) {
    definition = definition.withCopyFilesToContainer(options.copyFilesToContainer);
  }
  const container = await definition.start();

  const config: PostgresConnectionConfig = {
    host: container.getHost(),
    port: container.getMappedPort(POSTGRES_PORT),
    user,
    password,
    database,
  };
  try {
    await waitForPostgresReady(config, { timeoutMs: READY_PROBE_TIMEOUT_MS });
  } catch (error) {
    await container.stop().catch(() => undefined);
    throw error;
  }
  return {
    container,
    ...config,
    connectionString:
      `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}`
      + `@${config.host}:${config.port}/${encodeURIComponent(database)}`,
  };
}

/** Errors PostgreSQL (or the port mapping in front of it) returns while it is still starting. */
export function isRetryablePostgresStartupError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: unknown }).code;
  if (typeof code === 'string' && RETRYABLE_ERROR_CODES.has(code)) return true;
  return RETRYABLE_ERROR_MESSAGES.some((message) => error.message.includes(message));
}

/**
 * Connects with a fresh client and runs `SELECT 1` until it succeeds. Startup
 * errors are retried with a 200ms-1s backoff; any other error is thrown at
 * once. Once `timeoutMs` has passed the last error is thrown (an attempt in
 * flight at the deadline may add up to the 5s connect timeout). Resolves with
 * the number of attempts.
 */
export async function waitForPostgresReady(
  config: PostgresConnectionConfig,
  {
    timeoutMs = READY_PROBE_TIMEOUT_MS,
    initialDelayMs = 200,
    maxDelayMs = 1_000,
    onRetry,
  }: WaitForPostgresReadyOptions = {},
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let backoffMs = initialDelayMs;
  for (let attempt = 1; ; attempt += 1) {
    // A fixed per-attempt bound, not the time left: an attempt that starts at
    // the deadline must still report the server's error, not its own timeout.
    const client = new Client({ ...config, connectionTimeoutMillis: PROBE_CONNECT_TIMEOUT_MS });
    // A socket error after the probe settled must not become an uncaught 'error' event.
    client.on('error', () => undefined);
    let connected = false;
    let failure: Error;
    try {
      await client.connect();
      connected = true;
      await client.query('SELECT 1');
      return attempt;
    } catch (error) {
      if (!isRetryablePostgresStartupError(error)) throw error;
      failure = error as Error;
    } finally {
      // A failed connect is torn down by node-postgres itself.
      if (connected) await endQuietly(client);
    }
    const waitMs = Math.min(backoffMs, deadline - Date.now());
    if (waitMs <= 0) throw failure;
    onRetry?.(failure, attempt);
    await delay(waitMs);
    backoffMs = Math.min(backoffMs * 2, maxDelayMs);
  }
}

async function endQuietly(client: Client): Promise<void> {
  const timer = new AbortController();
  await Promise.race([
    client.end().catch(() => undefined),
    delay(PROBE_END_TIMEOUT_MS, undefined, { signal: timer.signal, ref: false }).catch(() => undefined),
  ]);
  timer.abort();
}
