import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';

import { PrismaService } from '@/modules/prisma/prisma.service';

import { GetStatsDto } from './dto/get-stats.dto';

/**
 * RequestLog jadvali ustidan agregatsiya. Barcha filterlar ixtiyoriy —
 * berilmasa umumiy statistika qaytadi.
 */
@Injectable()
export class StatsService {
  private readonly logger = new Logger(StatsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Umumiy sonlar: jami, muvaffaqiyatli (2xx), xatolar (>=400),
   * o'rtacha davomiylik, unikal userlar.
   */
  async getSummary(dto: GetStatsDto) {
    const where = this.buildWhere(dto);

    const [total, byStatus, avgDuration, uniqueUsers] = await Promise.all([
      this.prisma.requestLog.count({ where }),
      this.prisma.requestLog.groupBy({
        by: ['statusCode'],
        where,
        _count: { _all: true },
      }),
      this.prisma.requestLog.aggregate({
        where,
        _avg: { durationMs: true },
      }),
      this.prisma.requestLog.findMany({
        where: { ...where, userId: { not: null } },
        distinct: ['userId'],
        select: { userId: true },
      }),
    ]);

    const success = byStatus
      .filter((s) => s.statusCode >= 200 && s.statusCode < 300)
      .reduce((sum, s) => sum + s._count._all, 0);
    const errors = byStatus
      .filter((s) => s.statusCode >= 400)
      .reduce((sum, s) => sum + s._count._all, 0);

    return {
      total,
      success,
      errors,
      avgDurationMs: Math.round(avgDuration._avg.durationMs ?? 0),
      uniqueUsers: uniqueUsers.length,
      byStatus: byStatus.map((s) => ({
        statusCode: s.statusCode,
        count: s._count._all,
      })),
    };
  }

  /**
   * Path bo'yicha guruhlash — qaysi endpoint qancha marta chaqirilgan.
   */
  async getByPath(dto: GetStatsDto) {
    const where = this.buildWhere(dto);
    const rows = await this.prisma.requestLog.groupBy({
      by: ['path', 'method'],
      where,
      _count: { _all: true },
      _avg: { durationMs: true },
      orderBy: { _count: { path: 'desc' } },
    });

    return rows.map((r) => ({
      path: r.path,
      method: r.method,
      count: r._count._all,
      avgDurationMs: Math.round(r._avg.durationMs ?? 0),
    }));
  }

  /**
   * Timeseries — vaqt bo'yicha bucketlangan sonlar.
   * PostgreSQL `date_trunc` orqali agregatsiya (Prisma groupBy custom bucketni
   * qo'llab-quvvatlamaydi, shuning uchun $queryRaw ishlatamiz).
   */
  async getTimeseries(dto: GetStatsDto) {
    const bucket = dto.bucket ?? 'day';

    // SQL injection'dan himoya: bucket faqat oldindan tanlangan qiymatlardan bo'ladi.
    const truncUnit: Record<'hour' | 'day' | 'month', string> = {
      hour: 'hour',
      day: 'day',
      month: 'month',
    };
    const unit = truncUnit[bucket];

    const conditions: Prisma.Sql[] = [];
    if (dto.path) {
      conditions.push(Prisma.sql`"path" LIKE ${dto.path + '%'}`);
    }
    if (dto.method) {
      conditions.push(Prisma.sql`"method" = ${dto.method}`);
    }
    if (dto.from) {
      conditions.push(Prisma.sql`"createdAt" >= ${new Date(dto.from)}`);
    }
    if (dto.to) {
      conditions.push(Prisma.sql`"createdAt" <= ${new Date(dto.to)}`);
    }
    const whereSql =
      conditions.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
        : Prisma.empty;

    const rows: Array<{ bucket: Date; count: bigint }> =
      await this.prisma.$queryRaw(
        Prisma.sql`
          SELECT date_trunc(${unit}, "createdAt") AS bucket, COUNT(*)::bigint AS count
          FROM "RequestLog"
          ${whereSql}
          GROUP BY bucket
          ORDER BY bucket ASC
        `
      );

    return {
      bucket,
      points: rows.map((r) => ({
        at: r.bucket.toISOString(),
        count: Number(r.count),
      })),
    };
  }

  private buildWhere(dto: GetStatsDto): Prisma.RequestLogWhereInput {
    const where: Prisma.RequestLogWhereInput = {};
    if (dto.path) where.path = { startsWith: dto.path };
    if (dto.method) where.method = dto.method;
    if (dto.from || dto.to) {
      where.createdAt = {
        ...(dto.from ? { gte: new Date(dto.from) } : {}),
        ...(dto.to ? { lte: new Date(dto.to) } : {}),
      };
    }
    return where;
  }

  /**
   * 30 kundan eski RequestLog yozuvlarini o'chirib boradi.
   * Har kunlik ishga tushadi (00:00 UTC).
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async deleteOldRequestLogsCron(): Promise<void> {
    const threshold = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result = await this.prisma.requestLog.deleteMany({
      where: { createdAt: { lt: threshold } },
    });
    if (result.count > 0) {
      this.logger.log(
        `deleteOldRequestLogsCron: ${result.count} ta eski yozuv o'chirildi`
      );
    }
  }
}
