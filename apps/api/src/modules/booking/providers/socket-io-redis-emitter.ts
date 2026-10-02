import { createRequire } from 'node:module';

/**
 * Publishes Socket.IO room broadcasts straight to Valkey pub/sub, using the
 * wire format that `@socket.io/redis-adapter` (and `@socket.io/redis-emitter`)
 * use. API instances running the Redis adapter deliver the event to their
 * connected sockets in the room.
 *
 * Used where no Socket.IO server exists, such as the bounded Cloud Run
 * background worker (audit #151).
 */

type MsgpackCodec = { encode(value: unknown): Uint8Array };

export type SocketIoRedisPublisher = {
  publish(channel: string, message: Buffer): Promise<unknown>;
};

/** socket.io-parser PacketType.EVENT */
const SOCKET_IO_EVENT_PACKET_TYPE = 2;
/** `@socket.io/redis-adapter` default `key` option. */
const SOCKET_IO_REDIS_KEY = 'socket.io';
/** Never equal to a random adapter uid, so every API instance accepts it. */
const SOCKET_IO_EMITTER_UID = 'emitter';

let adapterCodec: MsgpackCodec | null = null;

/**
 * Loads the msgpack codec the installed Redis adapter decodes with, resolved
 * from the adapter package itself so both sides always agree on the encoding.
 */
function loadAdapterCodec(): MsgpackCodec {
  if (adapterCodec) return adapterCodec;
  const requireFromHere = createRequire(import.meta.url);
  const adapterEntry = requireFromHere.resolve('@socket.io/redis-adapter');
  const codec = createRequire(adapterEntry)('notepack.io') as Partial<MsgpackCodec>;
  if (typeof codec.encode !== 'function') {
    throw new TypeError('Socket.IO Redis adapter codec has no encode()');
  }
  adapterCodec = codec as MsgpackCodec;
  return adapterCodec;
}

export function buildSocketIoRoomChannel(namespace: string, room: string): string {
  return `${SOCKET_IO_REDIS_KEY}#${namespace}#${room}#`;
}

export function encodeSocketIoRoomEvent(
  namespace: string,
  room: string,
  event: string,
  payload: unknown,
): Buffer {
  const packet = {
    type: SOCKET_IO_EVENT_PACKET_TYPE,
    data: [event, payload],
    nsp: namespace,
  };
  const options = { rooms: [room], except: [], flags: {} };
  return Buffer.from(loadAdapterCodec().encode([SOCKET_IO_EMITTER_UID, packet, options]));
}

export function canPublishSocketIoEvents(client: unknown): client is SocketIoRedisPublisher {
  return typeof client === 'object'
    && client !== null
    && typeof (client as { publish?: unknown }).publish === 'function';
}

export async function publishSocketIoRoomEvent(
  publisher: SocketIoRedisPublisher,
  namespace: string,
  room: string,
  event: string,
  payload: unknown,
): Promise<void> {
  await publisher.publish(
    buildSocketIoRoomChannel(namespace, room),
    encodeSocketIoRoomEvent(namespace, room, event, payload),
  );
}
