import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

/**
 * Filter querylari — GET /v1/stats/requests uchun.
 */
export class GetStatsDto {
  @ApiPropertyOptional({
    example: '/v1/post/all',
    description: 'Path prefiks bo\'yicha filter (boshlanadi shu bilan).',
  })
  @IsOptional()
  @IsString()
  path?: string;

  @ApiPropertyOptional({
    example: 'GET',
    description: 'HTTP method bo\'yicha filter.',
  })
  @IsOptional()
  @IsString()
  method?: string;

  @ApiPropertyOptional({
    description: 'Boshlanish vaqti (UNIX ms).',
    type: Number,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  from?: number;

  @ApiPropertyOptional({
    description: 'Tugash vaqti (UNIX ms).',
    type: Number,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  to?: number;

  @ApiPropertyOptional({
    enum: ['hour', 'day', 'month'],
    default: 'day',
    description: 'Timeseries bucketi.',
  })
  @IsOptional()
  @IsIn(['hour', 'day', 'month'])
  bucket?: 'hour' | 'day' | 'month';
}

/**
 * Button click statistikasi (Telegram / Qo'ng'iroq) uchun filterlar.
 */
export class GetButtonClicksDto {
  @ApiPropertyOptional({
    enum: ['tg', 'call'],
    description: "Faqat bitta turdagi bosishlarni ko'rish uchun filter.",
  })
  @IsOptional()
  @IsIn(['tg', 'call'])
  type?: 'tg' | 'call';

  @ApiPropertyOptional({
    example: 123,
    description: 'Aniq post uchun (ixtiyoriy).',
    type: Number,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  loadId?: number;

  @ApiPropertyOptional({ description: 'Boshlanish vaqti (UNIX ms).', type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  from?: number;

  @ApiPropertyOptional({ description: 'Tugash vaqti (UNIX ms).', type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  to?: number;

  @ApiPropertyOptional({
    enum: ['hour', 'day', 'month'],
    default: 'hour',
    description: 'Timeseries bucketi.',
  })
  @IsOptional()
  @IsIn(['hour', 'day', 'month'])
  bucket?: 'hour' | 'day' | 'month';
}
