import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { RedisAdapter } from '@socket.io/redis-adapter';
import { BookingGateway } from './booking.gateway.js';
import {
  buildSocketIoRoomChannel,
  encodeSocketIoRoomEvent,
} from './providers/socket-io-redis-emitter.js';

const SHOWTIME_ID = '00000000-0000-4000-8000-000000000001';
const BUYER_ID = '00000000-0000-4000-8000-000000000002';
const ROOM = `showtime:${SHOWTIME_ID}`;

function createServerStub() {
  const emit = vi.fn();
  const to = vi.fn(() => ({ emit }));
  return { server: { to }, to, emit };
}

/**
 * Feeds a published message into the installed `@socket.io/redis-adapter`
 * the way an API instance receives it from Valkey, and returns what that
 * instance would broadcast to its local sockets.
 */
function deliverToApiInstance(channel: string, message: Buffer, joinedRoom: string) {
  const subscriber = { psubscribe: vi.fn(), subscribe: vi.fn(), on: vi.fn() };
  const publisher = { on: vi.fn(), publish: vi.fn() };
  const namespace = {
    name: '/booking',
    server: { encoder: { encode: (packet: unknown) => [JSON.stringify(packet)] } },
  };
  const adapter = new RedisAdapter(namespace as never, publisher, subscriber);
  adapter.addAll('local-socket-1', new Set([joinedRoom]));
  const localBroadcast = vi
    .spyOn(Object.getPrototypeOf(RedisAdapter.prototype) as { broadcast: () => void }, 'broadcast')
    .mockImplementation(() => {});

  try {
    // onmessage is private in the adapter typings; it is what Valkey pub/sub drives.
    (adapter as unknown as {
      onmessage(pattern: null, channel: string, message: Buffer): void;
    }).onmessage(null, channel, message);
    return localBroadcast.mock.calls as unknown as Array<
      [{ type: number; data: unknown[]; nsp: string }, { rooms: Set<string> }]
    >;
  } finally {
    localBroadcast.mockRestore();
  }
}

describe('BookingGateway', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips broadcasts when running without a Socket.IO server or Redis publisher', async () => {
    const gateway = new BookingGateway();

    expect(() =>
      gateway.broadcastSeatUpdate(SHOWTIME_ID, 'A-1', 'available', BUYER_ID),
    ).not.toThrow();
    await expect(gateway.publishSeatUpdate(SHOWTIME_ID, 'A-1', 'available')).resolves.toBe(false);
  });

  it('never includes the acting user in seat-update payloads (audit #92)', () => {
    const gateway = new BookingGateway();
    const { server, to, emit } = createServerStub();
    gateway.server = server as never;

    gateway.broadcastSeatUpdate(SHOWTIME_ID, '1F:A-1', 'locked', BUYER_ID);
    gateway.broadcastSeatUpdate(SHOWTIME_ID, '1F:A-2', 'sold', BUYER_ID);

    expect(to).toHaveBeenCalledWith(ROOM);
    expect(emit).toHaveBeenNthCalledWith(1, 'seat-update', { seatId: '1F:A-1', status: 'locked' });
    expect(emit).toHaveBeenNthCalledWith(2, 'seat-update', { seatId: '1F:A-2', status: 'sold' });
    expect(JSON.stringify(emit.mock.calls)).not.toContain(BUYER_ID);
  });

  it('tells seat update listeners about every update before emitting it, isolating their failures', async () => {
    const gateway = new BookingGateway();
    const { server, emit } = createServerStub();
    gateway.server = server as never;
    const order: string[] = [];
    emit.mockImplementation(() => order.push('emit'));
    const listener = vi.fn(() => order.push('listener'));
    const failing = vi.fn(() => {
      throw new Error('listener bug');
    });
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    gateway.onSeatUpdate(failing);
    const unsubscribe = gateway.onSeatUpdate(listener);

    gateway.broadcastSeatUpdate(SHOWTIME_ID, '1F:A-1', 'sold', BUYER_ID);
    await gateway.publishSeatUpdate(SHOWTIME_ID, '1F:A-2', 'available');

    expect(listener).toHaveBeenNthCalledWith(1, SHOWTIME_ID, '1F:A-1', 'sold');
    expect(listener).toHaveBeenNthCalledWith(2, SHOWTIME_ID, '1F:A-2', 'available');
    expect(order).toEqual(['listener', 'emit', 'listener', 'emit']);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Seat update listener failed'));

    unsubscribe();
    gateway.broadcastSeatUpdate(SHOWTIME_ID, '1F:A-3', 'locked');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('prefers the Socket.IO server over the Redis publisher inside the API process', async () => {
    const redis = { publish: vi.fn().mockResolvedValue(1) };
    const gateway = new BookingGateway(redis);
    const { server, emit } = createServerStub();
    gateway.server = server as never;

    await expect(gateway.publishSeatUpdate(SHOWTIME_ID, '1F:A-1', 'available')).resolves.toBe(true);

    expect(emit).toHaveBeenCalledOnce();
    expect(redis.publish).not.toHaveBeenCalled();
  });

  it('publishes through Valkey in a context without a Socket.IO server (audit #151)', async () => {
    const redis = { publish: vi.fn().mockResolvedValue(1) };
    const gateway = new BookingGateway(redis);

    await expect(gateway.publishSeatUpdate(SHOWTIME_ID, '1F:A-1', 'available')).resolves.toBe(true);

    expect(redis.publish).toHaveBeenCalledOnce();
    const [channel, message] = redis.publish.mock.calls[0] as [string, Buffer];
    expect(channel).toBe(`socket.io#/booking#${ROOM}#`);
    expect(channel).toBe(buildSocketIoRoomChannel('/booking', ROOM));

    const broadcasts = deliverToApiInstance(channel, message, ROOM);
    expect(broadcasts).toHaveLength(1);
    const [packet, options] = broadcasts[0]!;
    expect(packet).toMatchObject({
      type: 2,
      nsp: '/booking',
      data: ['seat-update', { seatId: '1F:A-1', status: 'available' }],
    });
    expect([...options.rooms]).toEqual([ROOM]);
  });

  it('is ignored by API instances without sockets in the showtime room', () => {
    const message = encodeSocketIoRoomEvent('/booking', ROOM, 'seat-update', {
      seatId: '1F:A-1',
      status: 'available',
    });

    expect(
      deliverToApiInstance(buildSocketIoRoomChannel('/booking', ROOM), message, 'showtime:other'),
    ).toHaveLength(0);
  });

  it('encodes with the same msgpack codec the installed adapter decodes with', () => {
    const adapterRequire = createRequire(createRequire(import.meta.url).resolve('@socket.io/redis-adapter'));
    const codec = adapterRequire('notepack.io') as { decode(value: Buffer): unknown };
    const message = encodeSocketIoRoomEvent('/booking', ROOM, 'seat-update', {
      seatId: '1F:A-1',
      status: 'locked',
    });

    expect(codec.decode(message)).toEqual([
      'emitter',
      { type: 2, data: ['seat-update', { seatId: '1F:A-1', status: 'locked' }], nsp: '/booking' },
      { rooms: [ROOM], except: [], flags: {} },
    ]);
  });

  it('reports a failed publish without throwing', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const redis = { publish: vi.fn().mockRejectedValue(new Error('Connection is closed.')) };
    const gateway = new BookingGateway(redis);

    await expect(gateway.publishSeatUpdate(SHOWTIME_ID, '1F:A-1', 'available')).resolves.toBe(false);
    expect(() => gateway.broadcastSeatUpdate(SHOWTIME_ID, '1F:A-1', 'available')).not.toThrow();
  });
});
