import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Inject, Logger, Optional } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import type { SeatState, SeatUpdateEvent } from '@grabit/shared';
import { allowSocketIoFrontendOrigin } from '../../config/frontend-origins.js';
import { REDIS_CLIENT, sanitizeRedisErrorMessage } from './providers/redis.provider.js';
import {
  canPublishSocketIoEvents,
  publishSocketIoRoomEvent,
  type SocketIoRedisPublisher,
} from './providers/socket-io-redis-emitter.js';

export const BOOKING_SOCKET_NAMESPACE = '/booking';
export const SEAT_UPDATE_EVENT = 'seat-update';

export function showtimeRoom(showtimeId: string): string {
  return `showtime:${showtimeId}`;
}

@WebSocketGateway({
  namespace: BOOKING_SOCKET_NAMESPACE,
  cors: {
    origin: allowSocketIoFrontendOrigin,
    credentials: true,
  },
})
export class BookingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(BookingGateway.name);
  private readonly redisPublisher: SocketIoRedisPublisher | null;

  @WebSocketServer()
  server?: Server;

  constructor(@Optional() @Inject(REDIS_CLIENT) redis?: unknown) {
    this.redisPublisher = canPublishSocketIoEvents(redis) ? redis : null;
  }

  handleConnection(client: Socket): void {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Client disconnected: ${client.id}`);
    // Seat lock cleanup happens via Redis TTL, not on disconnect.
  }

  @SubscribeMessage('join-showtime')
  handleJoinShowtime(
    @ConnectedSocket() client: Socket,
    @MessageBody() showtimeId: string,
  ): { event: string; data: string } {
    // Basic UUID validation
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(showtimeId)) {
      this.logger.warn(`Invalid showtime ID from client ${client.id}: ${showtimeId}`);
      return { event: 'error', data: 'Invalid showtime ID' };
    }

    void client.join(showtimeRoom(showtimeId));
    this.logger.log(`Client ${client.id} joined showtime:${showtimeId}`);
    return { event: 'joined', data: showtimeId };
  }

  @SubscribeMessage('leave-showtime')
  handleLeaveShowtime(
    @ConnectedSocket() client: Socket,
    @MessageBody() showtimeId: string,
  ): void {
    void client.leave(showtimeRoom(showtimeId));
    this.logger.log(`Client ${client.id} left showtime:${showtimeId}`);
  }

  /**
   * Broadcasts a seat status update to all clients in the showtime room.
   *
   * The room is joined without authentication, so the payload carries only the
   * seat and its state, never who locked or bought it (audit #92). The trailing
   * argument is accepted for existing callers and ignored.
   */
  broadcastSeatUpdate(
    showtimeId: string,
    seatId: string,
    status: SeatState,
    _ignoredActorId?: string,
  ): void {
    void this.publishSeatUpdate(showtimeId, seatId, status);
  }

  /**
   * Same as `broadcastSeatUpdate`, awaitable. Inside the API the Socket.IO
   * server (and its Redis adapter) fans the event out. A standalone Nest
   * application context such as the bounded background worker has no server,
   * so the event is published to Valkey in the adapter wire format instead
   * (audit #151). Resolves false when nothing could be sent; never rejects.
   */
  async publishSeatUpdate(showtimeId: string, seatId: string, status: SeatState): Promise<boolean> {
    const payload: SeatUpdateEvent = { seatId, status };
    const room = showtimeRoom(showtimeId);

    if (this.server) {
      this.server.to(room).emit(SEAT_UPDATE_EVENT, payload);
      return true;
    }

    if (!this.redisPublisher) {
      return false;
    }

    try {
      await publishSocketIoRoomEvent(
        this.redisPublisher,
        BOOKING_SOCKET_NAMESPACE,
        room,
        SEAT_UPDATE_EVENT,
        payload,
      );
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Seat update publish failed without a Socket.IO server. showtimeId=${showtimeId}, seatId=${seatId}, status=${status}: ${sanitizeRedisErrorMessage(message)}`,
      );
      return false;
    }
  }
}
