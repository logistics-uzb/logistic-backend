import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ParseMessageDto {
  @ApiProperty({
    description:
      'Raw Telegram message text to analyse. The backend runs the same classifier + OpenAI extraction pipeline as the scraper ingest, but does NOT persist anything — the structured result is returned so the dispatcher can review/edit before posting via /post/send-to-telegram.',
    example:
      'ТАШКЕНТ → МОСКВА\nГруз 20 тонн, тент\nЦена 2500$ нал\nКонтакт +998901234567',
  })
  @IsString()
  @MinLength(1)
  text: string;
}
