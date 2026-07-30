import { Injectable, Inject, Logger, forwardRef } from '@nestjs/common';
import { OpenaiService } from '../openai/openai.service';
import { PostsService } from '../logistics-message/logistics-message.service';
import { WhatsAppMessagePayloadDto } from '@/types/application';
import { whatsappToCreateDto } from '@/common/utils/whatsapp-adapter';

@Injectable()
export class SocketService {
  private readonly logger = new Logger(SocketService.name);

  constructor(
    // private readonly openai: OpenaiService,
    @Inject(forwardRef(() => PostsService))
    private readonly driverPost: PostsService
  ) {}

  async processTelegramMessage(data: any) {
    // senderId scraper'dan number keladi (Telethon .id) — DB'da String saqlanadi.
    const senderIdRaw = data?.senderId;
    const senderId =
      senderIdRaw === null || senderIdRaw === undefined
        ? null
        : String(senderIdRaw);

    const driverPost = await this.driverPost.create({
      tgMessageId: data.tgMessageId,
      channelName: data.channelName,
      text: data.text,
      date: data.date,
      views: data.views,
      senderTgUsername: data.senderTgUsername ?? null,
      senderFullName: data.senderFullName ?? null,
      senderId,
      postAuthor: data.postAuthor ?? null,
    });
    console.log(driverPost);
  }

  /**
   * logistic-whatsapp-scrapping servisidan Socket.IO orqali keladigan
   * `whatsapp:new_message_logistics` event handler'i.
   *
   * WhatsApp payload'ini `CreateLogisticMessageDto` shape'iga o'giradi va
   * mavjud `PostsService.create` pipeline'iga uzatadi (dedup + OpenAI + alert).
   */
  async processWhatsAppMessage(data: WhatsAppMessagePayloadDto) {
    if (!data?.waMessageId || !data?.chatId) {
      this.logger.warn(
        `processWhatsAppMessage skip: missing waMessageId or chatId (${JSON.stringify(
          {
            waMessageId: data?.waMessageId,
            chatId: data?.chatId,
          }
        )})`
      );
      return { skipped: true, reason: 'missing-identifiers' };
    }

    if (!data?.text || !data.text.trim()) {
      this.logger.debug(
        `processWhatsAppMessage skip: empty text (chat=${data.chatId} msg=${data.waMessageId})`
      );
      return { skipped: true, reason: 'empty-text' };
    }

    const createDto = whatsappToCreateDto(data);
    this.logger.log(
      `processWhatsAppMessage → PostsService.create tg=${createDto.tgMessageId} chat=${createDto.channelName} waId=${data.waMessageId}`
    );

    return this.driverPost.create(createDto);
  }
}
