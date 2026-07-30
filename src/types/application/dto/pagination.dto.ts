import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Faqat pagination — sodda endpointlar uchun (masalan /post/my).
 */
export class PaginationDto {
  @ApiPropertyOptional({ example: 1, default: 1, description: 'Sahifa raqami (1 dan boshlanadi).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20, default: 20, description: 'Sahifadagi elementlar soni (max 100).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
