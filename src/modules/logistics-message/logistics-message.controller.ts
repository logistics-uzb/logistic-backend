import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
  ParseMessageDto,
  SendTelegramRawDto,
  SendTelegramStructuredDto,
} from '@/types/logistics-message';
import { UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiExtraModels, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags, getSchemaPath } from '@nestjs/swagger';
import {
  CreateLogisticMessageDto,
  GetLogisticsMessagesDto,
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
  @ApiOkResponse({ description: 'Message sent to active telegram groups' })
  @ApiForbiddenResponse({ description: 'Access denied' })
  async sendToTelegram(
    @Body() body: SendTelegramStructuredDto,
    @Req() req: { user: { userId: number; role: 'ADMIN' | 'DISPATCHER' } }
  ) {
    return this.logisticMessageService.sendToTelegram(body, req.user.userId);
  }

  @Get('all')
  async getAllMessages(@Query() query: GetLogisticsMessagesDto) {
    return this.logisticMessageService.getAllMessages(query);
  }

  @Get('formatted')
  async getAllMessagesWithFormat(@Query() query: GetLogisticsMessagesDto) {
    return this.logisticMessageService.getAllMessagesWithFormat(query);
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

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async deleteMessage(@Param('id') id: string) {
    return this.logisticMessageService.deleteMessage(Number(id));
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
