import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

/**
 * Backend/admin panel uchun to'liq filter DTO.
 * Barcha LogisticMessage maydonlari bo'yicha qidiruv + universal `search`
 * ustunlararo full-text-lite qidiruv (text, title, phoneNumber, channelName,
 * senderFullName, senderTgUsername ustunlarida `contains`, case-insensitive).
 *
 * Bu DTO faqat GET /v1/post/for-backend uchun ishlatiladi — eski
 * GetLogisticsMessagesDto va /v1/post/all endpoint tegilmaydi.
 */
export class BackendPostsQueryDto {
  // ── Universal search ──
  @ApiPropertyOptional({
    description:
      "Bir necha ustunda (text, title, phoneNumber, channelName, senderFullName, senderTgUsername) `contains` qidiruv. Case-insensitive.",
    example: 'toshkent',
  })
  @IsOptional()
  @IsString()
  search?: string;

  // ── Basic ──
  @ApiPropertyOptional() @IsOptional() @IsString() channelName?: string;

  @ApiPropertyOptional({ enum: ['LOAD_POST', 'REGULAR_MESSAGE'] })
  @IsOptional()
  @IsIn(['LOAD_POST', 'REGULAR_MESSAGE'])
  aiStatus?: 'LOAD_POST' | 'REGULAR_MESSAGE';

  @ApiPropertyOptional({ enum: ['SCRAPING', 'DISPATCHER'] })
  @IsOptional()
  @IsIn(['SCRAPING', 'DISPATCHER'])
  source?: 'SCRAPING' | 'DISPATCHER';

  @ApiPropertyOptional({
    description: 'Yaratuvchi user id (masalan qaysi dispatcher yaratgan).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  createdById?: number;

  @ApiPropertyOptional() @IsOptional() @Type(() => Boolean) @IsBoolean() isActual?: boolean;

  @ApiPropertyOptional({ enum: ['TRUE', 'FALSE'] })
  @IsOptional()
  @IsIn(['TRUE', 'FALSE'])
  isComplete?: 'TRUE' | 'FALSE';

  @ApiPropertyOptional({
    enum: ['PENDING', 'QUEUED', 'SENDING', 'SENT', 'PARTIAL', 'FAILED', 'CANCELLED'],
  })
  @IsOptional()
  @IsIn(['PENDING', 'QUEUED', 'SENDING', 'SENT', 'PARTIAL', 'FAILED', 'CANCELLED'])
  sendStatus?:
    | 'PENDING'
    | 'QUEUED'
    | 'SENDING'
    | 'SENT'
    | 'PARTIAL'
    | 'FAILED'
    | 'CANCELLED';

  // ── Route ──
  @ApiPropertyOptional() @IsOptional() @IsString() countryFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() regionFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() countryTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() regionTo?: string;

  // ── Weight ──
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() weightMin?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() weightMax?: number;

  // ── Content/vehicle ──
  @ApiPropertyOptional({ description: '`contains` (insensitive)' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ enum: ['tons', 'pallet'] })
  @IsOptional()
  @IsIn(['tons', 'pallet'])
  cargoUnit?: 'tons' | 'pallet';

  @ApiPropertyOptional({ description: '`contains` (insensitive)' })
  @IsOptional()
  @IsString()
  vehicleType?: string;

  // ── Payment ──
  @ApiPropertyOptional({ enum: ['cash', 'online', 'combo'] })
  @IsOptional()
  @IsIn(['cash', 'online', 'combo'])
  paymentType?: 'cash' | 'online' | 'combo';

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() paymentAmountMin?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() paymentAmountMax?: number;

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

  // ── Phone / sender ──
  @ApiPropertyOptional({ description: 'Telefon `contains` qidiruv' })
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @ApiPropertyOptional({ description: 'Yuboruvchi ismi `contains` qidiruv' })
  @IsOptional()
  @IsString()
  senderFullName?: string;

  @ApiPropertyOptional({ description: "Yuboruvchi Telegram username (aynan)" })
  @IsOptional()
  @IsString()
  senderTgUsername?: string;

  // ── Distance / price ──
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() distanceKmMin?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() distanceKmMax?: number;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() pricePerKmMin?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() pricePerKmMax?: number;

  // ── Engagement counters ──
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) viewCountMin?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) callCountMin?: number;

  // ── Date ranges (UNIX ms) ──
  @ApiPropertyOptional({ description: 'UNIX ms' }) @IsOptional() @Type(() => Number) @IsNumber() pickupDateFrom?: number;
  @ApiPropertyOptional({ description: 'UNIX ms' }) @IsOptional() @Type(() => Number) @IsNumber() pickupDateTo?: number;

  @ApiPropertyOptional({ description: 'UNIX ms' }) @IsOptional() @Type(() => Number) @IsNumber() sentFrom?: number;
  @ApiPropertyOptional({ description: 'UNIX ms' }) @IsOptional() @Type(() => Number) @IsNumber() sentTo?: number;

  @ApiPropertyOptional({ description: 'UNIX ms — createdAt >=' }) @IsOptional() @Type(() => Number) @IsNumber() createdFrom?: number;
  @ApiPropertyOptional({ description: 'UNIX ms — createdAt <=' }) @IsOptional() @Type(() => Number) @IsNumber() createdTo?: number;

  // ── Sorting ──
  @ApiPropertyOptional({
    enum: ['createdAt', 'sentToTelegramAt', 'viewCount', 'callCount', 'paymentAmount', 'distanceKm', 'pricePerKm'],
    default: 'createdAt',
  })
  @IsOptional()
  @IsIn(['createdAt', 'sentToTelegramAt', 'viewCount', 'callCount', 'paymentAmount', 'distanceKm', 'pricePerKm'])
  orderBy?:
    | 'createdAt'
    | 'sentToTelegramAt'
    | 'viewCount'
    | 'callCount'
    | 'paymentAmount'
    | 'distanceKm'
    | 'pricePerKm';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';

  // ── Pagination ──
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, description: 'Max 100' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
