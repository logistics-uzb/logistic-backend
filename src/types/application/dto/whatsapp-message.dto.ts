import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * logistic-whatsapp-scrapping servisidan Socket.IO orqali keladigan payload.
 * SocketService.processWhatsAppMessage buni CreateLogisticMessageDto shape'iga
 * o'giradi (tgMessageId <- waMessageId hash, channelName <- chatId).
 */
export class WhatsAppMessagePayloadDto {
  @ApiProperty({
    example: '3EB0C767D82B5F5A1E9A',
    description: 'WhatsApp message ID (hex string, neonize qaytaradi)',
  })
  @IsString()
  waMessageId: string;

  @ApiProperty({
    example: '120363025246125486@g.us',
    description: 'WhatsApp guruh JID (kanal / group)',
  })
  @IsString()
  chatId: string;

  @ApiProperty({
    example: 'Yuklar TSHKNT',
    required: false,
    description: 'Guruh nomi (inson-o\'qiy)',
  })
  @IsOptional()
  @IsString()
  groupName?: string;

  @ApiProperty({
    example: '998901234567@s.whatsapp.net',
    required: false,
    description: 'Xabar yuboruvchining JID',
  })
  @IsOptional()
  @IsString()
  sender?: string;

  @ApiProperty({
    example: '+998901234567',
    required: false,
    description: 'senderdan ajratib olingan telefon raqami (+ prefiksli)',
  })
  @IsOptional()
  @IsString()
  senderPhone?: string;

  @ApiProperty({
    example: 'Toshkentdan Samarqandga 20 tonna yuk bor. Tel: +998901234567',
    description: 'Xabar matni (caption bo\'lsa u ham qo\'shiladi)',
  })
  @IsString()
  text: string;

  @ApiProperty({
    example: '2026-07-29T12:34:56+00:00',
    required: false,
    description: 'WhatsApp xabar yaratilgan vaqti (ISO-8601 UTC)',
  })
  @IsOptional()
  @IsString()
  date?: string;
}
