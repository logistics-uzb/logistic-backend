import {
  Body,
  Controller,
  Delete,
  Get,
  Query,
  ParseIntPipe,
  Param,
  Patch,
  Post,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TelegramGroupService } from './telegram-group.service';
import {
  BulkCreateTelegramGroupDto,
  CreateTelegramGroupDto,
  QueryTelegramGroupDto,
  UpdateTelegramGroupDto,
} from '@/types/telegram-group';
import {
  ApiBearerAuth,
  ApiBody,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/modules/auth/guards/roles.guard';
import { Roles } from '@/modules/auth/decorators/roles.decorator';

@ApiTags('Telegram-groups')
@ApiBearerAuth()
@Controller('telegram-groups')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TelegramGroupController {
  constructor(private readonly telegramGroupService: TelegramGroupService) {}

  @Roles('ADMIN', 'DISPATCHER')
  @Get('by-id/:id')
  @ApiOperation({ summary: 'Get telegram group by ID' })
  @ApiParam({ name: 'id', type: Number })
  async findById(@Param('id', ParseIntPipe) id: number) {
    return this.telegramGroupService.findById(id);
  }

  @Roles('ADMIN')
  @Post()
  @ApiOperation({ summary: 'Create telegram group (ADMIN)' })
  @ApiBody({ type: CreateTelegramGroupDto })
  @ApiForbiddenResponse({ description: 'Access denied' })
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateTelegramGroupDto) {
    return this.telegramGroupService.create(dto);
  }

  @Roles('ADMIN')
  @Post('bulk')
  @ApiOperation({
    summary:
      'Bulk create/seed telegram groups (ADMIN). ' +
      'Duplikatlar skipdaduplicates orqali jimjit tashlab yuboriladi.',
  })
  @ApiBody({ type: BulkCreateTelegramGroupDto })
  @ApiOkResponse({
    description:
      "Statistika: { received, valid, created, skipped_duplicates, invalid: [{index, reason}] }",
  })
  @HttpCode(HttpStatus.OK)
  async bulkCreate(@Body() dto: BulkCreateTelegramGroupDto) {
    return this.telegramGroupService.createMany(dto);
  }

  @Roles('ADMIN', 'DISPATCHER')
  @Get()
  @ApiOperation({ summary: 'Get telegram groups with filters' })
  @ApiQuery({ name: 'username', required: false })
  @ApiQuery({ name: 'title', required: false })
  @ApiQuery({ name: 'isActive', required: false, enum: ['TRUE', 'FALSE'] })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async findAll(@Query() query: QueryTelegramGroupDto) {
    return this.telegramGroupService.findAll(query);
  }

  @Roles('ADMIN')
  @Patch(':id')
  @ApiOperation({ summary: 'Update telegram group (ADMIN)' })
  @ApiParam({ name: 'id', type: Number })
  @ApiBody({ type: UpdateTelegramGroupDto })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTelegramGroupDto,
  ) {
    return this.telegramGroupService.update(id, dto);
  }

  @Roles('ADMIN')
  @Delete(':id')
  @ApiOperation({ summary: 'Deactivate telegram group (ADMIN)' })
  @ApiParam({ name: 'id', type: Number })
  async deactivate(@Param('id', ParseIntPipe) id: number) {
    return this.telegramGroupService.deactivate(id);
  }
}
