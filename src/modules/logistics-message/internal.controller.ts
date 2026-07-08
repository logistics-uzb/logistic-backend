import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { PostsService } from './logistics-message.service';
import { InternalSecretGuard } from '@/common/guards/internal-secret.guard';
import { SendResultDto } from '@/types/logistics-message';

/**
 * Service-to-service endpointlar. Faqat Python MTProto worker ishlatadi.
 * Auth: `X-Internal-Secret` header MTPROTO_SHARED_SECRET env bilan mos kelishi shart.
 *
 * NB: Bu kontrollerdan JWT/RolesGuard olib tashlandi — chunki Python service
 * hisobga olinmagan JWT token yubora olmaydi. Shu sababli shared secret bilan
 * himoyalanadi.
 */
@ApiTags('Internal (MTProto worker)')
@UseGuards(InternalSecretGuard)
@Controller('internal')
export class InternalController {
  constructor(private readonly postsService: PostsService) {}

  @Post('send-result')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Python MTProto worker natijalarini qabul qiladi. Guruh xatolari BlockedGroup jadvaliga yoziladi.',
  })
  async sendResult(@Body() body: SendResultDto) {
    return this.postsService.applySendResult(body);
  }
}
