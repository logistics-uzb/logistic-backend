import { ApiProperty } from '@nestjs/swagger';
import { Expose, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateIf,
} from 'class-validator';

/**
 * TelegramGroup yaratish DTO'si.
 *
 * `username` yoki `chatId` — kamida biri majburiy:
 *  - Ochiq guruh/kanal → `username` (@ bilan yoki busiz)
 *  - Yopiq guruh → `chatId` (-100... bilan boshlanadigan Telegram peer id)
 *
 * `chatId` string sifatida qabul qilinadi (JSON'da BigInt yo'q). Backend
 * Prisma BigInt'ga o'zi konvertatsiya qiladi.
 */
export class CreateTelegramGroupDto {
  @ApiProperty({
    required: false,
    example: 'yuk_gruppa',
    description:
      'Telegram guruh username (@ bilan yoki busiz). ' +
      'Yopiq guruhda `null` — bunday holda `chatId` majburiy.',
  })
  @IsOptional()
  @IsString()
  // Boshidagi @ ni normalize qilamiz — ma'lumotlarda `@` yo'q holida saqlanadi
  @Transform(({ value }) =>
    typeof value === 'string' ? value.replace(/^@/, '').trim() || null : value,
  )
  // Foydalanuvchi ikkalasini ham bermasa, xato beramiz (kamida biri kerak)
  @ValidateIf((o) => o.username != null || o.chatId == null)
  @Expose()
  username?: string | null;

  @ApiProperty({
    required: false,
    example: '-1001464499996',
    description:
      'Telegram peer id (BigInt). Yopiq guruhlar uchun majburiy. ' +
      'String sifatida qabul qilinadi (JSON BigInt qo\'llab-quvvatlamaydi).',
  })
  @IsOptional()
  @IsString()
  // Faqat raqamlar (- ham bo'lishi mumkin) — validatsiya
  @Matches(/^-?\d+$/, { message: 'chatId raqamli qiymat bo\'lishi kerak' })
  @ValidateIf((o) => o.chatId != null || o.username == null)
  @Expose()
  chatId?: string | null;

  @ApiProperty({
    required: false,
    example: 'Yuk Gruppa',
    description: 'Guruhning ko\'rinadigan nomi',
  })
  @IsOptional()
  @IsString()
  @Expose()
  title?: string | null;

  @ApiProperty({
    required: false,
    example: 'supergroup',
    enum: ['channel', 'group', 'supergroup'],
    description: 'Telethon dialog turi (list_chats natijasidan)',
  })
  @IsOptional()
  @IsIn(['channel', 'group', 'supergroup'])
  @Expose()
  type?: 'channel' | 'group' | 'supergroup' | null;

  @ApiProperty({
    required: false,
    example: 17580,
    description: 'A\'zolar soni (yig\'ilgan paytdagi)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Expose()
  members?: number | null;

  @ApiProperty({
    required: false,
    default: true,
    description: 'Aktivmi (default true)',
  })
  @IsOptional()
  @IsBoolean()
  @Expose()
  isActive?: boolean;
}
