import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Python MTProto worker Node backendga callback qilganda ishlatiladigan guard.
 * `X-Internal-Secret` header .env dagi `MTPROTO_SHARED_SECRET` bilan solishtiriladi.
 * Public foydalanuvchilar bu endpointlarga kira olmasligi kerak — ular faqat
 * internal service-to-service muloqot uchun.
 */
@Injectable()
export class InternalSecretGuard implements CanActivate {
  private readonly logger = new Logger(InternalSecretGuard.name);

  constructor(private readonly configService: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{
      headers: Record<string, string | string[]>;
      ip?: string;
    }>();

    const raw = req.headers['x-internal-secret'];
    const provided = Array.isArray(raw) ? raw[0] : raw;
    const expected = this.configService.get<string>('MTPROTO_SHARED_SECRET');

    if (!expected) {
      this.logger.error('MTPROTO_SHARED_SECRET .env da yo\'q');
      throw new UnauthorizedException('Internal auth not configured');
    }
    if (!provided || provided !== expected) {
      this.logger.warn(
        `Notog'ri internal secret ip=${req.ip ?? '-'} providedLen=${provided?.length ?? 0}`
      );
      throw new UnauthorizedException('Invalid internal secret');
    }
    return true;
  }
}
