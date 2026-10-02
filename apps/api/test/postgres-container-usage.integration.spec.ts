import { readdirSync, readFileSync } from 'node:fs';
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { join, relative, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  isRetryablePostgresStartupError,
  waitForPostgresReady,
  type PostgresConnectionConfig,
} from './helpers/postgres-container.js';

/**
 * Integration specs used to start `postgres:16[-alpine]` inline and query it as
 * soon as the mapped port answered, which intermittently failed with 57P03
 * ("the database system is starting up"), mostly on CI. This spec needs no
 * Docker: it pins every spec to the shared helper and exercises the readiness
 * probe against a fake server that speaks the PostgreSQL wire protocol.
 */
const API_ROOT = resolve(__dirname, '..');
const HELPER = join(API_ROOT, 'test/helpers/postgres-container.ts');
const INLINE_POSTGRES_CONTAINER = /GenericContainer\(\s*[`'"]postgres/;
const HELPER_IMPORT = /from '\.\/helpers\/postgres-container\.js'/;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === 'dist') return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

describe('integration spec PostgreSQL startup', () => {
  it('starts PostgreSQL only through startPostgresContainer', () => {
    const files = [
      ...walk(join(API_ROOT, 'test')).filter((file) => file.endsWith('.ts')),
      ...walk(join(API_ROOT, 'src')).filter((file) => file.endsWith('.integration.spec.ts')),
    ].filter((file) => file !== HELPER);

    const inline = files.filter((file) => INLINE_POSTGRES_CONTAINER.test(readFileSync(file, 'utf8')));
    expect(inline.map((file) => relative(API_ROOT, file))).toEqual([]);

    // Guards against the scan silently reading nothing.
    const usingHelper = files.filter((file) => HELPER_IMPORT.test(readFileSync(file, 'utf8')));
    expect(usingHelper.length).toBeGreaterThanOrEqual(25);
  });

  it('retries only the errors a starting server returns', () => {
    const withCode = (code: string, message = 'x') => Object.assign(new Error(message), { code });
    for (const error of [
      withCode('57P03', 'the database system is starting up'),
      new Error('the database system is starting up'),
      withCode('ECONNREFUSED'),
      withCode('ECONNRESET'),
      withCode('EPIPE'),
      new Error('Connection terminated unexpectedly'),
      // node-postgres' per-attempt connect timeout.
      new Error('timeout expired'),
    ]) {
      expect(isRetryablePostgresStartupError(error), error.message).toBe(true);
    }
    for (const error of [
      withCode('28P01', 'password authentication failed for user "postgres"'),
      withCode('3D000', 'database "missing" does not exist'),
      new Error('relation "users" does not exist'),
      'the database system is starting up',
    ]) {
      expect(isRetryablePostgresStartupError(error)).toBe(false);
    }
  });
});

type FakeBehavior = 'starting-up' | 'auth-failed' | 'ready';

function message(type: string, body: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeInt32BE(body.length + 4);
  return Buffer.concat([Buffer.from(type), length, body]);
}

function errorResponse(code: string, text: string): Buffer {
  const fields = [['S', 'FATAL'], ['V', 'FATAL'], ['C', code], ['M', text]]
    .map(([field, value]) => `${field}${value}\0`)
    .join('');
  return message('E', Buffer.from(`${fields}\0`));
}

function int16(value: number) { const buffer = Buffer.alloc(2); buffer.writeInt16BE(value); return buffer; }
function int32(value: number) { const buffer = Buffer.alloc(4); buffer.writeInt32BE(value); return buffer; }

const READY_FOR_QUERY = message('Z', Buffer.from('I'));
const SELECT_ONE_RESULT = Buffer.concat([
  message('T', Buffer.concat([int16(1), Buffer.from('?column?\0'), int32(0), int16(0), int32(23), int16(4), int32(-1), int16(0)])),
  message('D', Buffer.concat([int16(1), int32(1), Buffer.from('1')])),
  message('C', Buffer.from('SELECT 1\0')),
  READY_FOR_QUERY,
]);

/**
 * Answers the n-th connection with `plan[n]` (the last entry repeats):
 * a FATAL 57P03 like a starting server, a FATAL 28P01, or a working session
 * that answers one simple query.
 */
function serveFakePostgres(socket: Socket, behavior: FakeBehavior) {
  let buffered = Buffer.alloc(0);
  let started = false;
  socket.on('error', () => undefined);
  socket.on('data', (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    for (;;) {
      if (!started) {
        if (buffered.length < 4) return;
        const length = buffered.readInt32BE(0);
        if (buffered.length < length) return;
        buffered = buffered.subarray(length);
        started = true;
        if (behavior === 'starting-up') {
          socket.end(errorResponse('57P03', 'the database system is starting up'));
          return;
        }
        if (behavior === 'auth-failed') {
          socket.end(errorResponse('28P01', 'password authentication failed for user "postgres"'));
          return;
        }
        socket.write(Buffer.concat([message('R', int32(0)), READY_FOR_QUERY]));
        continue;
      }
      if (buffered.length < 5) return;
      const type = String.fromCharCode(buffered[0]!);
      const length = buffered.readInt32BE(1);
      if (buffered.length < length + 1) return;
      buffered = buffered.subarray(length + 1);
      if (type === 'Q') socket.write(SELECT_ONE_RESULT);
      if (type === 'X') {
        socket.end();
        return;
      }
    }
  });
}

async function listen(server: Server, port = 0): Promise<number> {
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolveListen());
  });
  return (server.address() as AddressInfo).port;
}

describe('waitForPostgresReady', () => {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  });

  async function fakePostgres(plan: FakeBehavior[], port = 0) {
    let connections = 0;
    const server = createServer((socket) => {
      const behavior = plan[Math.min(connections, plan.length - 1)]!;
      connections += 1;
      serveFakePostgres(socket, behavior);
    });
    servers.push(server);
    const boundPort = await listen(server, port);
    return { port: boundPort, connections: () => connections };
  }

  const config = (port: number): PostgresConnectionConfig => ({
    host: '127.0.0.1', port, user: 'postgres', password: 'test', database: 'probe_test',
  });

  it('retries 57P03 until the server accepts a query', async () => {
    const server = await fakePostgres(['starting-up', 'starting-up', 'ready']);
    const retried: string[] = [];

    const attempts = await waitForPostgresReady(config(server.port), {
      timeoutMs: 10_000,
      initialDelayMs: 10,
      onRetry: (error) => retried.push((error as Error & { code?: string }).code ?? error.message),
    });

    expect(attempts).toBe(3);
    expect(server.connections()).toBe(3);
    expect(retried).toEqual(['57P03', '57P03']);
  });

  it('waits for a port that is not listening yet', async () => {
    const placeholder = createServer();
    const port = await listen(placeholder);
    await new Promise((done) => placeholder.close(done));
    const retried: string[] = [];

    const opened = new Promise<{ connections: () => number }>((resolveOpened) => {
      setTimeout(() => { void fakePostgres(['ready'], port).then(resolveOpened); }, 300);
    });
    const attempts = await waitForPostgresReady(config(port), {
      timeoutMs: 10_000,
      initialDelayMs: 50,
      onRetry: (error) => retried.push((error as Error & { code?: string }).code ?? error.message),
    });

    expect((await opened).connections()).toBe(1);
    expect(attempts).toBeGreaterThan(1);
    expect(new Set(retried)).toEqual(new Set(['ECONNREFUSED']));
  });

  it('throws a non-startup error at once', async () => {
    const server = await fakePostgres(['auth-failed', 'ready']);

    await expect(waitForPostgresReady(config(server.port), { timeoutMs: 10_000, initialDelayMs: 10 }))
      .rejects.toMatchObject({ code: '28P01' });
    expect(server.connections()).toBe(1);
  });

  it('throws the last startup error once the deadline passes', async () => {
    const server = await fakePostgres(['starting-up']);
    const startedAt = Date.now();

    await expect(waitForPostgresReady(config(server.port), { timeoutMs: 600, initialDelayMs: 50, maxDelayMs: 100 }))
      .rejects.toMatchObject({ code: '57P03', message: 'the database system is starting up' });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(550);
    expect(server.connections()).toBeGreaterThan(2);
  });
});
