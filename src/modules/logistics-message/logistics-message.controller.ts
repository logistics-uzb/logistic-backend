import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Delete,
  Query,
  Put,
  Req,
  NotFoundException,
  Sse,
} from '@nestjs/common';
import { PostsService } from './logistics-message.service';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/modules/auth/guards/roles.guard';
import { Roles } from '@/modules/auth/decorators/roles.decorator';
import {
  CallCountDto,
  IncrementCountsDto,
  ParseMessageDto,
  SendResultDto,
  SendTelegramRawDto,
  SendTelegramStructuredDto,
} from '@/types/logistics-message';
import { InternalSecretGuard } from '@/common/guards/internal-secret.guard';
import { UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiExtraModels, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags, getSchemaPath } from '@nestjs/swagger';
import {
  BackendPostsQueryDto,
  CreateLogisticMessageDto,
  GetLogisticsMessagesDto,
  PaginationDto,
  UpdateLogisticMessageDto,
} from '@/types/application';
import { query } from 'express';
import { Observable, from, interval, map, switchMap } from 'rxjs';

@ApiBearerAuth()
@ApiTags('Posts')
@ApiExtraModels(SendTelegramRawDto, SendTelegramStructuredDto)
@Controller('post')
export class PostsController {
  constructor(private readonly logisticMessageService: PostsService) {}

  @Post()
  @ApiBody({ type: CreateLogisticMessageDto })
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() data: CreateLogisticMessageDto): Promise<any> {

    return this.logisticMessageService.create(data);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('DISPATCHER', 'ADMIN')
  @Post('ai-analyser')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'AI analyser: run the classifier + OpenAI extractor on raw text WITHOUT persisting. Returns a structured payload ready to drop into POST /post/send-to-telegram.',
  })
  @ApiBody({ type: ParseMessageDto })
  @ApiOkResponse({
    description:
      'Analysed result with extracted route/metadata fields, classifier verdict, and the raw OpenAI response.',
  })
  @ApiForbiddenResponse({ description: 'Access denied' })
  async aiAnalyser(
    @Body() body: ParseMessageDto,
    @Req() req: { user: { userId: number; role: 'ADMIN' | 'DISPATCHER' } }
  ) {
    return this.logisticMessageService.parseMessage(body.text, req.user.userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('DISPATCHER', 'ADMIN')
  @Post('send-to-telegram')
  @ApiOperation({ summary: 'Send message to Telegram groups (DISPATCHER)' })
  @ApiBody({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(SendTelegramStructuredDto) },
        // { $ref: getSchemaPath(SendTelegramRawDto) },
      ],
    },
  })
  @ApiOkResponse({ description: 'Message queued for Telegram delivery' })
  @ApiForbiddenResponse({ description: 'Access denied' })
  async sendToTelegram(
    @Body() body: SendTelegramStructuredDto,
    @Req() req: { user: { userId: number; role: 'ADMIN' | 'DISPATCHER' } }
  ) {
    return this.logisticMessageService.sendToTelegram(body, req.user.userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('DISPATCHER', 'ADMIN')
  @Post(':id/resend')
  @ApiOperation({
    summary:
      'Post-ni Telegram guruhlarga qayta yuborish. Xuddi shu matn va guruhlar bilan MTPro navbatiga qayta qo\'shiladi.',
  })
  @ApiParam({ name: 'id', type: Number, description: 'LogisticMessage.id' })
  @ApiOkResponse({ description: 'Post re-queued to MTPro' })
  @ApiForbiddenResponse({ description: 'Access denied (not your post)' })
  async resendToTelegram(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: { user: { userId: number; role: 'ADMIN' | 'DISPATCHER' } }
  ) {
    return this.logisticMessageService.resendToTelegram(
      id,
      req.user.userId,
      req.user.role,
    );
  }

  @Post('view-increment')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Bir necha post uchun view yoki call statistikasini +1 oshirish. Ochiq (public) — auth kerak emas, chunki oddiy foydalanuvchilar ham korilayotgan/qo\'ng\'iroq qilingan yuklarni ko\'rishlari kerak.',
  })
  @ApiBody({ type: IncrementCountsDto })
  @ApiOkResponse({
    description:
      'Yangilangan yozuvlar soni qaytariladi. Mavjud bo\'lmagan ID lar jimgina o\'tkazib yuboriladi.',
  })
  async incrementCounts(@Body() dto: IncrementCountsDto) {
    return this.logisticMessageService.incrementCounts(dto);
  }

  @Post('call-count')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Foydalanuvchi 'Telegram' yoki 'Qo\\'ng\\'iroq qilish' tugmasini bosganda chaqiriladi. Har bosish ButtonClick jadvaliga vaqti bilan yoziladi — soatlik/kunlik statistika uchun. Ochiq (public).",
  })
  @ApiBody({ type: CallCountDto })
  @ApiOkResponse({ description: 'Yozildi.' })
  async callCount(@Body() dto: CallCountDto) {
    return this.logisticMessageService.trackButtonClick(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('DISPATCHER', 'ADMIN')
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Cancel a queued dispatcher post. Only allowed while sendStatus = PENDING or QUEUED.',
  })
  async cancelPost(
    @Param('id') id: string,
    @Req() req: { user: { userId: number; role: 'ADMIN' | 'DISPATCHER' } }
  ) {
    return this.logisticMessageService.cancelPost(Number(id), req.user.userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('DISPATCHER', 'ADMIN')
  @Get(':id/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Fetch current MTProto send status for a post (queue position, per-group results).',
  })
  async getSendStatus(@Param('id') id: string) {
    return this.logisticMessageService.getSendStatus(Number(id));
  }

  @Get('all')
  async getAllMessages(@Query() query: GetLogisticsMessagesDto) {
    return this.logisticMessageService.getAllMessages(query);
  }

  @Get('formatted')
  async getAllMessagesWithFormat(@Query() query: GetLogisticsMessagesDto) {
    return this.logisticMessageService.getAllMessagesWithFormat(query);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('for-backend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "ADMIN uchun to'liq filter + universal search + sorting + pagination. Faqat ADMIN roli JWT bilan kira oladi. Barcha LogisticMessage maydonlari bo'yicha qidiruv.",
  })
  @ApiOkResponse({
    description:
      'Filterlangan sahifalangan ro\'yxat. Har post barcha maydonlari bilan + createdBy relation.',
  })
  async getPostsForBackend(@Query() query: BackendPostsQueryDto) {
    return this.logisticMessageService.getPostsForBackend(query);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('DISPATCHER', 'ADMIN')
  @Get('my')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Joriy dispatcher o'zi yuborgan barcha postlar. Faqat pagination (page, limit) — boshqa filter yo'q.",
  })
  @ApiOkResponse({
    description:
      "Dispatcher'ning o'z postlari ro'yxati sahifalash bilan.",
  })
  async getMyPosts(
    @Query() query: PaginationDto,
    @Req() req: { user: { userId: number; role: 'ADMIN' | 'DISPATCHER' } }
  ) {
    return this.logisticMessageService.getMyPosts(req.user.userId, query);
  }

  @Sse('all/sse')
  getAllMessagesSse(@Query() query: GetLogisticsMessagesDto) {
    const intervalMs =
      query.interval && query.interval >= 1000 ? query.interval : 5000; // default


    return interval(intervalMs).pipe(
      switchMap(() => from(this.logisticMessageService.getAllMessages(query))),
      map((data) => ({ data }))
    );
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async getMessage(@Param('id') id: string) {
    return this.logisticMessageService.getMessageById(Number(id));
  }

  @Put(':id')
  @ApiBody({ type: UpdateLogisticMessageDto })
  @HttpCode(HttpStatus.OK)
  async updateMessage(
    @Param('id') id: string,
    @Body() dto: UpdateLogisticMessageDto
  ) {
    return this.logisticMessageService.updateMessage(Number(id), dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('DISPATCHER', 'ADMIN')
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Postni o'chirish. DISPATCHER — faqat o'zi yaratgan postni. ADMIN — istalganini. Boshqaning postini o'chirishga urunish 403 xato beradi.",
  })
  async deleteMessage(
    @Param('id') id: string,
    @Req() req: { user: { userId: number; role: 'ADMIN' | 'DISPATCHER' } }
  ) {
    return this.logisticMessageService.deleteMessage(
      Number(id),
      req.user.userId,
      req.user.role
    );
  }
  // @Patch('restore/:id')
  // @HttpCode(HttpStatus.OK)
  // async restore(
  //   @Param('id') id: string,
  //   @Req() req: RequestWithUser
  // ): Promise<any> {
  //   return this.logisticMessageService.restore(id, req);
  // }
}
