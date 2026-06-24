import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class SendTelegramStructuredDto {
  @ApiPropertyOptional({
    enum: ['LOAD_POST', 'REGULAR_MESSAGE'],
    default: 'LOAD_POST',
    description:
      'Echoed back from /post/ai-analyser. Defaults to LOAD_POST so dispatcher-built loads stay LOAD_POST; pass REGULAR_MESSAGE to broadcast an informational/non-load message.',
  })
  @IsOptional()
  @IsIn(['LOAD_POST', 'REGULAR_MESSAGE'])
  aiStatus?: 'LOAD_POST' | 'REGULAR_MESSAGE';

  @ApiProperty({ example: 'Uzbekistan', description: 'Origin country' })
  @IsString()
  countryFrom: string;

  @ApiPropertyOptional({ example: 'Tashkent', description: 'Origin region' })
  @IsOptional()
  @IsString()
  regionFrom?: string;

  @ApiProperty({ example: 'Russia', description: 'Destination country' })
  @IsString()
  countryTo: string;

  @ApiPropertyOptional({ example: 'Moscow', description: 'Destination region' })
  @IsOptional()
  @IsString()
  regionTo?: string;

  @ApiProperty({ example: 'Yuk bor', description: 'Title for the message' })
  @IsString()
  title: string;

  @ApiPropertyOptional({ example: '20', description: 'Weight value' })
  @IsOptional()
  @IsString()
  weight?: string;

  @ApiPropertyOptional({ example: 'tons', description: 'Weight unit' })
  @IsOptional()
  @IsString()
  cargoUnit?: string;

  @ApiPropertyOptional({
    example: '82 m3',
    description: 'Capacity information',
  })
  @IsOptional()
  @IsString()
  capacity?: string;

  @ApiPropertyOptional({ example: 'TENT', description: 'Vehicle type' })
  @IsOptional()
  @IsString()
  vehicleType?: string;

  @ApiPropertyOptional({ example: 'EURO', description: 'Vehicle body type' })
  @IsOptional()
  @IsString()
  vehicleBodyType?: string;

  @ApiPropertyOptional({ example: 'cash', description: 'Payment type' })
  @IsOptional()
  @IsString()
  paymentType?: string;

  @ApiPropertyOptional({ example: '2500', description: 'Payment amount' })
  @IsOptional()
  @IsString()
  paymentAmount?: string;

  @ApiPropertyOptional({ example: 'usd', description: 'Payment currency' })
  @IsOptional()
  @IsString()
  paymentCurrency?: string;

  @ApiPropertyOptional({
    example: '2026-02-10',
    description: 'Pickup date (YYYY-MM-DD)',
  })
  @IsOptional()
  @IsDateString()
  pickupDate?: string;

  @ApiPropertyOptional({
    example: 'Tezkor yuk',
    description: 'Additional description',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description:
      'Raw message text. Required only when isMessage=true. Otherwise the backend builds the message from the structured fields above.',
  })
  @ValidateIf((o) => o.isMessage === true)
  @IsString()
  @MinLength(1)
  message?: string;

  @ApiPropertyOptional({
    description:
      'true → use the raw `message` field as-is. false/omitted → backend builds the message from the structured fields above.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isMessage?: boolean;
}
