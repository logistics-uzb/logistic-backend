import { Controller, Get, HttpCode, HttpStatus, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import {
  GetAllInOneDto,
  GetButtonClicksDto,
  GetStatsDto,
} from './dto/get-stats.dto';
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

  @Get('button-clicks-by-vehicle-type')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "ButtonClick × LogisticMessage.vehicleType bo'yicha statistika. Har bucket'da 5 ustun: ac (jami call), av (jami view), fura (tent post'lariga click), isuzu, chakman.",
  })
  async buttonClicksByVehicleType(@Query() dto: GetButtonClicksDto) {
    return this.statsService.getButtonClicksByVehicleType(dto);
  }

  @Get('all-in-one')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Barcha metrikalar bir chaqiruvda: view, call, tg (ButtonClick), getAll (/v1/post/all chaqiruvlari), users (tashqi bot backend). Toshkent timezone, bo'sh bucketlar 0.",
  })
  async allInOne(@Query() dto: GetAllInOneDto) {
    return this.statsService.getAllInOne(dto);
  }

  @Get('users')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Tashqi bot backend userlar statistikasi (proxy). USERS_STATS_API_URL env sozlanishi kerak.',
  })
  async users(@Query() dto: GetAllInOneDto) {
    return this.statsService.getUsersStats(dto);
  }

  @Get('sessions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "PostHog session statistikasi (session replay: davomiylik, unikal userlar). POST_HOG_API_URL/POST_HOG_PROJECT_ID/POST_HOG_API env'lar kerak.",
  })
  async sessions(@Query() dto: GetAllInOneDto) {
    return this.statsService.getSessionsStats(dto);
  }
}
