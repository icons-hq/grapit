import { isIP } from 'node:net';
import type { Request } from 'express';

const FALLBACK_IP = '0.0.0.0';

export function resolveTrustedRequestIp(req: Request): string {
  const headers = req.headers ?? {};
  const ip =
    firstHeaderIp(headers['cf-connecting-ip']) ||
    firstHeaderIp(headers['true-client-ip']) ||
    firstForwardedForIp(headers['x-forwarded-for']) ||
    req.ip ||
    req.socket.remoteAddress ||
    FALLBACK_IP;
  return isIP(ip) ? ip : FALLBACK_IP;
}

function firstHeaderIp(value: string | string[] | undefined): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && isIP(candidate) ? candidate : null;
}

function firstForwardedForIp(value: string | string[] | undefined): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  const firstIp = candidate?.split(',')[0]?.trim();
  return firstIp && isIP(firstIp) ? firstIp : null;
}
