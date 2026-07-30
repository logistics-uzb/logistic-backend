import { Logger, Injectable, forwardRef, Inject } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PostsService } from '../logistics-message/logistics-message.service'; // sizning getAll() shu yerda
import { GetLogisticsMessagesDto } from '@/types/application';
import { SocketService } from './notification-gateway.service';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
@Injectable()
export class LogisticsGateway {
  private readonly logger = new Logger(LogisticsGateway.name);
  private clientFilters = new Map<string, GetLogisticsMessagesDto>();

  @WebSocketServer()
  server: Server;

  constructor(
    // @Inject(forwardRef(() => PostsService))
    // private readonly logisticsService: PostsService,
    private readonly socketService: SocketService
  ) {}

  // 1️⃣ Client ulanishida
  handleConnection(client: Socket) {
    this.logger.debug(`Client connected: ${client.id}`);
  }

  // 2️⃣ Client uzilganda
  handleDisconnect(client: Socket) {
    this.logger.debug(`Client disconnected: ${client.id}`);
  }
  // 3️⃣ Client so‘rov yuboradi: yangi habarni jonatadi scrapperdan
  @SubscribeMessage('telegram:new_message_logistics')
  async handleTelegramMessage(_, payload: any) {
    console.log('payload', payload);
    const result = await this.socketService.processTelegramMessage(payload);
    console.log('result', result);

    // Agar logika ruxsat bersa → botga yuboramiz
  }

  // 3️⃣.5 logistic-whatsapp-scrapping servisidan keladigan WhatsApp xabarlar
  @SubscribeMessage('whatsapp:new_message_logistics')
  async handleWhatsAppMessage(_, payload: any) {
    this.logger.debug(
      `whatsapp:new_message_logistics waId=${payload?.waMessageId} chat=${payload?.chatId} len=${payload?.text?.length ?? 0}`
    );
    return this.socketService.processWhatsAppMessage(payload);
  }

  // 3️⃣ Client so‘rov yuboradi: GET_LOGISTICS
  @SubscribeMessage('get_logistics')
  async handleGetLogistics(
    @MessageBody()
    data: GetLogisticsMessagesDto,
    @ConnectedSocket() client: Socket
  ) {
    this.logger.debug(`Client ${client.id} requested logistics data`, data);

    try {
      this.clientFilters.set(client.id, data);

      const result =
        // await this.logisticsService.getAllMessages(data);

        client.emit('logistics_data', {
          success: true,
          // data: result,
        });
    } catch (error) {
      this.logger.error(`Socket get_logistics Error: ${error.message}`);
      client.emit('logistics_error', { message: error.message });
    }
  }

  sendUpdateToFilteredClients(message: any) {
    for (const [clientId, filter] of this.clientFilters.entries()) {
      const clientSocket = this.server.sockets.sockets.get(clientId);
      if (!clientSocket) continue;

      if (this.matchesFilter(message, filter)) {
        clientSocket.emit('get_logistics', {
          type: 'new',
          data: message,
        });
        this.logger.debug(
          `Sent new_logistics_message to ${clientId} (matched filter)`
        );
      }
    }
  }

  private matchesFilter(msg: any, filter: GetLogisticsMessagesDto): boolean {
    if (!filter) return true;

    // Channel filter
    if (filter.channelName && msg.channelName !== filter.channelName)
      return false;

    // Status filter (KEEP / SKIP)
    if (filter.aiStatus && msg.aiStatus !== filter.aiStatus) return false;

    // Actual filter (true/false)
    if (filter.isActual !== undefined && msg.isActual !== filter.isActual)
      return false;

    return true;
  }

  // 4️⃣ Server → barcha clientlarga broadcast qila olishi uchun:
  broadcastLogisticsUpdate(payload: any) {
    this.server.emit('logistics_data_update', payload);
    this.logger.debug(`Broadcasted logistics_data_update`);
  }
}
