import { Module } from '@nestjs/common';
import { TelegramGatewayService } from './telegram-gateway.service';

@Module({
  providers: [TelegramGatewayService],
  exports: [TelegramGatewayService],
})
export class TelegramGatewayModule {}
