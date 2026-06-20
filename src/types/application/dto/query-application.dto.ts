import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsBoolean,
  IsNumber,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

export class GetLogisticsMessagesDto {
  // Basic filters
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  channelName?: string;

  @ApiPropertyOptional({ enum: ['LOAD_POST', 'REGULAR_MESSAGE'] })
  @IsOptional()
  @IsIn(['LOAD_POST', 'REGULAR_MESSAGE'])
  aiStatus?: 'LOAD_POST' | 'REGULAR_MESSAGE';

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActual?: boolean;

  @ApiPropertyOptional({ enum: ['TRUE', 'FALSE'] })
  @IsOptional()
  @IsIn(['TRUE', 'FALSE'])
  isComplete?: 'TRUE' | 'FALSE';

  // Route filters
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  countryFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  regionFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  countryTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  regionTo?: string;

  // Weight
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  weightMin?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  weightMax?: number;

  // New filters
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ enum: ['tons', 'pallet'] })
  @IsOptional()
  @IsIn(['tons', 'pallet'])
  cargoUnit?: 'tons' | 'pallet';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  vehicleType?: string;

  @ApiPropertyOptional({ enum: ['cash', 'online', 'combo'] })
  @IsOptional()
  @IsIn(['cash', 'online', 'combo'])
  paymentType?: 'cash' | 'online' | 'combo';

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  paymentAmountMin?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  paymentAmountMax?: number;

  @ApiPropertyOptional({ enum: ['usd', 'sum'] })
  @IsOptional()
  @IsIn(['usd', 'sum'])
  paymentCurrency?: 'usd' | 'sum';

  @ApiPropertyOptional({
    enum: ['YES', 'NO'],
    description: 'YES => advancePayment IS NOT NULL, NO => IS NULL',
  })
  @IsOptional()
  @IsIn(['YES', 'NO'])
  hasAdvancePayment?: 'YES' | 'NO';

  @ApiPropertyOptional({ description: 'UNIX ms timestamp' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  pickupDateFrom?: number;

  @ApiPropertyOptional({ description: 'UNIX ms timestamp' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  pickupDateTo?: number;

  @ApiPropertyOptional({ description: 'UNIX ms timestamp' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sentFrom?: number;

  @ApiPropertyOptional({ description: 'UNIX ms timestamp' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sentTo?: number;

  // Pagination
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  interval?: number;
}
