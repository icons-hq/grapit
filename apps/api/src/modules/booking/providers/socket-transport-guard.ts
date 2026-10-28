import type { IncomingMessage } from 'node:http';
import { JwtService } from '@nestjs/jwt';
import { SOCKET_ACCESS_COOKIE } from '../../../common/socket-access.js';
import { isAllowedFrontendOrigin } from '../../../config/frontend-origins.js';
import { prepareJwtVerificationKey } from '../../../common/jwt-verification-key.js';

type Transport = {
  request: IncomingMessage;
  once(event: 'close', listener: () => void): unknown;
  close(discard?: boolean): unknown;
};
type Lease = { release: () => void; timer: ReturnType<typeof setTimeout>; expiresAt: number };

/** Authenticate before Engine.IO upgrades, including clients that never join a
 * namespace. Limits include handshakes in flight, so parallel requests cannot
 * bypass them. With concurrency 1000, 850 transports leave HTTP headroom.
 * Per-user limits are per process (at most eight with the two-instance profile).
 */
export class SocketTransportGuard {
  private readonly jwt: JwtService;
  private readonly leases = new WeakMap<IncomingMessage, Lease>();
  private readonly users = new Map<string, number>();
  private active = 0;

  constructor(
    private readonly secret: string,
    private readonly maximum = 850,
    private readonly perUser = 4,
  ) {
    // Missing config still rejects every handshake in allowRequest.
    this.jwt = new JwtService(secret ? { secret: prepareJwtVerificationKey(secret) } : {});
  }

  readonly allowRequest = (request: IncomingMessage, done: (message: string | null, allowed: boolean) => void): void => {
    try {
      if (!this.secret) throw new Error('Unavailable');
      if (request.headers.origin && !isAllowedFrontendOrigin(request.headers.origin)) throw new Error('Origin');
      const authorization = request.headers.authorization;
      const cookie = request.headers.cookie?.split(';').map((part) => part.trim())
        .find((part) => part.startsWith(`${SOCKET_ACCESS_COOKIE}=`))?.slice(SOCKET_ACCESS_COOKIE.length + 1);
      const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : cookie;
      if (!token || token.length > 8192) throw new Error('Missing token');
      const payload = this.jwt.verify<{ sub?: string; role?: string; exp?: number }>(token, { algorithms: ['HS256'] });
      if (!payload.sub || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.sub)
        || !['user', 'admin'].includes(payload.role ?? '') || !Number.isFinite(payload.exp)) throw new Error('Invalid token');
      if (this.active >= this.maximum || (this.users.get(payload.sub) ?? 0) >= this.perUser) throw new Error('Capacity');
      const user = payload.sub;
      this.active++;
      this.users.set(user, (this.users.get(user) ?? 0) + 1);
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        this.active--;
        const count = (this.users.get(user) ?? 1) - 1;
        if (count) this.users.set(user, count); else this.users.delete(user);
        const lease = this.leases.get(request);
        if (lease) clearTimeout(lease.timer);
        this.leases.delete(request);
      };
      // Failed upgrades must not consume a permanent account slot.
      const timer = setTimeout(release, 10000);
      timer.unref();
      this.leases.set(request, { release, timer, expiresAt: payload.exp! * 1000 });
      done(null, true);
    } catch {
      // Never include tokens or parser errors in a response or log.
      done('Socket access unavailable', false);
    }
  };

  readonly connected = (transport: Transport): void => {
    const lease = this.leases.get(transport.request);
    if (!lease) { transport.close(true); return; }
    clearTimeout(lease.timer);
    // Discard pending polling packets: a client that stops polling must not
    // postpone expiry (and quota release) by withholding a drain event.
    lease.timer = setTimeout(() => transport.close(true), Math.max(1, lease.expiresAt - Date.now()));
    lease.timer.unref();
    transport.once('close', lease.release);
  };
}
