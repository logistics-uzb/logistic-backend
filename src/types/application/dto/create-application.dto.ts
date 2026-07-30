import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsBoolean,
  IsObject,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateLogisticMessageDto {
  @ApiProperty({
    example: 26443,
    description: 'Telegram xabarning unikal IDsi (message.id)',
  })
  @IsNumber()
  tgMessageId: number;

  @ApiProperty({
    example: 'Muzaffardanyuklar',
    description: 'Telegram kanal nomi',
  })
  @IsString()
  channelName: string;

  @ApiProperty({
    example:
      'Toshkent → Andijon 20 tonna un uchun tent kerak. Nakd. 99890xxxxxxx',
    description: 'Xabar matni (to‘liq text)',
  })
  @IsString()
  text: string;

  @ApiProperty({
    example: '2025-12-12T11:38:52+00:00',
    required: false,
    description: 'Telegram xabarning yaratilgan vaqti (ISO format)',
  })
  @IsOptional()
  date?: string;

  @ApiProperty({
    example: 1234,
    required: false,
    description: 'Telegram xabar ko‘rishlar soni (views)',
  })
  @IsOptional()
  views?: number | null;

  @ApiProperty({
    example: 'ali_diller',
    required: false,
    description:
      'Xabar yuboruvchining Telegram username (@ belgisiz). Bor bo‘lsa saqlanadi. ' +
      'Nomlanish: `senderTgUsername` — `User.username` bilan chalkashmaslik uchun.',
  })
  @IsOptional()
  @IsString()
  senderTgUsername?: string | null;

  @ApiProperty({
    example: 'Ali Valiev',
    required: false,
    description:
      'Xabar yuboruvchining to‘liq ismi (first_name + last_name). Username yo‘q bo‘lsa fallback.',
  })
  @IsOptional()
  @IsString()
  senderFullName?: string | null;

  @ApiProperty({
    example: '8555788084',
    required: false,
    description:
      'Xabar yuboruvchining Telegram user ID. String — 2^31 dan katta qiymatlar bo‘lishi mumkin.',
  })
  @IsOptional()
  @IsString()
  senderId?: string | null;

  @ApiProperty({
    example: 'Admin',
    required: false,
    description:
      'Kanal "Sign messages" yoqilgan bo‘lsa ko‘rsatiladigan display nomi (Telegram message.post_author).',
  })
  @IsOptional()
  @IsString()
  postAuthor?: string | null;
}
