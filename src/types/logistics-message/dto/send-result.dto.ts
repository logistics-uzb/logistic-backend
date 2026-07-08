import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Python MTProto worker Node backendga yuboradigan payload.
 * Har bir guruh natijasi alohida element.
 */
export class SendResultItemDto {
  @ApiProperty({ example: '@some_group', description: 'Guruh username' })
  @IsString()
  group: string;

  @ApiProperty({ example: true, description: 'Muvaffaqiyatli yuborildimi' })
  @IsBoolean()
  ok: boolean;

  @ApiPropertyOptional({
    example: '2026-07-02T14:23:00Z',
    description: 'Yuborilgan vaqt (ISO)',
  })
  @IsOptional()
  @IsISO8601()
  sentAt?: string;

  @ApiPropertyOptional({
    example: 'peer_flood',
    description: 'Tasniflangan xato kodi',
    enum: [
      'peer_flood',
      'flood_wait',
      'slow_mode',
      'write_forbidden',
      'banned',
      'invalid_username',
      'unknown',
    ],
  })
  @IsOptional()
  @IsString()
  error?: string;

  @ApiPropertyOptional({
    example: 'PeerFloodError: Too many requests',
    description: 'Original xato matni (debug uchun)',
  })
  @IsOptional()
  @IsString()
  errorRaw?: string;

  @ApiPropertyOptional({
    example: 3600,
    description: 'Telegram tavsiya etgan kutish soni (mavjud bo\'lsa)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  retryAfterSec?: number;
}

export class SendResultDto {
  @ApiProperty({ example: 123, description: 'LogisticMessage id' })
  @IsInt()
  id: number;

  @ApiProperty({
    example: 'SENT',
    enum: ['SENDING', 'SENT', 'PARTIAL', 'FAILED'],
    description: 'Umumiy holat',
  })
  @IsIn(['SENDING', 'SENT', 'PARTIAL', 'FAILED'])
  status: 'SENDING' | 'SENT' | 'PARTIAL' | 'FAILED';

  @ApiPropertyOptional({
    example: '2026-07-02T14:20:00Z',
    description: 'Yuborish boshlangan vaqt',
  })
  @IsOptional()
  @IsISO8601()
  startedAt?: string;

  @ApiPropertyOptional({
    example: '2026-07-02T14:30:00Z',
    description: 'Yuborish tugagan vaqt',
  })
  @IsOptional()
  @IsISO8601()
  finishedAt?: string;

  @ApiPropertyOptional({
    type: [SendResultItemDto],
    description: 'Har guruh uchun natija',
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => SendResultItemDto)
  results?: SendResultItemDto[];
}
