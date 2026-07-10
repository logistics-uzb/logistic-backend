import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsIn } from 'class-validator';

/**
 * Frontend yuboradigan payload — postlarning ko'rish/qo'ng'iroq statistikasini
 * yig'ish uchun. Bir chaqiruvda bir necha post ID uchun bir xil turdagi
 * increment jo'natish mumkin.
 *
 * Misol:
 *   { "type": "view", "loadIds": ["12", "15", "18"] }
 *   → 3 ta postning viewCount ustuni +1 bo'ladi.
 */
export class IncrementCountsDto {
  @ApiProperty({
    enum: ['view', 'call'],
    description:
      'Qaysi ustun oshiriladi: `view` → viewCount, `call` → callCount.',
  })
  @IsIn(['view', 'call'])
  type: 'view' | 'call';

  @ApiProperty({
    type: [String],
    example: ['12', '15', '18'],
    description:
      'Statistikasi oshirilishi kerak bo\'lgan LogisticMessage id ro\'yxati (string yoki number).',
  })
  @IsArray()
  @ArrayNotEmpty()
  loadIds: (string | number)[];
}
