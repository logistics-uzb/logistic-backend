import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class QueryUsersDto {
  @ApiPropertyOptional({ enum: ['ADMIN', 'DISPATCHER'] })
  @IsOptional()
  @IsIn(['ADMIN', 'DISPATCHER'])
  role?: 'ADMIN' | 'DISPATCHER';

  @ApiPropertyOptional({ enum: ['TRUE', 'FALSE'] })
  @IsOptional()
  @IsIn(['TRUE', 'FALSE'])
  isActive?: 'TRUE' | 'FALSE';

  @ApiPropertyOptional({
    description: 'Contains match against username, phone, or fullName (case-insensitive).',
    example: 'ali',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
