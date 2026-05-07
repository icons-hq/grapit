import { isIP } from 'node:net';
import type { Request } from 'express';

const FALLBACK_IP = '0.0.0.0';

export function resolveTrustedRequestIp(req: Request): string {
  const ip = req.ip || req.socket.remoteAddress || FALLBACK_IP;
  return isIP(ip) ? ip : FALLBACK_IP;
}
