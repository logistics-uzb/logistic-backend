import { Module, forwardRef } from '@nestjs/common';

import { PostsController } from './logistics-message.controller';
import { InternalController } from './internal.controller';
import { PostsService } from './logistics-message.service';

import { TelegramModule } from '@/external/telegram/telegram.module';
import { OpenaiModule } from '../openai/openai.module';
import { LogisticsGatewayModule } from '../notification-gateway/notifications-gateway.module';
import { InternalSecretGuard } from '@/common/guards/internal-secret.guard';

@Module({
  imports: [
    forwardRef(() => LogisticsGatewayModule),
    forwardRef(() => TelegramModule),
    OpenaiModule,
  ],
  controllers: [PostsController, InternalController],
  providers: [PostsService, InternalSecretGuard],
  exports: [PostsService],
})
export class PostsModule {}
