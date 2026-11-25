import { BadRequestException, ForbiddenException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../booking/providers/redis.provider.js';
import { TrafficDefenseService, SECURITY_CHALLENGE_REQUIRED, SECURITY_BLOCKED } from './traffic-defense.service.js';

const ACTION = 'booking_seat';
const COOKIE = 'grabit_booking_browser';
const WINDOW_SECONDS = 30;
const HOSTS = new Set(['heygrabit.com', 'www.heygrabit.com']);

// All keys belong to one showtime slot. Retries on the same seat count once.
// Expiry is fixed at first observation so ordinary activity cannot prolong a restriction.
const OBSERVE = [
  "local proof = redis.call('GET', KEYS[6])",
  "if proof == 'verified' then return {1,0,0,0,0,0} end",
  "if proof == 'pending' then return {2,0,0,0,0,0} end",
  "local result = {0}",
  "for i=1,5 do",
  "  local added = redis.call('SADD', KEYS[i], ARGV[i])",
  "  local n = redis.call('SCARD', KEYS[i])",
  "  if added == 1 and n == 1 then redis.call('EXPIRE', KEYS[i], ARGV[6]) end",
  "  table.insert(result, n)",
  "end",
  "return result",
].join('\n');

type BookingRequest = Request & {
  user?: { id?: string };
  queueAdmission?: { queueSessionId: string; refreshFamilyId: string; activeUntilAt: string | null };
};
type Widget = { sitekey: string; secret: string };

@Injectable()
export class BookingMacroService {
  private readonly widget: Widget | undefined;
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis, private readonly traffic: TrafficDefenseService) {
    if (process.env['GRABIT_BOOKING_MACRO'] !== 'true') return;
    const raw = process.env['BOOKING_TURNSTILE_CONFIG'];
    if (!raw) throw new Error('Missing booking verification configuration');
    const config = JSON.parse(raw) as Partial<Widget>;
    if (!config.secret || !config.sitekey) throw new Error('Incomplete booking verification configuration');
    this.widget = { secret: config.secret, sitekey: config.sitekey };
  }

  private digest(value: string): string {
    return createHmac('sha256', this.widget!.secret).update('grabit/booking/v1:').update(value).digest('base64url');
  }

  private session(req: BookingRequest, showtimeId: string) {
    const admission = req.queueAdmission;
    const buyer = req.user?.id;
    if (!admission || !buyer || !admission.activeUntilAt) throw new ForbiddenException('대기열 입장 인증이 필요합니다');
    const scope = '{booking-risk:' + showtimeId + '}:';
    const binding = this.digest(JSON.stringify([buyer, showtimeId, admission.queueSessionId, admission.refreshFamilyId]));
    const ttl = Math.min(900, Math.ceil((Date.parse(admission.activeUntilAt) - Date.now()) / 1000));
    if (!Number.isFinite(ttl) || ttl <= 0) throw new ForbiddenException('대기열 입장 시간이 종료되었습니다');
    return { scope, binding, ttl, proof: scope + 'proof:' + binding, buyer: this.digest(buyer) };
  }

  private browser(req: BookingRequest, res: Response): string {
    const cookie: unknown = req.cookies?.[COOKIE];
    if (typeof cookie === 'string' && /^[a-f0-9-]{36}\.[\w-]{43}$/.test(cookie)) {
      const id = cookie.slice(0,36);
      if (timingSafeEqual(Buffer.from(cookie.slice(37)), Buffer.from(this.digest('browser:' + id)))) return id;
    }
    const id = randomUUID();
    res.cookie(COOKIE, id + '.' + this.digest('browser:' + id), {
      httpOnly: true, secure: process.env['NODE_ENV'] === 'production', sameSite: 'lax',
      path: '/api/v1/booking', maxAge: 15 * 60_000,
    });
    return id;
  }

  async beforeNewSeat(req: BookingRequest, res: Response, showtimeId: string, seatId: string): Promise<void> {
    if (!this.widget) return;
    const session = this.session(req, showtimeId);
    const browserId = this.browser(req, res);
    const device = session.scope + 'browser:' + browserId;
    const seat = this.digest(seatId);
    const [verified, buyerSeats, attempts, accounts, sessions, devices] = await this.redis.eval(
      OBSERVE, 6, session.scope + 'buyer:' + session.buyer, device + ':seats', device + ':accounts',
      device + ':sessions', session.scope + 'devices:' + session.buyer, session.proof,
      seat, session.buyer + ':' + seat, session.buyer, session.binding, browserId,
      String(WINDOW_SECONDS),
    ) as number[];
    if (verified === 1) return;
    const challenge = { message: SECURITY_CHALLENGE_REQUIRED, sitekey: this.widget.sitekey, binding: session.binding };
    if (verified === 2) throw new ForbiddenException(challenge);
    const decision = this.traffic.evaluateSecurityDecision('lock-seat', {
      repeatedAttempts: attempts, distinctAccountCount: accounts, distinctAdmissionTokenCount: sessions, distinctDeviceCount: devices,
      // A large sweep of different seats by the same verified account also warrants a human check.
      forceChallenge: buyerSeats >= 10,
    });
    if (decision.action === 'allow') return;
    if (decision.action === 'block') throw new ForbiddenException({ message: SECURITY_BLOCKED, retryAfterSeconds: WINDOW_SECONDS });
    // Do not override a concurrent verification or change any admission / payment deadline.
    await this.redis.set(session.proof, 'pending', 'EX', session.ttl, 'NX');
    if (await this.redis.get(session.proof) === 'verified') return;
    throw new ForbiddenException(challenge);
  }

  async verify(req: BookingRequest, showtimeId: string, token: string): Promise<void> {
    if (!this.widget) throw new BadRequestException('Booking verification is unavailable');
    const session = this.session(req, showtimeId);
    const state = await this.redis.get(session.proof);
    if (state === 'verified') return;
    if (state !== 'pending') throw new BadRequestException('Booking verification was not requested');
    let verdict: { success?: boolean; hostname?: string; action?: string; cdata?: string };
    try {
      const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST', body: new URLSearchParams({ secret: this.widget.secret, response: token }), signal: AbortSignal.timeout(4500),
      });
      if (!result.ok) throw new Error('Unavailable');
      verdict = await result.json() as typeof verdict;
    } catch {
      throw new ServiceUnavailableException('Booking verification is temporarily unavailable');
    }
    if (verdict.success !== true || !HOSTS.has(verdict.hostname || '') || verdict.action !== ACTION || verdict.cdata !== session.binding) {
      throw new ForbiddenException(SECURITY_CHALLENGE_REQUIRED);
    }
    if (!await this.redis.set(session.proof, 'verified', 'KEEPTTL', 'XX')) {
      throw new BadRequestException('Booking verification expired');
    }
  }
}
