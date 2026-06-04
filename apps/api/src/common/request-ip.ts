import { isIP } from 'node:net';
import type { Request } from 'express';

const FALLBACK_IP = '0.0.0.0';
const CLOUDFLARE_IPV4_CIDRS = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
] as const;
const CLOUDFLARE_IPV6_CIDRS = [
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
] as const;

export function resolveTrustedRequestIp(req: Request): string {
  const headers = req.headers ?? {};
  const proxyPeerIp = normalizedIp(req.ip) ?? normalizedIp(req.socket.remoteAddress);
  const forwardedIp = isCloudflareProxyIp(proxyPeerIp)
    ? firstHeaderIp(headers['cf-connecting-ip']) ||
      firstHeaderIp(headers['true-client-ip']) ||
      firstForwardedForIp(headers['x-forwarded-for'])
    : null;
  const ip =
    forwardedIp ||
    proxyPeerIp ||
    req.socket.remoteAddress ||
    FALLBACK_IP;
  return isIP(ip) ? ip : FALLBACK_IP;
}

function isCloudflareProxyIp(ip: string | null): boolean {
  if (!ip) {
    return false;
  }
  return isIP(ip) === 4
    ? CLOUDFLARE_IPV4_CIDRS.some((cidr) => ipv4InCidr(ip, cidr))
    : CLOUDFLARE_IPV6_CIDRS.some((cidr) => ipv6InCidr(ip, cidr));
}

function normalizedIp(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  if (isIP(value) === 4) {
    return value;
  }
  const mappedIpv4 = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  if (mappedIpv4 && isIP(mappedIpv4) === 4) {
    return mappedIpv4;
  }
  return isIP(value) === 6 ? value : null;
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

function ipv4InCidr(ip: string, cidr: string): boolean {
  const [network, prefixRaw] = cidr.split('/');
  const prefix = Number(prefixRaw);
  const ipNumber = ipv4ToNumber(ip);
  const networkNumber = network ? ipv4ToNumber(network) : null;
  if (ipNumber === null || networkNumber === null || !Number.isInteger(prefix)) {
    return false;
  }
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipNumber & mask) === (networkNumber & mask);
}

function ipv4ToNumber(ip: string): number | null {
  if (isIP(ip) !== 4) {
    return null;
  }
  return ip
    .split('.')
    .reduce((acc, octet) => ((acc << 8) + Number(octet)) >>> 0, 0);
}

function ipv6InCidr(ip: string, cidr: string): boolean {
  const [network, prefixRaw] = cidr.split('/');
  const prefix = Number(prefixRaw);
  const ipNumber = ipv6ToBigInt(ip);
  const networkNumber = network ? ipv6ToBigInt(network) : null;
  if (ipNumber === null || networkNumber === null || !Number.isInteger(prefix)) {
    return false;
  }
  const shift = 128n - BigInt(prefix);
  return (ipNumber >> shift) === (networkNumber >> shift);
}

function ipv6ToBigInt(ip: string): bigint | null {
  if (isIP(ip) !== 6) {
    return null;
  }
  const parts = ip.split('::');
  if (parts.length > 2) {
    return null;
  }
  const head = parseIpv6Part(parts[0] ?? '');
  const tail = parseIpv6Part(parts[1] ?? '');
  if (!head || !tail) {
    return null;
  }
  const zeroCount = parts.length === 2 ? 8 - head.length - tail.length : 0;
  const groups = [...head, ...Array<number>(zeroCount).fill(0), ...tail];
  if (zeroCount < 0 || groups.length !== 8) {
    return null;
  }
  return groups.reduce((acc, group) => (acc << 16n) + BigInt(group), 0n);
}

function parseIpv6Part(part: string): number[] | null {
  if (!part) {
    return [];
  }
  return part.split(':').map((group) => Number.parseInt(group, 16));
}
