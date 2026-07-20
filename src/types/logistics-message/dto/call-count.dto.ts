import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';

/**
 * Frontend har safar "Telegram" yoki "Qo'ng'iroq qilish" tugmasi bosilganda
 * jo'natadi. Har bosish ButtonClick jadvaliga alohida yozuv sifatida
 * tushadi — soatlik/kunlik grafik uchun.
 */
export class CallCountDto {
  @ApiProperty({
    enum: ['tg', 'call'],
    description:
      "Qaysi tugma bosilgan: 'tg' — Telegram, 'call' — Qo'ng'iroq qilish.",
  })
  @IsIn(['tg', 'call'])
  type: 'tg' | 'call';

  @ApiPropertyOptional({
    example: 123,
    description:
      "Qaysi post uchun bosilgan (ixtiyoriy — analitikada foydali).",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  loadId?: number;
}
