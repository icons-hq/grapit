import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import type { SeatState } from '@grabit/shared';

@WebSocketGateway({
  namespace: '/booking',
  cors: {
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      const allowedOrigin =
        process.env['FRONTEND_URL'] ?? 'http://localhost:3000';
      if (
        process.env['NODE_ENV'] !== 'production' ||
        !origin ||
        origin === allowedOrigin
      ) {
        callback(null, true);
      } else {
        callback(new Error('CORS not allowed'));
      }
    },
    credentials: true,
  },
})
export class BookingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(BookingGateway.name);

  @WebSocketServer()
  server?: Server;

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

    void client.join(`showtime:${showtimeId}`);
    this.logger.log(`Client ${client.id} joined showtime:${showtimeId}`);
    return { event: 'joined', data: showtimeId };
  }

  @SubscribeMessage('leave-showtime')
  handleLeaveShowtime(
    @ConnectedSocket() client: Socket,
    @MessageBody() showtimeId: string,
  ): void {
    void client.leave(`showtime:${showtimeId}`);
    this.logger.log(`Client ${client.id} left showtime:${showtimeId}`);
  }

  /**
   * Broadcasts a seat status update to all clients in the showtime room.
   * A standalone Nest application context, such as the bounded background
   * worker, does not initialize a Socket.IO server.
   */
  broadcastSeatUpdate(showtimeId: string, seatId: string, status: SeatState, userId?: string): void {
    if (!this.server) {
      return;
    }

    this.server.to(`showtime:${showtimeId}`).emit('seat-update', {
      seatId,
      status,
      userId,
    });
  }
}
