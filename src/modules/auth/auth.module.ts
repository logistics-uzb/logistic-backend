import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { SubscriptionExpireCron } from './cron/subscription-expire.cron';
import { PrismaModule } from '@/modules/prisma/prisma.module';
import { JwtConfig } from '@/common/config/app.config';
import { TelegramGatewayModule } from '@/external/telegram-gateway/telegram-gateway.module';

@Module({
  imports: [
    PrismaModule,
    PassportModule,
    JwtModule.register({
      secret: JwtConfig.secret,
      signOptions: { expiresIn: JwtConfig.expiresIn },
    }),
    TelegramGatewayModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, SubscriptionExpireCron],
  exports: [AuthService],
})
export class AuthModule {}
