import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class SendTelegramStructuredDto {
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
    example: '+998901234567',
    description: 'Contact phone number',
  })
  @IsOptional()
  @IsString()
  phone_number?: string;

  @ApiPropertyOptional({
    example: 'Tezkor yuk',
    description: 'Additional description',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'Raw message text to send to Telegram groups',
    example: '🔥 Yuk bor! Toshkent → Moskva...',
  })
  @IsString()
  @MinLength(1)
  message: string;

  @ApiProperty({
    description: 'Whether this is a message post or not',
    example: true,
  })
  @IsBoolean()
  isMessage: boolean;
}
