import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import { allowSocketIoFrontendOrigin } from '../../config/frontend-origins.js';

type QueueRealtimeSnapshot = {
  queueSessionId: string;
  state: string;
  position: number;
  waitingCount: number;
  etaSeconds: number;
  remainingSeats: number;
  autoEnter: boolean;
  admittedAt: string | null;
  activeUntilAt: string | null;
  reentryGraceUntilAt: string | null;
};

@WebSocketGateway({
  namespace: '/queue',
  cors: {
    origin: allowSocketIoFrontendOrigin,
    credentials: true,
  },
})
export class QueueGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(QueueGateway.name);

  @WebSocketServer()
  server!: Server;

  handleConnection(client: Socket): void {
    this.logger.log(`Queue client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Queue client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join-queue-session')
  handleJoinQueueSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() queueSessionId: string,
  ): { event: string; data: string } {
    if (!queueSessionId || queueSessionId.length < 8) {
      return { event: 'error', data: 'Invalid queue session ID' };
    }

    void client.join(this.queueRoom(queueSessionId));
    return { event: 'joined', data: queueSessionId };
  }

  @SubscribeMessage('leave-queue-session')
  handleLeaveQueueSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() queueSessionId: string,
  ): void {
    void client.leave(this.queueRoom(queueSessionId));
  }

  emitPosition(queueSessionId: string, snapshot: QueueRealtimeSnapshot): void {
    this.server
      .to(this.queueRoom(queueSessionId))
      .emit('queue:position', snapshot);
  }

  emitAdmitted(queueSessionId: string, snapshot: QueueRealtimeSnapshot): void {
    this.server
      .to(this.queueRoom(queueSessionId))
      .emit('queue:admitted', snapshot);
  }

  emitExpired(
    queueSessionId: string,
    payload: {
      queueSessionId: string;
      state: string;
      autoEnter: boolean;
    },
  ): void {
    this.server
      .to(this.queueRoom(queueSessionId))
      .emit('queue:expired', payload);
  }

  private queueRoom(queueSessionId: string): string {
    return `queue-session:${queueSessionId}`;
  }
}
