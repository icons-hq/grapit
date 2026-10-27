import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { Server } from 'socket.io';
import { SocketTransportGuard } from '../providers/socket-transport-guard.js';
import { SOCKET_ACCESS_COOKIE } from '../../../common/socket-access.js';

const secret = 'socket-transport-test-secret-with-enough-entropy';
const jwt = new JwtService({ secret });
const token = (sub = randomUUID()) => jwt.sign({ sub, role: 'user' }, { expiresIn: '15m' });
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function start(maximum = 850, perUser = 4) {
  const http = createServer();
  const guard = new SocketTransportGuard(secret, maximum, perUser);
  const server = new Server(http, { allowRequest: guard.allowRequest, connectTimeout: 5000 });
  server.engine.on('connection', guard.connected);
  servers.push(server);
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('Missing server address');
  const url = `http://127.0.0.1:${address.port}/socket.io/?EIO=4&transport=polling`;
  return { server, handshake: (headers: Record<string, string> = {}) => fetch(url, { headers }) };
}

describe('Socket.IO transport admission', () => {
  it('rejects anonymous, expired, forged and non-access tokens before creating an Engine.IO transport', async () => {
    const { server, handshake } = await start();
    const tokens = [null, `${token()}forged`, jwt.sign({ sub: randomUUID(), role: 'user' }, { expiresIn: -1 }), jwt.sign({ type: 'registration' })];
    for (const value of tokens) {
      const response = await handshake(value ? { Authorization: `Bearer ${value}` } : {});
      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain(value ?? 'undefined');
      expect(server.engine.clientsCount).toBe(0);
    }
  });

  it('accepts the browser httpOnly cookie and authenticated tooling without putting a token in the URL', async () => {
    const { server, handshake } = await start();
    expect((await handshake({ Cookie: `unrelated=1; ${SOCKET_ACCESS_COOKIE}=${token()}` })).status).toBe(200);
    expect((await handshake({ Authorization: `Bearer ${token()}` })).status).toBe(200);
    expect(server.engine.clientsCount).toBe(2);
  });

  it('bounds concurrent account handshakes and frees a slot when the transport closes', async () => {
    const { server, handshake } = await start(5, 1);
    const headers = { Authorization: `Bearer ${token()}` };
    const responses = await Promise.all(Array.from({ length: 8 }, () => handshake(headers)));
    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    expect(server.engine.clientsCount).toBe(1);
    Object.values(server.engine.clients)[0]!.close(true);
    expect((await handshake(headers)).status).toBe(200);
  });

  it('rejects a foreign browser origin even when it sends a valid cookie', async () => {
    const { server, handshake } = await start();
    expect((await handshake({ Origin: 'https://foreign.invalid', Cookie: `${SOCKET_ACCESS_COOKIE}=${token()}` })).status).toBe(403);
    expect(server.engine.clientsCount).toBe(0);
  });

  it('preserves HTTP headroom across different accounts, including raw clients that never join a namespace', async () => {
    const { server, handshake } = await start(2, 4);
    const responses = await Promise.all(Array.from({ length: 8 }, () => handshake({ Authorization: `Bearer ${token()}` })));
    expect(responses.filter((response) => response.status === 200)).toHaveLength(2);
    expect(server.engine.clientsCount).toBe(2);
  });
});
