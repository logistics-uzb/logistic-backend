import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, ValidateNested } from 'class-validator';

import { CreateTelegramGroupDto } from './create-telegram-group.dto';

/**
 * Ko'p sonli TelegramGroup'ni bir marta yaratish uchun.
 *
 * `POST /telegram-groups/bulk`ga yuboriladigan body.
 * Ichkarida `prisma.createMany({ skipDuplicates: true })` ishlatiladi —
 * `username` yoki `chatId` bo'yicha duplikat bo'lsa jimjit skip qilinadi.
 *
 * Cheklov: 1–1000 element (birdaniga juda ko'pini yubormaslik uchun).
 */
export class BulkCreateTelegramGroupDto {
  @ApiProperty({
    type: () => [CreateTelegramGroupDto],
    description: 'Yaratiladigan guruhlar ro\'yxati',
    minItems: 1,
    maxItems: 1000,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => CreateTelegramGroupDto)
  items!: CreateTelegramGroupDto[];
}
