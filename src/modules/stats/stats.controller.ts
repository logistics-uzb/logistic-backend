import { Controller, Get, HttpCode, HttpStatus, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { GetButtonClicksDto, GetStatsDto } from './dto/get-stats.dto';
import { StatsService } from './stats.service';

/**
 * Endpoint statistika API — RequestLog jadvali ustidan agregatsiya.
 * Ochiq (public) — barcha foydalanuvchilar ko'rishlari mumkin.
 */
@ApiTags('Stats')
@Controller('stats')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get('summary')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Umumiy statistika: jami, muvaffaqiyatli, xato, o\'rtacha vaqt, unikal foydalanuvchilar.',
  })
  @ApiOkResponse({ description: 'Umumiy agregatsiya.' })
  async summary(@Query() dto: GetStatsDto) {
    return this.statsService.getSummary(dto);
  }

  @Get('by-path')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Endpoint (path + method) bo\'yicha chaqiruvlar soni va o\'rtacha davomiyligi.',
  })
  async byPath(@Query() dto: GetStatsDto) {
    return this.statsService.getByPath(dto);
  }

  @Get('timeseries')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Vaqt bo\'yicha bucketlangan chaqiruv sonlari (hour/day/month). Grafik chizish uchun mos.',
  })
  async timeseries(@Query() dto: GetStatsDto) {
    return this.statsService.getTimeseries(dto);
  }

  @Get('button-clicks')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "'Telegram' va 'Qo\\'ng\\'iroq qilish' tugmalari bosilishi statistikasi. Har bucket'da tg va call sonini alohida va jami bilan qaytaradi.",
  })
  async buttonClicks(@Query() dto: GetButtonClicksDto) {
    return this.statsService.getButtonClicksTimeseries(dto);
  }
}
