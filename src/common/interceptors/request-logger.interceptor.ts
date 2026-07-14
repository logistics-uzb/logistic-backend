import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';

import { PrismaService } from '@/modules/prisma/prisma.service';

/**
 * Kuzatiladigan path prefikslar. Faqat shu ro'yxatdagi pathlarga tushgan
 * requestlar DB'ga yoziladi — barcha requestlarni yozmaymiz (health/health-check
 * kabi cheksiz shovqindan qochish uchun).
 *
 * Yangi path qo'shish uchun shu massivga qatorni qo'shing (prefiks bo'yicha mos keladi).
 */
const TRACKED_PATH_PREFIXES = [
  '/v1/post/all',
  '/v1/post/formatted',
  '/v1/post/ai-analyser',
  '/v1/post/send-to-telegram',
  '/v1/post/view-increment',
];

function shouldTrack(path: string): boolean {
  return TRACKED_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * Global interceptor — kuzatiladigan endpointlar uchun har chaqiruvni
 * `RequestLog` jadvaliga yozadi. Yozish `fire-and-forget` (await qilinmaydi)
 * — response'ni sekinlashtirmaslik uchun. DB xatosi log'ga yoziladi va
 * asosiy so'rovga ta'sir qilmaydi.
 */
@Injectable()
export class RequestLoggerInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestLoggerInterceptor.name);

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest<any>();
    const res = context.switchToHttp().getResponse<any>();

    const path: string = req.originalUrl?.split('?')[0] ?? req.url ?? '';
    if (!shouldTrack(path)) {
      return next.handle();
    }

    const method: string = req.method ?? 'UNKNOWN';
    const startedAt = Date.now();
    const userId: number | null =
      typeof req.user?.userId === 'number' ? req.user.userId : null;
    const forwarded = req.headers?.['x-forwarded-for'];
    const ip: string | null =
      (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0].trim() ||
      req.ip ||
      null;

    return next.handle().pipe(
      tap({
        next: () => this.persist(path, method, res?.statusCode ?? 200, startedAt, userId, ip),
        error: (err) => {
          const status =
            (err?.status && Number.isFinite(err.status)) ? err.status : 500;
          this.persist(path, method, status, startedAt, userId, ip);
        },
      })
    );
  }

  private persist(
    path: string,
    method: string,
    statusCode: number,
    startedAt: number,
    userId: number | null,
    ip: string | null
  ): void {
    const durationMs = Date.now() - startedAt;
    // Fire-and-forget — response yuborilishini kutmaymiz.
    this.prisma.requestLog
      .create({
        data: {
          path,
          method,
          statusCode,
          durationMs,
          userId: userId ?? undefined,
          ip: ip ?? undefined,
        },
      })
      .catch((err) => {
        this.logger.error(
          `RequestLog yozib bo'lmadi (${method} ${path}): ${err?.message ?? err}`
        );
      });
  }
}
