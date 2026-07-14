import { Controller, Get, HttpCode, HttpStatus, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/modules/auth/guards/roles.guard';
import { Roles } from '@/modules/auth/decorators/roles.decorator';

import { GetStatsDto } from './dto/get-stats.dto';
import { StatsService } from './stats.service';

/**
 * Endpoint statistika API — RequestLog jadvali ustidan agregatsiya.
 * Faqat ADMIN kira oladi (dispatcherlarga ehtiyoj yo'q).
 */
@ApiBearerAuth()
@ApiTags('Stats')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
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
}
