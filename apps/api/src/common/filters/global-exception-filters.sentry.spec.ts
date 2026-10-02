import { createServer, type Server, type Socket } from 'node:net';
import { Controller, Get, Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as Sentry from '@sentry/nestjs';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSentryInitOptions } from '../observability/sentry-options.js';
import { createGlobalExceptionFilters } from './global-exception-filters.js';

// Bound values of a sign-up and a payment confirm query.
const EMAIL = 'buyer@example.test';
const PHONE = '+821012345678';
const PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA';
const PAYMENT_KEY = 'tgen_payment_key_value';
const ORDER_ID = 'grabit-order-7f3c';
const BOUND_VALUES = [EMAIL, PHONE, PASSWORD_HASH, PAYMENT_KEY, ORDER_ID];

let db: NodePgDatabase;

@Controller('probe')
class DbProbeController {
  @Get('signup')
  async signup(): Promise<void> {
    await db.execute(sql`
      insert into users (email, phone, password_hash)
      values (${EMAIL}, ${PHONE}, ${PASSWORD_HASH})
    `);
  }

  @Get('confirm')
  async confirm(): Promise<void> {
    await db.execute(
      sql`select id from payments where payment_key = ${PAYMENT_KEY} and order_id = ${ORDER_ID}`,
    );
  }
}

function envelopeText(body: string | Uint8Array): string {
  return typeof body === 'string' ? body : new TextDecoder().decode(body);
}

/**
 * The real failure chain behind #156: drizzle-orm wraps a pg pool connection
 * timeout in `DrizzleQueryError` (message `Failed query: ...\nparams: ...`),
 * the catch-all filter reports it, and the event goes through the API Sentry
 * options. The bound values must not reach Sentry or the error log.
 */
describe('catch-all filter + Sentry options with a real DrizzleQueryError', () => {
  let app: INestApplication;
  let pool: Pool;
  let hangingServer: Server;
  let client: Sentry.NodeClient;
  const sockets = new Set<Socket>();
  const envelopes: string[] = [];
  const loggerError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

  beforeAll(async () => {
    // Accepts TCP connections but never answers the Postgres startup message,
    // so the pool hits its connection timeout as during a Cloud SQL stall.
    hangingServer = createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => hangingServer.listen(0, '127.0.0.1', resolve));
    const address = hangingServer.address();
    if (address === null || typeof address === 'string') throw new Error('no port');

    pool = new Pool({
      host: '127.0.0.1',
      port: address.port,
      user: 'grabit',
      database: 'grabit',
      connectionTimeoutMillis: 200,
    });
    db = drizzle(pool);

    const options = buildSentryInitOptions({ NODE_ENV: 'test' });
    if (!Array.isArray(options.integrations)) throw new Error('expected an integration array');
    client = new Sentry.NodeClient({
      ...options,
      dsn: 'https://public@o0.ingest.sentry.io/1',
      // The HTTP integration would patch node:http for the whole test process.
      integrations: [
        ...options.integrations.filter((integration) => integration.name === 'RequestData'),
        Sentry.linkedErrorsIntegration(),
      ],
      stackParser: Sentry.defaultStackParser,
      transport: (transportOptions) => Sentry.createTransport(transportOptions, (sent) => {
        envelopes.push(envelopeText(sent.body));
        return Promise.resolve({ statusCode: 200 });
      }),
    });
    Sentry.setCurrentClient(client);
    client.init();

    const moduleRef = await Test.createTestingModule({
      controllers: [DbProbeController],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalFilters(...createGlobalExceptionFilters());
    await app.init();
  });

  beforeEach(() => {
    envelopes.length = 0;
    loggerError.mockClear();
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => hangingServer.close(() => resolve()));
    Sentry.getCurrentScope().setClient(undefined);
    await client?.close(100);
    loggerError.mockRestore();
  });

  it.each([
    ['signup', 'insert into users'],
    ['confirm', 'select id from payments'],
  ])('reports the %s query failure without its bound values', async (route, sqlText) => {
    const response = await request(app.getHttpServer()).get(`/probe/${route}`);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      statusCode: 500,
      message: 'Internal server error',
      timestamp: expect.any(String),
    });

    await client.flush(1000);
    expect(envelopes).toHaveLength(1);
    const envelope = envelopes[0]!;
    // The event still tells operators which query failed and why.
    expect(envelope).toContain('Failed query:');
    expect(envelope).toContain(sqlText);
    expect(envelope).toContain('params: [Filtered]');
    expect(envelope).toMatch(/connection timeout/i);
    expect(envelope).toContain('"http.status_code":"500"');

    expect(loggerError).toHaveBeenCalledTimes(1);
    const [logMessage, logStack] = loggerError.mock.calls[0] ?? [];
    expect(logMessage).toContain('params: [Filtered]');
    expect(String(logStack)).toMatch(/Caused by: Error: Connection terminated due to connection timeout/);

    const logged = JSON.stringify(loggerError.mock.calls);
    for (const value of BOUND_VALUES) {
      expect(envelope).not.toContain(value);
      expect(logged).not.toContain(value);
    }
  });
});
